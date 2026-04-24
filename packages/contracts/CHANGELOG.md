# Changelog

All notable changes to `@solana-builder-night/contracts` are documented in this file.

The format follows Keep a Changelog and semantic versioning.

## [Unreleased]

### Added
- Prediction-market canonical schemas for Stage A cross-venue mapping:
  - deterministic ID format contracts (`pm_evt_v1_*`, `pm_mkt_v1_*`, `pm_out_v1_*`),
  - canonical enums for event state, market type, and outcome side,
  - quote quality metadata schema for freshness/integrity/confidence classification.

### Changed
- Expanded prediction venue enums from `dflow|pnp` to `dflow|gemini|pnp` in additive contract fields and execution/market payload schemas.
- Added optional canonical prediction identifiers and quote quality metadata on market snapshot and market-data event payloads.

## [0.2.0] - 2026-04-21

### Added
- Integration-wave contract freeze controls for Sprint 3 handoff:
  - Stable required event set and mandatory envelope IDs locked for consumer integration.
  - `v0.2.0` designated as the pinned baseline for cross-service adapter implementation.

### Changed
- Promoted contracts package version from `0.1.0` to `0.2.0` to mark the integration freeze boundary.

## [0.1.0] - 2026-04-21

### Added
- Initial package scaffold for canonical contracts.
- Baseline event schemas and API specification placeholders.
