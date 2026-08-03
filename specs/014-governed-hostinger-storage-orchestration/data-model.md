# Data Model

## Principles

- Additive schema only.
- Existing tenant, workspace, resource, principal, approval, capability, incident, and audit authorities are referenced rather than duplicated.
- Filesystem paths are execution evidence, not ownership authority.
- Durable multi-tenant records use opaque or encrypted provider-local path references.
- No credential payload, private key, token, file content, raw environment value, or raw secret-bearing provider payload is stored.
- All mutations include tenant/workspace/resource audience where applicable and monotonic revision/readback evidence.

## Resource graph

```text
storage_provider_accounts
  └─ storage_targets
      ├─ storage_target_bindings
      ├─ storage_pressure_snapshots
      ├─ storage_cleanup_operations
      │   ├─ storage_cleanup_plans
      │   │   ├─ storage_cleanup_plan_items
      │   │   ├─ storage_cleanup_plan_impacts
      │   │   └─ storage_cleanup_approvals
      │   ├─ storage_execution_leases
      │   └─ storage_cleanup_runs
      │       ├─ storage_cleanup_run_items
      │       └─ storage_reconciliation_results
      ├─ storage_emergency_reserves
      └─ storage_pressure_incidents
```

Existing entities referenced:

- tenants;
- workspaces and workspace ownership/membership;
- platform resources/resource graph;
- principals/effective subjects;
- Capability Envelopes and Resource Authority;
- delegation/break-glass/support cases;
- operational alerts/incidents;
- release/deployment evidence;
- execution/audit evidence.

## Entity: `storage_provider_accounts`

Represents one provider account/plan authority boundary.

| Field | Type | Rules |
|---|---|---|
| id | UUID | Primary key |
| provider_key | varchar | `hostinger` initially |
| provider_account_ref | varchar | Opaque stable reference, never credential |
| ownership_scope | enum | `platform`, `tenant`, `shared` |
| platform_owner_resource_id | UUID nullable | Platform resource graph link |
| tenant_id | UUID nullable | Required only for tenant-exclusive account |
| workspace_id | UUID nullable | Required only for tenant-exclusive account |
| status | enum | `active`, `blocked`, `retired` |
| policy_revision | bigint/varchar | Monotonic policy binding |
| created_at/updated_at | timestamp | Audit timestamps |

Constraints:

- Tenant/workspace must be null for platform/shared account unless a canonical owner edge defines otherwise.
- Provider account reference unique per provider.
- No SSH host/user/password fields stored here; use target/credential-reference registry.

## Entity: `storage_targets`

Represents a website, deployment slot, account-level cache/log surface, or certified storage root.

| Field | Type | Rules |
|---|---|---|
| id | UUID | Primary key |
| provider_account_id | UUID | FK |
| resource_id | UUID | Canonical platform resource |
| target_key | varchar | Stable key |
| target_type | enum | `account`, `website`, `deployment_slot`, `storage_root`, `reserve` |
| ownership_scope | enum | `platform`, `tenant`, `shared` |
| tenant_id/workspace_id | UUID nullable | Required for tenant-owned target |
| parent_target_id | UUID nullable | Resource hierarchy |
| storage_root_ref | varchar | Opaque provider-local reference |
| ssh_target_ref | varchar | Existing platform-managed target reference |
| host_key_fingerprint_ref | varchar | Trusted fingerprint evidence reference |
| active_deployment_ref | varchar nullable | Current deployment evidence reference |
| ownership_revision | varchar | Exact authority binding |
| policy_revision | varchar | Candidate/threshold policy binding |
| layout_certification_status | enum | `unknown`, `inventory_only`, `certified` |
| dispatch_status | enum | `disabled`, `scan_only`, `synthetic_apply`, `enabled` |
| status | enum | `active`, `blocked`, `retired` |

Indexes:

- unique `(provider_account_id, target_key)`;
- `(tenant_id, workspace_id, resource_id, status)`;
- `(ownership_scope, status)`;
- `(ssh_target_ref, status)`.

## Entity: `storage_target_bindings`

Stores revisioned ownership and path-scope evidence.

Fields:

- target ID;
- binding revision;
- tenant/workspace/resource IDs;
- ownership scope;
- canonical root hash/ref;
- allowed operation classes;
- active-from/to;
- evidence source and digest;
- created by principal/operation.

Only one current binding per target. Ownership change invalidates pending plans, approvals, and leases.

## Entity: `storage_pressure_snapshots`

Stores provider quota and SSH inventory observations.

| Field | Description |
|---|---|
| id, target/account IDs | Identity |
| provider_observed_at | hPanel/API timestamp |
| provider_evidence_ref/hash | Authority/freshness evidence |
| disk_limit_bytes/used_bytes/percent | Nullable when provider evidence unavailable |
| inode_limit/used/percent | Nullable when unavailable |
| ssh_observed_at | Inventory timestamp |
| logical_usage_bytes | Account or resource logical bytes |
| logical_inode_count | Resource/account inode count |
| byte_pressure_state | normal/warning/critical/emergency/unknown |
| inode_pressure_state | same |
| effective_pressure_state | worse state |
| completeness | complete/partial/stale/failed |
| top_directory_summary | bounded JSON, no contents/secrets |
| inode_hotspot_summary | bounded JSON |
| category_footprint_summary | bounded JSON |
| active_deployment_evidence_ref | Runtime/release binding |
| secrets_included | Must be false |

Retention: frequent snapshots aggregated after operational window; incident-linked snapshots retained per audit policy.

## Entity: `storage_cleanup_operations`

One orchestration lifecycle record.

Fields:

- operation ID;
- operation key;
- selected context (`admin`/`tenant`);
- principal/effective subject references;
- target/account/resource/tenant/workspace IDs;
- authority-context hash;
- ownership/policy revisions;
- idempotency key;
- state;
- risk class;
- capability/resource-authority/delegation/support/break-glass/release-authority references;
- current plan/run/lease IDs;
- unknown-outcome flag and reconciliation status;
- timestamps and terminal reason.

Unique constraints:

- idempotency key scoped to operation class/target while active;
- one active consequential operation per target/root enforced through lease.

## Entity: `storage_cleanup_plans`

Immutable plan header.

Fields:

- plan ID and operation ID;
- target/account/resource/tenant/workspace/ownership scope;
- authority-context hash;
- ownership revision;
- policy revision;
- source snapshot ID;
- candidate-set hash;
- plan hash;
- count/bytes totals;
- category totals;
- impact-set hash;
- created/expires timestamps;
- status: `planned`, `inspected`, `approval_requested`, `approved`, `expired`, `cancelled`, `consumed`, `blocked`;
- consumed run ID/time;
- bounded/truncated flags;
- protected/skipped counts;
- secrets_included=false.

Plan rows are immutable except lifecycle/consumption fields controlled by state transitions.

## Entity: `storage_cleanup_plan_items`

Exact approved write set.

Fields:

- item ID, plan ID, ordinal;
- category;
- opaque/encrypted path reference;
- relative tenant-safe path where allowed;
- size bytes;
- device ID hash/value;
- inode;
- ctime/mtime;
- file type expectation;
- eligibility rule/evidence;
- ownership evidence reference;
- protected classification=false requirement;
- item hash;
- planned result state.

Constraints:

- unique `(plan_id, ordinal)` and `(plan_id, item_hash)`;
- no raw content;
- candidate path must resolve under target root during execution.

## Entity: `storage_cleanup_plan_impacts`

Resolved impacted workspace/resource set.

Fields:

- plan ID;
- tenant/workspace/resource ID;
- impact class;
- candidate count/bytes;
- approval requirement key;
- resolution evidence;
- status.

Shared apply cannot become approved with unresolved impact rows.

## Entity: `storage_cleanup_approvals`

Storage-specific binding over existing approval authority.

Fields:

- approval ID and plan ID;
- approval slot (`platform_admin`, `workspace_owner`, `release_authority`, `incident_authority`, `delegation`);
- approver principal/context/workspace;
- decision;
- authority evidence reference;
- plan/candidate/impact/context hashes;
- ownership/policy revisions;
- expires/decided timestamps;
- invalidated flag/reason/time;
- supersedes approval ID.

No plaintext typed confirmation is persisted; store confirmation digest and contract key when required.

## Entity: `storage_execution_leases`

Prevents concurrent apply/deployment on a target/root.

Fields:

- lease ID;
- target/root reference;
- operation ID;
- lease purpose (`cleanup_apply`, `reserve`, `deployment`);
- generation/version;
- acquired/renewed/expires timestamps;
- holder worker/session reference;
- status;
- release/readback evidence.

CAS semantics and monotonic generation are required. A stale worker cannot renew or release a newer lease.

## Entity: `storage_cleanup_runs`

Provider execution attempt and aggregate outcome.

Fields:

- run ID, operation ID, plan ID;
- adapter key/version;
- worker/connector reference;
- dispatch certification reference;
- host-key evidence reference;
- started/finished timestamps;
- state;
- deleted/skipped/missing/failed counts and bytes;
- journal/checkpoint digest;
- before/after snapshot IDs;
- provider response classification;
- unknown-outcome flag;
- readback status;
- result digest;
- secrets_included=false.

## Entity: `storage_cleanup_run_items`

Per-item checkpoint/result.

Fields:

- run ID, plan item ID, sequence;
- pre-delete revalidation outcome;
- result (`deleted`, `skipped_changed`, `skipped_missing`, `skipped_protected`, `failed`);
- observed stat digest;
- checkpoint timestamp;
- error code/sanitized message;
- readback state.

No path content is duplicated when an opaque plan item reference is sufficient.

## Entity: `storage_reconciliation_results`

Classifies uncertain outcome.

Fields:

- reconciliation ID, run/operation IDs;
- input evidence hashes;
- item accounting totals;
- filesystem/provider/runtime readback references;
- outcome: `applied`, `partially_applied`, `not_applied`, `conflict`, `still_unknown`;
- retry permission (normally false; only explicit proof can allow a new plan);
- reviewed/created timestamps;
- evidence digest.

## Entity: `storage_emergency_reserves`

Fields:

- target/account ID;
- opaque reserve path reference;
- expected size;
- file fingerprint metadata;
- status (`absent`, `provisioned`, `released`, `invalid`);
- created/verified/released operation IDs and timestamps;
- active incident ID for release;
- policy revision.

Reserve fingerprint excludes file contents and credential data.

## Entity: `storage_pressure_incidents`

Fields:

- incident ID;
- target/account and impacted resource IDs;
- severity and pressure dimension;
- opened/resolved timestamps;
- provider case/reference;
- blocked deployment references;
- reserve action references;
- cleanup operation references;
- root-cause/growth-source classification;
- prevention action and remaining risk;
- support/delegation references;
- status and audit evidence.

## Policy data

Machine-readable policy controls:

- pressure thresholds;
- provider evidence freshness;
- candidate classes and retention;
- protected surfaces;
- plan limits and TTL;
- role/approval matrix;
- dispatch certification phase;
- reserve size;
- readback requirements;
- retention.

Policy changes are revisioned and pending plans/approvals bind to the revision they were created under.

## State transitions

### Operation

```text
observed -> classified -> planned -> inspected
-> approval_requested -> partially_approved -> approved
-> lease_acquired -> executing -> readback_pending
-> reconciling -> completed
```

Terminal: `blocked`, `expired`, `cancelled`, `failed`.  
Uncertain: `unknown_outcome -> reconciling`.

### Plan

```text
planned -> inspected -> approval_requested
-> approved -> consumed
```

Alternates: `expired`, `cancelled`, `blocked`.

### Run

```text
created -> dispatched -> running -> readback_pending
-> reconciling -> completed
```

Alternates: `failed`, `unknown_outcome`, `blocked`.

## Migration sequence

1. Provider account/target and binding tables.
2. Snapshot and policy revision support.
3. Operation/plan/item/impact tables.
4. Approval and lease bindings.
5. Run/item/reconciliation tables.
6. Reserve and incident links.
7. Read-only projections and indexes.
8. Tool/operation registry seeds default-off.

Each migration is additive, classified into existing domains/Work Maps, applied through the governed runner, and followed by same-cycle schema/count/index/readback.

## Rollback posture

- Before live data: drop additive objects only through separately governed rollback.
- After live data: disable routes/dispatch and retain records; do not drop audit/history automatically.
- Compatibility views may preserve read-only consumers during schema evolution.
- No rollback performs file restoration automatically.
