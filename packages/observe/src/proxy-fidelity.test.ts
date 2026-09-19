import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import * as tls from "node:tls";
import selfsigned from "selfsigned";
import { afterEach, describe, expect, it } from "vitest";
import { HttpFaultProxy } from "./proxy.js";

/**
 * TRD §12's flagged open risk: "An HTTP proxy can change timing,
 * connection reuse and HTTP/2 behavior in ways that alter application
 * behavior ... Needs a parity check against an unproxied baseline."
 *
 * This checks the dimensions that matter most for evidence fidelity —
 * response status, headers and body content arrive unchanged when no
 * fault is injected — by making the *same* request both directly and
 * through the proxy and diffing the results. It does not cover HTTP/2 or
 * connection-reuse behavior (this proxy and Node's `http`/`https` clients
 * here are both HTTP/1.1 only), and it does not attempt to characterize
 * timing overhead precisely — those remain open, as the TRD says.
 */

interface Upstream {
  port: number;
  close: () => Promise<void>;
}

async function startEchoUpstream(): Promise<Upstream> {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString("utf8")));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json", "x-custom-header": "custom-value" });
      res.end(JSON.stringify({ method: req.method, path: req.url, echo: body ? JSON.parse(body) : null }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  return { port, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

function requestDirect(port: number, path: string, body?: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method: body ? "POST" : "GET", headers: body ? { "content-type": "application/json" } : {} },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c.toString("utf8")));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }));
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function requestViaProxy(proxyPort: number, targetUrl: string, body?: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: proxyPort, path: targetUrl, method: body ? "POST" : "GET", headers: body ? { "content-type": "application/json" } : {} },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c.toString("utf8")));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }));
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

describe("HttpFaultProxy — fidelity parity against an unproxied baseline", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.all(cleanups.map((fn) => fn()));
    cleanups.length = 0;
  });

  it("returns byte-identical status, body and application headers for a GET, proxied vs. direct", async () => {
    const upstream = await startEchoUpstream();
    cleanups.push(upstream.close);
    const proxy = new HttpFaultProxy();
    const { port: proxyPort } = await proxy.start();
    cleanups.push(() => proxy.stop());

    const direct = await requestDirect(upstream.port, "/api/todos");
    const proxied = await requestViaProxy(proxyPort, `http://127.0.0.1:${upstream.port}/api/todos`);

    expect(proxied.status).toBe(direct.status);
    expect(proxied.body).toBe(direct.body);
    expect(proxied.headers["content-type"]).toBe(direct.headers["content-type"]);
    expect(proxied.headers["x-custom-header"]).toBe(direct.headers["x-custom-header"]);
  });

  it("returns byte-identical status and body for a POST with a JSON body, proxied vs. direct", async () => {
    const upstream = await startEchoUpstream();
    cleanups.push(upstream.close);
    const proxy = new HttpFaultProxy();
    const { port: proxyPort } = await proxy.start();
    cleanups.push(() => proxy.stop());

    const payload = JSON.stringify({ item: "milk", qty: 2 });
    const direct = await requestDirect(upstream.port, "/api/cart", payload);
    const proxied = await requestViaProxy(proxyPort, `http://127.0.0.1:${upstream.port}/api/cart`, payload);

    expect(proxied.status).toBe(direct.status);
    expect(proxied.body).toBe(direct.body);
    expect(JSON.parse(proxied.body).echo).toEqual({ item: "milk", qty: 2 });
  });

  it("returns the same body over the HTTPS MITM tunnel as a direct TLS request to the same upstream", async () => {
    const ca = await selfsigned.generate([{ name: "commonName", value: "Test Upstream CA" }], {
      keySize: 2048,
      algorithm: "sha256",
      extensions: [
        { name: "basicConstraints", cA: true, critical: true },
        { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
      ],
    });
    const leaf = await selfsigned.generate([{ name: "commonName", value: "127.0.0.1" }], {
      keySize: 2048,
      algorithm: "sha256",
      ca: { key: ca.private, cert: ca.cert },
      extensions: [
        { name: "basicConstraints", cA: false },
        { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
        { name: "extKeyUsage", serverAuth: true },
        { name: "subjectAltName", altNames: [{ type: 7, ip: "127.0.0.1" }] },
      ],
    });
    const server = https.createServer({ key: leaf.private, cert: leaf.cert }, (req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ secure: true, path: req.url }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const upstreamPort = (server.address() as net.AddressInfo).port;
    cleanups.push(() => new Promise((resolve) => server.close(() => resolve())));

    const direct = await requestDirectTls(upstreamPort, ca.cert, "/secure/data");
    expect(direct.status).toBe(200);
    expect(JSON.parse(direct.body)).toEqual({ secure: true, path: "/secure/data" });

    const proxy = new HttpFaultProxy({ upstreamHttpsAgent: new https.Agent({ ca: ca.cert }) });
    const { port: proxyPort, caCert } = await proxy.start();
    cleanups.push(() => proxy.stop());

    const proxied = await requestViaHttpsProxy(proxyPort, caCert!, "127.0.0.1", upstreamPort, "/secure/data");

    expect(proxied.status).toBe(direct.status);
    expect(proxied.body).toBe(direct.body);
  });
});

function requestDirectTls(port: number, caCert: string, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request({ host: "127.0.0.1", port, path, agent: new https.Agent({ ca: caCert }) }, (res) => {
      let data = "";
      res.on("data", (c: Buffer) => (data += c.toString("utf8")));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on("error", reject);
    req.end();
  });
}

function connectThroughProxy(proxyPort: number, targetHost: string, targetPort: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(proxyPort, "127.0.0.1", () => {
      socket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`);
    });
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      if (buffer.includes("\r\n\r\n")) {
        socket.removeListener("data", onData);
        if (buffer.startsWith("HTTP/1.1 200")) resolve(socket);
        else reject(new Error(`CONNECT failed: ${buffer}`));
      }
    };
    socket.on("data", onData);
    socket.on("error", reject);
  });
}

async function requestViaHttpsProxy(
  proxyPort: number,
  proxyCaCert: Buffer,
  targetHost: string,
  targetPort: number,
  path: string,
): Promise<{ status: number; body: string }> {
  const rawSocket = await connectThroughProxy(proxyPort, targetHost, targetPort);
  const tlsSocket = tls.connect({ socket: rawSocket, ca: proxyCaCert, checkServerIdentity: () => undefined });
  await new Promise<void>((resolve, reject) => {
    tlsSocket.once("secureConnect", resolve);
    tlsSocket.once("error", reject);
  });

  return new Promise((resolve, reject) => {
    let raw = "";
    tlsSocket.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
    tlsSocket.on("end", () => {
      const [head, ...rest] = raw.split("\r\n\r\n");
      const status = Number(head!.split("\r\n")[0]!.split(" ")[1]);
      resolve({ status, body: rest.join("\r\n\r\n") });
    });
    tlsSocket.on("error", reject);
    tlsSocket.write([`GET ${path} HTTP/1.1`, `Host: ${targetHost}`, "Connection: close", "", ""].join("\r\n"));
  });
}
