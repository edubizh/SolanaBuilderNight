# @solana-builder-night/contracts

Canonical, versioned contracts shared by all services in SolanaBuilderNight.

## Purpose

This package defines shared schemas and API boundaries used across ingestion,
opportunity, risk, execution, settlement, and control-plane components.

## Contents

- `events.ts`: Event envelope and required domain events.
- `market-schema.ts`: Market and quote canonical models.
- `opportunity-schema.ts`: Opportunity intent and scoring structures.
- `execution-schema.ts`: Execution lifecycle and terminal states.
- `risk-schema.ts`: Risk snapshots and decision outcomes.
- `api-spec.yaml`: Baseline OpenAPI for control-plane surface.

## Versioning

Contracts use semantic versioning and follow
`docs/architecture/contract-versioning-policy.md`.
