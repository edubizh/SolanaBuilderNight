export interface HeliusParsedTransaction {
  signature: string;
  slot: number;
  timestampMs: number;
  accountKeys: string[];
  instructionCount: number;
}

export interface CanonicalHeliusEvent {
  source: "helius";
  eventId: string;
  observedAtMs: number;
  traceId: string;
  payload: {
    signature: string;
    slot: number;
    accountKeys: string[];
    instructionCount: number;
  };
}

export function toCanonicalHeliusEvent(
  parsed: HeliusParsedTransaction,
  traceId = parsed.signature
): CanonicalHeliusEvent {
  const observedAtMs = normalizeTimestampMs(parsed.timestampMs);
  const eventId = `helius:${parsed.signature}|${parsed.slot}`;

  return {
    source: "helius",
    eventId,
    observedAtMs,
    traceId: traceId || eventId,
    payload: {
      signature: parsed.signature,
      slot: parsed.slot,
      accountKeys: parsed.accountKeys,
      instructionCount: parsed.instructionCount
    }
  };
}

function normalizeTimestampMs(input: number): number {
  if (!Number.isFinite(input) || input <= 0) {
    throw new Error("timestamp must be a positive finite number");
  }

  return Math.trunc(input < 1_000_000_000_000 ? input * 1_000 : input);
}
