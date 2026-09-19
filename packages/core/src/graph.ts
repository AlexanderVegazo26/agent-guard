import type { AgentEvent, AgentRun, Evidence, EvidenceLink, EvidenceRelation, EvidenceType } from "./schema.js";

/**
 * §5 Evidence compiler and §5.2 query interface.
 *
 * Pipeline: Events → Normalize → Extract → Link → EvidenceGraph.
 * The "Verify-redaction" stage (TRD §5.1) is intentionally not implemented —
 * redaction-at-capture (§8) is out of scope for this build (see repo notes).
 */

export interface EvidenceGraph {
  readonly task: string;
  readonly items: Evidence[];
  readonly links: EvidenceLink[];
  byType(type: EvidenceType): Evidence[];
  related(id: string, relation?: EvidenceRelation): Evidence[];
  window(fromSeq: number, toSeq: number): Evidence[];
  linksAmong(items: Evidence[]): EvidenceLink[];
}

export interface EvidenceCompiler {
  compile(run: AgentRun): Promise<EvidenceGraph>;
}

class CompiledEvidenceGraph implements EvidenceGraph {
  constructor(
    public readonly task: string,
    public readonly items: Evidence[],
    public readonly links: EvidenceLink[],
  ) {}

  byType(type: EvidenceType): Evidence[] {
    return this.items.filter((e) => e.type === type);
  }

  related(id: string, relation?: EvidenceRelation): Evidence[] {
    const ids = new Set<string>();
    for (const link of this.links) {
      if (relation && link.relation !== relation) continue;
      if (link.from === id) ids.add(link.to);
      if (link.to === id) ids.add(link.from);
    }
    return this.items.filter((e) => ids.has(e.id));
  }

  window(fromSeq: number, toSeq: number): Evidence[] {
    return this.items.filter((e) => e.seq >= fromSeq && e.seq <= toSeq);
  }

  linksAmong(items: Evidence[]): EvidenceLink[] {
    const ids = new Set(items.map((e) => e.id));
    return this.links.filter((l) => ids.has(l.from) && ids.has(l.to));
  }
}

export class DefaultEvidenceCompiler implements EvidenceCompiler {
  async compile(run: AgentRun): Promise<EvidenceGraph> {
    const events = normalize(run.events);
    const items = extract(run, events);
    const links = link(items);
    return new CompiledEvidenceGraph(run.task, items, links);
  }
}

// ---------------------------------------------------------------------------
// Normalize — stable ordering by seq (TRD §5.1).
// ---------------------------------------------------------------------------

function normalize(events: AgentEvent[]): AgentEvent[] {
  return [...events].sort((a, b) => a.seq - b.seq);
}

// ---------------------------------------------------------------------------
// Extract — one extractor per evidence type. Claim extraction is the only
// non-mechanical step: it segments free-form text into individually checkable
// claims, verbatim, never paraphrased (TRD §5.1).
// ---------------------------------------------------------------------------

function extract(run: AgentRun, events: AgentEvent[]): Evidence[] {
  const items: Evidence[] = [
    {
      id: "e-task",
      type: "user_request",
      source: "run.task",
      content: { text: run.task },
      derivedFrom: ["run.task"],
      timestamp: run.startedAt,
      seq: -1,
    },
  ];

  for (const event of events) {
    switch (event.type) {
      case "message":
        if (event.role === "user") {
          items.push(makeEvidence(`e-${event.id}`, "user_request", event, { text: event.text }));
        } else if (event.role === "agent") {
          items.push(...splitClaims(event.text, event.id, event.timestamp, event.seq));
        }
        break;
      case "tool_call":
        items.push(
          makeEvidence(`e-${event.id}`, "tool_call", event, {
            tool: event.tool,
            arguments: event.arguments,
            callId: event.callId,
          }),
        );
        break;
      case "tool_result":
        items.push(
          makeEvidence(`e-${event.id}`, "tool_result", event, {
            callId: event.callId,
            success: event.success,
            result: event.result,
          }),
        );
        break;
      case "network":
        items.push(makeEvidence(`e-${event.id}`, "network", event, omitBase(event)));
        break;
      case "browser_state":
        items.push(makeEvidence(`e-${event.id}`, "browser_state", event, omitBase(event)));
        break;
      case "state_change":
        items.push(
          makeEvidence(`e-${event.id}`, "state_change", event, { kind: event.kind, data: event.data }),
        );
        break;
      case "fault":
        items.push(
          makeEvidence(`e-${event.id}`, "injected_fault", event, {
            faultId: event.faultId,
            spec: event.spec,
          }),
        );
        break;
      case "tool_definition":
        items.push(
          makeEvidence(`e-${event.id}`, "tool_definition", event, {
            tool: event.tool,
            description: event.description,
            inputSchema: event.inputSchema,
          }),
        );
        break;
      case "agent_spawn":
        items.push(
          makeEvidence(`e-${event.id}`, "agent_spawn", event, {
            parentAgentId: event.parentAgentId,
            childAgentId: event.childAgentId,
            task: event.task,
          }),
        );
        break;
      case "agent_result":
        items.push(
          makeEvidence(`e-${event.id}`, "agent_result", event, {
            childAgentId: event.childAgentId,
            success: event.success,
            claim: event.claim,
          }),
        );
        // The sub-agent's own claim is ALSO compiled as an ordinary
        // agent_claim, tagged with its origin — an inter-agent
        // noUnsupportedClaims (PRD2 F9, deferred) needs to check it the
        // same way any other claim is checked, not read it only off the
        // agent_result wrapper.
        if (event.claim) {
          items.push(...splitClaims(event.claim, event.id, event.timestamp, event.seq, "msg", event.childAgentId));
        }
        break;
      case "guard_decision":
        items.push(
          makeEvidence(`e-${event.id}`, "guard_decision", event, {
            tool: event.tool,
            arguments: event.arguments,
            decision: event.decision,
            reason: event.reason,
            callId: event.callId,
          }),
        );
        break;
    }
  }

  if (run.finalOutput) {
    items.push(...splitClaims(run.finalOutput, "final", run.endedAt ?? run.startedAt, Number.MAX_SAFE_INTEGER, "final"));
  }

  return items;
}

function makeEvidence(id: string, type: EvidenceType, event: AgentEvent, content: unknown): Evidence {
  return {
    id,
    type,
    source: event.id,
    content,
    derivedFrom: [event.id],
    timestamp: event.timestamp,
    seq: event.seq,
  };
}

function omitBase<T extends { type: string; id: string; timestamp: string; seq: number }>(
  event: T,
): Omit<T, "type" | "id" | "timestamp" | "seq"> {
  const { type: _type, id: _id, timestamp: _timestamp, seq: _seq, ...rest } = event;
  return rest;
}

function splitClaims(
  text: string,
  sourceId: string,
  timestamp: string,
  seq: number,
  kind: "msg" | "final" = "msg",
  // PRD2 F9 — when a claim originates from a named sub-agent (an
  // `agent_result.claim`), it's tagged so "the agent said X" stays
  // unambiguous once a run has more than one agent in it.
  agentId?: string,
): Evidence[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return sentences.map((sentenceText, i) => ({
    id: kind === "final" ? `e-final-c${i + 1}` : `e-${sourceId}-c${i + 1}`,
    type: "agent_claim" as const,
    source: kind === "final" ? "run.finalOutput" : sourceId,
    content: agentId !== undefined ? { text: sentenceText, agentId } : { text: sentenceText },
    derivedFrom: [kind === "final" ? "run.finalOutput" : sourceId],
    timestamp,
    seq,
  }));
}

// ---------------------------------------------------------------------------
// Link — deterministic links only (TRD §3.3). The compiler never emits a
// `contradicts` link with basis "deterministic" unless the contradiction is
// mechanically checkable; everything softer would be "heuristic", and this
// build does not implement a heuristic linker (see repo notes).
// ---------------------------------------------------------------------------

const SUCCESS_PATTERNS = [
  /success(?:fully)?/i,
  /\bcompleted\b/i,
  /\bconfirmed\b/i,
  /\bpurchased\b/i,
  /\bpaid\b/i,
];

function isSuccessClaim(text: string): boolean {
  return SUCCESS_PATTERNS.some((p) => p.test(text));
}

function statusOf(item: Evidence): number | undefined {
  const status = (item.content as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function link(items: Evidence[]): EvidenceLink[] {
  const links: EvidenceLink[] = [];

  // callId pairing: a tool result is causedBy its call.
  const toolCalls = items.filter((e) => e.type === "tool_call");
  const toolResults = items.filter((e) => e.type === "tool_result");
  for (const result of toolResults) {
    const callId = (result.content as { callId: string }).callId;
    const call = toolCalls.find((c) => (c.content as { callId: string }).callId === callId);
    if (call) {
      links.push({ from: result.id, to: call.id, relation: "causedBy", basis: "deterministic" });
    }
  }

  // A success claim contradicted by a recorded HTTP failure (4xx or 5xx)
  // with no later success before the claim — the mechanical contradiction
  // PRD §7 depends on. PRD2 review finding: this used to check `status >=
  // 500` only, so a declined payment (402), a forbidden request (403) or a
  // rate limit (429) followed by "Payment completed successfully" produced
  // no contradiction — the archetypal false-completion case for a payment
  // API that (correctly) uses 4xx for a declined charge, not 5xx.
  const claims = items.filter((e) => e.type === "agent_claim");
  const networkEvents = items.filter((e) => e.type === "network");
  for (const claim of claims) {
    const text = (claim.content as { text: string }).text;
    if (!isSuccessClaim(text)) continue;

    const failuresBefore = networkEvents.filter((n) => {
      const status = statusOf(n);
      return n.seq <= claim.seq && status !== undefined && status >= 400;
    });

    for (const failure of failuresBefore) {
      const laterSuccess = networkEvents.some((n) => {
        const status = statusOf(n);
        return n.seq > failure.seq && n.seq <= claim.seq && status !== undefined && status >= 200 && status < 300;
      });
      if (!laterSuccess) {
        links.push({ from: claim.id, to: failure.id, relation: "contradicts", basis: "deterministic" });
      }
    }
  }

  return links;
}
