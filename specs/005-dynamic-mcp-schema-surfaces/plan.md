# Implementation Plan

## Phase 0 — Baseline and containment

Preserve evidence; add a regression test for tenant `execution_guardrail`; freeze hand-edits to generated schemas; register lifecycle ownership; fix read-only SQL Tool Bus classification.

## Phase 1 — Deterministic generation

Create canonical surface registry; generate to temporary directory; recursively validate; enforce host/auth separation and operation budgets; write only after validation; add parity CI; schema PRs require review.

## Phase 2 — Surface split

Produce Admin Core, Tenant Core, Activation Admin, and Tenant Activation schemas. Preserve Device/Development isolation and compatibility aliases.

## Phase 3 — DB MCP normalization

Map projections to canonical tool keys; normalize schema version/hash; add output validation; principal-aware surface bindings; registry/schema versions; explicit stale-version conflict.

## Phase 4 — Activation Gateway

Generate policy from fixed OpenAPI; implement stateless edge; exact route/query/header controls; signed manifest; stale policy; health/readiness/observability; dark deploy.

## Phase 5 — Shadow/parity

Compare old/new projections with backend admin auth and real tenant OAuth. Block unexplained differences.

## Phase 6 — Production rollout

Temporary worker domain, smoke, custom domain, dual availability, GPT Action update, usage monitoring, rollback rehearsal, evidence closure.

## Safety

No production mutation in specification phase, no direct `main` edits, no DB/secret access at edge, all deployments SHA/hash-bound.
