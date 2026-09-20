import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import type { Duplex } from "node:stream";
import * as tls from "node:tls";
import selfsigned from "selfsigned";
import { CaptureSink, DefaultRedactor, type FaultSpec, type Redactor } from "@alexvegman/core";

/**
 * §7 — fault injection and the network proxy. Real implementation: a plain
 * HTTP proxy plus HTTPS MITM (CONNECT tunnelling, terminated locally with a
 * per-host certificate signed by a locally generated CA — never installed
 * system-wide, per TRD §7's notes). This is the mechanism PRD §8.5
 * provisionally selects; Playwright route interception is the documented
 * fallback if Phase 0 question 8 resolves against it (not built here).
 *
 * PRD3 D3: this comment used to say fidelity parity-testing against an
 * unproxied baseline "is not attempted" (TRD §12). It now is —
 * `proxy-fidelity.test.ts` runs GET, JSON POST and HTTPS-MITM requests both
 * with and without the proxy and asserts byte-identical bodies; see that
 * file's own header for what it deliberately does not cover (HTTP/2,
 * connection reuse, timing overhead). Still not attempted: this proxy has
 * not been wired to a real MCP-owned browser's launch options — a caller
 * (e.g. the Playwright fixture) is responsible for pointing a browser's
 * proxy/CA-trust settings at `proxyInfo()`'s output once a fault is
 * injected; nothing here does that automatically.
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
  /**
   * PRD2 G0a: the proxy captures raw request/response headers and bodies —
   * Authorization headers, cookies, login-endpoint bodies — before an
   * observer ever sees them. Defaults to a plain `DefaultRedactor()` so
   * `events()` never returns unredacted secrets, even if a downstream
   * consumer forgets to redact again.
   */
  redactor?: Redactor;
}

export class HttpFaultProxy implements FaultProxy {
  private server: http.Server | null = null;
  private ca: Pem | null = null;
  private readonly hostCertCache = new Map<string, Pem>();
  private readonly faults: CompiledFault[] = [];
  private readonly sink: CaptureSink<RecordedNetworkEvent>;
  private readonly upstreamHttpsAgent: https.Agent;
  // PRD2 review finding: `handleConnect` used to create a fresh
  // `http.Server` per CONNECT tunnel and drive it with
  // `innerServer.emit("connection", tlsSocket)`, but never tracked or
  // closed either object — `stop()` closed only the outer proxy server.
  // Tracked here so both a natural connection close and an explicit
  // `stop()` actually release them.
  private readonly activeMitmConnections = new Set<{ innerServer: http.Server; tlsSocket: tls.TLSSocket }>();

  constructor(options: HttpFaultProxyOptions = {}) {
    this.upstreamHttpsAgent = options.upstreamHttpsAgent ?? https.globalAgent;
    this.sink = new CaptureSink({ redactor: options.redactor ?? new DefaultRedactor() });
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
      matches: (url) => matchesFaultUrl(url, fault.url),
      timesRemaining: "times" in fault ? (fault.times ?? Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY,
    });
  }

  events(): RecordedNetworkEvent[] {
    return this.sink.all();
  }

  /** Exposed for tests: proves the MITM leak fix actually releases connections, not just that `stop()` doesn't throw. */
  activeMitmConnectionCount(): number {
    return this.activeMitmConnections.size;
  }

  async stop(): Promise<void> {
    for (const entry of this.activeMitmConnections) {
      entry.innerServer.close();
      entry.tlsSocket.destroy();
    }
    this.activeMitmConnections.clear();

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

    const entry = { innerServer, tlsSocket };
    this.activeMitmConnections.add(entry);
    const releaseConnection = (): void => {
      this.activeMitmConnections.delete(entry);
      innerServer.close();
    };
    tlsSocket.on("close", releaseConnection);
    clientSocket.on("close", releaseConnection);

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
    // PRD2 G0a: redact before this ever enters the sink's array — the
    // array `events()` returns to every consumer (the Playwright fixture,
    // and anything else that drains this proxy) is the only copy that
    // exists.
    this.sink.push(event);
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

    // PRD3 F14 — a stalled upstream: hold the connection open for
    // `delayMs`, then tear it down with no response at all, the same
    // shape a real hung/unreachable upstream produces (as opposed to
    // "http"'s fast, well-formed error response).
    if (fault?.spec.type === "timeout") {
      fault.timesRemaining -= 1;
      await new Promise((resolve) => setTimeout(resolve, fault.spec.type === "timeout" ? fault.spec.delayMs : 0));
      req.socket.destroy();
      this.record({ method, url: targetUrl, timingMs: Date.now() - startedAt, error: "injected timeout: upstream never responded" });
      return;
    }

    // PRD3 F14 — a 200 whose body isn't valid JSON, distinct from "http"'s
    // structured error body: the agent gets a response, it just can't be
    // parsed as the API contract promised.
    if (fault?.spec.type === "malformed-response") {
      fault.timesRemaining -= 1;
      const responseBodyRaw = '{"this is not valid JSON';
      res.writeHead(200, { "content-type": "application/json" });
      res.end(responseBodyRaw);
      this.record({
        method,
        url: targetUrl,
        status: 200,
        timingMs: Date.now() - startedAt,
        requestBody: safeParseJson(requestBodyRaw),
        responseBody: responseBodyRaw,
      });
      return;
    }

    // PRD3 F14 — App. C #2: a 429 with a well-formed body, distinct from a
    // generic "http" fault only in that it names the scenario and can carry
    // a Retry-After hint, so a fixture doesn't have to encode 429 as a bare
    // status code on the general-purpose fault.
    if (fault?.spec.type === "http-429") {
      fault.timesRemaining -= 1;
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (fault.spec.retryAfterMs !== undefined) headers["retry-after"] = String(Math.ceil(fault.spec.retryAfterMs / 1000));
      const responseBodyRaw = JSON.stringify({ error: "Too Many Requests" });
      res.writeHead(429, headers);
      res.end(responseBodyRaw);
      this.record({
        method,
        url: targetUrl,
        status: 429,
        timingMs: Date.now() - startedAt,
        requestBody: safeParseJson(requestBodyRaw),
        responseBody: safeParseJson(responseBodyRaw),
      });
      return;
    }

    // PRD3 F14 — App. C #6: a 200 with a zero-length body, distinct from
    // "malformed-response" (which returns bytes that fail to parse) and
    // from "http" (which returns a structured error).
    if (fault?.spec.type === "empty-response") {
      fault.timesRemaining -= 1;
      res.writeHead(200, { "content-type": "application/json", "content-length": "0" });
      res.end();
      this.record({
        method,
        url: targetUrl,
        status: 200,
        timingMs: Date.now() - startedAt,
        requestBody: safeParseJson(requestBodyRaw),
        responseBody: "",
      });
      return;
    }

    // PRD3 F14 — App. C #8: a 403, distinct from "http" only in naming the
    // scenario, same rationale as "http-429".
    if (fault?.spec.type === "permission-denied") {
      fault.timesRemaining -= 1;
      const responseBodyRaw = JSON.stringify({ error: "Permission denied" });
      res.writeHead(403, { "content-type": "application/json" });
      res.end(responseBodyRaw);
      this.record({
        method,
        url: targetUrl,
        status: 403,
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
          // PRD3 F14 / A4 — "a mutation that cannot be applied ... reports
          // so; it never pretends." Set when a fault matched but the real
          // response's shape made it inapplicable (e.g. `duplicate-record`
          // against a non-array body): the request still succeeds
          // untouched, but `events()` records why the fault did nothing,
          // rather than looking identical to "no fault matched at all".
          let notApplicableReason: string | undefined;

          if (fault?.spec.type === "prompt-injection") {
            fault.timesRemaining -= 1;
            const parsed = safeParseJson(bodyText);
            if (parsed !== undefined && typeof parsed === "object" && parsed !== null) {
              (parsed as Record<string, unknown>)[fault.spec.field] = fault.spec.payload;
              bodyText = JSON.stringify(parsed);
              bodyBuffer = Buffer.from(bodyText, "utf8");
            }
          }

          // PRD3 F14 — App. C #4: overwrite a named field with a value the
          // caller supplies as "stale" (e.g. an old balance, a superseded
          // status), leaving the rest of the real response untouched. Unlike
          // "incorrect-data" this is framed around staleness (an old value
          // that was once true), not an arbitrary wrong one — same
          // mechanism, different fixture semantics per the catalogue.
          if (fault?.spec.type === "stale-data") {
            fault.timesRemaining -= 1;
            const parsed = safeParseJson(bodyText);
            if (parsed !== undefined && typeof parsed === "object" && parsed !== null) {
              (parsed as Record<string, unknown>)[fault.spec.field] = fault.spec.staleValue;
              bodyText = JSON.stringify(parsed);
              bodyBuffer = Buffer.from(bodyText, "utf8");
            }
          }

          // PRD3 F14 — App. C #5: delete a named field the real upstream
          // sent, rather than substitute a wrong value for it — an agent
          // must notice absence, not just a bad value.
          if (fault?.spec.type === "missing-field") {
            fault.timesRemaining -= 1;
            const parsed = safeParseJson(bodyText);
            if (parsed !== undefined && typeof parsed === "object" && parsed !== null) {
              delete (parsed as Record<string, unknown>)[fault.spec.field];
              bodyText = JSON.stringify(parsed);
              bodyBuffer = Buffer.from(bodyText, "utf8");
            }
          }

          // PRD3 F14 — App. C #9: duplicate the first element of an array
          // response, the shape a real double-write or a retried-without-
          // idempotency-key request produces. `notApplicable`-shaped: a
          // non-array body has nothing to duplicate, so it passes through
          // unmodified rather than fabricating array structure that was
          // never there.
          if (fault?.spec.type === "duplicate-record") {
            fault.timesRemaining -= 1;
            const parsed = safeParseJson(bodyText);
            if (Array.isArray(parsed) && parsed.length > 0) {
              const mutated = [parsed[0], ...parsed];
              bodyText = JSON.stringify(mutated);
              bodyBuffer = Buffer.from(bodyText, "utf8");
            } else {
              notApplicableReason = "duplicate-record: response body is not a non-empty array; mutation not applied";
            }
          }

          // PRD3 F14 — App. C #10: overwrite a named field with an
          // arbitrary wrong value (as opposed to "stale-data"'s
          // once-true-now-outdated framing).
          if (fault?.spec.type === "incorrect-data") {
            fault.timesRemaining -= 1;
            const parsed = safeParseJson(bodyText);
            if (parsed !== undefined && typeof parsed === "object" && parsed !== null) {
              (parsed as Record<string, unknown>)[fault.spec.field] = fault.spec.incorrectValue;
              bodyText = JSON.stringify(parsed);
              bodyBuffer = Buffer.from(bodyText, "utf8");
            }
          }

          // PRD3 F14 — App. C #11: set two fields in the same response to
          // values that contradict each other, distinct from a single wrong
          // value — the agent has no way to tell which field to trust from
          // the response alone.
          if (fault?.spec.type === "contradictory-response") {
            fault.timesRemaining -= 1;
            const parsed = safeParseJson(bodyText);
            if (parsed !== undefined && typeof parsed === "object" && parsed !== null) {
              const record = parsed as Record<string, unknown>;
              record[fault.spec.field] = fault.spec.value;
              record[fault.spec.conflictField] = fault.spec.conflictValue;
              bodyText = JSON.stringify(record);
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
            error: notApplicableReason,
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

/**
 * PRD2 review finding: fault matching used to be `url.includes(fault.url)`,
 * a plain substring test. A fault on `/api` therefore also matched
 * `/api-docs`, `/apikeys`, or any URL carrying that text in its query
 * string — never the intent of a fault meant for one specific endpoint.
 *
 * `fault.url` is a path (every caller in this codebase passes one, e.g.
 * `/api/payment`), matched against the target URL's own path, ignoring
 * its query string — a fault on a bare path still fires no matter what
 * query parameters a real request happens to carry. A `fault.url` that is
 * itself a full absolute URL is matched exactly instead, for callers that
 * prefer to be that specific.
 */
function matchesFaultUrl(targetUrl: string, faultUrl: string): boolean {
  if (targetUrl === faultUrl) return true;
  if (faultUrl.startsWith("http://") || faultUrl.startsWith("https://")) return false;

  let pathOnly: string;
  try {
    pathOnly = new URL(targetUrl).pathname;
  } catch {
    pathOnly = targetUrl.split("?")[0]!;
  }
  return pathOnly === faultUrl;
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
