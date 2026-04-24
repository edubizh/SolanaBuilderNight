# Shared Types Compatibility Matrix

This matrix defines the required semantic version constraints for `@solana-builder-night/shared-types` and `@solana-builder-night/contracts` across services.

## Baseline release set

- `@solana-builder-night/contracts`: `0.2.0` (integration wave freeze baseline)
- `@solana-builder-night/shared-types`: `0.2.0`

## Compatibility matrix

| Consumer service/package | Required `@solana-builder-night/shared-types` | Required `@solana-builder-night/contracts` | Notes |
|---|---|---|---|
| `services/ingestion-gateway` | `^0.2.0` | `^0.2.0` | Integration wave requires frozen envelope and market/event contracts. |
| `services/state-normalizer` | `^0.2.0` | `^0.2.0` | Integration wave requires frozen normalized market/event contracts. |
| `services/opportunity-engine` | `^0.2.0` | `^0.2.0` | Integration wave requires frozen opportunity/event lifecycle contracts. |
| `services/risk-engine` | `^0.2.0` | `^0.2.0` | Integration wave requires frozen risk decision and breaker contracts. |
| `services/execution-orchestrator` | `^0.2.0` | `^0.2.0` | Integration wave requires frozen execution lifecycle contracts. |
| `services/position-settlement-service` | `^0.2.0` | `^0.2.0` | Integration wave requires frozen reconciliation lifecycle contracts. |
| `services/control-plane-api` | `^0.2.0` | `^0.2.0` | Integration wave requires frozen API DTO and event envelope contracts. |
| `apps/frontend-console` | `^0.2.0` | `^0.2.0` | Integration wave requires frozen read-model and API contracts. |

## Upgrade rules

1. PATCH (`0.1.x -> 0.1.y`): safe to roll out independently.
2. MINOR (`0.1.x -> 0.2.0`): requires compatibility review; consumers should stay on a shared minor target.
3. MAJOR (`0.x -> 1.0`): requires coordinated migration notes and a scheduled rollout window.

## Publication checklist

1. Run `npm --prefix packages/contracts run typecheck`.
2. Run `npm --prefix packages/shared-types install`.
3. Run `npm --prefix packages/shared-types run typecheck`.
4. Run `npm --prefix packages/shared-types run build`.
5. Verify package exports include `dist/index.d.ts` and `dist/index.js`.

## Freeze controls for integration wave

1. `v0.2.0` is the only accepted contract baseline for Sprint 3 integration tasks.
2. Any post-freeze breaking proposal must be deferred to `v0.3.0` unless explicitly approved by Agent 1 with migration notes.
3. PATCH updates in the `0.2.x` line may only include documentation, examples, and non-contract metadata clarifications.

## Stage A prediction additive contracts

- Stage A prediction-market support is additive-only and backward-safe for `0.2.x` consumers.
- New optional fields are permitted for:
  - canonical prediction IDs (`canonical_event_id`, `canonical_market_id`),
  - canonical outcome side metadata (`outcome_side`),
  - quote quality metadata (`quote_quality`).
- Venue enums now include `gemini` in addition to `dflow` and `pnp`; consumers that exhaustively switch on venue should add a `gemini` branch before enabling that venue in runtime logic.
