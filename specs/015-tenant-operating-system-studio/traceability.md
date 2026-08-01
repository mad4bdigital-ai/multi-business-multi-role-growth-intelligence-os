# Traceability Matrix

## Goals to requirements

| Goal | Requirements | Primary tasks | Acceptance |
|---|---|---|---|
| G-001 Complete tenant-authored system | FR-001..018, FR-024..044 | T010..T056 | AC-001..008, AC-014..027 |
| G-002 Agency package reuse | FR-049..055, FR-063..068 | T020..T027, T070..T076 | AC-008..013, AC-028..032 |
| G-003 Client-owned Tenant delegation | FR-063..068 | T071..T076 | AC-011..013 |
| G-004 Reuse platform foundations | FR-008..013, FR-026..029 | T002..T003, T010..T018 | AC-048 |
| G-005 Full package lifecycle | FR-045..062 | T060..T066 | AC-002..003, AC-031..039 |
| G-006 Lineage and revisions | FR-003..006, FR-053..058 | T023..T027, T063..T066 | AC-029..035 |
| G-007 AI-assisted, not authoritative | FR-035..039 | T050..T052 | AC-014..015 |
| G-008 Generated tenant-safe surfaces | FR-040..044 | T053..T056 | AC-027..028, AC-042 |
| G-009 Sandbox and acceptance | FR-069..074 | T062, T066, T090..T097 | AC-040..041, AC-050 |
| G-010 Portability and handover | FR-056..068 | T074..T076 | AC-036..039 |
| G-011 Machine-readable assurance | FR-069..074 | T001, T018, T066, T082 | AC-040, AC-045..047 |
| G-012 No secrets/implicit authority | FR-002, FR-006..007, FR-023, FR-036, FR-047, FR-050 | all security tasks | AC-006..007, AC-014, AC-037 |

## Candidate PR extraction traceability

### PR #3922

| Candidate content | Spec 015 destination | Required proof |
|---|---|---|
| Business Operating Profile | package applicability/profile substrate | current-main reuse matrix and generic schema |
| Activity Type Registry | activity/profile substrate | not Commerce-hardcoded |
| Inheritance/merge strategies | package/profile resolution | dimension-specific tests |
| Applicability predicates | bounded predicate component | complexity/security tests |
| Activity Capability Packs | package/component substrate | canonical component mapping |
| Effective Business Profile | compiler input | revision and invalidation proof |
| Solution Blueprints | Studio recommendation layer | recommendation not authority |
| Retail/POS/inventory/orders/payments | Retail Commerce child pack | validates as optional package |
| WordPress/WooCommerce/ERPNext | Retail Commerce child pack and provider components | certification and single-writer rules |
| Workspace File Fabric details | reusable file-policy substrate plus child config | exact connection/Brand isolation |

### PR #4432

| Candidate content | Spec 015 destination | Required proof |
| Development automation contract | package development-assurance template | planning-only/no authority |
| CI automation contract | package acceptance/CI template | exact candidate evidence |
| Evidence/Intake entities | Evidence Intelligence child pack | package entity/lifecycle contracts |
| Forms/client surveys | Evidence Intelligence child pack | form/client-link contracts |
| File naming/routing/dedup | Evidence Intelligence child pack/file policy example | original preservation/readback |
| Gemini gateway/result schemas | AI component/provider example | structured output/manual fallback |
| Review/promotion lifecycles | Evidence Intelligence child pack | human authority and audit |
| E2E phases | package acceptance template | sandbox/canary/production boundaries |

## Operation paths to requirements

| Operation | Requirements |
|---|---|
| OP-001 package draft | FR-001..007 |
| OP-002 component revision | FR-008..018 |
| OP-003 AI authoring | FR-035..039 |
| OP-004 package compile | FR-008..013, FR-051..055, FR-069..074 |
| OP-005 publish | FR-045..048 |
| OP-006 installation plan | FR-049..051 |
| OP-007 configure | FR-052..055 |
| OP-008 sandbox/acceptance | FR-069..072 |
| OP-009 activate | FR-053..055, FR-071..074 |
| OP-010 execute | FR-024..044 |
| OP-011 upgrade | FR-056..057 |
| OP-012 rollback | FR-058 |
| OP-013 fork/export | FR-059..060 |
| OP-014 handover | FR-060, FR-063..068 |
| OP-015 suspend/uninstall/retire | FR-061..062 |
| OP-016 candidate reconciliation | FR-069..074 and Phase 0 decisions |

## Evidence classes

Every implementation task declares applicable evidence from:

```text
contract_validation
unit_test
state_machine_test
security_negative_test
cross_tenant_isolation_test
integration_test
migration_dry_run
migration_apply_readback
surface_dispatch_parity
sandbox_acceptance
provider_readback
runtime_health
backup_restore
rollback_rehearsal
handover_continuity
production_parity
operator_runbook
```

A task cannot be closed by substituting a weaker evidence class for the one declared.