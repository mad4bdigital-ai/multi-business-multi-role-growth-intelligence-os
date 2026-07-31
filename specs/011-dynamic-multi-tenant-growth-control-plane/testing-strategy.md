# Testing Strategy

## Test pyramid

### Unit tests

- schema validation and unknown-field rejection;
- merge operators and security strictness;
- canonical identity and alias behavior;
- activity/capability/workflow compatibility;
- DAG cycles, fan-out, and node schema flow;
- adapter ranking and tie blocking;
- policy condition/effect compilation;
- feature cohort determinism;
- stable hash generation.

### Integration tests

- repository and transaction boundaries;
- active pointer compare-and-set;
- configuration publish plus outbox invalidation;
- plan compilation and immutable snapshots;
- approval, resource authority, and provider readiness;
- outbox dispatch and readback;
- cache invalidation after policy/grant/config change;
- event consumer deduplication.

### End-to-end tests

- multi-tenant/multi-brand onboarding;
- internal artifact plan with provider nodes held;
- staging approval and bounded write;
- production canary and rollback;
- provider timeout with unknown effect reconciliation;
- historical run replay after version changes;
- cross-brand and cross-tenant denial.

## Mandatory security tests

1. Caller cannot override signed tenant or user.
2. User with Brand A access cannot read or mutate Brand B resource.
3. Tenant actor cannot access another tenant through list, search, direct ID, cache, event, export, or readback.
4. Lower scope cannot enable a platform-denied effect.
5. Expired or mismatched approval cannot dispatch.
6. Revoked resource authority blocks queued dispatch.
7. No credential/token appears in responses, logs, events, or snapshots.
8. Unknown provider effect is not retried automatically.

## Contract tests

- OpenAPI 3.1 validates.
- Request/response examples validate against schemas.
- Error envelope and stable reason codes remain compatible.
- JSON Schema config examples validate; additional properties fail.
- Adapter and Activity Pack manifests validate.
- Event payloads validate per event version.

## Determinism tests

Given identical principal scope, registry revisions, configuration versions, feature cohort inputs, and request, the resolver MUST produce identical:

- effective values;
- selected capabilities/workflow/adapters;
- policy requirements;
- reason codes;
- revision vector;
- SHA-256 snapshots.

## Migration and compatibility tests

- additive migration dry run and checksum;
- legacy rows remain readable;
- shadow resolver matches legacy behavior for supported paths;
- optional-field schema evolution remains compatible;
- active plans retain pinned versions after activation/rollback;
- rollback restores expected new-plan behavior.

## Concurrency and idempotency tests

- concurrent publish with stale revision returns conflict;
- duplicate plan request returns/reuses correct plan under contract;
- duplicate dispatch creates at most one provider effect;
- lease expiry/reclaim does not duplicate effect;
- outbox replay is idempotent;
- event consumers deduplicate.

## Performance tests

Measure at representative scale:

- catalog/search pagination;
- effective config resolution at p50/p95/p99;
- workflow compile by node/edge size;
- policy compile by rule count/depth;
- cache hit and invalidation latency;
- queue/lease throughput per tenant and brand;
- portfolio analytics projection.

## Test fixtures

Include at least:

- two tenants;
- multiple workspaces and users with different roles;
- three brands including a multi-activity brand;
- travel and ecommerce Activity Packs;
- two CMS adapters including an ambiguity case;
- allowed, denied, expired, and revoked approvals/grants;
- provider success, failure, timeout, unknown effect, and partial effect.

## CI gates

Specification PR:

- markdown/link checks where available;
- JSON parse and JSON Schema self-validation;
- OpenAPI validation;
- manifest/completion consistency;
- required file inventory.

Implementation PRs:

- syntax/lint/type checks;
- unit and integration suites;
- architecture drift;
- resolver/policy/security gates;
- migration dry-run and ledger readback;
- release readiness.

## Production evidence

Tests alone do not prove production readiness. Cohort rollout requires shadow parity, dev/staging smoke, migration evidence, production canary readback, metrics, and post-merge audit.
