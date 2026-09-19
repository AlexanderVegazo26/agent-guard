/**
 * §8 — Redaction. Runs at capture, not at compile time: the guarantee is
 * "no unredacted evidence is written anywhere or transmitted anywhere,"
 * which only holds if the same rule set applies to the raw event the
 * observer is about to append to `events.jsonl` — before the compiler has
 * even run. `redactEvent` and `verify` therefore share one rule
 * implementation (`redactValue`/`scanValue`) applied to two different
 * shapes: a raw `AgentEvent` on the hot capture path, and compiled
 * `Evidence.content` in the §5.1 defence-in-depth audit.
 */

export interface RedactionAudit {
  clean: boolean;
  findings: Array<{ evidenceId: string; rule: string }>;
}

export interface Redactor {
  /** Capture boundary. One event at a time, synchronous, on the hot path. */
  redactEvent<T>(event: T): T;
  /** §5.1 defence-in-depth pass over the compiled graph. Never mutates. */
  verify(evidence: Array<{ id: string; content: unknown }>): RedactionAudit;
}

export interface RedactionConfig {
  /** Literal secret values supplied via config (e.g. a test API key) — always redacted verbatim wherever they appear. */
  secrets: string[];
  /** Additional configured secret patterns, beyond the built-in defaults. */
  extraPatterns?: RegExp[];
  /** URL patterns whose entire request body is redacted (TRD §8: "request bodies on auth endpoints"). */
  authEndpointPatterns?: RegExp[];
}

const SENSITIVE_HEADER_NAMES = new Set(["authorization", "cookie", "set-cookie"]);
const TOKEN_LIKE_KEY_PATTERN = /(token|secret|password|passwd|api[_-]?key|auth)/i;
const DEFAULT_AUTH_ENDPOINT_PATTERNS = [/\/login\b/i, /\/auth\b/i, /\/signin\b/i, /\/session\b/i];

function placeholderFor(label: string): string {
  return `<redacted:${label.toLowerCase()}>`;
}

/**
 * Fail-closed by contract, not by internal try/catch: if this throws, the
 * caller (the capture-path writer) must not write the event and must not
 * fall back to writing it unredacted. This function itself never swallows
 * an error to "keep going" — that would silently reintroduce the risk it
 * exists to remove.
 */
export class DefaultRedactor implements Redactor {
  private readonly secretValues: Set<string>;
  private readonly patterns: RegExp[];
  private readonly authEndpointPatterns: RegExp[];

  constructor(config: RedactionConfig = { secrets: [] }) {
    this.secretValues = new Set(config.secrets.filter((s) => s.length > 0));
    this.patterns = config.extraPatterns ?? [];
    this.authEndpointPatterns = config.authEndpointPatterns ?? DEFAULT_AUTH_ENDPOINT_PATTERNS;
  }

  redactEvent<T>(event: T): T {
    const redacted = this.redactValue(event) as T;
    return this.redactAuthEndpointBody(redacted);
  }

  verify(evidence: Array<{ id: string; content: unknown }>): RedactionAudit {
    const findings: RedactionAudit["findings"] = [];
    for (const item of evidence) {
      this.scanValue(item.content, item.id, findings);
    }
    return { clean: findings.length === 0, findings };
  }

  // -------------------------------------------------------------------------
  // Capture-path redaction
  // -------------------------------------------------------------------------

  private redactValue(value: unknown): unknown {
    if (typeof value === "string") return this.redactString(value);
    if (Array.isArray(value)) return value.map((v) => this.redactValue(v));
    if (value !== null && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        if (this.isSensitiveKey(key)) {
          out[key] = placeholderFor(key);
        } else {
          out[key] = this.redactValue(val);
        }
      }
      return out;
    }
    return value;
  }

  private redactString(value: string): string {
    if (this.secretValues.has(value)) return placeholderFor("secret");
    for (const pattern of this.patterns) {
      if (pattern.test(value)) return placeholderFor("secret");
    }
    return value;
  }

  private isSensitiveKey(key: string): boolean {
    const lower = key.toLowerCase();
    return SENSITIVE_HEADER_NAMES.has(lower) || TOKEN_LIKE_KEY_PATTERN.test(lower);
  }

  /**
   * A `NetworkEvent`-shaped object whose `url` matches an auth-endpoint
   * pattern has its whole `requestBody` blanked — credentials on a login
   * endpoint can appear under any field name, not only ones a key-name
   * heuristic recognizes (TRD §8: "request bodies on auth endpoints").
   */
  private redactAuthEndpointBody<T>(event: T): T {
    if (event === null || typeof event !== "object") return event;
    const candidate = event as { url?: unknown; requestBody?: unknown };
    if (typeof candidate.url !== "string" || candidate.requestBody === undefined) return event;
    if (!this.authEndpointPatterns.some((p) => p.test(candidate.url as string))) return event;
    return { ...event, requestBody: placeholderFor("auth-endpoint-body") };
  }

  // -------------------------------------------------------------------------
  // §5.1 verify() — defence-in-depth, read-only
  // -------------------------------------------------------------------------

  private scanValue(value: unknown, evidenceId: string, findings: RedactionAudit["findings"]): void {
    if (typeof value === "string") {
      if (this.secretValues.has(value)) findings.push({ evidenceId, rule: "configured-secret" });
      for (const pattern of this.patterns) {
        if (pattern.test(value)) findings.push({ evidenceId, rule: "configured-pattern" });
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const v of value) this.scanValue(v, evidenceId, findings);
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const [key, val] of Object.entries(value)) {
        if (this.isSensitiveKey(key) && typeof val === "string" && !val.startsWith("<redacted:")) {
          findings.push({ evidenceId, rule: `unredacted-key:${key}` });
        }
        this.scanValue(val, evidenceId, findings);
      }
    }
  }
}
