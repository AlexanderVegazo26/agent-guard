import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import type { Duplex } from "node:stream";
import * as tls from "node:tls";
import selfsigned from "selfsigned";
import type { FaultSpec } from "@agent-guard/core";

/**
 * §7 — fault injection and the network proxy. Real implementation: a plain
 * HTTP proxy plus HTTPS MITM (CONNECT tunnelling, terminated locally with a
 * per-host certificate signed by a locally generated CA — never installed
 * system-wide, per TRD §7's notes). This is the mechanism PRD §8.5
 * provisionally selects; Playwright route interception is the documented
 * fallback if Phase 0 question 8 resolves against it (not built here).
 *
 * What this file does NOT attempt: fidelity parity-testing against an
 * unproxied baseline (TRD §12, "proxy fidelity" — an open risk), and it has
 * not been wired to a real MCP-owned browser's launch options — see the
 * project's top-level notes on what's built vs. declared.
 */

export interface RecordedNetworkEvent {
  method: string;
  url: string;
  status?: number;
  timingMs?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: unknown;
  responseBody?: unknown;
  bodyTruncated?: boolean;
  error?: string;
}

export interface FaultProxy {
  start(): Promise<{ port: number; caCert?: Buffer }>;
  inject(fault: FaultSpec): void;
  events(): RecordedNetworkEvent[];
  stop(): Promise<void>;
}

interface CompiledFault {
  spec: FaultSpec;
  matches: (url: string) => boolean;
  timesRemaining: number;
}

interface Pem {
  key: string;
  cert: string;
}

const MAX_BODY_BYTES = 4096;

export interface HttpFaultProxyOptions {
  /**
   * The `https.Agent` used for the OUTBOUND leg to the real upstream (never
   * for the inbound MITM leg, which always uses the freshly generated
   * local CA). Defaults to `https.globalAgent`, i.e. ordinary system trust
   * validation — overriding this to trust an additional CA is how a test
   * upstream with its own self-signed certificate can be exercised without
   * weakening validation for real targets. Never set `rejectUnauthorized`
   * globally to work around this; scope trust to the agent instead.
   */
  upstreamHttpsAgent?: https.Agent;
}

export class HttpFaultProxy implements FaultProxy {
  private server: http.Server | null = null;
  private ca: Pem | null = null;
  private readonly hostCertCache = new Map<string, Pem>();
  private readonly faults: CompiledFault[] = [];
  private readonly recorded: RecordedNetworkEvent[] = [];
  private readonly upstreamHttpsAgent: https.Agent;

  constructor(options: HttpFaultProxyOptions = {}) {
    this.upstreamHttpsAgent = options.upstreamHttpsAgent ?? https.globalAgent;
  }

  async start(): Promise<{ port: number; caCert?: Buffer }> {
    this.ca = await generateCA();

    this.server = http.createServer((req, res) => {
      void this.proxyPlainRequest(req, res);
    });
    this.server.on("connect", (req, clientSocket, head) => {
      void this.handleConnect(req, clientSocket, head);
    });

    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    const address = this.server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    return { port, caCert: Buffer.from(this.ca.cert) };
  }

  inject(fault: FaultSpec): void {
    this.faults.push({
      spec: fault,
      matches: (url) => url.includes(fault.url),
      timesRemaining: fault.type === "http" ? fault.times ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY,
    });
  }

  events(): RecordedNetworkEvent[] {
    return [...this.recorded];
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }

  // ---------------------------------------------------------------------
  // Plain HTTP — the request line carries an absolute URL for a proxied request.
  // ---------------------------------------------------------------------

  private async proxyPlainRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const targetUrl = req.url ?? "";
    await this.proxyRequest(req, res, targetUrl, false);
  }

  // ---------------------------------------------------------------------
  // HTTPS MITM — CONNECT tunnel, terminated locally with a minted cert.
  // ---------------------------------------------------------------------

  private async handleConnect(req: http.IncomingMessage, clientSocket: Duplex, _head: Buffer): Promise<void> {
    const target = req.url ?? "";
    const [host, portStr] = target.split(":");
    if (!host) {
      clientSocket.destroy();
      return;
    }
    const upstreamPort = Number(portStr || "443");

    let cert: Pem;
    try {
      cert = await this.certFor(host);
    } catch {
      clientSocket.destroy();
      return;
    }

    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");

    const tlsSocket = new tls.TLSSocket(clientSocket, { isServer: true, key: cert.key, cert: cert.cert });
    tlsSocket.on("error", () => clientSocket.destroy());

    const innerServer = http.createServer((innerReq, innerRes) => {
      const targetUrl = `https://${host}${innerReq.url ?? ""}`;
      void this.proxyRequest(innerReq, innerRes, targetUrl, true, host, upstreamPort);
    });
    innerServer.emit("connection", tlsSocket);
  }

  private async certFor(host: string): Promise<Pem> {
    const cached = this.hostCertCache.get(host);
    if (cached) return cached;
    if (!this.ca) throw new Error("HttpFaultProxy: start() must be called before intercepting HTTPS");

    const pems = await selfsigned.generate([{ name: "commonName", value: host }], {
      keySize: 2048,
      algorithm: "sha256",
      ca: this.ca,
      extensions: [
        { name: "basicConstraints", cA: false },
        { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
        { name: "extKeyUsage", serverAuth: true },
        { name: "subjectAltName", altNames: [net.isIP(host) ? { type: 7, ip: host } : { type: 2, value: host }] },
      ],
    });
    const pem: Pem = { key: pems.private, cert: pems.cert };
    this.hostCertCache.set(host, pem);
    return pem;
  }

  // ---------------------------------------------------------------------
  // Shared forwarding path: check faults, else forward to the real upstream.
  // ---------------------------------------------------------------------

  private findFault(url: string): CompiledFault | undefined {
    return this.faults.find((f) => f.matches(url) && f.timesRemaining > 0);
  }

  private record(event: RecordedNetworkEvent): void {
    this.recorded.push(event);
  }

  private async proxyRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    targetUrl: string,
    isTls: boolean,
    hostOverride?: string,
    portOverride?: number,
  ): Promise<void> {
    const startedAt = Date.now();
    const method = req.method ?? "GET";
    const requestBodyRaw = await readBody(req);
    const fault = this.findFault(targetUrl);

    if (fault?.spec.type === "http") {
      fault.timesRemaining -= 1;
      const status = fault.spec.status;
      const responseBodyRaw = JSON.stringify(fault.spec.body ?? { error: "Injected fault", status });
      res.writeHead(status, { "content-type": "application/json" });
      res.end(responseBodyRaw);
      this.record({
        method,
        url: targetUrl,
        status,
        timingMs: Date.now() - startedAt,
        requestBody: safeParseJson(requestBodyRaw),
        responseBody: safeParseJson(responseBodyRaw),
      });
      return;
    }

    let url: URL;
    try {
      url = new URL(targetUrl);
    } catch {
      res.writeHead(400);
      res.end("Bad Request");
      return;
    }

    const outboundHeaders: http.OutgoingHttpHeaders = { ...req.headers };
    delete outboundHeaders["proxy-connection"];
    delete outboundHeaders.connection;
    delete outboundHeaders.host;

    const client = isTls ? https : http;
    const upstreamReq = client.request(
      {
        hostname: hostOverride ?? url.hostname,
        port: portOverride ?? Number(url.port || (isTls ? 443 : 80)),
        path: url.pathname + url.search,
        method,
        headers: outboundHeaders,
        ...(isTls ? { agent: this.upstreamHttpsAgent } : {}),
      },
      (upstreamRes) => {
        const chunks: Buffer[] = [];
        upstreamRes.on("data", (chunk: Buffer) => chunks.push(chunk));
        upstreamRes.on("end", () => {
          let bodyBuffer = Buffer.concat(chunks);
          let bodyText = bodyBuffer.toString("utf8");

          if (fault?.spec.type === "prompt-injection") {
            fault.timesRemaining -= 1;
            const parsed = safeParseJson(bodyText);
            if (parsed !== undefined && typeof parsed === "object" && parsed !== null) {
              (parsed as Record<string, unknown>)[fault.spec.field] = fault.spec.payload;
              bodyText = JSON.stringify(parsed);
              bodyBuffer = Buffer.from(bodyText, "utf8");
            }
          }

          // The buffered body is re-framed with a fresh Content-Length; the
          // upstream's own framing header must not travel with it, or Node
          // refuses to write both on the same response.
          const responseHeaders = { ...upstreamRes.headers };
          delete responseHeaders["transfer-encoding"];
          delete responseHeaders["content-length"];
          responseHeaders["content-length"] = String(bodyBuffer.byteLength);
          res.writeHead(upstreamRes.statusCode ?? 502, responseHeaders as http.OutgoingHttpHeaders);
          res.end(bodyBuffer);

          const truncated = bodyText.length > MAX_BODY_BYTES;
          this.record({
            method,
            url: targetUrl,
            status: upstreamRes.statusCode,
            timingMs: Date.now() - startedAt,
            requestHeaders: headersToRecord(outboundHeaders),
            responseHeaders: headersToRecord(upstreamRes.headers),
            requestBody: safeParseJson(requestBodyRaw),
            responseBody: safeParseJson(truncated ? bodyText.slice(0, MAX_BODY_BYTES) : bodyText),
            bodyTruncated: truncated || undefined,
          });
        });
      },
    );

    upstreamReq.on("error", (err) => {
      if (!res.headersSent) {
        res.writeHead(502);
        res.end("Bad Gateway");
      }
      this.record({ method, url: targetUrl, timingMs: Date.now() - startedAt, error: String(err) });
    });

    if (requestBodyRaw.length > 0) upstreamReq.write(requestBodyRaw);
    upstreamReq.end();
  }
}

async function generateCA(): Promise<Pem> {
  const pems = await selfsigned.generate([{ name: "commonName", value: "AgentGuard Local Test CA" }], {
    keySize: 2048,
    algorithm: "sha256",
    extensions: [
      { name: "basicConstraints", cA: true, critical: true },
      { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
    ],
  });
  return { key: pems.private, cert: pems.cert };
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function safeParseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function headersToRecord(headers: http.IncomingHttpHeaders | http.OutgoingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out[key] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return out;
}
