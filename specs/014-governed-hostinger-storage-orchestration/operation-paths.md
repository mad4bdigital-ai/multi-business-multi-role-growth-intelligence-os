# Operation Paths

Every path uses a stable `operation_id`, explicit context, target/resource binding, structured errors, bounded evidence, and `secrets_included: false`.

## OP-001 — Admin storage scan

**Actor:** Platform Admin or authorized service principal.  
**Entry:** `GET /admin/hosting/storage/targets/{targetId}/snapshot` or scheduled scan operation.  
**Input:** target ID, requested freshness, optional bounded inventory limits.

**Preconditions and authority**

- Authenticated Admin/service principal.
- Admin context resolved by Context Kernel.
- Target is visible to Platform Admin.
- Provider target exists and SSH host key is pinned for live scan.
- Scheduled service principal has read-only scan capability only.

**States**

```text
observed -> classified -> completed
                  \-> blocked/failed
```

**Normal sequence**

1. Resolve target/resource and ownership scope.
2. Read latest hPanel quota evidence and freshness.
3. Dispatch fixed `scan` to certified worker when a fresh SSH inventory is requested.
4. Collect logical bytes, inode count, directory hotspots, large files, and category footprints.
5. Classify byte and inode pressure independently.
6. Persist bounded snapshot and return Admin projection.

**Alternates/errors**

- Stale provider evidence: return snapshot with `quota_evidence_stale` and no authoritative percentage.
- Worker unavailable: return last safe snapshot with degraded freshness.
- Host-key mismatch: fail closed and open security attention.
- Scan timeout: mark partial evidence; do not infer missing directories as zero.

**Idempotency/retry**

Read-only and safe to retry with same operation ID. A duplicate completed scan returns the existing result unless `refresh=true` is authorized.

**Evidence/readback**

Target/resource IDs, provider evidence timestamp, SSH inventory timestamp, pressure state, category totals, timeout/completeness status.

**Recovery/support**

Open operational attention when evidence is stale, worker fails, or pressure is critical/emergency.

## OP-002 — Tenant resource scan

**Actor:** Tenant Workspace Owner, Tenant Operator, or read-only service principal.  
**Entry:** `GET /tenant/workspaces/{workspaceId}/resources/{resourceId}/storage/snapshot`.

**Preconditions and authority**

- Explicit Tenant context.
- Principal membership matches Tenant and Workspace.
- Resource is exclusively tenant-owned and bound to the selected context.
- Tenant projection policy exists.

**Normal sequence**

1. Resolve context and target ownership.
2. Deny shared/platform target.
3. Obtain owned-resource inventory from latest certified snapshot or bounded live scan.
4. Project only resource usage, inode count, relative paths, categories, and freshness.
5. Return no SSH or cross-tenant metadata.

**Errors**

- Context/resource mismatch: 403 `STORAGE_TARGET_NOT_OWNED`.
- Shared root: return request-support action, not an account listing.
- Stale snapshot: return degraded freshness with safe next action.

**Retry/readback**

Read-only and replay-safe. Audit records only the tenant's own request and result reference.

## OP-003 — Create conservative plan

**Actor:** Platform Admin, Workspace Owner, or Tenant Operator for owned target.  
**Entry:** Admin or Tenant `POST .../storage/plans`.

**Input:** target/resource, policy revision, candidate-class request, scan snapshot ID.

**Preconditions**

- Current Work Map/policy/runtime versions supported.
- Target ownership and root certification current.
- Snapshot fresh enough for policy.
- Requested classes allowed for actor/context.

**States**

```text
classified -> planned -> expired/cancelled/blocked
```

**Normal sequence**

1. Resolve exact target and root reference.
2. Select only safe candidate classes allowed by policy.
3. Enumerate candidates without deletion.
4. Validate canonical path and protection rules.
5. Record size/device/inode/ctime/mtime/category for each item.
6. Compute candidate-set hash and plan hash.
7. Bind ownership/policy revisions, context hash, impact set, totals, and expiry.
8. Persist immutable plan.

**Alternates**

- Tenant root not exclusive: create support request candidate, not an executable plan.
- Candidate crosses protected surface: omit and record protected count.
- Limits reached: truncate deterministically and mark plan bounded.

**Idempotency**

Same target/snapshot/policy/context/candidate request returns the same active plan or a deterministic duplicate reference.

**Readback**

Plan ID/hash, count/bytes by category, expiry, impact set, protected/skipped counts, next action `inspect`.

## OP-004 — Inspect plan

**Actor:** Any principal authorized to view the plan in selected context.  
**Entry:** `GET .../storage/plans/{planId}`.

**Preconditions**

- Plan context/resource audience matches requester.
- Tenant projection hides absolute paths and other tenants.

**Normal sequence**

1. Read immutable plan and current validity.
2. Return bounded candidates with category, size, relative/provider-safe path, and validity.
3. Return revisions, hashes, expiry, approvals, and impact set appropriate to context.

**Errors**

- Plan audience mismatch: 404/403 without existence leakage.
- Plan tampered or hash mismatch: block and open incident.
- Plan expired: return historical read-only state.

**Retry**

Read-only and replay-safe.

## OP-005 — Request apply approval

**Actor:** Tenant Operator, Workspace Owner, or Platform Admin.  
**Entry:** `POST .../plans/{planId}/request-approval`.

**Preconditions**

- Plan inspected and unexpired.
- Plan/revision/context hashes still current.
- Requester may request but need not be an approver.

**Normal sequence**

1. Revalidate plan binding and impact set.
2. Determine approval policy by ownership scope/candidate class.
3. Create approval hold bound to exact plan hash and expiry.
4. Notify/route to required approvers through existing approval center.
5. Transition to `approval_requested` or `partially_approved`.

**No dispatch rule**

This operation never invokes SSH and never changes provider state.

**Errors**

Stale plan, unresolved impact, unsupported class, or changed ownership blocks the hold.

## OP-006 — Approve or deny plan

**Actor:** Workspace Owner, Platform Admin, Release Authority, or incident authority as required.  
**Entry:** `POST .../plans/{planId}/approve`.

**Preconditions**

- Approver holds exact role/authority for one required approval slot.
- Plan and authority context are fresh.
- Approval decision includes plan hash and revision vector.

**Normal sequence**

1. Resolve approver context.
2. Validate approval slot and separation rules.
3. Record approve/deny with expiry and evidence reference.
4. Recompute missing approvals.
5. Transition to `approved`, `partially_approved`, or `blocked`.

**Invalidation**

Any target, tenant/workspace, impact set, plan hash, ownership/policy revision, or expiry change invalidates approval.

**Retry**

Same approver/plan decision is idempotent; conflicting second decision requires explicit supersession policy.

## OP-007 — Tenant-owned apply

**Actor:** Tenant Workspace Owner.  
**Entry:** `POST /tenant/workspaces/{workspaceId}/storage/plans/{planId}/apply`.

**Preconditions and authority**

- Tenant context matches target tenant/workspace/resource.
- Target ownership scope is `tenant` and root is exclusive.
- Workspace Owner role and Resource Authority for `apply`.
- Capability Envelope matches operation/target/environment.
- All approvals satisfied.
- Exact authority-context hash, plan/candidate hash, ownership/policy revisions.
- Active execution lease.
- Typed confirmation.
- Provider adapter, worker, host key, and readback certified.
- Runtime feature flag enabled for tenant-exclusive apply.

**States**

```text
approved -> lease_acquired -> executing -> readback_pending
-> reconciling -> completed
                  \-> unknown_outcome/failed/blocked
```

**Normal sequence**

1. Acquire/revalidate one lease for target/root.
2. Mark plan execution started and create run journal.
3. Dispatch fixed adapter operation.
4. For each item, worker revalidates path/type/device/inode/size/ctime/mtime.
5. Delete exact unchanged safe item; checkpoint result.
6. Mark changed/protected/missing item skipped.
7. Return structured result and perform same-operation readback.
8. Consume plan and release lease after durable completion.

**Errors/recovery**

- Lease conflict: wait/reconcile.
- Host-key mismatch: stop before mutation.
- Item mismatch: skip item, continue within policy.
- Transport uncertainty: enter `unknown_outcome`; no retry.
- Readback incomplete: remain `readback_pending` or `reconciling`.

## OP-008 — Platform/shared apply

**Actor:** Platform Admin; additional Workspace Owner, Release Authority, or incident approvals as required.  
**Entry:** Admin apply route.

**Additional preconditions**

- Platform target: Platform Admin approval.
- Tenant target under support: delegation or break-glass + support case + tenant approval/active delegation.
- Shared target: complete impact set and required workspace approvals/quorum.
- Deployment-history candidates: Release Authority, exact active Production SHA exclusion, retained rollback set, reconstructability proof.

**Normal sequence**

Same execution mechanics as OP-007, but Admin evidence includes bounded impact set and provider-relative paths. Tenant content remains opaque.

**Failure rule**

Any unclassified candidate or unresolved impacted owner blocks the whole plan before dispatch.

## OP-009 — Unknown-outcome reconciliation

**Actor:** Orchestrator service; Admin may initiate/read, Tenant sees own projection.  
**Entry:** reconciliation job for operation state `unknown_outcome`.

**Preconditions**

- Original operation ID, plan, run, journal, target, and idempotency key available.
- No new apply on target/root until reconciliation resolves or is administratively blocked.

**Normal sequence**

1. Read durable per-item checkpoints and applied marker.
2. Run read-only filesystem/stat scan for exact plan items.
3. Compare deleted/skipped/unchanged/missing states against journal.
4. Read provider/account and runtime evidence.
5. Classify `applied`, `partially_applied`, `not_applied`, `conflict`, or `still_unknown`.
6. Complete, block, or escalate; do not silently retry.

**Retry**

Reconciliation itself is read-only and retryable. Mutation retry requires a new plan unless proof shows the original plan never started and remains valid.

## OP-010 — Reserve create/status/release

**Actor:** Platform Admin only.  
**Entry:** Admin reserve routes.

### Create

- Requires healthy headroom and exact size policy.
- Creates one protected reserve file and records fingerprint.

### Status

- Read-only; returns existence, size, fingerprint reference, and last verification.

### Release

- Requires active storage incident, exact reserve fingerprint, Admin authority, Capability Envelope, lease, and typed confirmation.
- Must delete reserve without first allocating a new inode or lock when the inode limit may be exhausted.
- Deletes only the known reserve path.

**Readback**

Writable-space probe, hPanel refresh request, incident update, and reserve state.

## OP-011 — Production promotion preflight

**Actor:** Release orchestration service and Release Authority.  
**Entry:** governed `main` to `Production` promotion candidate validation.

**Preconditions**

- Fresh hPanel quota evidence.
- Fresh SSH inventory or bounded growth delta.
- Predicted install/build footprint.
- Current reserve state.

**Normal sequence**

1. Evaluate byte and inode pressure.
2. Calculate projected post-deploy headroom.
3. Verify reserve at critical pressure.
4. Return `allow`, `allow_with_attention`, or `block`.
5. If blocked, open operational attention and cleanup request; never auto-apply.

**Readback**

Promotion evidence includes storage snapshot ID, predicted footprint, threshold policy revision, and decision.

## OP-012 — Incident and support handoff

**Actor:** Platform Admin/support operator/provider liaison.  
**Entry:** critical/emergency alert, failed operation, File Manager/environment update failure, or provider support response.

**Normal sequence**

1. Open/update storage pressure incident.
2. Attach safe snapshot IDs, reason codes, blocked deployments, and latest readback.
3. Record provider case/reference without credentials.
4. If Tenant resource is involved, create bounded support/delegation request.
5. Track reserve release, cleanup plan, hPanel refresh, File Manager probe, environment-variable save, and runtime health.
6. Close only after root cause/growth source and prevention action are recorded.

**Support handoff fields**

Target ID, ownership scope, pressure dimension, timestamps, evidence IDs, operation/plan/run IDs, provider case, safe next action, and unresolved risk.

**Forbidden fields**

Passwords, private keys, tokens, raw environment values, file contents, and unredacted provider payloads.
