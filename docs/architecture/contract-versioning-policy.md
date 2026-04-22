# Contract Versioning Policy

This policy governs `packages/contracts/**` and `packages/shared-types/**`.

## Goals

- Preserve cross-service compatibility during parallel delivery.
- Make breaking changes explicit and auditable.
- Keep schema evolution predictable across sprints.

## Semantic Versioning Rules

- **MAJOR**: Breaking contract changes.
  - Removing required fields.
  - Renaming event types.
  - Changing field types or semantics incompatibly.
- **MINOR**: Backward-compatible additions.
  - Adding optional fields.
  - Adding new event types.
  - Extending enums with non-breaking defaults.
- **PATCH**: Non-contract behavior/documentation fixes.
  - Clarifications, comments, examples, and metadata updates.

## Change Process

1. Update contract source and `packages/contracts/CHANGELOG.md`.
2. Bump `packages/contracts/package.json` version.
3. Update `packages/shared-types` to track compatible type exports and constraints.
4. Add compatibility note in PR description and release notes.
5. Notify dependent agents when MAJOR/MINOR is released.

## Compatibility Expectations

- Consumers must pin a compatible minor range when possible.
- Breaking changes require migration notes and coordinated rollout.
- Agent 1 is the owner of shared contracts and final approver.
- Shared type package releases must declare explicit constraints on contract versions.
- The active compatibility table is maintained in `docs/architecture/shared-types-compatibility-matrix.md`.

## Integration Freeze Control (v0.2.0)

- `v0.2.0` is the contract freeze target for the Sprint 3 integration wave.
- During the freeze window:
  - no breaking schema changes are allowed in `0.2.x`,
  - no required field removals or semantic repurposing are allowed,
  - no event name changes are allowed.
- Allowed updates in `0.2.x` are limited to:
  - documentation clarifications,
  - additive metadata that does not alter schema requirements,
  - compatibility notes and release bookkeeping.
- Proposed breaking updates must queue for the next minor planning cycle (`v0.3.0`) with migration guidance.
