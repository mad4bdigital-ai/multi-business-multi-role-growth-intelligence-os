# Spec 012 — EC5 Execution Capsule Rollout and Duplicate Resolver Retirement

## Status

`in_progress`

EC5 introduces a framework-independent rollout coordinator for the Execution Capsule path. The coordinator is default-off and unmounted. It provides a governed progression from legacy-authoritative shadow comparison to bounded canary use and finally logical retirement of duplicate resolver execution.

This phase does not activate a route, replace Production runtime authority, call a provider, load credentials, write a database, apply a migration, deploy code, or synchronize Production.

## Rollout states

The coordinator exposes four explicit states:

1. `disabled`: the existing legacy resolution service remains authoritative and preserves exact input/result identity.
2. `shadow`: legacy remains authoritative while the capsule path runs for parity and target-retention evidence. Capsule failures and telemetry failures cannot change the legacy result.
3. `canary`: a trusted rollout certificate is mandatory. Only dynamically selected requests use the capsule path; non-selected requests retain the legacy path.
4. `retired`: a trusted retirement certificate is mandatory. The duplicate legacy resolver is never invoked for resolution and remains injectable only for a separately guarded rollback.

No state may silently substitute a different Tenant, workspace, brand, resource, or connection. A capsule result that differs from the expected exact target stops with `context_re_resolution_required` and never falls back silently. A mismatched result is not added to the reuse cache.

## Certification authority

Rollout and retirement require a certificate produced by the module-owned evaluator. A plain object with equivalent fields is rejected. The certification floors cannot be weakened through evaluator options.

The evaluator requires:

- at least six unique representative samples;
- at least two samples for each mandatory lane: Tenant read, Admin read, and governed mutation;
- zero parity failures;
- zero exact-target-retention failures;
- zero cross-tenant access, connection substitution, stale-authority acceptance, ambiguity suppression, or other authority-safety failures;
- median resolution-stage improvement of at least 40 percent;
- full candidate-enumeration reduction of at least 60 percent;
- rollback evidence proving exact-owner isolation, fail-closed behavior when the guard is unavailable, and safe legacy restoration;
- zero provider dispatch, database write, or credential mutation during certification.

The certificate is process-local and accepted only when issued by the evaluator closure in the same module instance. It is also bound to exact implementation, policy, and evidence revisions. Canary or retirement creation fails when any expected certification revision differs from the certified context.

## Revision-bound reuse

Canary and retired modes cache only resolved capsule results that retain the exact requested target. The key includes exact principal and context identity plus:

- context revision;
- authority revision;
- capability revision;
- registry revision;
- credential-readiness revision;
- optional resource version.

There is no TTL-only cache key. Any movement in the revision vector produces a different key and forces canonical capsule resolution. Explicit invalidation and complete cache clearing are available for invalidation-graph consumers.

The cache is bounded LRU state. Its default maximum is 256 entries, with a hard supported maximum of 4096 entries. Oldest entries are evicted when the configured bound is reached; a cache hit refreshes recency.

## Rollback contract

Shadow rollback returns the exact disabled legacy composition.

Canary and retired rollback require an injected exact-owner isolation guard. If the guard is missing, throws, or returns false, rollback produces a fail-closed coordinator. It does not restore an owner-unsafe selector or silently enable the legacy path.

A safe retired rollback returns to canary mode under the same exact certification revisions rather than directly restoring broad legacy authority.

## Regression contract

`http-generic-api/test-execution-capsule-rollout-evaluator.mjs` and `http-generic-api/test-execution-capsule-rollout-coordinator.mjs` prove:

- exact disabled legacy identity;
- module-issued certification and forged-certificate rejection;
- immutable minimum sample, lane, performance, and enumeration floors;
- duplicate-sample and underrepresented-lane rejection;
- certification binding to implementation, policy, and evidence revisions;
- shadow legacy authority and telemetry isolation;
- target-substitution detection without fallback or caching;
- dynamic canary selection;
- bounded LRU revision cache, eviction, reuse, and revision movement invalidation;
- retired mode never invokes the duplicate legacy resolver;
- rollback fail-closed behavior and safe retired-to-canary rollback;
- plain-data input validation and bounded reason-code telemetry;
- no environment, network, provider SDK, database, credential, or external-send dependency.

## Completion gates

EC5 completes after canonical test-manifest registration, generator-owned evidence refresh, exact-head required CI, diagnostic suites, Human Architecture/Security Review, latest-main reconciliation, merge, and post-merge readback.

Completion of the code slice does not itself activate Production. Production rollout remains a separately governed deployment and runtime configuration action.

## Safety boundaries

- `runtime_authority=false`;
- `production_activation=false`;
- coordinator remains unmounted and default-off;
- capsule never grants execution authority by itself;
- certification floors cannot be weakened;
- stale certification revisions cannot authorize canary or retirement;
- reuse cache is bounded and revision-vector keyed;
- no route or OpenAPI behavior change;
- no provider call or external send;
- no database write or migration apply;
- no credential mutation;
- no deployment or Production synchronization;
- no destructive deletion of rollback code before certified retirement and post-merge readback.
