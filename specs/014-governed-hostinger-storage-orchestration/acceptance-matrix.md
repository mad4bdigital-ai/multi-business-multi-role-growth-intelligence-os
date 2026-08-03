# Acceptance Matrix

| ID | Scenario | Requirements | Operation paths | Expected evidence | Current state |
|---|---|---|---|---|---|
| AC-001 | Fresh hPanel byte/inode evidence produces independent and effective pressure states | FR-007, FR-008 | OP-001, OP-011 | provider timestamp/hash, byte/inode percentages, effective state | pending provider adapter |
| AC-002 | Stale/missing quota evidence cannot be represented as authoritative plan percentage | FR-008, FR-025 | OP-001, OP-011 | `STORAGE_QUOTA_EVIDENCE_STALE/REQUIRED`, release block | pending |
| AC-003 | Every target resolves account/resource/ownership/root/revisions before path access | FR-003 | OP-001–OP-003 | target binding and ownership evidence | design complete |
| AC-004 | Tenant can see only matching owned resource and relative paths | FR-004, FR-010 | OP-002, OP-004 | zero cross-tenant/absolute-path leakage | policy test partial; route pending |
| AC-005 | Dual-role and Tenant Operator cannot borrow Admin/apply authority | FR-001, FR-002, FR-014 | OP-002, OP-005–OP-007 | denial reason codes and role/context evidence | pure policy test passes |
| AC-006 | Admin tenant mutation requires delegation/break-glass plus support evidence | FR-005, FR-015 | OP-008, OP-012 | delegation/support/incident references | pure policy test passes; integration pending |
| AC-007 | Shared plan resolves all impacted workspaces and approvals | FR-006 | OP-003, OP-006, OP-008 | impact-set hash and approval completeness | pure policy test passes; persistence pending |
| AC-008 | Provider invocation contains fixed action/script and no free-form shell/root | FR-016 | OP-001, OP-007, OP-008 | adapter invocation schema and deny tests | shell/policy complete; worker pending |
| AC-009 | SSH host-key mismatch fails before credentialed mutation; outputs contain no secrets | FR-017, FR-026 | OP-001, OP-007, OP-008 | pinned fingerprint evidence, redaction scan | pending worker certification |
| AC-010 | Plan/approval invalidates on context, ownership, policy, impact, hash, or expiry change | FR-012, FR-013, FR-020 | OP-003–OP-007 | invalidation event and denial | design/pure revision test partial |
| AC-011 | Proposed schema is additive, classified, indexed, and read back in same cycle | FR-012, FR-020, FR-026 | all durable paths | migration/classification/readback evidence | design complete; SQL pending |
| AC-012 | Migration/tool seeds remain default-off and rollback/disable is proven | FR-027 | rollout | migration readback and flags | pending |
| AC-013 | Replaced inode/symlink/path escape is skipped or blocked; write set never expands | FR-018, FR-019 | OP-007, OP-008 | per-item pre-delete stat/result | synthetic script test passes |
| AC-014 | One active lease and consumed-plan marker prevent concurrent/replayed mutation | FR-020, FR-021 | OP-007, OP-008 | lease/idempotency/consumption evidence | replay script test passes; durable lease pending |
| AC-015 | Every item and operation is accounted for with bounded, secret-safe evidence | FR-021, FR-023, FR-026 | OP-007–OP-009 | journal digest, deleted/skipped totals, no-secret marker | local script partial; durable evidence pending |
| AC-016 | Transport uncertainty enters unknown outcome and reconciles before retry | FR-022 | OP-009 | reconciliation classification and no auto-retry | state policy complete; integration pending |
| AC-017 | Reserve is Admin/incident-only and can release under inode exhaustion without pre-allocation | FR-024 | OP-010 | reserve fingerprint, incident, writable probe | basic script exists; inode-safe fix pending |
| AC-018 | Critical/emergency storage preflight blocks Production promotion without cleanup | FR-025 | OP-011 | preflight decision and zero apply dispatch | pending release integration |
| AC-019 | Deployment history excludes active SHA and retained rollback releases | FR-028 | OP-008, OP-011 | active deployment/readback and Release Authority | blocked pending layout certification |
| AC-020 | Exact-head CI, Work Map, classification, contracts, security, rollout and Production readbacks pass before enablement | FR-027, SC-010 | all | complete closeout packet | in progress |

## Acceptance completion rule

An acceptance case is complete only when evidence is bound to:

- exact implementation commit SHA;
- environment and target ID;
- requirement and operation path;
- test/run/migration/deployment ID;
- expected and observed result;
- no-secret marker;
- reviewer/authority where consequential.

Narrative confirmation or evidence from a superseded head is insufficient.
