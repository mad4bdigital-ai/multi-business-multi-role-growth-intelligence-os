# Rollout and Rollback

## Global rules

- Every phase is default-off and target-allowlisted.
- Provider mutation never activates from documentation or route availability alone.
- Exact-head CI and current Work Map/classification evidence are required at each implementation PR.
- No force push or stale-head merge.
- Unknown outcomes reconcile before retry.
- Scheduled operations are scan/readback only.

## Phase 0 — Contract and pure policy

**Scope**

- Spec Kit package.
- Machine-readable cleanup/orchestration policies.
- Conservative shell tool and synthetic filesystem tests.
- Pure Admin/Tenant authorization/state logic.
- CI guard.

**Live effects**: none.

**Exit criteria**

- Work Map readiness passes.
- Contracts/schema/checklists complete.
- Pure tests and full CI pass.
- No runtime route, SQL apply, SSH credential read, provider dispatch, or Production change.

**Rollback**

Close or revert feature PR; no provider/data rollback required.

## Phase 1 — Additive persistence and default-off registry

**Scope**

- Additive tables/indexes/projections.
- Operation/tool registry entries disabled.
- Repository services with no routes or dispatch.

**Authority**

Governed migration authorization and exact migration readback.

**Exit criteria**

- Schema classification current.
- Migration preflight/apply/readback successful.
- No active operation rows created by default.
- Rollback/disable plan reviewed.

**Rollback**

Before live data, governed additive rollback may remove objects. After live data, disable and preserve evidence.

## Phase 2 — Read-only Admin/Tenant scan

**Scope**

- Allowlisted non-production targets.
- Admin account/target projection.
- Tenant owned-resource projection.
- Pinned host key and fixed scan adapter.
- hPanel quota evidence ingestion.

**Flags**

```text
storage_orchestration_routes=true
storage_scan_dispatch=true
storage_plan_enabled=false
storage_apply_enabled=false
```

**Acceptance**

- SSH and hPanel evidence compared.
- Tenant projection leak tests pass.
- Scan time/output bounds pass.
- No state write required under pressure.
- File Manager and runtime unaffected.

**Rollback**

Disable scan dispatch/routes; retain snapshots/audit.

## Phase 3 — Plan, inspect, and approval center

**Scope**

- Immutable plan and item persistence.
- Admin/Tenant plan and inspect.
- Approval holds, delegation/support, impact sets, invalidation.
- Apply remains disabled.

**Acceptance**

- Plans include only safe classes.
- Shared/tenant ownership and impact tests pass.
- Approval/revision/expiry invalidation passes.
- No SSH mutation route can dispatch.

**Rollback**

Disable plan/approval routes; expire pending holds; retain historical plans.

## Phase 4 — Synthetic apply certification

**Scope**

- Dedicated non-production fixture root.
- Synthetic cache/log files only.
- Fixed worker apply, lease, journal, checkpoints, readback.
- Unknown-outcome and worker interruption drills.

**Flags**

```text
storage_apply_enabled=true
storage_apply_mode=synthetic_only
```

**Acceptance**

- Exact candidates deleted; protected/replaced candidates skipped.
- Replay rejected.
- Host-key mismatch fails before mutation.
- All unknown-outcome drills reconcile.
- Evidence passes no-secret validation.

**Rollback**

Disable apply flag and worker operation. Synthetic data can be recreated; retain run evidence.

## Phase 5 — Tenant-exclusive canary

**Scope**

- One certified tenant-owned exclusive root.
- Low-risk candidate classes only.
- Workspace Owner approval.
- Small plan limits and enhanced monitoring.

**Preconditions**

- Ownership and layout certified.
- No shared path or active deployment.
- Tenant support contact and rollback posture confirmed.
- Fresh hPanel/SSH snapshots.

**Acceptance window**

- 24–72 hours observation.
- Zero cross-tenant disclosure.
- Complete item accounting/readback.
- Expected reclaimed bytes/inodes.
- No application/runtime regression.

**Rollback**

Disable tenant apply; keep scan/plan read-only. File deletion recovery uses backups/rebuildability, not automatic reverse mutation.

## Phase 6 — Platform and shared canary

**Scope**

- Platform-owned low-risk caches/logs.
- Shared target only with complete impact set and approvals/quorum.
- Emergency reserve certification.

**Acceptance**

- Shared impact resolution complete.
- Required workspace approvals present.
- Reserve release works under inode-pressure simulation without pre-allocation.
- Provider/runtime readback complete.

**Rollback**

Disable shared/platform apply and reserve operations; preserve incident/audit evidence.

## Phase 7 — Deployment history and release integration

**Scope**

- Certified inactive deployment copies only.
- Exact active Production SHA exclusion.
- Retained rollback release set.
- Release Authority approval.
- Storage preflight integrated into `main`→`Production` promotion.

**Promotion policy**

- Normal: allow.
- Warning: allow or attention per policy.
- Critical: require projected headroom and reserve policy.
- Emergency/stale evidence/unknown footprint: block.
- Preflight never auto-cleans.

**Rollback**

Disable deployment-history candidate class and promotion integration. Preserve last known safe promotion policy/readback.

## Production deployment sequence

1. Synchronize implementation branch with latest `main` through normal merge.
2. Pass exact-head CI, Work Map, classification, contracts, security, and review.
3. Merge exact validated head to `main` with expected-head protection.
4. Apply separately authorized migrations and readback.
5. Enable approved phase flags for allowlisted targets.
6. Promote current `main` to protected `Production` through governed release PR.
7. Hostinger Auto Deploy rebuilds from `Production` only.
8. Verify exact Production SHA and runtime endpoints.
9. Verify hPanel/SSH pressure, File Manager, and environment update probes.
10. Record monitoring window and closeout.

## Rollback triggers

- Cross-tenant or absolute-path leakage.
- Secret-bearing output/evidence.
- Host-key mismatch.
- Unexpected candidate/protected path.
- Unknown outcome without deterministic reconciliation.
- Incomplete readback.
- Runtime/deployment regression.
- Pressure does not improve as expected.
- Worker saturation or repeated timeouts.
- Main/Production/runtime SHA mismatch.

## Rollback actions

- Disable affected route and dispatch flags.
- Cancel/expire pending plans, approvals, and leases.
- Block target and open incident.
- Stop worker dispatch and revoke/rotate credentials if exposure suspected.
- Restore application using retained release/backups/provider support where required.
- Reconcile active operations before new mutation.
- Preserve all audit and readback evidence.

## Closeout criteria

- Exact production branch/SHA verified.
- `/status`, `/health`, `/version`, `/deployment-info` accepted.
- hPanel byte/inode usage and freshness accepted.
- File Manager and environment-variable write probes pass.
- All canary operations reconciled with complete item accounting.
- No unresolved security, ownership, impact, or unknown-outcome finding.
- Remaining review-only candidate classes explicitly deferred.
- `completion.json` and human acknowledgement updated.
