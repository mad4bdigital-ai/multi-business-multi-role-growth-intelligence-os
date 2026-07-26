# Requirements Quality Checklist

All checked items are complete for branch implementation, contracts, tests, and governed rollout controls. They do **not** authorize production migration apply, enforcement enablement, provider writes, credential materialization, live canary promotion, or bypass retirement. Those remain explicit post-merge operational gates documented in `../completion-evidence.md`.

## Scope and decisions

- [x] Dynamic types and classifications.
- [x] Multi-parent containment with transaction-safe cycle prevention.
- [x] Sharing separate and read-only by default.
- [x] Explicit operation-bounded delegation.
- [x] Role templates, composition, and direct assignments.
- [x] Activity and Workflow container types.
- [x] No implicit `platform_owner` bypass.
- [x] Two approvers for destructive, credential, and deployment override classes.
- [x] 15/60 minute override TTLs.
- [x] Authority epoch and immutable snapshots.
- [x] Bounded deterministic traversal and closure rebuild.

## Security

- [x] Authorization and schema validation occur before credential materialization.
- [x] Passive preview and shadow modes have zero provider/token/external-write side effects.
- [x] Deny/restrict precedence.
- [x] Cross-tenant rejection.
- [x] Ambiguity blocks.
- [x] Delegation cannot exceed delegator authority.
- [x] Override scope, expiry, one-time consumption, stale-snapshot, and readback rules.
- [x] Distinct approvers for critical classes.
- [x] No secrets in bindings, caches, ledgers, logs, generated artifacts, or responses.
- [x] Threat model documented in `../threat-model.md`.

## Data and performance

- [x] Canonical SQL authority separated from Platform Graph projection.
- [x] Additive schema and legacy adapters.
- [x] Bounded traversal, closure, and query indexes.
- [x] Initial limits and failure codes defined.
- [x] p95/p99 budgets benchmarked and enforced by `scripts/dynamic-container-rollout-benchmark.mjs`.
- [x] Migration statement parity completed: migration 319 = 22/22, migration 320 = 25/25, risk count = 0.
- [x] Executable `EXPLAIN` preflight verifies the four critical query indexes through `dynamicContainerQueryPlanPreflight.js`.
- [x] Non-destructive rollback plan and transactional drill completed through `dynamicContainerRolloutSafety.js`.

## API

- [x] OpenAPI 3.1 additive contracts.
- [x] Strict path, query, header, and body schemas.
- [x] Structured 400/401/403/404/409/422/429/503 classes.
- [x] Stable error envelope and request IDs.
- [x] Idempotency and optimistic concurrency represented.
- [x] Final route scopes completed for authority resources, Co-workspaces, Workspace teams, and Brand teams.
- [x] Team-management routes require User JWT and object-level authorization.
- [x] Cursor pagination documented for Co-workspace and team lists.

## Testing and rollout

- [x] Multi-parent, cycle, conflict, deny, sharing, delegation, over-delegation, stale epoch, replay, cross-tenant, preview-side-effect, audit, cache-invalidation, and query-plan cases.
- [x] Shadow-first, selected read-only canary candidates, bounded mutation gates, and non-destructive rollback.
- [x] Mismatch threshold approved in policy: maximum 0.5%; critical mismatch count 0.
- [x] Performance limits approved in policy: p95 <= 150 ms; p99 <= 400 ms.
- [x] Audit coverage requirement approved in policy: 100%.
- [x] Rollback drill completed with dry-run, typed confirmation, transaction rollback/commit, and readback.
- [x] Single-canary promotion gate enforces one read-only capability at a time after readiness.
- [x] Bypass retirement gate requires enforced adoption evidence, stable readiness windows, 100% audit coverage, zero mismatch, and zero active overrides.

## Design-freeze approval gate

- [x] Domain and tenancy review: `../spec.md`, `../data-model.md`, `../inheritance-matrix.md`, and `../resolution-algorithm.md`.
- [x] Security review: `../threat-model.md` plus resolver/override/team tests.
- [x] Database and index review: migrations 319/320, static preflight, index contracts, and executable `EXPLAIN` preflight.
- [x] API contract review: `../contracts/openapi-fragment.yaml`, root OpenAPI 3.1, route coverage, and strict request validation.
- [x] Performance review: benchmark gate and rollout latency views.
- [x] Rollout and rollback review: readiness views, canary gate, bypass-retirement gate, and rollback drill.
- [x] Auth-lifecycle repair remains separate; Dynamic Container preview/shadow never materializes provider credentials.

## Validation evidence

- Full repository test manifest: **514/514 passed**.
- Architecture validation: **173/173 passed**.
- Activation surface coverage: **18/18 explicit internal exclusions; 0 missing**.
- Surface-contract documentation: **100% completion; 0 gaps**.
- Latest benchmark and migration-preflight details are recorded in `../completion-evidence.md`.
