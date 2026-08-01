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
| G-011 Machine-readable assurance | FR-069..074 | T001, T009, T018, T066, T082 | AC-040, AC-045..047 |
| G-012 No secrets/implicit authority | FR-002, FR-006..007, FR-023, FR-036, FR-047, FR-050 | all security tasks | AC-006..007, AC-014, AC-037 |

## Open Draft Spec portfolio traceability

| PR | Feature key | Canonical role | Spec 015 relationship | Required next proof |
|---:|---|---|---|---|
| #1898 | `004-tenant-asset-federation` | Architectural doctrine source | extract reviewed generic decisions | current-main ADR/reuse matrix |
| #1935 | `006-adaptive-authorization-execution-governance` | Authority kernel candidate | dependency; must not be replaced by Studio | current auth/context authority map |
| #2284 | `008-governed-pr-delivery-orchestration` | Repository delivery subsystem | consolidate with assurance extracted from #4432 | workflow and repository-automation reuse map |
| #2385 | `009-local-connector-reachability-recovery` | Infrastructure recovery subsystem | bounded service/package source | current device/resource/probe authority map |
| #2949 | `011-database-driven-operation-fabric` | Operation fabric subsystem | installation/operation compiler dependency | ordered implementation-train reconciliation |
| #2950 | `011-tenant-gpt-effective-capability-envelope` | Tenant application component | Studio assistant and questionnaire component source | runtime/spec split and context-kernel reconciliation |
| #3922 | `014-retail-commerce-operations-growth-os` | Reference package source | generic profile substrate plus Retail Commerce Pack | current-main reconstruction and package validation |
| #4386 | `014-governed-hostinger-storage-orchestration` | Integration rollup | Hostinger Storage service/package source | live rollup, durable authority, canary, and production gates |
| #4432 | `014-gemini-evidence-intake-automation` | Reference package source | assurance template plus Evidence Intelligence Pack | completion repair and current-main reconstruction |
| #4456 | `015-tenant-operating-system-studio` | Portfolio convergence parent | owns portfolio awareness and package composition | architecture review and implementation readiness |

The machine-readable authority for this table is `draft-spec-portfolio.json`. The numeric Spec number does not define uniqueness. `feature_key + canonical_role` is the portfolio identity.

## Duplicate identity traceability

### Numeric `011`

| PR | Distinct function | Resolution |
|---:|---|---|
| #2949 | operation registry, compiled bindings, durable operation lifecycle | operation-fabric subsystem beneath current workflow/control-plane authorities |
| #2950 | Tenant GPT capability discovery, questionnaires, and preview orchestration | tenant application/Studio assistant component |

### Numeric `014`

| PR | Distinct function | Resolution |
|---:|---|---|
| #3922 | Business Profile substrate and Retail Commerce | extract generic substrate; reconstruct Retail Commerce Pack |
| #4386 | Hostinger storage control and execution rollup | bounded platform service and operational package |
| #4432 | Evidence Intelligence and development assurance | extract assurance; reconstruct Evidence Intelligence Pack |

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

### PR #4386

| Candidate content | Spec 015 destination | Required proof |
| storage plan and operation contracts | Hostinger Storage operational package | closed schemas and deterministic plan hash |
| Admin/Tenant authority projections | reusable service boundary | exact context and no cross-scope authority |
| read-only and synthetic adapters | package certification examples | factory provenance and no live dispatch |
| recovery and checkpoint contracts | operational component family | restore sample and unknown-outcome tests |
| provider-specific toolchain | Hostinger package implementation | pinned tool/binary certification |

### PR #2385

| Candidate content | Spec 015 destination | Required proof |
| connection and device health model | Local Connector Recovery package | current resource/device authority reuse |
| diagnostic and probe contracts | reusable recovery components | bounded read-only evidence |
| recovery planner | optional package workflow | fresh authorization and same-cycle readback |
| Admin break-glass path | platform-only authority | never exposed as Tenant package authority |

## Implementation train traceability

### PR #2949 strict stack

```text
#3005 → #3021 → #3026 → #3044 → #3054 → #3070
→ #3083 → #3089 → #3097 → #3109 → #3119 → #3130 → #3134
```

These PRs collectively implement registry foundation, repository contracts, compiler, immutable manifests, verifier, authority preflight, SQL loading, guarded fallback, revision pinning, capability lifecycle binding, chunk collection, durable lifecycle, and write receipts. They must be reviewed as one dependency-ordered train.

### PR #4386 parallel integration

- #4390 contracts: integrated.
- #4458 and #4459 synthetic adapter provenance corrections: integrated.
- #4455 Tenant Canary hardening: open child PR at the observed snapshot.

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
