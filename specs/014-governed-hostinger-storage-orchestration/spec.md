# Feature Specification: Governed Hostinger Storage Orchestration

**Branch**: `gpt/hostinger-safe-storage-cleanup-ssh-20260801`  
**Created**: 2026-08-01  
**Status**: Implementation in progress — provider dispatch disabled  
**Delivery**: multi_pr  
**Spec owner**: platform-team

## Problem and verified baseline

Hostinger confirmed that the hosting plan reached its storage limit. The provider temporarily raised the limit, restoring File Manager access. During the incident, File Manager returned 403, environment-variable updates failed, and redeployment could not be trusted because required runtime state could not be persisted.

Verified facts:

- the failure affected the hosting plan, not only one application directory;
- hPanel Resources Usage is the authoritative provider view of plan disk and inode limits;
- SSH can inventory account bytes, inode counts, directory hotspots, and large files but `df` alone is not the Hostinger quota;
- the plan can contain platform, shared, and tenant-owned resources;
- deleting files based only on age, size, or pathname can remove active deployments, uploads, secrets, backups, or tenant data;
- a shell confirmation token is an accident-prevention measure, not authentication or authorization;
- live cleanup must not run from the public application runtime.

The current branch contains a conservative SSH script, policies, and pure authorization tests. No runtime route, database state, provider adapter, credential resolution, or live execution is active.

## Objective

Create one governed storage orchestration domain that:

1. detects byte and inode pressure before it blocks operations;
2. attributes growth to owned resources and candidate classes;
3. exposes separate Admin and Tenant surfaces over one application service;
4. creates immutable, inspectable cleanup plans;
5. resolves authority, approvals, delegation, and leases before mutation;
6. invokes only fixed, reviewed SSH operations;
7. verifies provider and runtime state after execution;
8. reconciles uncertain outcomes before any retry;
9. blocks risky Production promotion when storage headroom is insufficient;
10. never exposes credentials or cross-tenant filesystem information.

## Scope

### Included

- Hostinger account/plan/website/deployment/storage-root resource modeling.
- Disk-byte and inode pressure snapshots.
- Admin and Tenant read-only scan, plan, inspect, and readback.
- Tenant apply requests and approval holds.
- Workspace Owner, Platform Admin, delegation, break-glass, and shared-impact approval rules.
- Immutable cleanup plans and exact candidate-set binding.
- Execution leases, idempotency, interruption checkpoints, and reconciliation.
- Fixed Hostinger SSH adapter contract with host-key pinning.
- Conservative cleanup classes: old npm cache, npm diagnostic logs, rotated/compressed logs.
- Emergency reserve lifecycle for Admin only.
- Production promotion storage preflight.
- Tenant-safe and Admin-bounded evidence projections.
- Auditing, metrics, alerts, runbooks, and closeout evidence.

### Excluded

- Arbitrary SSH commands, arbitrary roots, wildcards, or delete expressions.
- Automatic scheduled deletion.
- Tenant account-level or shared-root deletion.
- Deleting uploads, databases, mail, secrets, archives, backups, or active deployment roots.
- Deployment-history cleanup before active-root and rollback-set certification.
- Treating Spec Kit, UI role, route parameter, or typed confirmation as runtime authority.
- Reading or returning SSH credentials, API tokens, private keys, or secret values.
- Applying migrations or enabling provider dispatch in this specification PR.

## Work Map integration and dimension discovery

`work-map-integration.json` binds this feature to all current generated Work Maps and schema domains. The principal integrations are:

- Policy/Authority: Admin/Tenant context, Capability Envelope, Resource Authority, approvals, delegation, break-glass.
- Platform Resource Graph: hosting account, website, deployment slot, storage root, plan, run, incident.
- Connector/Provider: fixed Hostinger SSH adapter and credential-reference boundary.
- Workflow/Task Orchestration: operation lifecycle, approval holds, leases, reconciliation.
- Observability/Release: pressure snapshots, alerts, promotion gate, readback.
- Delivery/Support: incidents, support cases, provider escalation, recovery.
- Data Model Domain: durable targets, plans, items, approvals, runs, incidents.
- Migration Lifecycle: additive schema rollout and rollback.
- Repository Development/Automation: contract tests, generated maps, CI, and governed delivery.

No new Work Map is proposed. Existing maps are reused or extended.

## Actors and authority

| Actor | Principal/auth mode | Allowed responsibilities | Forbidden overrides |
|---|---|---|---|
| Platform Admin | Admin JWT/service authority | Platform/shared scans, policy, incidents, reserve, governed apply | Cannot silently borrow Tenant ownership or read secrets |
| Tenant Workspace Owner | Tenant JWT + effective subject | Owned-resource scan, plan, approval, governed apply | Cannot operate shared/platform targets or other workspaces |
| Tenant Operator | Tenant JWT + membership | Scan, plan, inspect, request approval | Cannot approve or apply |
| Service Principal | Service identity | Scheduled scan/readback only | Cannot plan, approve, apply, or release reserve |
| Delegated Support Operator | Admin context + active delegation/support case | Bounded tenant support operation | Cannot exceed delegation or omit tenant evidence |
| Release Authority | Governed release principal | Approve deployment-history candidate exclusion and promotion gate | Cannot authorize unrelated cleanup |
| Provider Worker | Dedicated worker/connector | Execute fixed certified adapter operation | Cannot resolve authority or accept free-form commands |

## User journeys

### US1 — Platform Admin sees storage risk before deployment (P1)

**Given** a Hostinger target and fresh provider/account evidence  
**When** the Admin opens a storage snapshot  
**Then** the system returns byte/inode pressure, growth attribution, confidence, freshness, and deployment impact without exposing credentials.

### US2 — Tenant Operator investigates an owned resource (P1)

**Given** an explicit Tenant/Workspace/Resource context  
**When** the operator requests a scan  
**Then** only relative paths and aggregate usage for that owned resource are returned.

### US3 — Workspace Owner approves low-risk cleanup (P1)

**Given** an immutable plan limited to the owned root and safe candidate classes  
**When** the owner approves the exact plan hash  
**Then** approval is bound to tenant, workspace, resource, ownership revision, policy revision, candidate hash, expiry, and authority context.

### US4 — Platform Admin cleans a platform-owned target (P1)

**Given** a certified adapter, approved plan, active lease, and exact confirmation  
**When** apply begins  
**Then** only plan items that still match path/device/inode/size/ctime/mtime are deleted and every item produces a checkpoint.

### US5 — Admin supports a tenant without stealing authority (P1)

**Given** a tenant-owned target  
**When** an Admin requests mutation  
**Then** the request is denied unless active delegation or bounded break-glass evidence, a support case, required approvals, and the exact tenant resource binding exist.

### US6 — Shared-account cleanup resolves impact (P1)

**Given** candidates span shared or multi-tenant infrastructure  
**When** Admin creates a plan  
**Then** the orchestrator computes the impacted workspace set and blocks apply until required approvals or an approved quorum policy is satisfied.

### US7 — Unknown SSH result is reconciled (P1)

**Given** transport fails after a possible deletion  
**When** the operation outcome is uncertain  
**Then** state becomes `unknown_outcome`, no automatic retry occurs, and reconciliation uses the same operation journal and readback.

### US8 — Emergency reserve restores writability (P2)

**Given** an active storage incident and a pre-provisioned reserve  
**When** Platform Admin releases the exact reserve fingerprint  
**Then** only the reserve file is removed, the operation is audited, and normal cleanup remains separately authorized.

### US9 — Production promotion is blocked safely (P1)

**Given** emergency pressure or insufficient projected install headroom  
**When** a `main` to `Production` promotion is evaluated  
**Then** the promotion gate blocks without auto-cleaning and opens operational attention.

## Operation paths

Detailed paths are in `operation-paths.md`:

- OP-001 Admin storage scan.
- OP-002 Tenant resource scan.
- OP-003 Create conservative plan.
- OP-004 Inspect plan.
- OP-005 Request approval.
- OP-006 Approve or deny plan.
- OP-007 Tenant-owned apply.
- OP-008 Platform/shared apply.
- OP-009 Unknown-outcome reconciliation.
- OP-010 Reserve create/status/release.
- OP-011 Production promotion preflight.
- OP-012 Incident and support handoff.

## Functional requirements

- **FR-001**: The system SHALL resolve an explicit `admin` or `tenant` context before target discovery.
- **FR-002**: A dual-role principal SHALL explicitly select one context; no authority may be borrowed across contexts.
- **FR-003**: Every target SHALL resolve to hosting account, resource, ownership scope, canonical root reference, ownership revision, policy revision, and SSH target reference.
- **FR-004**: Tenant requests SHALL be restricted to a matching tenant, workspace, and exclusively owned resource.
- **FR-005**: Admin mutation of a tenant-owned resource SHALL require active delegation or bounded break-glass evidence tied to a support case.
- **FR-006**: Shared-target apply SHALL require a resolved impact set and all required approvals or an approved quorum policy.
- **FR-007**: The system SHALL measure and classify disk-byte and inode pressure independently.
- **FR-008**: Provider plan limits SHALL come from fresh hPanel evidence; SSH `df` SHALL not be represented as the plan quota.
- **FR-009**: `scan` SHALL be read-only, bounded, secret-safe, and usable without creating state files.
- **FR-010**: Tenant scan results SHALL use relative paths and SHALL exclude account-wide and cross-tenant details.
- **FR-011**: `plan` SHALL include only policy-approved candidate classes and SHALL not delete files.
- **FR-012**: A plan SHALL bind target, resource, context hash, ownership revision, policy revision, candidate-set hash, plan hash, totals, impact set, and expiry.
- **FR-013**: Plan approval SHALL be invalidated when any bound field changes or the plan expires.
- **FR-014**: Tenant Operator SHALL not approve or apply; Workspace Owner may approve/apply only within the exact owned context.
- **FR-015**: Mutation SHALL require Capability Envelope, Resource Authority where applicable, execution lease, typed confirmation, and exact plan binding.
- **FR-016**: Provider invocation SHALL use a fixed adapter operation and reviewed script reference; no free-form shell input is permitted.
- **FR-017**: SSH host-key fingerprint SHALL be pinned and a mismatch SHALL fail closed.
- **FR-018**: Before each deletion the worker SHALL revalidate canonical path, regular-file type, symlink status, device, inode, size, ctime, and mtime.
- **FR-019**: A changed or replaced plan item SHALL be skipped; the worker SHALL never substitute or expand candidates.
- **FR-020**: An apply plan SHALL be single-use and protected by target/root execution lease and idempotency key.
- **FR-021**: Every mutation SHALL emit interruption checkpoints and a bounded execution journal.
- **FR-022**: Unknown outcomes SHALL not retry automatically and SHALL reconcile before completion or retry.
- **FR-023**: Readback SHALL compare before/after bytes, inodes, plan items, hPanel usage, File Manager writability, environment-variable save, and runtime health where applicable.
- **FR-024**: Emergency reserve operations SHALL be Admin-only and reserve release SHALL require an active storage incident and exact reserve fingerprint.
- **FR-025**: Production promotion SHALL run a read-only storage preflight and SHALL block at emergency pressure or insufficient headroom.
- **FR-026**: The system SHALL record tenant-safe and platform audit projections without credential values or raw provider payloads.
- **FR-027**: Provider dispatch SHALL remain disabled until route, persistence, approval, lease, host-key, worker, reconciliation, and live readback certification pass.
- **FR-028**: Deployment-history cleanup SHALL require Release Authority, active Production SHA exclusion, rollback-set retention proof, and deployment/runtime readback.

## Non-functional requirements

- **NFR-001 Security**: All consequential operations fail closed on missing, stale, ambiguous, or mismatched authority evidence.
- **NFR-002 Tenant isolation**: No tenant response may reveal another tenant, shared account tree, absolute server path, or provider credential metadata.
- **NFR-003 Availability**: Scan shall remain usable during storage pressure and shall not require creation of locks or plan state.
- **NFR-004 Performance**: Responses and command output shall be bounded; expensive inventory operations shall support limits, timeouts, and asynchronous execution.
- **NFR-005 Observability**: Every operation has stable operation ID, state transition evidence, metrics, audit references, and readback completeness.
- **NFR-006 Compatibility**: Existing Hostinger deployment behavior remains unchanged until explicit adapter rollout; current production is not mutated by this package.
- **NFR-007 Replay safety**: Idempotency keys, plan consumption, approval expiry, and leases prevent duplicate mutation.
- **NFR-008 Privacy**: Logs, plans, approvals, and evidence never contain file contents, credentials, secret values, or unnecessary personal data.
- **NFR-009 Recovery**: Interrupted/unknown operations can reconcile deterministically without broad retries.
- **NFR-010 Maintainability**: Admin and Tenant routes reuse one application service, operation catalog, state machine, policy registry, and provider adapter.

## State and data requirements

Entities are defined in `data-model.md`:

- storage targets and ownership bindings;
- pressure snapshots and provider quota evidence;
- operations, plans, plan items, impact sets, approvals, leases, runs, journals, incidents, and policy revisions;
- encrypted or opaque provider-local path references;
- lifecycle transitions and invalidation rules;
- bounded retention and no-secret guarantees.

## Contracts

Contract drafts under `contracts/` use OpenAPI 3.1 and JSON Schema 2020-12. They are specification-only and are not mounted until a separately governed implementation phase.

## Error taxonomy

| Code | HTTP/status | Stage | Retryable | User action | Readback |
|---|---:|---|---|---|---|
| STORAGE_CONTEXT_REQUIRED | 400 | context | no | Select Admin or Tenant context | Context Kernel |
| STORAGE_TARGET_NOT_OWNED | 403 | authority | no | Select owned resource or request support | Resource authority |
| STORAGE_DELEGATION_REQUIRED | 403 | authority | no | Obtain delegation/support evidence | Delegation registry |
| STORAGE_PLAN_STALE | 409 | planning | no | Generate a new plan | Plan/revision readback |
| STORAGE_APPROVALS_MISSING | 409 | approval | no | Complete required approvals | Approval center |
| STORAGE_LEASE_CONFLICT | 409 | execution | yes after expiry/reconciliation | Wait or reconcile | Lease registry |
| STORAGE_HOST_KEY_MISMATCH | 503 | dispatch | no | Security review and repin | Worker known-host evidence |
| STORAGE_ITEM_CHANGED | item-skip | apply | no | Review skipped item | Per-item stat readback |
| STORAGE_UNKNOWN_OUTCOME | 202/409 | execution | no automatic retry | Run reconciliation | Journal/filesystem readback |
| STORAGE_QUOTA_EVIDENCE_STALE | 409 | preflight | yes after refresh | Refresh hPanel evidence | Provider evidence |
| STORAGE_PROMOTION_BLOCKED | 409 | release | no | Resolve pressure/headroom | Promotion preflight |
| STORAGE_DISPATCH_DISABLED | 503 | runtime | no | Complete rollout certification | Feature/dispatch registry |

See `error-catalog.md` for the complete structured catalog.

## Security and privacy

The design requires:

- authenticated principal and explicit context;
- object-level ownership and audience binding;
- Context Kernel and Effective Authority resolution;
- Capability Envelope and Resource Authority for mutation;
- Workspace Owner, Platform Admin, delegation, break-glass, support-case, incident, and Release Authority checks as applicable;
- short-lived approvals and leases;
- pinned SSH host key;
- credential references resolved only in the worker;
- no credentials in command line, plan, logs, evidence, approval, or response;
- bounded tenant and admin projections;
- fail-closed behavior for unclassified paths or impact.

## Observability and evidence

Required evidence includes:

- `operation_id`, `plan_id`, `run_id`, target/resource IDs, and authority-context hash;
- pressure snapshots and provider-evidence timestamp;
- state transitions and denial reason codes;
- candidate totals by category, not contents;
- approval and lease references;
- worker dispatch certificate and host-key fingerprint reference;
- per-item deleted/skipped counts and checkpoint sequence;
- before/after bytes and inode count;
- hPanel recalculation, File Manager probe, environment-variable save probe, and runtime status/health/version/deployment-info when relevant;
- unknown-outcome reconciliation result;
- `secrets_included: false` on every evidence packet.

## Rollout, rollback, and compatibility

Rollout is phased:

1. contract and pure policy;
2. read-only Admin/Tenant projections;
3. durable plan and approval center;
4. synthetic non-production apply;
5. tenant-exclusive apply;
6. platform/shared apply and reserve;
7. deployment-history and release integration.

Every phase is default-off and independently reversible. Rollback disables route/dispatch flags, expires new approvals/leases, preserves audit evidence, and does not automatically reverse file deletion. Recovery relies on protected candidate classes, rollback-set retention, backups, and provider/runtime readback.

## Success criteria

- **SC-001**: Storage pressure is detected before File Manager or environment updates fail in the certified target set.
- **SC-002**: 100% of Tenant projections pass cross-tenant and absolute-path leakage tests.
- **SC-003**: 100% of mutation attempts without exact authority, approval, lease, and plan binding are denied.
- **SC-004**: Changed inode/path candidates are skipped in all race tests.
- **SC-005**: Duplicate/replayed plans produce no second deletion.
- **SC-006**: Unknown-outcome tests never trigger automatic retry.
- **SC-007**: Synthetic apply readback accounts for every candidate as deleted or skipped.
- **SC-008**: Emergency promotion pressure blocks deployment without automatic deletion.
- **SC-009**: No secret-bearing output is found in tests, logs, plans, or evidence.
- **SC-010**: Production enablement occurs only after exact-head CI, migration/readback, pinned SSH, synthetic drill, and explicit rollout approval.

## Open questions

- **Q-001**: What supported Hostinger API or export will provide durable hPanel quota evidence? Owner: platform operations; gate: Phase 2.
- **Q-002**: What is the exact active deployment and historical checkout layout for the current Node.js product? Owner: platform operations; gate: Phase 2 inventory certification.
- **Q-003**: Which tenant resources are actually exclusive storage roots versus logical allocations on a shared root? Owner: Context Kernel/data team; gate: Phase 3.
- **Q-004**: What quorum policy is permitted for shared cleanup with multiple impacted workspaces? Owner: governance; gate: Phase 3.
- **Q-005**: What retention and encryption policy applies to provider-local opaque path references? Owner: security/data governance; gate: migration design.

## Delivery state

This package documents and guards the target design. The current branch may include pure policy, safe shell tooling, and tests, but it does not authorize live routes, SQL apply, credential access, SSH dispatch, deletion, merge, Production promotion, or Hostinger deployment.
