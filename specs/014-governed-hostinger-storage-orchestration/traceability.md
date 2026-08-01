# Traceability

## Requirement to operation/task/acceptance mapping

| Requirement | Operation paths | Primary tasks | Acceptance |
|---|---|---|---|
| FR-001 Explicit context | OP-001, OP-002, OP-007, OP-008 | T033, T035 | AC-004, AC-005 |
| FR-002 No authority borrowing | OP-002, OP-006–OP-008 | T033–T036 | AC-005, AC-006 |
| FR-003 Target/resource binding | OP-001–OP-004 | T020, T030, T031 | AC-003 |
| FR-004 Tenant-owned restriction | OP-002, OP-007 | T032–T035, T039 | AC-004 |
| FR-005 Admin tenant delegation | OP-008, OP-012 | T036, T055 | AC-006 |
| FR-006 Shared impact approvals | OP-003, OP-006, OP-008 | T032, T054 | AC-007 |
| FR-007 Byte/inode pressure | OP-001, OP-002, OP-011 | T044, T060 | AC-001 |
| FR-008 hPanel authority | OP-001, OP-011 | T044, T060, T062 | AC-001, AC-002 |
| FR-009 Read-only scan | OP-001, OP-002 | T040–T045 | AC-008, AC-009 |
| FR-010 Tenant-safe projection | OP-002, OP-004 | T039, T064 | AC-004 |
| FR-011 Safe plan classes | OP-003 | T040, T050 | AC-013 |
| FR-012 Immutable plan binding | OP-003–OP-007 | T011, T020, T050 | AC-010, AC-011 |
| FR-013 Approval invalidation | OP-005, OP-006 | T053 | AC-010 |
| FR-014 Tenant role ceilings | OP-005–OP-007 | T033, T034, T036 | AC-005 |
| FR-015 Mutation authority | OP-007, OP-008, OP-010 | T035–T038, T051 | AC-005–AC-007, AC-014 |
| FR-016 Fixed provider adapter | OP-001, OP-007, OP-008 | T042, T043 | AC-008 |
| FR-017 Pinned host key | OP-001, OP-007, OP-008 | T042, T074 | AC-009 |
| FR-018 Per-item revalidation | OP-007, OP-008 | T040, T041, T074 | AC-013 |
| FR-019 Skip/no expansion | OP-007, OP-008 | T040, T041, T050 | AC-013 |
| FR-020 Lease/replay safety | OP-007, OP-008 | T051, T057 | AC-014 |
| FR-021 Journal/checkpoints | OP-007–OP-009 | T051, T061 | AC-014, AC-015 |
| FR-022 Reconcile unknown outcome | OP-009 | T052, T057, T074 | AC-016 |
| FR-023 Complete readback | OP-007–OP-011 | T061 | AC-015, AC-016, AC-018 |
| FR-024 Reserve controls | OP-010, OP-012 | T046, T056 | AC-017 |
| FR-025 Promotion preflight | OP-011 | T062, T085 | AC-018 |
| FR-026 Audit/no secrets | all | T012, T064, T075 | AC-009, AC-015 |
| FR-027 Dispatch disabled until certified | all | T047, T070–T076, T090–T097 | AC-020 |
| FR-028 Deployment-history safety | OP-008, OP-011 | T031, T045, T085 | AC-019 |

## Existing implementation evidence

| Artifact | Requirements | Status |
|---|---|---|
| `http-generic-api/scripts/hostinger-storage-cleanup.sh` | FR-009, FR-011, FR-018–FR-021, FR-024 | non-production adapter core |
| `http-generic-api/scripts/test-hostinger-storage-cleanup-script.mjs` | FR-009, FR-011, FR-018–FR-021 | synthetic regression |
| `http-generic-api/config/hostinger-storage-cleanup-policy.json` | FR-007–FR-013, FR-024 | policy contract |
| `http-generic-api/config/hostinger-storage-orchestration-policy.json` | FR-001–FR-006, FR-014–FR-017, FR-027 | authority/orchestration contract |
| `http-generic-api/hostingerStorageOrchestrationPolicy.js` | FR-001–FR-006, FR-012–FR-015, FR-022 | pure resolver/state guard |
| `http-generic-api/test-hostinger-storage-orchestration-policy.mjs` | AC-004–AC-007, AC-010, AC-016, AC-017 | pure regression |
| `.github/workflows/hostinger-storage-cleanup-guard.yml` | FR-027, AC-020 | dedicated exact-head guard |

## Work Map traceability

See `work-map-integration.json`. Integrated/extended dimensions are linked to requirement, task, acceptance, and evidence references. No new Work Map or unresolved dimension exists at the recorded registry fingerprint.

## Delivery traceability

- Feature PR: #4347.
- Branch: `gpt/hostinger-safe-storage-cleanup-ssh-20260801`.
- Initial branch synchronization PR: #4353.
- Pinned synchronized `main`: `a0ad040abfd7b99c6d6536ac9f6b80fcf0879d70`.
- Synchronization merge: `44e131117e3959099c8607cca4f5fc139ef5a228`.

These values are historical evidence and must be refreshed if `main` moves before final merge.

## Closeout traceability

`completion.json` records final evidence only after:

- exact-head tests and reviews;
- current Work Map/classification readback;
- migration apply/readback when authorized;
- phased runtime/provider certification;
- Production promotion and exact SHA readback;
- hPanel/File Manager/environment/runtime acceptance;
- unresolved gaps explicitly closed or deferred with governance.
