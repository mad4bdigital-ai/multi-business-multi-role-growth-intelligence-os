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
| G-008 Generated and reviewed external surfaces | FR-040..044 | T053..T056 | AC-027..028, AC-042 |
| G-009 Sandbox and acceptance | FR-069..074 | T062, T066, T090..T097 | AC-040..041, AC-050 |
| G-010 Portability and handover | FR-056..068 | T074..T076 | AC-036..039 |
| G-011 Machine-readable assurance | FR-069..074 | T001, T009, T018, T066, T082 | AC-040, AC-045..047 |
| G-012 No secrets or implicit authority | FR-002, FR-006..007, FR-023, FR-036, FR-047, FR-050 | all security tasks | AC-006..007, AC-014, AC-037 |

## Primary open Draft Spec traceability

| PR | Feature key | Canonical role | Relationship to Spec 015 | Required next proof |
|---:|---|---|---|---|
| #1898 | `004-tenant-asset-federation` | architectural doctrine source | extract generic decisions | current-main ADR and reuse matrix |
| #1935 | `006-adaptive-authorization-execution-governance` | authority kernel candidate | dependency; Studio must not replace it | current authorization/context authority map |
| #2284 | `008-governed-pr-delivery-orchestration` | repository delivery subsystem | consolidate with #2949/#4432 assurance | repository workflow reuse matrix |
| #2385 | `009-local-connector-reachability-recovery` | infrastructure recovery subsystem | Local Connector Recovery package/service source | device/resource/probe authority map |
| #2949 | `011-database-driven-operation-fabric` | operation-fabric subsystem | installation/operation compiler dependency | full stack reconstruction plan |
| #2950 | `011-tenant-gpt-effective-capability-envelope` | tenant application component | Studio assistant and questionnaire source | Spec/runtime split and Context Kernel reconciliation |
| #3159 | `013-system-tool-catalog-v2` | system tool catalog subsystem | canonical discovery/projection source candidate | choose one current-main implementation |
| #3922 | `014-retail-commerce-operations-growth-os` | reference package source | profile substrate plus Retail Commerce Pack | reconstruction and package validation |
| #4386 | `014-governed-hostinger-storage-orchestration` | integration rollup | Hostinger service/package source | rollup, authority, canary, migration, Production gates |
| #4432 | `014-gemini-evidence-intake-automation` | reference package source | assurance template plus Evidence Intelligence Pack | completion repair and reconstruction |
| #4456 | `015-tenant-operating-system-studio` | portfolio convergence parent | owns portfolio awareness and package composition | architecture review and implementation readiness |
| #4460 | `016-chatgpt-plugin-mcp-integration` | external integration surface | exposes reviewed focused tools through MCP | OAuth, tool catalog, Context Kernel, endpoint, Developer mode |

Machine-readable authority: `draft-spec-portfolio.json`.

## Duplicate identity and feature traceability

### Numeric `011`

| PR | Distinct function | Resolution |
|---:|---|---|
| #2949 | operation registry and compiled execution fabric | subsystem beneath current workflow/control-plane authorities |
| #2950 | Tenant GPT capability discovery and preview orchestration | tenant application/Studio assistant component |

### Numeric `014`

| PR | Distinct function | Resolution |
|---:|---|---|
| #3922 | Business Profile and Retail Commerce | generic substrate plus bounded package |
| #4386 | Hostinger Storage | bounded platform service/package |
| #4432 | Evidence Intelligence and development assurance | bounded package plus extracted assurance |

### Feature `013-system-tool-catalog-v2`

| PR | Role | Resolution |
|---:|---|---|
| #3159 | representative mixed Spec/runtime branch | compare and reconstruct on current main |
| #3139 | competing reconciliation branch | supersede after selected branch validation |
| #3145 | test-manifest helper | absorb into selected branch |

## External integration traceability

```text
Studio package or current platform operation
→ canonical System Tool Catalog / focused projection
→ Spec 016 MCP tool metadata and transport
→ authenticated Context Kernel scope
→ capability/policy decision
→ existing execution and readback authority
```

| Source | Spec 016 use | Authority boundary |
|---|---|---|
| Spec 005/current MCP runtime | protocol and schema foundation | transport only |
| #3159 System Tool Catalog | focused tool discovery/projection | no authorization grant |
| #2949 Operation Fabric/current operations | callable operation binding | execution remains kernel-owned |
| #2950 Tenant GPT | user-oriented capability explanation | application component, not transport authority |
| #4456 Studio | package and generated-surface metadata | published package does not imply external exposure |
| #4462 | first read-only adapter wave | flags disabled; OAuth and Production incomplete |

## Candidate extraction traceability

### PR #3922

| Candidate content | Destination | Required proof |
|---|---|---|
| Business Operating Profile | package applicability substrate | current-main reuse matrix |
| Activity Registry and inheritance | profile resolution | non-Commerce generic tests |
| Applicability predicates | bounded predicate component | complexity/security tests |
| Activity Capability Packs | component substrate | canonical component mapping |
| Effective Business Profile | compiler input | revision/invalidation proof |
| Solution Blueprints | recommendation layer | recommendation is not authority |
| Retail/POS/inventory/orders/payments | Retail Commerce Pack | optional package validation |
| WordPress/WooCommerce/ERPNext | provider components | certification and single-writer rules |

### PR #4432

| Candidate content | Destination | Required proof |
| Development and CI contracts | package assurance template | planning-only and exact-candidate evidence |
| Evidence/Intake entities | Evidence Intelligence Pack | entity/lifecycle contracts |
| Forms and client surveys | Evidence Intelligence Pack | form/client-link contracts |
| File routing/dedup | file policy example | original preservation/readback |
| Gemini contracts | AI component example | structured output/manual fallback |
| Human review/promotion | lifecycle example | human authority and audit |

### PR #4386

| Candidate content | Destination | Required proof |
| storage plans/operations | Hostinger operational package | closed schemas and plan hash |
| Admin/Tenant projections | service boundary | exact context and isolation |
| adapters | certification examples | factory provenance and no live dispatch |
| recovery/checkpoints | operational component family | restore and unknown-outcome tests |

### PR #2385

| Candidate content | Destination | Required proof |
| device/connection health | Local Connector Recovery | current authority reuse |
| diagnostics/probes | recovery components | bounded read-only evidence |
| recovery planner | optional workflow | fresh authorization and readback |
| break-glass | platform-only authority | never exposed as Tenant package authority |

## Delivery train traceability

### Operation Fabric

```text
#3005 → #3021 → #3026 → #3044 → #3054 → #3070
→ #3083 → #3089 → #3097 → #3109 → #3119 → #3130 → #3134
```

PR #3160 is a broad later constraints candidate. The entire set requires one overlap/reuse audit.

### Hostinger Storage

- #4390 contracts integrated.
- #4458 and #4459 provenance corrections integrated.
- #4455 Tenant Canary hardening open at the snapshot.

### System Tool Catalog v2

```text
#3139 competing reconciliation
#3145 helper
#3159 representative reconciliation
```

### ChatGPT/MCP

```text
#4460 canonical Spec
└── #4462 read-only implementation child
```

## Related open Draft classification

The registry classifies 22 related Drafts:

- fourteen Operation Fabric implementation candidates: #3005, #3021, #3026, #3044, #3054, #3070, #3083, #3089, #3097, #3109, #3119, #3130, #3134, #3160;
- System Tool Catalog branches #3139 and #3145;
- repository readiness repair #3143;
- email-ledger migration candidate #3144;
- support-ticket contracts/docs #3181;
- Surface callability closure #4002;
- Admin-control security hardening #2030;
- ChatGPT MCP implementation #4462.

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
| OP-016 candidate/portfolio reconciliation | FR-069..074 and Phase 0 decisions |

## Evidence classes

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
mcp_transport_and_oauth_conformance
sandbox_acceptance
provider_readback
runtime_health
backup_restore
rollback_rehearsal
handover_continuity
production_parity
operator_runbook
```

No task may be closed by substituting a weaker evidence class for the one declared.
