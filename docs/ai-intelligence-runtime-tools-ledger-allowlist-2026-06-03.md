# AI Intelligence Runtime Tools Migration Ledger Allowlist

Date: 2026-06-03

## Purpose

This change allows migration `167_sprint65_ai_intelligence_runtime_governance_tools.sql` to be applied through the governed migration runner and tracked by release readiness.

## Context

`release_readiness` reported migration drift for three missing admin tool runtime artifacts from migration `167`:

```text
ai_model_run_events
platform_engine_execution_envelope
platform_engine_run_history
```

The migration preflight was already `pass` with `risk_count=0` and `secrets_included=false`.

## Scope

This change only updates:

```text
http-generic-api/scripts/governed-migration-runner.mjs
http-generic-api/releaseReadiness.js
```

It does not change runtime behavior and does not apply SQL in the PR.

## After merge

Apply migration 167 through the governed migration runner with typed confirmation:

```text
APPLY_167_SPRINT65_AI_INTELLIGENCE_RUNTIME_GOVERNANCE_TOOLS
```

Then read back the missing admin tools and run `release_readiness`.

## Safety

- No destructive SQL.
- No direct DB mutation outside the governed migration runner.
- Migration 167 is registry upsert only.
- Secrets are not included.
