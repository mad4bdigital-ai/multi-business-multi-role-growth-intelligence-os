# Hostinger Storage Orchestration for Admin and Tenant

## Objective

Provide one governed orchestration domain for Hostinger storage pressure while preserving two distinct authority surfaces:

- **Admin surface** for platform infrastructure, shared hosting accounts, provider policy, emergency reserve, cross-tenant impact, incidents, and release gates.
- **Tenant surface** for a tenant workspace to observe, plan, request approval, inspect, and—only when every authority requirement is satisfied—apply cleanup to its exclusively owned resource root.

The design must not create two cleanup engines. Both surfaces resolve into one application service, one operation state machine, one plan format, one audit model, and one SSH adapter.

```text
Admin HTTP surface ─┐
                    ├─> Context Kernel
Tenant HTTP surface ┘       ↓
                       Effective Authority
                              ↓
                    Storage Orchestration Service
                              ↓
              fixed Hostinger SSH provider adapter
                              ↓
                 scan / plan / inspect / apply
```

## Non-negotiable separation

Admin and Tenant are not interchangeable presentation modes.

- A Platform Admin does not automatically acquire Tenant Workspace Owner authority.
- A user who has both roles must select `admin` or `tenant` context explicitly.
- Changing context invalidates the pending authority context hash.
- Tenant context cannot invoke reserve, shared-account apply, platform policy, or platform infrastructure operations.
- Admin context cannot mutate a tenant-owned resource without explicit delegation or break-glass evidence.
- No route accepts a free-form shell command, arbitrary root, wildcard, or delete expression.

This prevents confused-deputy behavior where an elevated account accidentally performs a tenant operation using platform authority or vice versa.

## Resource graph

Authority is resolved over a resource graph rather than a raw filesystem path:

```text
Hosting Account
  └─ Hosting Plan
      ├─ Website
      │   └─ Deployment Slot
      │       └─ Storage Root
      │           └─ Cleanup Plan
      │               └─ Cleanup Plan Item
      └─ Account-level cache/log/reserve surfaces
```

Every actionable target must resolve to:

- `target_id`;
- `hosting_account_id`;
- `resource_id`;
- `ownership_scope`;
- `account_ownership_scope`;
- `tenant_id` and `workspace_id` when tenant-owned;
- canonical allowlisted storage root;
- ownership revision;
- policy revision;
- SSH target and pinned host-key fingerprint.

A pathname is execution evidence, not authority. The orchestrator must resolve resource ownership before a path can become eligible.

## Ownership scopes

### Platform-owned

Examples include `auth.mad4b.com` and platform control-plane files.

- Tenant read or mutation is forbidden.
- Platform Admin may scan and plan.
- Apply requires Platform Admin authority, Capability Envelope, exact plan hash, execution lease, and readback.
- Deployment-history cleanup additionally requires Release Authority and active-SHA exclusion.

### Tenant-owned

The website/storage root belongs exclusively to one tenant workspace.

- Workspace Owner and Tenant Operator may scan, plan, and inspect.
- Tenant Operator may request an apply approval but cannot approve or execute it.
- Workspace Owner may approve and execute only within the same Tenant, Workspace, Resource, and ownership revision.
- Platform Admin may observe for support, but mutation requires explicit Tenant delegation or a bounded break-glass record tied to a support case.

### Shared

The account/root contains resources from multiple tenants or both platform and tenant infrastructure.

- A tenant can see only its allocation or resource projection.
- A tenant cannot execute account-level cleanup.
- A tenant may submit a cleanup request for its owned resource.
- Platform Admin plans account-level cleanup and resolves the impact set.
- If candidate paths affect tenant resources, required Workspace Owner approvals or an approved policy-defined quorum must be satisfied.
- No shared plan may rely on a generic “admin approved” flag without the impact set.

## Principal profiles

### Platform Admin

May:

- manage provider and retention policy;
- run account-wide scans;
- inspect cross-tenant impact sets;
- manage emergency reserve;
- approve and apply platform-owned plans;
- approve and apply shared plans after impact approvals;
- open/resolve storage incidents;
- block Production promotion at storage emergency.

Cannot:

- read credential payloads through this tool;
- silently borrow Tenant Workspace Owner authority;
- delete tenant-owned content without delegation/break-glass;
- bypass exact plan binding or readback.

### Tenant Workspace Owner

May:

- scan tenant-owned resources;
- create and inspect conservative plans;
- approve tenant-owned low-risk cleanup;
- apply an exact plan after Resource Authority, Capability Envelope, lease, typed confirmation, and revision checks.

Cannot:

- manage reserve;
- change global retention policy;
- inspect other tenants;
- operate on a shared account root or platform target;
- widen the plan after approval.

### Tenant Operator

May:

- scan;
- plan;
- inspect;
- request approval.

Cannot approve or apply.

### Service Principal

May run scheduled read-only scan/readback only. It cannot create approval, approve, apply, release reserve, or mutate policy.

## Unified operation catalog

```text
hostinger_storage_scan
hostinger_storage_plan
hostinger_storage_inspect_plan
hostinger_storage_request_apply
hostinger_storage_approve_plan
hostinger_storage_apply_plan
hostinger_storage_readback
hostinger_storage_reserve_status
hostinger_storage_reserve_create
hostinger_storage_reserve_release
hostinger_storage_policy_manage
```

### Read-only operations

`scan`, `plan`, `inspect`, and `readback` are non-consequential at the provider level. `plan` may persist an immutable internal plan, but it performs no deletion.

### Approval operations

`request_apply` creates an approval hold only. It must not dispatch SSH.

`approve_plan` records a scope-specific decision. An approval is bound to:

- principal and selected context;
- tenant/workspace/resource;
- ownership revision;
- policy revision;
- exact candidate-set hash;
- exact plan hash;
- expiration;
- impact set.

### Consequential operation

`apply_plan` is the only general cleanup mutation. Authorization success does not by itself enable dispatch. Live dispatch requires separate runtime certification.

## Two HTTP surfaces, one service

Suggested route families:

### Admin

```text
GET  /admin/hosting/storage/targets/:targetId/snapshot
POST /admin/hosting/storage/targets/:targetId/plans
GET  /admin/hosting/storage/plans/:planId
POST /admin/hosting/storage/plans/:planId/request-approval
POST /admin/hosting/storage/plans/:planId/approve
POST /admin/hosting/storage/plans/:planId/apply
GET  /admin/hosting/storage/runs/:runId/readback
POST /admin/hosting/storage/targets/:targetId/reserve
POST /admin/hosting/storage/targets/:targetId/reserve/release
```

### Tenant

```text
GET  /tenant/workspaces/:workspaceId/resources/:resourceId/storage/snapshot
POST /tenant/workspaces/:workspaceId/resources/:resourceId/storage/plans
GET  /tenant/workspaces/:workspaceId/storage/plans/:planId
POST /tenant/workspaces/:workspaceId/storage/plans/:planId/request-approval
POST /tenant/workspaces/:workspaceId/storage/plans/:planId/approve
POST /tenant/workspaces/:workspaceId/storage/plans/:planId/apply
GET  /tenant/workspaces/:workspaceId/storage/runs/:runId/readback
```

Both route families must call the same orchestration application service. Route parameters never establish ownership; Context Kernel and Effective Authority must resolve and verify it.

## Tenant-safe projection

Tenant responses must contain only:

- relative paths under the owned storage root;
- the tenant resource’s logical bytes and inode count;
- candidate category and size;
- own operation/approval/readback records;
- generic account-pressure state where exposing it is permitted.

Tenant responses must not contain:

- absolute server path;
- SSH host/user/port;
- other tenant IDs or workspace IDs;
- account-wide directory listing;
- raw provider payload;
- credentials or secret references;
- platform deployment paths.

## Admin projection

Admin may receive bounded absolute or provider-relative paths for governance, but secret values remain forbidden. Cross-tenant information is limited to impact resolution and operational governance, not credential or content inspection.

## Authority composition

The operation is authorized only when all applicable layers agree:

```text
Authenticated Principal
  ∩ Explicit Context
  ∩ Tenant/Workspace Membership
  ∩ Target Ownership
  ∩ Resource Authority
  ∩ Operation Capability
  ∩ Approval Policy
  ∩ Exact Plan Binding
  ∩ Execution Lease
  ∩ Runtime Dispatch Certification
```

Missing or ambiguous evidence fails closed.

### Tenant apply

Requires:

- tenant context;
- matching tenant/workspace/resource;
- Workspace Owner role;
- Resource Authority for `apply`;
- short-lived Capability Envelope;
- exact authority-context hash;
- exact plan and candidate hashes;
- matching ownership and policy revisions;
- Workspace Owner approval;
- execution lease;
- typed confirmation;
- certified SSH adapter.

### Admin apply to tenant-owned resource

Additionally requires one of:

- explicit active Tenant delegation plus support case; or
- bounded break-glass grant plus support case and active incident.

Admin role alone is insufficient.

### Shared apply

Requires:

- Platform Admin;
- resolved impacted workspace set;
- all required approvals or policy-defined quorum;
- no unowned/unclassified path;
- exact plan and revisions;
- execution lease and readback.

## Plan immutability

A plan must bind at minimum:

```text
target_id
hosting_account_id
resource_id
ownership_scope
tenant_id
workspace_id
authority_context_hash
ownership_revision
policy_revision
candidate_set_hash
plan_hash
expires_at
```

Approval is invalidated when any bound value changes. The executor never substitutes or discovers additional candidates at apply time.

## Orchestration state machine

```text
observed
  -> classified
  -> planned
  -> inspected
  -> approval_requested
  -> partially_approved
  -> approved
  -> lease_acquired
  -> executing
  -> readback_pending
  -> reconciling
  -> completed
```

Terminal alternatives:

```text
blocked
expired
cancelled
failed
```

Uncertain provider results enter:

```text
unknown_outcome -> reconciling
```

They are never retried automatically. Reconciliation must prove the same operation’s result from plan journal, filesystem readback, inode/byte delta, and runtime health.

## Leases and idempotency

Each mutation requires:

- stable `operation_id`;
- idempotency key derived from target, plan hash, and authority context;
- one active lease per target/root;
- lease expiry and monotonic renewal;
- no concurrent apply or deployment on the same root;
- interruption checkpoint after every deleted item;
- consumed-plan marker;
- reconcile-before-retry on uncertain transport outcome.

A deployment promotion and storage apply must be mutually exclusive on the same active deployment root.

## Approval model

### Tenant-owned low-risk plan

```text
Workspace Owner approval
```

### Platform-owned plan

```text
Platform Admin approval
```

### Admin support mutation of tenant resource

```text
Platform Admin approval
+ Workspace Owner approval or active delegation
+ support case
```

### Shared plan with tenant impact

```text
Platform Admin approval
+ approvals for impacted workspaces or approved quorum policy
```

### Deployment-history cleanup

```text
Platform Admin
+ Release Authority
+ exact active Production SHA exclusion
+ retained rollback-set proof
```

### Emergency reserve release

```text
Platform Admin
+ active storage incident
+ exact reserve fingerprint
```

## Data model

### `storage_targets`

Stores target/resource ownership, account scope, canonical root reference, provider target, revisions, and status.

### `storage_pressure_snapshots`

Stores disk/inode observations, authoritative hPanel timestamp, SSH inventory, pressure classification, and growth attribution.

### `storage_cleanup_operations`

Stores operation ID, operation key, selected context, authority-context hash, state, idempotency key, lease, and reconciliation status.

### `storage_cleanup_plans`

Stores immutable plan hash, target/resource ownership, policy/ownership revisions, impact set, TTL, approval state, and candidate totals.

### `storage_cleanup_plan_items`

Stores path reference, category, size, device/inode/ctime/mtime, ownership evidence, eligibility evidence, and result.

Absolute path should be encrypted or represented by a provider-local opaque reference in durable multi-tenant storage.

### `storage_cleanup_approvals`

Stores approver scope, decision, authority evidence reference, exact plan hash, expiration, and invalidation reason.

### `storage_cleanup_runs`

Stores execution journal, before/after snapshots, deleted/skipped totals, checkpoints, unknown-outcome status, and readback.

### `storage_pressure_incidents`

Stores severity, pressure dimension, reserve use, blocked deployments, support case, and resolution evidence.

## Deployment orchestration integration

Storage becomes a dependency of Production promotion:

```text
Promotion candidate
  -> storage preflight scan
  -> hPanel quota freshness check
  -> predicted install footprint
  -> allow / block
```

At emergency pressure, promotion is blocked. At critical pressure, promotion requires sufficient projected headroom and a healthy reserve. The preflight may open an operational attention item or cleanup request, but it cannot apply cleanup automatically.

## Runtime adapter boundary

The provider adapter must:

- run on a dedicated worker or Local Connector, never public web runtime;
- pin SSH host key;
- resolve credential references without exposing values;
- invoke a fixed reviewed script path and fixed operation key;
- reject arbitrary root and shell input;
- cap stdout/stderr;
- redact secret-like output;
- emit `secrets_included: false`;
- persist same-operation evidence;
- support cancellation and interruption checkpoints.

## Rollout sequence

### Phase 1 — contract only

- machine-readable policy;
- pure Admin/Tenant authority resolver;
- state transition guard;
- tests;
- no route, SQL, provider dispatch, or Production mutation.

### Phase 2 — read-only Admin/Tenant surfaces

- Context Kernel target resolution;
- tenant-safe and admin projections;
- live SSH scan with pinned host key;
- hPanel usage evidence ingestion;
- no plan apply.

### Phase 3 — plan and approval center

- durable immutable plans;
- plan inspection;
- Tenant Approval Center and Admin approval holds;
- impact set and revision invalidation;
- apply still disabled.

### Phase 4 — synthetic apply certification

- non-production synthetic files only;
- exact plan and lease;
- interruption and unknown-outcome drills;
- readback and reconciliation;
- no active deployment cleanup.

### Phase 5 — tenant-owned apply

- only tenant-exclusive roots;
- Workspace Owner authority;
- per-tenant audit and quotas;
- no shared/account-level cleanup.

### Phase 6 — platform/shared apply

- platform and shared impact governance;
- reserve certification;
- release/deployment coordination;
- deployment-history cleanup only after active-root and rollback-set proof.

## Current certification boundary

The policy and resolver may prove whether an operation *would be authorized*. They do not certify SSH dispatch. Until route wiring, durable authority evidence, approval persistence, execution leases, host-key pinning, and live readback are implemented, `hostinger_storage_apply_plan` must remain dispatch-disabled.
