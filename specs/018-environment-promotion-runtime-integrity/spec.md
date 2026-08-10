# Spec 018 — Environment Promotion and Runtime Integrity

## Status
Draft

## Purpose
Define the governed environment-promotion, production-runtime integrity, break-glass reconciliation, canonical-resource resolution, and deployment-attestation model for the platform.

This specification makes `main` the staging/integration authority, `Production` the production source authority, and Hostinger an immutable runtime by default. It also replaces hard-coded activation document lists with a dynamic canonical resource registry that distinguishes activation-critical resources from searchable, on-demand knowledge.

## Problem Statement
The platform currently has related integrity gaps:

1. production deployment contracts can still describe `main` as the Hostinger deploy branch even though the intended lifecycle is `main` -> staging validation -> `Production` -> production deployment;
2. the Hostinger checkout can become locally modified, weakening provenance and allowing runtime state to diverge from reviewed Git source;
3. break-glass runtime changes need an explicit lifecycle that cannot complete until the fix is reconciled through `main` and `Production` and a clean redeploy is proven;
4. activation depends on a fixed set of canonical repository files instead of a registry-driven resource model;
5. deployment evidence should be generated from the approved production commit and active resource registry rather than maintained as a manually edited static manifest;
6. service health, activation readiness, and runtime integrity are distinct states and must not be conflated.

## Goals

### G1 — Environment authority
- work branches contain feature/fix/spec changes;
- `main` is the staging and integration authority;
- `Production` is the production source authority;
- Hostinger production deployment resolves an exact `Production` commit SHA;
- normal production promotion flows through `main` before `Production`.

### G2 — Immutable production runtime
Application-code mutation on Hostinger is denied by default. Hostinger is a runtime/readback surface, not a development workspace.

### G3 — Governed break glass
Allow tightly bounded emergency local mutation only through explicit break-glass authorization that is incident-bound, principal-bound, path-bound, time-bound, and auditable.

### G4 — Mandatory reconciliation
A successful local break-glass patch is temporary. The incident cannot close until the equivalent change is represented in Git, validated on `main`, promoted to `Production`, redeployed, and the Hostinger runtime is clean and commit-aligned.

### G5 — Dynamic canonical resources
Replace hard-coded canonical-file activation dependencies with a SQL-authoritative canonical resource registry supporting multiple loading and validation strategies.

### G6 — Generated deployment attestation
Generate immutable deployment attestation from the exact `Production` commit, build identity, active canonical resource registry revision, and hashes for resources requiring deployment-time integrity evidence.

## Non-Goals
- This spec does not directly deploy to Hostinger.
- This spec does not authorize direct writes to `main` or `Production`.
- This spec does not remove GitHub as the reviewed source authority.
- This spec does not require all knowledge files to be loaded into model context at activation time.
- This spec does not make a dirty Hostinger checkout acceptable as canonical production authority.
- This spec does not weaken existing approval, CI, branch-protection, migration, credential, or secret-handling requirements.

## Environment Authority Model

The normal lifecycle MUST be:

```text
work branch
    -> main
    -> staging CI and verification
    -> Production
    -> immutable production deployment
    -> Hostinger runtime
```

### Invariants
- `main` MUST represent staging/integration authority.
- `Production` MUST represent production source authority.
- Production deployment MUST resolve an exact commit from `Production`.
- A feature, fix, hotfix, or spec branch MUST NOT normally deploy directly to Hostinger production.
- Direct application-code writes to Hostinger MUST be denied outside an active break-glass authorization.
- A production deployment MUST expose sufficient readback to prove the deployed commit.

## Break-Glass Lifecycle

Break glass is a temporary runtime exception, not an alternate development process.

```text
OPEN
  -> APPROVED
  -> LOCAL_PATCH_APPLIED
  -> RUNTIME_VERIFIED
  -> RECONCILING
  -> MAIN_COMMITTED
  -> STAGING_VERIFIED
  -> PRODUCTION_PROMOTED
  -> REDEPLOYED
  -> CLEAN_READBACK
  -> CLOSED
```

Rollback is allowed when the local patch fails verification:

```text
LOCAL_PATCH_APPLIED -> ROLLED_BACK
RUNTIME_VERIFIED -> ROLLED_BACK
```

### Break-glass authorization requirements
An authorization MUST bind at least:
- `break_glass_id`;
- `incident_id`;
- approving principal;
- executing principal or agent;
- bounded reason;
- allowed paths;
- expiry timestamp;
- pre-change hashes where applicable;
- rollback plan;
- audit correlation identifiers.

Broad unrestricted shell or filesystem mutation is not an acceptable substitute.

### Closure invariant
`CLOSED` MUST be impossible unless:
- the intended fix is committed through the governed Git workflow;
- the change has reached `main`;
- staging verification passed;
- the approved change has reached `Production`;
- Hostinger was redeployed from an exact `Production` SHA;
- runtime readback matches the approved deployment;
- the production checkout/artifact is clean according to policy;
- no unapproved local mutation remains.

## Runtime Integrity Model
Runtime integrity is separate from service availability.

Suggested states:
- `verified_clean`;
- `break_glass_active`;
- `degraded_unreconciled_change`;
- `verification_failed`;
- `unknown`.

A service MAY be healthy while runtime integrity is degraded. Activation and dashboards MUST expose these dimensions separately.

## Canonical Resource Registry
Canonical resources MUST be registry-driven rather than compiled into a fixed activation list.

A SQL-authoritative registry SHOULD support fields equivalent to:
- `resource_key`;
- `path` or governed canonical pointer;
- `resource_type`;
- `load_strategy`;
- `validation_strategy`;
- `required_at_activation`;
- `searchable`;
- `environment_scope`;
- `enabled`;
- registry revision evidence.

### Resource classes
At minimum:
1. `runtime_critical` — integrity must be proven during activation/bootstrap;
2. `routing_index` — used to locate governed logic, knowledge, or resources;
3. `on_demand_searchable` — retrieved only when a request requires the content.

Activation MUST NOT require loading the full text of every registered resource. Integrity verification and content retrieval are separate concerns.

## Dynamic Knowledge Retrieval
For `on_demand_searchable` resources:

```text
request
  -> activity/routing resolution
  -> canonical resource registry
  -> search or exact resource lookup
  -> bounded relevant retrieval
  -> task execution
```

Removing a non-critical knowledge file from the active registry MUST NOT require changing activation code. Adding a new searchable resource SHOULD primarily be a governed registry/configuration operation.

## Generated Deployment Attestation
Deployment attestation MUST be generated, not manually maintained as the primary integrity record.

It SHOULD contain at least:
- schema/version identifier;
- repository identity;
- source branch (`Production` for production deploys);
- exact source commit SHA;
- build/release identifier;
- build timestamp;
- canonical resource registry revision;
- hashes for resources whose strategy requires integrity evidence;
- generation policy/version;
- no secrets.

The registry defines WHAT requires evidence. Git defines reviewed CONTENT. The generated attestation proves WHAT was built/deployed. Hostinger readback proves WHAT is running.

## Activation Requirements
Activation SHOULD validate only resources and evidence required for bootstrap and safe operation.

It MUST distinguish at least:
- provider/bootstrap readiness;
- canonical-resource integrity readiness;
- runtime deployment integrity;
- degraded optional/on-demand knowledge surfaces.

A missing optional searchable resource MUST NOT automatically invalidate the entire activation if policy does not classify it as activation-critical.

Errors MUST identify precise reasons such as:
- `canonical_resource_missing`;
- `canonical_resource_hash_mismatch`;
- `canonical_registry_revision_stale`;
- `production_commit_mismatch`;
- `runtime_dirty_unapproved`;
- `deployment_attestation_missing`;
- `deployment_attestation_stale`;
- `break_glass_reconciliation_incomplete`.

## Production Deployment Contract
The Hostinger production deployment contract MUST move from a caller-selectable or `main`-only branch contract to registry/policy-resolved production authority.

Preferred behavior:
- caller supplies/approves an expected production commit SHA;
- runtime policy resolves that SHA against configured production branch `Production`;
- arbitrary branches cannot be deployed through the production surface;
- deployment readback proves the same SHA after restart;
- branch policy is registry/config authority rather than duplicated hard-coded enums.

## Security Requirements
- No inline provider credentials or secrets.
- No unrestricted remote shell for routine production modification.
- Local production writes require explicit break-glass authorization.
- Path scope MUST be narrow and allowlisted.
- Authorization MUST expire automatically.
- Mutations MUST be audit logged.
- Readback MUST verify intended state transition.
- Protected-branch writes remain separately governed.
- Break-glass approval MUST NOT implicitly authorize later Git merge, production promotion, or deployment.

## Observability Requirements
Expose:
- current staging authority SHA;
- current production authority SHA;
- deployed runtime SHA;
- runtime integrity state;
- active break-glass incidents;
- unreconciled local changes;
- canonical registry revision;
- deployment attestation identity;
- last successful integrity verification timestamp;
- precise degraded reason codes.

## Compatibility and Migration
Implementation SHOULD be additive and phased:
1. introduce authority and integrity readbacks;
2. add dynamic canonical resource registry while preserving existing required resources;
3. generate deployment attestation in shadow/read-only mode;
4. enforce `Production` as production deploy authority;
5. deny routine Hostinger local application-code mutation;
6. enable governed break-glass lifecycle;
7. retire hard-coded activation resource assumptions after parity is proven.

## Acceptance Criteria
1. `main` is explicitly modeled as staging/integration authority.
2. `Production` is explicitly modeled as production source authority.
3. Hostinger production deployment cannot normally deploy from `main` or arbitrary branches.
4. Hostinger application-code local writes are denied by default.
5. Break-glass mutation requires bounded authorization and durable audit evidence.
6. Break-glass cannot close before reconciliation through `main`, staging verification, `Production`, clean redeployment, and readback.
7. Runtime health and runtime integrity are reported separately.
8. Canonical resources resolve through a dynamic registry rather than a fixed activation list.
9. On-demand/searchable resources can be added or disabled without changing activation code.
10. Activation validates critical resource integrity without loading all knowledge content.
11. Deployment attestation is generated from approved production commit and active registry revision.
12. Commit/hash/readback mismatch produces explicit degraded reason codes.
13. This specification PR performs no protected-branch write, merge, deployment, migration execution, or Hostinger mutation.

## Implementation Decomposition
After spec approval, implementation SHOULD be split into bounded PRs:
- PR A: environment authority and production deployment contract;
- PR B: Hostinger runtime immutability and break-glass lifecycle;
- PR C: dynamic canonical resource registry and on-demand retrieval;
- PR D: generated deployment attestation and activation/runtime-integrity readback;
- PR E: enforcement cleanup and retirement of legacy hard-coded assumptions after parity evidence.
