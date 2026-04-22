# @solana-builder-night/shared-types

Runtime-agnostic TypeScript type exports for all SolanaBuilderNight services.

## Purpose

- Provide a single import surface for cross-service data contracts.
- Keep service code on stable compile-time types without requiring runtime schema imports.
- Track compatibility against `@solana-builder-night/contracts`.

## Install

```bash
npm install @solana-builder-night/shared-types
```

## Version compatibility

- `@solana-builder-night/shared-types@0.1.x` requires `@solana-builder-night/contracts@^0.1.0`.
- Consumers should pin shared types with a compatible minor range (recommended: `^0.1.0`).

## Usage

```ts
import type { CanonicalEvent, OpportunityIntent } from "@solana-builder-night/shared-types";
```
