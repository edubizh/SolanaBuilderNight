# PM-G-004 Evidence Summary

- Pass path: `pass-run.log` exit code must be 0 and artifacts copied to `pass-artifacts/`.
- Missing data failure: `missing-data-failure.log` exit code must be non-zero and include `BLOCKER_REASON=missing_required_input:guarded_live_started_at_utc_ms`.

## Captured Artifacts

- `pass-artifacts/promotion-gate-daily-snapshot-*.json`
- `pass-artifacts/promotion-gate-daily-summary-*.md`

## Captured Logs

- `pass-run.log`
- `missing-data-failure.log`
