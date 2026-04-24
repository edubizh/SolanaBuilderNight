export interface RawSnapshot {
  source: string;
  symbol: string;
  priceAtomic: bigint;
  decimals: number;
  observedAt: number | string | Date;
  externalEventId?: string;
  traceId?: string;
}

export interface NormalizedSnapshot extends EventIdentity {
  source: string;
  symbol: string;
  price: string;
  observedAtMs: number;
  normalizedAtMs: number;
}

export interface EventIdentity {
  eventId: string;
  traceId: string;
}

export {
  assessPredictionQuoteIntegrity,
  buildPredictionCanonicalMapping
} from "./prediction-canonicalization.ts";
export type {
  PredictionCanonicalMapping,
  PredictionCanonicalizationInput,
  PredictionQuoteInput,
  PredictionQuoteQualityMetadata
} from "./prediction-canonicalization.ts";
export { buildPredictionQuoteTraceId, normalizePredictionQuotes } from "./normalize-prediction-quotes.ts";
export type {
  CanonicalQuoteInput,
  NormalizePredictionQuotesInput,
  PreCanonicalPredictionQuote
} from "./normalize-prediction-quotes.ts";

export function normalizeDecimal(priceAtomic: bigint, decimals: number): string {
  if (decimals < 0) {
    throw new Error("decimals must be >= 0");
  }

  const divisor = 10n ** BigInt(decimals);
  const absoluteAtomic = priceAtomic < 0n ? -priceAtomic : priceAtomic;
  const whole = absoluteAtomic / divisor;
  const fraction = absoluteAtomic % divisor;
  const sign = priceAtomic < 0n ? "-" : "";

  if (decimals === 0) {
    return `${sign}${whole.toString()}`;
  }

  return `${sign}${whole.toString()}.${fraction.toString().padStart(decimals, "0")}`;
}

export function normalizeTimestampMs(input: number | string | Date): number {
  if (input instanceof Date) {
    const epochMs = input.getTime();
    validateEpochMs(epochMs);
    return epochMs;
  }

  if (typeof input === "string") {
    const parsed = Number(input);
    if (Number.isFinite(parsed)) {
      return normalizeTimestampMs(parsed);
    }

    const isoDate = new Date(input);
    if (!Number.isFinite(isoDate.getTime())) {
      throw new Error("timestamp must be an epoch number or ISO-8601 string");
    }

    return isoDate.getTime();
  }

  if (!Number.isFinite(input) || input <= 0) {
    throw new Error("timestamp must be a positive finite number");
  }

  const epochMs = input < 1_000_000_000_000 ? input * 1_000 : input;
  validateEpochMs(epochMs);
  return Math.trunc(epochMs);
}

export function createEventIdentity(params: {
  source: string;
  externalEventId?: string;
  observedAtMs: number;
  identityComponents?: string[];
}): EventIdentity {
  const deterministicToken =
    params.externalEventId ??
    (params.identityComponents?.length
      ? params.identityComponents.join("|")
      : `${params.source}:${params.observedAtMs}`);

  const eventId = `${params.source}:${deterministicToken}`;
  return {
    eventId,
    traceId: eventId
  };
}

export function normalizeSnapshot(raw: RawSnapshot, nowMs = Date.now()): NormalizedSnapshot {
  const observedAtMs = normalizeTimestampMs(raw.observedAt);
  const identity = createEventIdentity({
    source: raw.source,
    externalEventId: raw.externalEventId,
    observedAtMs,
    identityComponents: [raw.symbol, raw.priceAtomic.toString(), raw.decimals.toString()]
  });

  return {
    ...identity,
    traceId: raw.traceId ?? identity.traceId,
    source: raw.source,
    symbol: raw.symbol,
    price: normalizeDecimal(raw.priceAtomic, raw.decimals),
    observedAtMs,
    normalizedAtMs: nowMs
  };
}

function validateEpochMs(epochMs: number): void {
  if (!Number.isFinite(epochMs) || epochMs <= 0) {
    throw new Error("timestamp must normalize to a positive finite epoch milliseconds value");
  }
}
