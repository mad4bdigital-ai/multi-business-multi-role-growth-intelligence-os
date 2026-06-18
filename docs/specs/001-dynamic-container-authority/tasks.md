# Task Breakdown

## SP-0 — Specification review

- [ ] SP-001 Review against tenancy, auth, authority, and envelope canonicals.
- [ ] SP-002 Validate all multi-parent merge semantics.
- [ ] SP-003 Complete threat model.
- [ ] SP-004 Confirm errors/status codes.
- [ ] SP-005 Approve design freeze.

## AUTH-1 — Passive preview repair

- [ ] AUTH-101 Move credential materialization after authorization/schema.
- [ ] AUTH-102 Remove actionless Google clients.
- [ ] AUTH-103 Fix obsolete Drive dependencies.
- [ ] AUTH-104 Prove preview has zero secret/token/provider side effects.
- [ ] AUTH-105 Add regression tests.

## CT-2 — Container foundation

- [ ] CT-201 Add type registry and containers.
- [ ] CT-202 Add relationship types and relationships.
- [ ] CT-203 Implement transaction-safe cycle preflight.
- [ ] CT-204 Add closure projection and bounded rebuild.
- [ ] CT-205 Add readiness/issue views and indexes.
- [ ] CT-206 Seed default dynamic topology.

## CL-3 — Classifications

- [ ] CL-301 Add classification registries and assignments.
- [ ] CL-302 Validate registered value schemas.
- [ ] CL-303 Implement merge/conflict behavior.

## RB-4 — Roles and bindings

- [ ] RB-401 Add role templates/permissions and composition.
- [ ] RB-402 Add explicit container role assignments.
- [ ] RB-403 Add resource dimension registry/bindings.
- [ ] RB-404 Implement deny/restrict and operation matching.
- [ ] RB-405 Add legacy adapters.

## ID-5 — Identity and projections

- [ ] ID-501 Project Platform/Tenant/Workspace.
- [ ] ID-502 Project Brands via `brands.target_key`.
- [ ] ID-503 Reconcile workspace-brand links; hold ambiguity.
- [ ] ID-504 Project Activity/Workflow.
- [ ] ID-505 Project to Platform Graph and extend taxonomy validation.

## ER-6 — Effective resolution

- [ ] ER-601 Implement bounded multi-parent loader.
- [ ] ER-602 Resolve classifications, roles, bindings, shares, and delegations.
- [ ] ER-603 Detect typed conflicts.
- [ ] ER-604 Persist immutable no-secret snapshots.
- [ ] ER-605 Integrate shadow comparisons and dashboard.

## OV-7 — Override

- [ ] OV-701 Add request/approval records linked to envelopes.
- [ ] OV-702 Require normal resolution first.
- [ ] OV-703 Enforce exact path/dimension/resource/operation/snapshot.
- [ ] OV-704 Enforce 15/60 minute caps.
- [ ] OV-705 Require distinct second approver for destructive/credential/deployment.
- [ ] OV-706 Remove implicit platform-owner bypass in canary.
- [ ] OV-707 Record use/readback/stale/expiry evidence.

## API-8 — Contracts

- [ ] API-801 Add resolution, relationship, role, binding, and override resources.
- [ ] API-802 Add structured 400/403/404/409/422 examples.
- [ ] API-803 Preserve compatibility.

## TEST-9 — Verification

- [ ] TEST-901 Multi-parent happy path and cycle rejection.
- [ ] TEST-902 Broad allow plus narrow deny.
- [ ] TEST-903 Equal-distance conflict.
- [ ] TEST-904 Read share vs write delegation.
- [ ] TEST-905 Credential materialization blocked before allow.
- [ ] TEST-906 Platform owner without override.
- [ ] TEST-907 One vs two approvers.
- [ ] TEST-908 Stale snapshot invalidation.
- [ ] TEST-909 Cross-tenant rejection.
- [ ] TEST-910 Preview side-effect proof.
- [ ] TEST-911 Audit hash reconstruction.
- [ ] TEST-912 Query-plan/path-explosion bounds.

## ROLLOUT-10 — Promotion

- [ ] ROLLOUT-1001 Define shadow thresholds.
- [ ] ROLLOUT-1002 Select read-only canaries.
- [ ] ROLLOUT-1003 Require 100% audit coverage.
- [ ] ROLLOUT-1004 Promote one capability at a time.
- [ ] ROLLOUT-1005 Verify rollback and retire bypasses only after adoption.
