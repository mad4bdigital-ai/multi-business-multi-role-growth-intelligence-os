# Spec 012 — EC0 Execution Capsule Contract

## Status

`in_progress`

EC0 delivers the pure domain/application contract and tests for the Execution Capsule. It does not activate runtime resolution, dispatch, persistence, provider access, routes, workers, or public surfaces.

## Delivered contract

### Domain value

`http-generic-api/contextKernel/domain/executionCapsule.js`

The domain contract provides:

- one immutable `ExecutionCapsule` value;
- deterministic `capsuleHash` and derived `capsuleRef`;
- exact principal, effective subject, Tenant, Workspace, optional Brand, Resource, Connection, authority path, and capability references;
- explicit context, authority, capability, registry, and credential-readiness revisions;
- canonical invalidation dependency vector;
- static versus dynamic refresh classification;
- bounded Tenant and Admin projections;
- `executionAllowed=false` as an invariant;
- `secretsIncluded=false` as an invariant.

The capsule hash uses a capsule-specific canonicalization contract. The generic Context hash sanitizer intentionally removes credential-bearing keys; using it for the capsule would incorrectly remove the safe authority-bearing `credentialReadinessRevision` from identity.

### Application service

`http-generic-api/contextKernel/application/executionCapsuleService.js`

The service exposes framework-independent `resolve` and `validate` operations.

`resolve` requires:

- `resolution.status=resolved`;
- exactly one matching selected candidate in the authorized candidate set;
- exact agreement between selected candidate and resolved context;
- principal, effective subject, Tenant, Workspace, Resource, and Connection identity;
- a dispatchable capability decision;
- explicit authority, capability, registry, and credential-readiness revisions;
- a future expiry.

`validate` classifies the capsule as one of:

- `valid`;
- `expired`;
- `revision_mismatch`;
- `context_mismatch`;
- `dynamic_refresh_required`;
- `interpretation_required`;
- `blocked`.

A valid result proves only that the context artifact is internally current for the supplied evidence. It never authorizes execution. Spec 011 governance, plan, approval, dynamic authority, mutation-frontier, idempotency, provider, and readback checks remain required.

## Dependency semantics

The dependency vector is keyed by `domain + ref` and bound to revisions. Duplicate or conflicting dependencies fail closed.

Static dependencies include:

- principal;
- effective subject;
- Tenant;
- Workspace;
- optional Brand;
- Resource;
- Connection identity;
- authority path;
- capability binding;
- registry revision.

Credential readiness is dynamic. A changed dynamic dependency requests refresh without silently selecting another connection. A changed static dependency requires context re-resolution.

Current dependencies not referenced by the capsule do not invalidate it. This prevents an unrelated Tenant, Resource, or registry domain from invalidating an exact capsule.

## Projection contract

Tenant projection exposes only the exact selected context and capsule identity needed by a tenant-scoped caller. It omits principal administration details, authority path revisions, registry revisions, credential-readiness revisions, and the full dependency vector.

Admin projection adds bounded principal, authority, revision, and dependency metadata over the same canonical capsule. It does not add credentials, raw grants, JWTs, provider payloads, or raw evidence.

## Tests

`http-generic-api/test-execution-capsule-contract.mjs` certifies:

- deterministic identity independent of dependency input order;
- hash changes for authority, capability, registry, and credential-readiness revision changes;
- immutable capsule and dependencies;
- secret-like reference rejection;
- exact candidate/context requirement;
- capability-readiness requirement;
- canonical expiry;
- duplicate/conflicting dependency rejection;
- static versus dynamic invalidation;
- unrelated dependency isolation;
- Tenant/Admin projection separation;
- all seven validation outcomes;
- mutation dynamic-refresh requirement;
- `executionAllowed=false` for every outcome;
- removal of raw credentials and authorization material.

The standalone EC0 contract test and existing Context Kernel domain/application/isolation regressions succeeded before index and manifest registration.

## Remaining work

- exact-head CI and human review for this PR;
- EC1 shadow adapter beside legacy resolution;
- EC2 selected Tenant/Admin read pilot;
- EC3 read-only unified-dispatch integration;
- EC4 reversible mutation validation pilot;
- EC5 measured rollout and duplicate resolver retirement.

## Safety boundaries

- no runtime authority;
- no provider call or external send;
- no database write, migration, or backfill;
- no route or OpenAPI change;
- no approval, retry, idempotency, or readback change;
- no automatic context substitution;
- no raw credential, token, JWT, grant payload, provider body, or unbounded evidence;
- no deployment or Production synchronization.
