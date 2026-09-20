import type { Redactor } from "./redaction.js";

/**
 * PRD3 F13 — before this existed, `TranscriptAdapter.push` (this package),
 * `AgentGuardFixture.push` (`@alexvegman/playwright`) and
 * `HttpFaultProxy.record` (`@alexvegman/observe`) each redacted a draft and
 * appended it to their own private array, in their own hand-written order.
 * Functionally identical, but three separate places to get that order wrong
 * — redact-then-append is the one sequence PRD2 G0a depends on (no
 * unredacted event is ever observable, even transiently), and nothing
 * enforced that the three implementations agreed on it beyond a reviewer
 * reading all three side by side.
 *
 * `CaptureSink` is that one order, written once: redact the draft, then
 * (optionally) stamp an envelope around it — an `AgentEvent`'s
 * `id`/`timestamp`/`seq`/`provenance` for the two callers that need one,
 * or nothing for `HttpFaultProxy`, which records its own
 * `RecordedNetworkEvent` shape as-is. `envelope` defaults to the identity
 * function for that reason.
 */
export interface CaptureSinkOptions<TDraft, TEvent> {
  redactor: Redactor;
  /** Stamps whatever an individual caller's own event shape needs around the redacted draft. Defaults to identity (`TDraft` and `TEvent` are the same type). */
  envelope?: (redactedDraft: TDraft, seq: number) => TEvent;
}

export class CaptureSink<TDraft, TEvent = TDraft> {
  private seq = 0;
  private readonly items: TEvent[] = [];
  private readonly redactor: Redactor;
  private readonly envelope: (redactedDraft: TDraft, seq: number) => TEvent;

  constructor(options: CaptureSinkOptions<TDraft, TEvent>) {
    this.redactor = options.redactor;
    this.envelope = options.envelope ?? ((draft) => draft as unknown as TEvent);
  }

  /** Redacts `draft`, envelopes it, appends the result, and returns it — the one path every capture site now shares. */
  push(draft: TDraft): TEvent {
    this.seq += 1;
    const redacted = this.redactor.redactEvent(draft);
    const event = this.envelope(redacted, this.seq);
    this.items.push(event);
    return event;
  }

  all(): TEvent[] {
    return [...this.items];
  }

  get count(): number {
    return this.items.length;
  }
}
