/**
 * Canonical IR (docs/Architecture-check.md §6), trimmed to the fields the
 * static NAM/SCH rule slice actually needs. Fields present in the doc but
 * unused by this slice (ToolCallEvent, SessionTrace, FixInstruction, etc.)
 * are deliberately left out here rather than stubbed; the session's build
 * report lists what was left for a later pass and why.
 *
 * `core-ir` MUST NOT depend on any other internal package (§4.2). This file
 * has zero imports.
 */

/** Minimal JSON Schema shape sufficient for the static SCH rules in this slice. */
export interface JSONSchema {
  type?: string | string[];
  properties?: Record<string, JSONSchema>;
  required?: string[];
  additionalProperties?: boolean | JSONSchema;
  items?: JSONSchema;
  enum?: unknown[];
  [key: string]: unknown;
}

export interface Provenance {
  adapter: string;
  uri?: string;
  symbol?: string;
  confidence: number;
  editable: boolean;
}

export interface ToolSpec {
  id: string;
  name: string;
  title?: string;
  description?: string;
  inputSchema: JSONSchema;
  outputSchema?: JSONSchema;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
    costHint?: "free" | "cheap" | "expensive";
    latencyHint?: "fast" | "slow";
  };
  /**
   * §6 declares this required, computed by a tokenizer matching
   * ToolSurface.modelHint. No tokenizer is implemented in this slice, so
   * callers must supply it (e.g. fixtures pass zeros). Documented deviation,
   * not an invention of a counter that doesn't exist.
   */
  tokens: { name: number; description: number; schema: number; total: number };
  provenance: Provenance;
  tags?: string[];
}

export interface ToolSurface {
  id: string;
  tools: ToolSpec[];
  provider: "anthropic" | "openai" | "gemini" | "mcp" | "generic";
  modelHint?: string;
  budget?: { maxDefinitionTokens?: number; maxTools?: number };
}

export type Severity = "error" | "warn" | "info";
export type Confidence = "high" | "medium" | "low";

export interface Evidence {
  kind: string;
  detail: string;
}

export interface FindingTarget {
  kind: "tool" | "surface" | "session" | "param";
  id: string;
  path?: string;
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  confidence: Confidence;
  target: FindingTarget;
  message: string;
  rationale: string;
  evidence: Evidence[];
  suppressible: boolean;
  baselineStatus: "new" | "known" | "regressed" | "fixed";
}
