# Specification Readiness Checklist

## Problem and scope

- [x] Provider-confirmed incident and affected control-plane symptoms recorded.
- [x] Disk bytes and inode pressure treated independently.
- [x] hPanel quota authority distinguished from SSH inventory.
- [x] Included and excluded candidate classes/surfaces defined.
- [x] No automatic apply or free-form SSH permitted.

## Work Map and schema governance

- [x] `work-map-integration.json` exists.
- [x] All current Work Maps have decisions.
- [x] All current schema domains have decisions.
- [x] Integrated/extended dimensions bind requirements, tasks, acceptance, and evidence.
- [x] No unresolved dimension or new Work Map candidate.
- [x] Current coverage matrix has zero unresolved/intentionally unclassified objects.
- [ ] Final exact-head Work Map gate re-run after all package/runtime changes.
- [ ] Proposed migration objects classified before SQL creation.

## Actors and authority

- [x] Platform Admin, Workspace Owner, Tenant Operator, service principal, delegated support, Release Authority, and worker roles defined.
- [x] Explicit Admin/Tenant context required.
- [x] Dual-role authority borrowing prohibited.
- [x] Tenant ownership/resource boundary defined.
- [x] Admin tenant mutation delegation/break-glass/support requirement defined.
- [x] Shared impact-set approval policy defined.
- [x] Capability Envelope, Resource Authority, lease, and typed confirmation defined.
- [x] Reserve and deployment-history authority defined.

## Operation paths

- [x] Admin scan.
- [x] Tenant scan.
- [x] Plan creation.
- [x] Plan inspection.
- [x] Approval request.
- [x] Approval decision/invalidation.
- [x] Tenant apply.
- [x] Platform/shared apply.
- [x] Unknown-outcome reconciliation.
- [x] Reserve lifecycle.
- [x] Production promotion preflight.
- [x] Incident/support handoff.
- [x] Each path covers errors, retry/idempotency, evidence, readback, and recovery.

## Data and lifecycle

- [x] Resource graph and ownership scopes defined.
- [x] Snapshots, operations, plans, items, impacts, approvals, leases, runs, reconciliation, reserve, and incident entities defined.
- [x] Immutable plan/candidate and revision binding defined.
- [x] State transitions and terminal/unknown states defined.
- [x] Retention/no-secret principles defined.
- [x] Additive migration sequencing and rollback posture defined.
- [ ] SQL migration design implemented and governed readback specified in executable tests.

## API and contracts

- [x] OpenAPI 3.1 Admin and Tenant route draft exists.
- [x] Storage operation JSON Schema exists.
- [x] Storage plan JSON Schema exists.
- [x] Storage evidence JSON Schema exists.
- [x] Structured error catalog exists.
- [x] Tenant-safe projection constraints documented.
- [ ] Contract validation and negative examples pass repository tooling.
- [ ] Runtime canonical OpenAPI integration separately reviewed before route mount.

## Security and privacy

- [x] Threat model covers tenant crossing, confused deputy, shared impact, TOCTOU, symlink/path escape, replay, unknown outcome, host key, worker secret leakage, reserve misuse, and active deployment deletion.
- [x] Pinned SSH host key required.
- [x] Credentials reference-only and worker-local.
- [x] No file contents, raw secrets, or raw provider payloads.
- [x] Per-item stat revalidation and no plan expansion.
- [x] Public runtime dispatch prohibited.
- [ ] Exact-head security review completed.
- [ ] Worker secret scanning and host-key rotation drill completed.

## Availability, performance, and observability

- [x] Scan works without state/lock creation.
- [x] Candidate/output/time bounds defined.
- [x] Lease/concurrency and deployment conflict defined.
- [x] Emergency reserve and inode-exhaustion concern documented.
- [x] Metrics, events, evidence, alerts, and readback defined.
- [ ] hPanel evidence adapter and freshness tested.
- [ ] Reserve release fixed/certified without pre-allocation.

## Testing

- [x] Static/policy tests defined.
- [x] Pure authority/state tests defined.
- [x] Filesystem synthetic tests defined and initial regression exists.
- [x] Contract, integration, worker, tenant isolation, migration, provider, release, and production tests defined.
- [x] Unknown-outcome fault injection defined.
- [ ] All tests registered and passing on exact final head.
- [ ] Synthetic worker apply and reconciliation drills pass.

## Rollout and rollback

- [x] Default-off phased rollout defined.
- [x] Read-only before apply; synthetic before tenant; tenant before shared/platform; deployment history last.
- [x] Promotion preflight blocks without auto-cleanup.
- [x] Rollback triggers/actions defined.
- [x] Production and hPanel/File Manager/environment/runtime closeout defined.
- [ ] Phase approvals and target allowlists created.
- [ ] Production closeout completed.

## Delivery authority

- [x] Specification states no SQL/provider/deployment authority.
- [x] Current implementation boundary is non-production/default-off.
- [x] Branch synchronized without force at the recorded point.
- [ ] Final branch synchronized with latest `main` and `behind_by=0`.
- [ ] Exact-head CI and review pass.
- [ ] Explicit merge authority obtained.
- [ ] Migrations, rollout, Production promotion, and Hostinger deployment separately authorized.

## Readiness decision

- Specification and Work Map design readiness: **ready for continued implementation**.
- Live provider apply readiness: **blocked** until persistence, authority wiring, worker/host-key, synthetic drill, reconciliation, and readback certification complete.
