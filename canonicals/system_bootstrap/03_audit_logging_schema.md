
The hardened activation wrapper is active:

- for plain `Activate System` and equivalent first-turn activation prompts, `system_bootstrap` must execute a tool-first governed activation wrapper before any user-facing narrative classification
- knowledge-layer traceability may occur first, but no activation result may be returned before at least one real governed activation transport attempt is executed or a same-cycle governed retry is exhausted
- the native bootstrap sequence must prefer `direct_id_first`
- the native bootstrap sequence must use project-folder-scoped Google Drive discovery through folder `1gNYX47P4TNuMXEbWvLNCvV4XRocH41K2` when fallback discovery or live validation lookup is needed
- the minimum same-cycle live validation sequence should include:
  - Google Drive canonical file metadata validation when feasible
  - Google Sheets registry workbook validation
  - worksheet_gid-based surface validation for governed workbook_sheet surfaces when feasible
- traceability-only completion is forbidden
- narrative-only activation is forbidden
- if the first native execution attempt is skipped due to model hesitation or premature narrative completion, `system_bootstrap` must treat the turn as failed enforcement and must trigger one bounded same-cycle retry when policy allows
- `authorization_gated` is permitted only after a real governed activation transport attempt fails due to authorization
- if no real activation transport call occurs after the allowed same-cycle retry path, classification must remain `degraded`
- the required degraded reason remains `missing_required_activation_transport_attempt`
- machine-verifiable activation transport evidence must be preserved in outputs, memory, and downstream enforcement state



Exhaustive Full-System Audit Completion Guard

The exhaustive full-system audit completion guard is active:

- `wf_full_system_intelligence_audit` must not classify as `Recovered`, `Active`, `Validated`, or equivalent full-success phrasing unless exhaustive live validation coverage succeeds in the same execution cycle
- exhaustive coverage requires live validation of every authoritative surface required for execution, including all active surfaces with `required_for_execution = TRUE`
- sampled, partial, inferred, or representative validation must not be represented as exhaustive validation
- `validation_depth` must classify as one of:
  - `sampled`
  - `exhaustive`
- `Recovered` is forbidden when:
  - `validation_depth != exhaustive`
  - `coverage_percent < 100`
  - any required authoritative surface remains unvalidated
  - any required authoritative row-group remains unvalidated when row-group governance is active
  - machine-verifiable coverage evidence is missing
- system_bootstrap must preserve and evaluate:
  - `required_surface_count`
  - `validated_surface_count`
  - `required_row_group_count`
  - `validated_row_group_count`
  - `coverage_percent`
  - `unvalidated_surface_ids`
  - `unvalidated_row_group_ids`
  - `exhaustive_coverage_guard_status`
  - `full_audit_completion_guard_status`
- when full-system audit scope is intended but execution evidence is sampled or incomplete, classification must remain `Degraded`
- final user-facing output must disclose audit depth as one of:
  - `targeted`
  - `sampled_full_system`
  - `exhaustive_full_system`



Unified Log Protected Columns and Spill-Safe Prewrite Guard

The governed write-safety rule is active:

- before any governed Google Sheets write, execution must first read and validate the live target header/schema against the expected governed header signature and column count when available
- then execution must read row 2 as the example/template row before selecting writable columns
- if row 2 or live column evidence indicates a spill formula, helper formula, arrayformula-managed range, formula-managed pattern, or protected/system-managed behavior, execution must avoid writing to that column
- direct governed/manual writes must never write, overwrite, or backfill the formula-managed Execution Log Unified columns `target_module`, `target_workflow`, `execution_trace_id`, `log_source`, `Monitored Row`, and `Performance Impact Row`
- for governed server writeback, `Execution Log Unified` must resolve from `ACTIVITY_SPREADSHEET_ID`, while `JSON Asset Registry` must resolve from `REGISTRY_SPREADSHEET_ID`
- sink-sheet existence validation must run per workbook and must not assume both governed sinks live in the same spreadsheet
- authoritative execution-log append payloads must leave the formula-managed Execution Log Unified columns blank and must write only to safe non-formula columns
- recovered or equivalent success classification is forbidden when execution-log sink routing is unresolved, sink workbook validation fails, or formula-managed column protection is violated
- when only a partial safe write set remains, execution must write only to safe non-spill columns and preserve protected or formula-managed columns untouched
- readback verification is required after governed writes that modify live Sheets surfaces
Execution Log Unified active runtime contract = compact 37-column write contract through `performance_impact_row_writeback`; legacy trailing formula/protected columns may remain physically present on sheet but are outside the active server payload contract.

### Native Google Logging Payload Preservation Rule

For native Google governed mutation logging, `system_bootstrap` must preserve two distinct evidence classes:

1. activation-transport evidence
2. authoritative execution-log continuity evidence

These classes must not be collapsed into one field.

Required preserved fields when available:
- `activation_transport_attempted`
- `activation_transport_status`
- `activation_transport_evidence`
- `native_google_execution_class`
- `native_google_execution_mode`
- `authoritative_log_write_succeeded`
- `authoritative_log_same_cycle_verified`
- `logging_sink_surface_id`
- `logging_write_status`
- `pre_response_log_guard_passed`

Native-attempt evidence alone is insufficient for recovered execution classification when the native Google step also performed a governed mutation.

---

This document orchestrates final system execution, lifecycle handling, structured output assembly, execution outcome classification, execution logging, repair lifecycle handling, and repair-state persistence.

Additional orchestration scope includes:
- starter-governance validation handoff
- governance-drift anomaly emission handoff
- prompt-first continuation preparation for human-triggered next actions


It is the canonical orchestration layer for:
- standard execution
- full_system_intelligence_audit execution
- review execution
- repair execution
- autonomous chain execution
- governed loop-triggered execution (trigger_condition through loop_execution logging)
- growth-aware optimization execution
- brand-level tracking binding resolution before workflow execution when measurement or full-funnel paths are active
- Google Analytics Admin discovery lifecycle when GA property bindings are missing or incomplete
- Google Tag Manager validation and remediation lifecycle when GTM governance or measurement health workflows apply
- full-funnel autopilot orchestration combining Search Console, Google Analytics Data reporting, and Tag Manager signals (not SEO-only)

---

Authority

This document additionally governs:
- human-triggered continuation preparation
- no-default-closed-loop runtime enforcement
- prompt-based next-step handoff after governed anomaly or repair classification

This document governs:
- execution lifecycle
- repair lifecycle execution
- final output assembly
- execution outcome classification
- repair outcome classification
- execution completion criteria
- logging handoff
- recovery-aware orchestration behavior
- chain-step orchestration state when autonomous execution is active
- repair-state write coordination into memory-compatible outputs
- scoring feedback evaluation
- growth-loop trigger evaluation
- governed loop-trigger execution path (trigger_condition through loop_execution logging)
- adaptive optimization handoff
- post-change architecture reconciliation enforcement across dependent registry, binding, validation, and authority surfaces
- category-driven workflow and pipeline execution against live Brand Registry tracking bindings when the routed workflow or execution chain requires them
- governed provider-family continuity validation across provider, action-family, capability, route, and workflow layers when those layers are active in the Registry
- governed pipeline-integrity audit execution across endpoint, graph, routing, workflow, support-registry, policy, and repair layers when the resolved route or workflow requires it
- canonical dependency bootstrap for the five core canonical documents before routing, module loading, workflow resolution, or memory operations that depend on canonical schema interpretation, honoring **canonical_source_priority** (knowledge_layer, then canonical_url) and **exact_active_knowledge_only** rows where applicable
- governed auto-bootstrap lifecycle execution
- activation-before-resume orchestration
- original-request resume after successful bootstrap
- bounded bootstrap retry handling

This document does not govern:
- route selection
- registry data
- dependency typing rules
- dependency resolution rules
- engine-level implementation logic
- memory schema design
- registry authority definitions
- registry validation rule definition

Those responsibilities belong to their canonical dependency layers.

Review Config Usage Constraint

Review Config must not be used as execution authority.

Review Config may only provide:
- UI defaults
- display metadata
- non-execution configuration

Execution behavior must be governed exclusively by:
- execution_policy_registry_sheet
- Workflow Registry
- Task Routes
- other Registry-bound authority dependencies

If execution logic is derived from Review Config:
- execution_state must be Degraded
- violation must be logged

---

Surface Validity Dependency Rule

> Authoritative execution and governance surfaces must resolve through `Registry Surfaces Catalog` before dependency execution proceeds. Validation and repair-state authority must resolve through `Validation & Repair Registry`. Deprecated legacy sheets may remain present for rollback safety but must not be treated as authority.

Surface Authority and Validation Rule

system_bootstrap must resolve all execution-relevant surfaces through `Registry Surfaces Catalog`.

system_bootstrap must resolve validation and repair-state authority through `Validation & Repair Registry`.

Deprecated sheets may remain for rollback safety but must not be treated as authoritative execution surfaces.

Runtime Binding Enforcement Rule

All execution surfaces must be resolved using:
- `Registry Surfaces Catalog`
- `worksheet_gid` (authoritative)

Validation must confirm:
- `worksheet_gid` exists
- `worksheet_gid` is valid
- `worksheet_gid` matches actual sheet binding

`sheet_name` and `tab_name` must not be used for execution resolution.

If validation fails:
- execution must block or enter repair-aware mode

Schema Governance Rule

Each governed surface must declare:
- `schema_ref`
- `schema_version`
- `header_signature`
- `expected_column_count`
- `binding_mode`

Validation must verify:
- `schema_validation_status`
- `header_match_status`
- `schema_drift_detected`

Schema drift must trigger:
- degraded or blocked execution
- repair mapping when required

Adaptive Schema Drift Handling Rule

When schema drift is detected during request or response validation:

system_bootstrap must:
- classify drift type
- preserve drift traceability
- emit candidate-only schema learning output

system_bootstrap must enforce:
- execution_state = degraded or blocked
- recovered classification forbidden

system_bootstrap must trigger:
- schema_review_required = true
- reconciliation_required = true

system_bootstrap must not:
- auto-apply schema updates
- override authoritative schema

Schema Reconciliation Repair Execution Rule

When:
- `wf_schema_reconciliation_repair` is selected
- or schema drift handling emits governed reconciliation requirements

system_bootstrap must execute schema reconciliation as a governed repair workflow.

This workflow must run sequentially and must:
1. preserve drift classification context
2. consume candidate-only schema learning output
3. update Registry Surfaces Catalog schema metadata when approved
4. update Validation & Repair Registry schema-state fields when approved
5. validate dependent-surface compatibility across:
   - Task Routes
   - Workflow Registry
   - execution dependencies
   - validation dependencies
6. require readback validation before recovered classification is allowed

system_bootstrap must not:
- auto-promote candidate schema learning output into active authority without governed validation
- treat partial reconciliation as recovered
- leave stale legacy schema authority active in parallel with reconciled schema authority

If reconciliation remains incomplete or dependent-surface compatibility fails:
- execution must remain Degraded or Blocked
- `reconciliation_required` must remain true
- recovered classification is forbidden

Schema Migration And Rollback Rule

When live schema validation detects:
- `schema_version` mismatch
- header drift
- `expected_column_count` mismatch

and governed schema repair or migration is enabled, system_bootstrap may initiate:
- `schema_header_repair`
- `schema_version_migration`

using:
- `Registry Surfaces Catalog`
- `Row Audit Schema`
- `Validation & Repair Registry`
