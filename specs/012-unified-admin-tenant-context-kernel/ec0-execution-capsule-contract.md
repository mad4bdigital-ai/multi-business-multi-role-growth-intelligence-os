# Spec 012 — EC0 Execution Capsule Contract

## Status

`in_progress`

Delivery PR: `#3348` on `gpt/spec-012-ec0-clean-9c9b-20260730`.

The clean core build completed successfully: the permanent EC0 domain, application, export, standalone-test, and Spec evidence files were copied onto a current baseline; the EC0 and existing Context Kernel domain/application/isolation regressions passed; the latest hardcoding scanner passed; and every one-shot workflow was removed from the delivery diff.

Global registration in `scripts/test-manifest.mjs` and its generated frontend evidence are intentionally deferred to a small follow-up PR. This keeps EC0 Core independent from rapidly changing repository-wide generated artifacts without removing the standalone test or weakening coverage. Exact-head platform CI and human review remain required before merge.

EC0 delivers the pure domain/application contract and standalone tests for the Execution Capsule. It does not activate runtime resolution, dispatch, persistence, provider access, routes, workers, or public surfaces.

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
- canonical integrity verification before validation or projection;
- bounded field length, dependency cardinality, and canonical serialization size;
- `executionAllowed=false` as an invariant;
- `secretsIncluded=false` as an invariant.

The capsule hash uses a capsule-specific canonicalization contract. The generic Context hash sanitizer intentionally removes credential-bearing keys; using it for the capsule would incorrectly remove the safe authority-bearing `credentialReadinessRevision` from identity. The generic sanitizer itself remains unchanged.

`assertExecutionCapsuleIntegrity` reconstructs the canonical capsule from its exact fields and normalized dependency vector. A forged schema version, security invariant, capsule reference, or hash is rejected before context validation or projection.

### Application service

`http-generic-api/contextKernel/application/executionCapsuleService.js`

The service exposes framework-independent `resolve` and `validate` operations.

`resolve` requires:

- `resolution.status=resolved`;
- exactly one matching selected candidate in the authorized candidate set;
- the authoritative candidate object from that authorized set, not caller-selected target fields;
- exact agreement among the authorized candidate, nested selected candidate, and resolved context;
- principal, effective subject, Tenant, Workspace, Resource, and Connection identity;
- authority-scope Tenant parity;
- capability key and dispatch/apply decision parity between context and readiness evidence;
- a dispatchable capability decision;
- explicit authority, capability, registry, and credential-readiness revisions;
- a future expiry.

`validate` verifies canonical capsule integrity first, then classifies the capsule as one of:

- `valid`;
- `expired`;
- `revision_mismatch`;
- `context_mismatch`;
- `dynamic_refresh_required`;
- `interpretation_required`;
- `blocked`.

A forged or malformed capsule returns a bounded `blocked` result with `execution_capsule_integrity_invalid`; it does not echo untrusted context hash or revision values. A valid result proves only that the context artifact is internally current for the supplied evidence. It never authorizes execution. Spec 011 governance, plan, approval, dynamic authority, mutation-frontier, idempotency, provider, and readback checks remain required.

## Dependency semantics

The dependency vector is keyed by `domain + ref` and bound to revisions. Duplicate or conflicting dependencies fail closed.

Static dependencies include:

- principal;
- effective subject;
- Tenant;
- Workspace;
- optional Brand;
- Resource identity;
- Connection identity;
- authority path;
- capability binding;
- registry revision.

Dynamic domains supported by the EC0 contract include:

- credential readiness;
- approval state;
- capability-envelope state;
- effective authority or owner grant;
- resource version;
- provider version;
- connection status;
- expected resource or branch version/SHA.

A changed dynamic dependency requests refresh without silently selecting another target or connection. A changed static dependency requires context re-resolution. Current dependencies not referenced by the capsule do not invalidate it, preventing unrelated Tenant, Resource, or registry changes from invalidating an exact capsule.

## Bounds

EC0 prevents an attacker or malformed adapter from creating unbounded context artifacts:

- each bounded reference/revision field is limited to 512 characters;
- additional capsule dependencies are limited to 128;
- current validation dependencies are limited to 256;
- canonical capsule serialization is limited to 256 KiB;
- duplicate dependency identities fail closed.

The full stored dependency vector contains the automatic identity/revision dependencies plus bounded operation-specific dependencies. Integrity reconstruction separates those automatic entries before rebuilding the canonical capsule, so valid maximum-sized inputs are not double-counted.

## Projection contract

Tenant projection exposes only the exact selected context and capsule identity needed by a tenant-scoped caller. It omits principal administration details, authority path revisions, registry revisions, credential-readiness revisions, and the full dependency vector.

Admin projection adds bounded principal, authority, revision, and dependency metadata over the same canonical capsule. It does not add credentials, raw grants, JWTs, provider payloads, or raw evidence.

Both projection modes verify canonical capsule integrity before returning fields. A caller cannot use a forged object to bypass projection allowlists or security invariants.

## Tests

`http-generic-api/test-execution-capsule-contract.mjs` certifies:

- deterministic identity independent of dependency input order;
- hash changes for authority, capability, registry, and credential-readiness revision changes;
- immutable capsule and dependencies;
- secret-like reference rejection;
- field, dependency-count, and canonical-size bounds;
- canonical integrity and forged-hash rejection;
- projection rejection of forged security invariants;
- exact authorized-candidate/context requirement;
- caller-selected target forgery rejection;
- nested selected-candidate parity;
- authority-scope Tenant parity;
- capability-decision parity;
- capability-readiness requirement;
- canonical expiry;
- duplicate/conflicting dependency rejection;
- static versus dynamic invalidation;
- operation-specific dynamic evidence domains;
- unrelated dependency isolation;
- Tenant/Admin projection separation;
- all seven validation outcomes;
- bounded blocked result for forged capsules;
- mutation dynamic-refresh requirement;
- `executionAllowed=false` for every outcome;
- removal of raw credentials and authorization material.

The standalone EC0 contract test and existing Context Kernel domain/application/isolation regressions succeeded in bounded reviews. Repository-wide test-manifest registration and generated evidence are pending a separate follow-up delivery.

## Remaining work

- exact-head CI and human review for PR `#3348`;
- complete test-manifest registration and generated evidence refresh in a follow-up PR;
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
