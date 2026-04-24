const MS_PER_UTC_DAY = 86_400_000;
const REQUIRED_PAPER_DAYS = 7;
const REQUIRED_GUARDED_LIVE_DAYS = 3;

const FAILED_CRITERIA_ORDER = [
  "missing_required_input",
  "paper_days_requirement",
  "guarded_live_days_requirement",
  "realized_pnl_positive_requirement",
  "critical_risk_breach_requirement"
] as const;

type FailedCriterion = (typeof FAILED_CRITERIA_ORDER)[number] | `missing_required_input:${string}`;

export interface PromotionGateInput {
  asOfUtcMs?: number;
  paperStartedAtUtcMs?: number;
  guardedLiveStartedAtUtcMs?: number;
  realizedPnlUsd?: number;
  criticalRiskBreaches?: number;
}

export interface PromotionGateResult {
  as_of_utc: string;
  paper_days_completed: number;
  guarded_live_days_completed: number;
  realized_pnl_usd: number;
  critical_risk_breaches: number;
  overall_pass: boolean;
  failed_criteria: string[];
}

function toUtcDayStartMs(timestampMs: number): number {
  const date = new Date(timestampMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function getCompletedUtcDays(startedAtUtcMs: number | undefined, asOfUtcMs: number): number {
  if (startedAtUtcMs === undefined || !Number.isFinite(startedAtUtcMs) || startedAtUtcMs > asOfUtcMs) {
    return 0;
  }

  const startDayMs = toUtcDayStartMs(startedAtUtcMs);
  const asOfDayMs = toUtcDayStartMs(asOfUtcMs);
  return Math.max(0, Math.floor((asOfDayMs - startDayMs) / MS_PER_UTC_DAY));
}

function normalizeMissingCriteria(input: PromotionGateInput): FailedCriterion[] {
  const missing: FailedCriterion[] = [];
  if (!Number.isFinite(input.paperStartedAtUtcMs)) {
    missing.push("missing_required_input:paper_started_at_utc_ms");
  }
  if (!Number.isFinite(input.guardedLiveStartedAtUtcMs)) {
    missing.push("missing_required_input:guarded_live_started_at_utc_ms");
  }
  if (!Number.isFinite(input.realizedPnlUsd)) {
    missing.push("missing_required_input:realized_pnl_usd");
  }
  if (!Number.isFinite(input.criticalRiskBreaches)) {
    missing.push("missing_required_input:critical_risk_breaches");
  }
  return missing;
}

function sortFailedCriteria(failedCriteria: FailedCriterion[]): string[] {
  const unique = [...new Set(failedCriteria)];
  return unique.sort((left, right) => {
    const leftBase = left.startsWith("missing_required_input") ? "missing_required_input" : left;
    const rightBase = right.startsWith("missing_required_input") ? "missing_required_input" : right;
    const leftIndex = FAILED_CRITERIA_ORDER.indexOf(leftBase as (typeof FAILED_CRITERIA_ORDER)[number]);
    const rightIndex = FAILED_CRITERIA_ORDER.indexOf(rightBase as (typeof FAILED_CRITERIA_ORDER)[number]);
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return left.localeCompare(right);
  });
}

export function evaluatePromotionGate(input: PromotionGateInput): PromotionGateResult {
  const asOfUtcMs = Number.isFinite(input.asOfUtcMs) ? (input.asOfUtcMs as number) : Date.now();
  const realizedPnlUsd = Number.isFinite(input.realizedPnlUsd) ? (input.realizedPnlUsd as number) : 0;
  const criticalRiskBreaches = Number.isFinite(input.criticalRiskBreaches) ? (input.criticalRiskBreaches as number) : 1;

  const paperDaysCompleted = getCompletedUtcDays(input.paperStartedAtUtcMs, asOfUtcMs);
  const guardedLiveDaysCompleted = getCompletedUtcDays(input.guardedLiveStartedAtUtcMs, asOfUtcMs);

  const failedCriteria: FailedCriterion[] = normalizeMissingCriteria(input);
  if (paperDaysCompleted < REQUIRED_PAPER_DAYS) {
    failedCriteria.push("paper_days_requirement");
  }
  if (guardedLiveDaysCompleted < REQUIRED_GUARDED_LIVE_DAYS) {
    failedCriteria.push("guarded_live_days_requirement");
  }
  if (realizedPnlUsd <= 0) {
    failedCriteria.push("realized_pnl_positive_requirement");
  }
  if (criticalRiskBreaches !== 0) {
    failedCriteria.push("critical_risk_breach_requirement");
  }

  const orderedFailedCriteria = sortFailedCriteria(failedCriteria);
  return {
    as_of_utc: new Date(asOfUtcMs).toISOString(),
    paper_days_completed: paperDaysCompleted,
    guarded_live_days_completed: guardedLiveDaysCompleted,
    realized_pnl_usd: realizedPnlUsd,
    critical_risk_breaches: criticalRiskBreaches,
    overall_pass: orderedFailedCriteria.length === 0,
    failed_criteria: orderedFailedCriteria
  };
}
