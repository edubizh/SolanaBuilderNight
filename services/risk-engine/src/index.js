import { evaluateHardLimits, DEFAULT_HARD_LIMITS } from "./limits.js";
import { evaluateCircuitBreakers, DEFAULT_BREAKER_THRESHOLDS } from "./circuit-breaker.js";

export class RiskEngine {
  constructor(config = {}) {
    this.hardLimits = config.hardLimits ?? DEFAULT_HARD_LIMITS;
    this.breakerThresholds = config.breakerThresholds ?? DEFAULT_BREAKER_THRESHOLDS;
  }

  evaluatePreTrade(input) {
    const hardLimitResult = evaluateHardLimits(input, this.hardLimits);
    return {
      approved: hardLimitResult.passed,
      hardLimitResult
    };
  }

  evaluateRuntime(signal) {
    return evaluateCircuitBreakers(signal, this.breakerThresholds);
  }
}

export { evaluateHardLimits, evaluateCircuitBreakers, DEFAULT_HARD_LIMITS, DEFAULT_BREAKER_THRESHOLDS };
