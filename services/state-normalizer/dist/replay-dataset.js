import { assessPredictionQuoteIntegrity, buildPredictionCanonicalMapping } from "./prediction-canonicalization.ts";
export function replayDatasetToNormalizedFrames(dataset) {
    return dataset.frames.map((frame) => {
        if (frame.source === "coingecko") {
            return normalizeCoinGeckoFrame(frame);
        }
        if (frame.source === "pyth-hermes") {
            return normalizePythFrame(frame);
        }
        return normalizeHeliusFrame(frame);
    });
}
function normalizeCoinGeckoFrame(frame) {
    const observedAtMs = normalizeTimestampMs(frame.observedAt);
    const eventId = `${frame.source}:${frame.externalEventId}`;
    const canonicalMapping = buildPredictionCanonicalMapping({
        venue: frame.venue,
        venueEventId: frame.venueEventId,
        venueMarketId: frame.venueMarketId,
        venueOutcomeId: frame.venueOutcomeId,
        eventTitle: frame.eventTitle,
        marketQuestion: frame.marketQuestion,
        outcomeLabel: frame.outcomeLabel,
        eventState: "scheduled",
        marketType: "binary",
        outcomeSide: "yes",
        eventStartMs: normalizeTimestampMs(frame.eventStartAt)
    });
    const quote = Number(frame.priceUsd) / 200;
    const quoteQuality = assessPredictionQuoteIntegrity({
        observedAtMs,
        nowMs: observedAtMs + 450,
        bidPrice: quote - 0.01,
        askPrice: quote + 0.01,
        confidenceRatio: 0.01,
        depthScore: 0.7
    });
    return {
        source: frame.source,
        venue: frame.venue,
        symbol: frame.symbol,
        eventId,
        observedAtMs,
        traceId: eventId,
        payload: {
            tokenAddress: frame.tokenAddress,
            price: normalizeDecimal(toAtomicUnits(frame.priceUsd, frame.decimals), frame.decimals),
            canonicalMapping,
            quoteQuality
        }
    };
}
function normalizePythFrame(frame) {
    const observedAtMs = normalizeTimestampMs(frame.publishTimeSec);
    const eventId = `${frame.source}:${frame.externalEventId}`;
    const canonicalMapping = buildPredictionCanonicalMapping({
        venue: frame.venue,
        venueEventId: frame.venueEventId,
        venueMarketId: frame.venueMarketId,
        venueOutcomeId: frame.venueOutcomeId,
        eventTitle: frame.eventTitle,
        marketQuestion: frame.marketQuestion,
        outcomeLabel: frame.outcomeLabel,
        eventState: "live",
        marketType: "binary",
        outcomeSide: "yes",
        eventStartMs: normalizeTimestampMs(frame.eventStartAt)
    });
    const quoteQuality = assessPredictionQuoteIntegrity({
        observedAtMs,
        nowMs: observedAtMs + 2_000,
        bidPrice: Number(frame.bidPrice),
        askPrice: Number(frame.askPrice),
        confidenceRatio: Number(frame.confidence) / Math.max(1, Math.abs(Number(frame.price))),
        depthScore: 0.85
    });
    return {
        source: frame.source,
        venue: frame.venue,
        symbol: frame.symbol,
        eventId,
        observedAtMs,
        traceId: eventId,
        payload: {
            feedId: frame.feedId,
            confidence: frame.confidence,
            publishTimeSec: frame.publishTimeSec,
            price: normalizeDecimal(BigInt(frame.price), 2),
            canonicalMapping,
            quoteQuality
        }
    };
}
function normalizeHeliusFrame(frame) {
    const parsed = parseHeliusStreamEvent(frame.streamMessage);
    if (!parsed) {
        throw new Error("replay helius frame failed to parse stream message");
    }
    const eventId = `helius:${parsed.signature}|${parsed.slot}`;
    const observedAtMs = normalizeTimestampMs(parsed.timestampMs);
    const canonicalMapping = buildPredictionCanonicalMapping({
        venue: frame.venue,
        venueEventId: frame.venueEventId,
        venueMarketId: frame.venueMarketId,
        venueOutcomeId: frame.venueOutcomeId,
        eventTitle: frame.eventTitle,
        marketQuestion: frame.marketQuestion,
        outcomeLabel: frame.outcomeLabel,
        eventState: "live",
        marketType: "binary",
        outcomeSide: "yes",
        eventStartMs: normalizeTimestampMs(frame.eventStartAt)
    });
    const quoteQuality = assessPredictionQuoteIntegrity({
        observedAtMs,
        nowMs: observedAtMs + 1_000,
        bidPrice: 0.58,
        askPrice: 0.6,
        confidenceRatio: 0.02,
        depthScore: 0.5
    });
    return {
        source: "helius",
        venue: frame.venue,
        symbol: frame.symbol,
        eventId,
        observedAtMs,
        traceId: frame.externalEventId,
        payload: {
            signature: parsed.signature,
            slot: parsed.slot,
            accountKeys: parsed.accountKeys,
            instructionCount: parsed.instructionCount,
            canonicalMapping,
            quoteQuality
        }
    };
}
function toAtomicUnits(decimalValue, decimals) {
    const [wholePart, fractionPart = ""] = decimalValue.split(".");
    const paddedFraction = fractionPart.padEnd(decimals, "0").slice(0, decimals);
    return BigInt(`${wholePart}${paddedFraction}`);
}
function normalizeDecimal(priceAtomic, decimals) {
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
function normalizeTimestampMs(input) {
    if (typeof input === "string") {
        const date = new Date(input);
        const epoch = date.getTime();
        if (!Number.isFinite(epoch) || epoch <= 0) {
            throw new Error("timestamp must be valid");
        }
        return epoch;
    }
    if (!Number.isFinite(input) || input <= 0) {
        throw new Error("timestamp must be positive");
    }
    return input < 1_000_000_000_000 ? Math.trunc(input * 1_000) : Math.trunc(input);
}
function parseHeliusStreamEvent(message) {
    const parsed = JSON.parse(message);
    const value = parsed.params?.result?.value;
    if (!value?.signature || value.slot === undefined || value.timestamp === undefined) {
        return null;
    }
    const accountKeys = value.transaction?.message?.accountKeys ?? [];
    const instructions = value.transaction?.message?.instructions ?? [];
    return {
        signature: value.signature,
        slot: value.slot,
        timestampMs: value.timestamp * 1_000,
        accountKeys,
        instructionCount: instructions.length
    };
}
