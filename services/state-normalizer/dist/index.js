export { assessPredictionQuoteIntegrity, buildPredictionCanonicalMapping } from "./prediction-canonicalization.ts";
export { buildPredictionQuoteTraceId, normalizePredictionQuotes } from "./normalize-prediction-quotes.ts";
export function normalizeDecimal(priceAtomic, decimals) {
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
export function normalizeTimestampMs(input) {
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
export function createEventIdentity(params) {
    const deterministicToken = params.externalEventId ??
        (params.identityComponents?.length
            ? params.identityComponents.join("|")
            : `${params.source}:${params.observedAtMs}`);
    const eventId = `${params.source}:${deterministicToken}`;
    return {
        eventId,
        traceId: eventId
    };
}
export function normalizeSnapshot(raw, nowMs = Date.now()) {
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
function validateEpochMs(epochMs) {
    if (!Number.isFinite(epochMs) || epochMs <= 0) {
        throw new Error("timestamp must normalize to a positive finite epoch milliseconds value");
    }
}
