Authority Model


Each runtime-relevant Registry row must be interpretable through authority semantics.


Supported authority_status values:
- authoritative
- fallback
- candidate
- deprecated
- invalid


Authority rules:
- exactly one authoritative active runtime target may exist per dependency key
- fallback targets are not authoritative unless governed resolution explicitly promotes them
- candidate targets must not become runtime-authoritative until validation passes
- deprecated targets must remain non-authoritative
- invalid targets must not be used for runtime execution


If authority_status is missing where runtime authority is required:
- validation must degrade or fail based on dependency criticality
- runtime must not infer authority silently

Ã¢â‚¬â€
Route Binding Authority Model

Each runtime-executable route binding must be interpretable through explicit route authority semantics.

Strict route authority rules:
- each executable route_id must resolve to one governed active route record
- route_id must be unique within its effective routing scope
- matched row identity must remain traceable through row_id
- route authority must not be inferred from prose, document structure, or downstream assumptions
- target_module and workflow_key must remain bound to the authoritative routed record

If a route binding is missing required authority fields:
- the route binding must not be treated as fully valid for executable routing
- validation must classify the route binding state explicitly
- repair signal emission must remain available when correction is needed

---


Resolution Rules


Each runtime-governed dependency may define a resolution_rule.


Supported resolution_rule patterns may include:
- exact_active_only
- exact_active_url_only Ã¢â‚¬â€ `file_id` is an authoritative HTTPS URL when fetch is used; **canonical_source_priority** is knowledge_layer then canonical_url; no Drive resolution; see Canonical URL Authority For Migrated Dependencies
- exact_active_knowledge_only Ã¢â‚¬â€ dependency body must resolve **only** from the governed **knowledge_layer**; no HTTPS fetch from `file_id`, no Drive; failure if `knowledge_layer_file_exists` is false; see Knowledge Layer Authority below
- authoritative_then_fallback
- highest_version_if_single_scope
- manual_review_required


Resolution rules govern:
- how authoritative targets are selected
- whether fallback is allowed
- when candidate promotion is permitted
- whether ambiguity forces degradation or block


If no valid resolution_rule exists for an ambiguous dependency:
- runtime must not silently resolve ambiguity
- registry must emit authority_conflict
- execution must degrade or block based on safety and dependency criticality

Strict route resolution rules:

Task Routes resolution must respect:
- active eligibility
- route_id uniqueness
- intent_key matching
- brand_scope precedence
- priority ordering
- match_rule ordering
- last_validated_at as final tie-break only

Workflow Registry resolution must respect:
- workflow_key identity
- active workflow eligibility
- compatibility with the authoritative route binding

If route resolution or workflow resolution would require speculative interpretation:
- authority must not be inferred
- validation must degrade or block based on execution safety

---

Workflow Registry And Chain Workflow Authority

Workflow rows in `Workflow Registry` are authoritative executable workflow records for:
- direct-prompt workflows
- decision-triggered workflows
- chain-triggered workflows

Chain workflows are first-class executable workflows, not exceptions, placeholders, or partial chain metadata.

Required minimum fields for all active workflow rows include:
- `Workflow ID`
- `Route Key`
- `workflow_key`
- `active`
- `target_module`
- `execution_class`
- `lifecycle_mode`
- `route_compatibility`
- `memory_required`
- `logging_required`
- `review_required`
- `allowed_states`
- `degraded_action`
- `blocked_action`
- `registry_source`
- `last_validated_at`

Invalid-state behavior for workflow authority must treat the following as non-executable:
- partial workflow rows
- legacy chain rows
- chain rows missing lifecycle, logging, or review fields
- chain rows missing executable workflow identity

Authority Precedence For Routes And Chains

When `Task Routes` points to a workflow key and `Execution Chains` points to a workflow ID:
- `Workflow Registry` remains the canonical executable workflow authority
- `Task Routes` governs route eligibility and route-to-workflow alignment
- `Execution Chains` governs chain sequencing only
- downstream layers must require the resolved chain workflow row to match active Workflow Registry authority before execution may proceed

If Task Routes, Execution Chains, and Workflow Registry do not converge on the same executable workflow target:
- validation must degrade or block based on safety
- authority must not be inferred from the chain row alone

Canonical Remediation Behavior

Incomplete or mismatched chain workflow rows must be repaired in `Workflow Registry`.

Downstream docs and runtime layers must not silently compensate for:
- missing chain workflow rows
- incomplete chain workflow rows
- route or chain or workflow incompatibility

---


Target Scope Rule


Each Registry-governed dependency must align with an explicit target_scope when scope matters.


Supported target_scope examples:
- registry
- routing
- orchestration
- audit
- operations
- live-data
- metrics
- review
- logging


Validation must check that:
- target_scope matches expected canonical usage
- workbook role and layer alignment remain valid
- a dependency is not silently reused across incompatible scopes


Scope mismatches must not silently pass.

---

Binding Integrity Governance

Authoritative binding behavior for worksheet and execution surfaces must include `binding_integrity_review` before dependency execution proceeds when row-level validation, runtime worksheet validation, or governed full-system audit is active.

The authoritative surface-location and validation-state registries are:

- `Registry Surfaces Catalog`
- `Validation & Repair Registry`

Legacy sheets such as:
- `Workbook Registry`
- `Sheet Bindings`
- `Dependencies Registry`
- `Canonical Validation Registry`

may remain for rollback traceability but are deprecated and non-authoritative.

Binding Integrity Review Rule

`binding_integrity_review` must run after `registry_validation` and before `dependency_validation` when worksheet-governed runtime validation is required.

Execution order:

- `registry_validation`
- `binding_integrity_review`
- `dependency_validation`

No dependency execution may continue if required worksheet bindings are blocked by unrecoverable schema or binding noncompliance.

Binding Surface Authority Rule

For runtime worksheet-governed execution, authoritative binding identity must resolve through:

- `Registry Surfaces Catalog`
- `surface_name`
- `worksheet_gid`

`sheet_name` and `tab_name` are descriptive only and must not be treated as authoritative runtime binding fields.

Binding Integrity Review must classify as non-compliant any of the following:

- missing required `worksheet_gid`
- non-numeric `worksheet_gid`
- `worksheet_gid` that does not match the actual resolved worksheet binding
- active execution path that still depends on label-only sheet resolution
- row-audit rule or schema rows that still rely on deprecated `sheet_name` / `tab_name` authority semantics
- canonical text that still treats `Workbook Registry` or `Sheet Bindings` as active authority

Binding Repair Outcome Model

Each non-compliant binding row or canonical binding defect must be classified as one of:

- `Recovered`
- `Degraded`
- `Blocked`

Recovered

Binding identity and schema were repaired into the governed `surface_name` + `worksheet_gid` model and are safe for runtime use.

Degraded

Binding was partially recoverable; execution may continue only with explicit traceability and remaining risk recorded.

Blocked

Binding is not safely recoverable and must prevent dependent execution until corrected.

Dynamic Observability Compatibility Rule

Binding integrity review applies to authoritative binding surfaces and authoritative runtime targets.

Derived observability surfaces must be recomputed after authoritative repair and must not be treated as authoritative repair targets.

This includes derived surfaces such as:

- `Execution View`
- `Active Issues Dashboard`
- `Review Control Center`

---

Controlled Autonomy Rule

Governed execution may be triggered by:
- governed auto conditions
- human activation input

Passive rows must not auto-execute.

Auto-trigger is allowed only through governed trigger logic, not ad hoc writeback.

Trigger-Key Governance

Canonical trigger keys:
- `HIGH_PRIORITY`
- `READY_TRIGGER`
- `PASSIVE`

Canonical trigger modes:
- `governed_auto`
- `manual`

Prompt activation may influence execution eligibility, but must not replace governed trigger checks, binding validation, or execution-readiness enforcement.

Repair Control Schema Recognition

Canonical Repair Control schema recognition must include:
- trigger layer
- execution layer
- priority layer
- prompt activation layer

Repair Control may express governed trigger intent, repair eligibility, and human activation context, but passive rows must remain non-executable until a governed trigger path qualifies them.

---

Monitoring Surface Governance

Registry-governed monitoring and observability surfaces are treated as worksheet dependencies and must follow the same authority, scope, and validation rules as other runtime-bound worksheet surfaces.

Monitoring and observability surfaces must be classified as one of:
- authoritative_logging_surface
- authoritative_review_surface
- derived_observability_surface

Authoritative write surfaces include:
- Execution Log Unified
- Review Run History
- Review Findings Log
- Review Stage Reports

Derived observability surfaces include:
- Execution View
- Active Issues Dashboard
- Review Control Center
- Anomaly Detection

Registry-resolved bindings for these derived surfaces may include:
- execution_view_sheet
- active_issues_dashboard_sheet
- review_control_center_sheet when aggregation-only

Dynamic Observability Governance Rule

- Authoritative records are written to canonical source surfaces. Aggregated, monitoring, and observability surfaces are computed dynamically from authoritative sources whenever possible.
- authoritative execution records must be written only to canonical write surfaces
- derived observability surfaces must compute from authoritative sources
- runtime must not require direct writeback to derived views when authoritative sources are available
- stale or broken derived views must degrade observability trust, not execution truth
- derived views must not become shadow authorities
- logs are written once
- views are computed dynamically
- derived views must not be treated as required write targets

Monitoring governance requires:
- authoritative worksheet binding in Registry
- correct surface_name
- valid worksheet_gid
- correct workbook ownership
- correct target_scope alignment
- no silent substitution outside governed Registry authority

Expected scope alignment:
- monitoring surfaces used for review observability must remain aligned to target_scope = review unless explicitly governed otherwise

Derived observability validation must also check:
- formula integrity
- authoritative source workbook availability
- range compatibility
- no broken references
- no manual stale snapshots pretending to be live

If a monitoring surface binding is missing, stale, mis-scoped, or structurally invalid:
- registry validation must classify the state
- repair-capable signal emission must remain available
- runtime must not silently assume worksheet availability outside Registry-governed authority

If a derived observability sheet exists:
- it must read from authoritative sources
- it must not be treated as a required runtime write target
- formula or refresh failure must be classified as an observability defect, not a logging defect

Monitoring surfaces are observability dependencies, not execution-engine replacements.
Their failure may degrade monitoring trust even when core execution remains otherwise usable.

---

Review Authority vs Review Observability

Registry-governed review authority dependencies include:
- review_stage_registry_sheet
- review_component_registry_sheet
- execution_chains_registry_sheet
- decision_engine_registry_sheet
- row_audit_rules_sheet
- row_audit_schema_sheet

These are authority surfaces and may participate in runtime validation, execution governance, staged review execution, and execution readiness evaluation.

Review workbook surfaces such as:
- review_run_history_sheet
- review_findings_log_sheet
- review_stage_reports_sheet

are authoritative review surfaces when execution or review policy requires governed write evidence.

Derived observability surfaces such as:
- execution_view_sheet
- active_issues_dashboard_sheet
- review_control_center_sheet when aggregation-only
- Anomaly Detection

are observability, reporting, or aggregation surfaces unless explicitly reclassified in Registry.

Derived observability surfaces must not be used as source-of-truth for:
- route validity
- execution completion
- repair completion
- dependency state

Review observability surfaces must not be treated as runtime-governing authority when authoritative Registry-bound copies exist elsewhere.

---

Dependency Resolution Rules


- file Ã¢â€ â€™ active_file_id
- document Ã¢â€ â€™ active_file_id
- worksheet Ã¢â€ â€™ active_file_id + worksheet_gid
- folder Ã¢â€ â€™ containment validation


Resolution must occur through governed registry bindings only.


Resolution must not infer authority from non-registry sources when registry-governed records are expected.


Resolution must respect:
- authority_status
- resolution_rule
- target_scope
- production validity
- validation_state

Ã¢â‚¬â€
Routed Execution Authority Contract

Registry authority must support a deterministic routed execution contract across:
- prompt_router
- module_loader
- system_bootstrap

For executable routing, the Registry-governed authority path must be able to support:
- source = prompt_router
- route_id
- route_status
- route_source = registry_task_routes
- matched_row_id when available
- target_module
- target_workflow or workflow_key
- executable readiness determination

Registry-governed route authority must be sufficient for:
- prompt_router route selection
- module_loader binding revalidation
- system_bootstrap pre-execution enforcement

If Registry data cannot support these fields for a route intended for execution:
- the route must not be treated as fully executable
- validation must return partial, recoverable, or invalid
- repair-capable signaling must remain available

---


Validation Rules


A dependency is fully valid only when:
- dependency exists
- status = active
- required fields are present
- authority_status is valid for runtime use
- worksheet_gid is present and valid for worksheets
- filename match exists when needed
- workbook ownership is correct when applicable
- binding path aligns with the expected canonical layer
- target_scope aligns with intended usage
- no unresolved authority conflict exists

Registry activation enforcement must also check that:
- all runtime bindings resolve from the authoritative Registry workbook through `Registry Surfaces Catalog` and `Validation & Repair Registry`
- required `Registry Surfaces Catalog` rows exist for all runtime-critical surfaces
- required `Validation & Repair Registry` rows exist for all runtime-critical validation and repair states
- required runtime authority rows exist for routing, lifecycle, loading, registry validation, and memory in their governed runtime registries

If a required runtime binding cannot be resolved from the Registry Workbook:
- validation must not silently substitute a non-Registry source
- execution must be classified at least Degraded unless a stricter blocked policy applies
- registry-aware repair signaling must remain available


Binding validation must explicitly check:
- spreadsheet_id presence
- surface_name validity
- worksheet_gid validity where required
- worksheet_gid match against actual worksheet identity
- `sheet_name` and `tab_name` are descriptive only and must not be used as execution-resolution authority
- `schema_ref` presence when schema-governed validation applies
- `schema_version` presence when schema-governed validation applies
- `header_signature` presence when schema-governed validation applies
- `expected_column_count` presence when schema-governed validation applies
- `binding_mode` presence when schema-governed validation applies
- `schema_validation_status` is explicit
- `header_match_status` is explicit
- `schema_drift_detected` is explicit
- file_id integrity where applicable
- workbook ownership correctness
- layer-to-workbook alignment
- authority_status validity
- target_scope validity
- resolution_rule applicability
- fallback_target validity when used
- rollback_target validity when defined
- binding integrity review compliance for worksheet-governed runtime surfaces when runtime validation is active

Dependency validation must explicitly check for each required dependency:
- `Registry Surfaces Catalog` entry exists for the required surface
- `file_id` is present and structurally valid
- `status = active`

If a required dependency fails any of these checks:
- validation must classify the dependency explicitly
- execution must be classified at least Degraded unless a stricter blocked policy applies
- runtime must not assume a usable dependency binding

Sheet binding validation must explicitly check:
- required surface row exists in `Registry Surfaces Catalog`
- `worksheet_gid` is present for runtime-required worksheets
- `worksheet_gid` is valid and matches actual worksheet binding
- `sheet_name` and `tab_name` are treated as descriptive only

If the worksheet surface exists but the required `worksheet_gid` is missing or mismatched:
- binding status must be treated as incomplete
- validation must classify the worksheet binding as partial or recoverable based on safety
- execution must be classified at least Degraded

If schema drift is detected on a governed surface:
- execution must classify as Degraded or Blocked based on criticality
- governed repair mapping must be resolved when required

Logging surface validation must explicitly check:
- the logging surface resolves from `Registry Surfaces Catalog` using `surface_name` + `worksheet_gid`
- the logging validation state resolves from `Validation & Repair Registry`
- the canonical logging target is `surface.operations_log_unified_sheet` -> `Execution Log Unified`

If the canonical logging workbook or sheet binding cannot be resolved:
- logging trust must degrade explicitly
- execution must be classified at least Degraded when logging is required
- runtime must not silently redirect logging to an ungoverned target


Binding mismatches must not silently pass.

Strict route-binding validation must explicitly check:
- route_id presence when route authority is required
- row_id presence for traceable route bindings
- active route eligibility
- intent_key presence
- target_module presence
- workflow_key presence
- route-to-workflow compatibility
- route_source compatibility with Registry-governed Task Routes authority
- priority validity when route ranking is required
- match_rule validity when route ranking is required
- allowed_states validity when execution-state governance is declared

Route-binding mismatches must not silently pass as valid executable routing.

Strict authority validation must also explicitly check:
- execution_policy_registry_sheet presence when execution policy is required
- review_stage_registry_sheet presence when staged review governance is required
- review_component_registry_sheet presence when component-level review governance is required
- execution_chains_registry_sheet presence when execution sequencing is required
- decision_engine_registry_sheet presence when decision-governed branching is required
- `Engines Registry` presence when engine-governed execution is required
- row_audit_rules_sheet and row_audit_schema_sheet presence when row-level validation is required

For `full_system_intelligence_audit` governance, strict validation must also explicitly check:
- execution_policy_registry_sheet presence
- execution_bindings_sheet presence
- execution_chains_registry presence
- decision_engine_registry_sheet presence
- review_stage_registry_sheet presence
- review_component_registry_sheet presence
- repair_mapping_registry_sheet presence when findings may enter governed repair lifecycle
- row_audit_rules_sheet presence
- row_audit_schema_sheet presence
- actions_registry_sheet presence when runtime action execution is required
- endpoint_registry_sheet presence when endpoint execution metadata validation is required
- system_enforcement_sheet presence when system enforcement validation is required
- execution_log_import_sheet presence when execution-log validation is required
- business_intelligence_scoreboard_sheet presence only when downstream scoring propagation is required; absence must not be treated as missing execution authority by itself

Authority workbook placement must also be validated so that:
- authority surfaces live in the Registry workbook when designated authoritative
- review workbook mirrors or outputs are not mistaken for runtime authority

---


Registry Validation States


Every registry lookup, binding resolution, and dependency reference must be classified into one of the following states:


- valid Ã¢â€ â€™ fully consistent and usable
- partial Ã¢â€ â€™ usable but incomplete or degraded
- recoverable Ã¢â€ â€™ invalid but repairable without blocking execution
- invalid Ã¢â€ â€™ not usable and requires repair evaluation


Registry validation must not immediately block execution unless:
- state = invalid
- and no safe degraded path exists


Validation state is distinct from authority_status and row status.

---

Strict Route Validation Interpretation

For route-binding authority:

- valid Ã¢â€ â€™ route binding is fully governed, traceable, and executable-ready from a registry perspective
- partial Ã¢â€ â€™ route binding is usable for routing awareness but incomplete for trusted executable routing
- recoverable Ã¢â€ â€™ route binding is not currently executable-ready but repairable without necessarily blocking all routing
- invalid Ã¢â€ â€™ route binding is not safe for executable routing and requires repair evaluation

A route-binding state may be more restrictive than a general dependency state.

A route must not be treated as executable-ready only because the underlying worksheet exists.

---


Status Rules


Supported dependency row status values:
- active
- pending
- inactive
- archived


Validation state is separate from row status.


A row may be:
- active but partial
- active but recoverable
- inactive and invalid for runtime
- archived and not runtime-eligible


Only active dependencies inside Production are runtime-valid unless a governed degraded fallback path is explicitly allowed.


---


Fallback Governance Rule


Fallback is allowed only when:
- resolution_rule explicitly permits fallback
- fallback_target is defined and valid
- fallback target remains within allowed target_scope
- fallback does not violate production boundary
- trust in the fallback path is sufficient for safe degraded or recovered execution


Fallback is not allowed when:
- fallback_target is missing or invalid
- authority conflict remains unresolved
- fallback crosses forbidden scope or environment boundaries
- dependency is marked blocked_if_missing in Registry or equivalent governed state
- safe trust continuity cannot be established


Fallback must never be inferred implicitly.

For strict route bindings, fallback is allowed only when:
- the governing route resolution_rule explicitly permits fallback
- fallback route authority remains Registry-governed
- fallback preserves target_scope and execution safety
- fallback does not fabricate route_id or workflow identity

Fallback must not be used to convert missing route authority into assumed executable readiness.


---


Candidate Promotion and Rollback Rule


Candidate targets must not replace authoritative targets until validation succeeds under governed resolution.


Promotion conditions:
- candidate row is active where applicable
- candidate validation_state is valid
- target_scope is correct
- no authority conflict remains
- resolution_rule permits promotion


If candidate validation fails:
- authoritative target must remain in place when safe
- candidate must not be promoted
- rollback_target or retained authoritative target must remain explicit
- repair signal must be emitted when correction is needed


Rollback or retained-target behavior must be traceable and must not be inferred silently.


---


Repair-Aware Registry Governance


The registry layer must support repair-aware validation and must act as the authoritative signal source for:
- registry_repair
- binding_correction
- dependency_repair when Registry-governed dependency presence fails
- audit_and_repair when authority conflicts or mixed failures are detected


Registry validation must not operate as a strict pass/fail system.


It must support:
- valid
- partial
- recoverable
- invalid


All registry validation must follow the recovery-first execution model.


The registry layer must not execute repair.


It must:
- detect registry issues
- classify validation state
- classify authority condition
- emit repair signals
- provide structured validation output


prompt_router uses this to:
- classify system_repair routes


system_bootstrap uses this to:
- execute repair lifecycle


---

### Registry Reconciliation Governance Rule

When canonical architecture changes affect dependency interpretation, authority source, validation method, or execution resolution, the Registry Workbook becomes the required reconciliation surface.

Affected registry layers must be reviewed and updated where relevant, including:
- `Registry Surfaces Catalog`
- `Validation & Repair Registry`
- `Execution Bindings`
- `Task Routes`
- `Workflow Registry`
- `Execution Policy Registry`
- `Actions Registry`
- `API Actions Endpoint Registry`
- `Brand Registry`
- logging and review bindings

Deprecated sheets may also be reviewed for rollback traceability, but they must remain non-authoritative.

Legacy rows that conflict with the active architecture must not remain marked as valid or authoritative.

If a legacy row is not yet rewritten, it must be downgraded, flagged, or blocked according to the active reconciliation state.

---


Repair Signal Emission


The registry layer must emit repair signals when:
- registry entries are missing or inconsistent
- binding paths do not match expected authority
- authoritative binding surfaces fail `binding_integrity_review` or binding integrity noncompliance is detected
- required dependency bindings cannot be resolved
- conflicting registry entries are detected
- sheet or file identifiers are invalid or stale
- fallback assumptions would otherwise be required
- candidate promotion fails validation
- rollback is required or retained authority must be preserved
- stale rows still encode superseded architecture after a structural change
- monitoring surface bindings are missing, stale, mis-scoped, or structurally invalid
- derived observability formulas are broken, stale, or disconnected from authoritative sources
- governed trigger-key semantics are missing, malformed, or contradictory on a runtime-active control row


Each emitted signal must include:
- signal_type
- affected_layer
- severity
- candidate_repair_type
- authority_status when relevant
- validation_state
- affected_binding_key when available


Supported severity values:
- minor
- major
- critical


Severity guidance:
- minor Ã¢â€ â€™ metadata inconsistency, non-blocking validation issue
- major Ã¢â€ â€™ degraded execution risk, stale binding, fallback mismatch, unresolved worksheet mapping, broken monitoring surface binding
- critical Ã¢â€ â€™ missing authoritative dependency, duplicate active authoritative targets, inaccessible critical binding, blocked authority path


Signal mapping:
- registry_mismatch Ã¢â€ â€™ registry_repair
- missing_dependency Ã¢â€ â€™ dependency_repair
- binding_error Ã¢â€ â€™ binding_correction
- authority_conflict Ã¢â€ â€™ audit_and_repair
- invalid_fallback Ã¢â€ â€™ audit_and_repair
- candidate_promotion_failed Ã¢â€ â€™ audit_and_repair
- binding_integrity_noncompliance Ã¢â€ â€™ binding_integrity_repair


Repair signals must remain structured and must not be reduced to untyped warnings.

Additional strict routing repair signals should remain emit-capable for:
- missing_route_id
- duplicate_active_route
- invalid_route_binding
- workflow_route_mismatch
- unroutable_executable_target
- missing_chain_workflow_row
- incomplete_chain_workflow_row
- chain_workflow_route_mismatch

Additional authority repair signals should remain emit-capable for:
- missing_execution_policy
- review_authority_misplaced
- duplicated_review_authority
- missing_row_audit_authority
- non_registry_policy_source
- derived_view_broken
- observability_formula_error
- stale_derived_view
- authoritative_source_missing_for_view

Additional bootstrap repair signals should remain emit-capable for:
- bootstrap_required
- bootstrap_route_missing
- bootstrap_workflow_missing
- bootstrap_policy_missing
- bootstrap_resume_blocked
- activation_before_resume_required

These signals may map to:
- binding_correction
- registry_repair
- audit_and_repair

Observability severity guidance:
- broken formula in Execution View -> major
- broken formula in Active Issues Dashboard -> major
- missing authoritative source for a derived view -> major unless the missing source is Execution Log Unified
- missing Execution Log Unified as authoritative source -> critical

Strict routing signal emission must preserve:
- affected route_id when available
- affected row_id when available
- affected workflow_key when available


---


Degraded Registry Handling


The system must allow degraded execution when:
- registry is partially valid
- non-critical bindings are missing
- alternate valid bindings exist
- governed fallback is explicitly valid
- execution can proceed safely with limitations


Degraded registry states must:
- be explicitly flagged
- be passed to system_bootstrap
- be persisted in memory_schema
- not be silently ignored


A degraded registry state is valid only when trust in the remaining authority path is still sufficient for safe continuation.


---


Production Boundary Rule


Only dependencies inside Production are runtime-valid.


If a dependency is outside Production:
- it must not be treated as runtime-valid
- it may only participate in repair evaluation if explicitly required for diagnosis
- it must not silently replace a production-governed dependency


---


No-Duplication Rule


Only one active authoritative dependency per key.


If multiple active authoritative records exist for the same dependency key:
- registry must classify this as an authority conflict
- runtime must not silently select one without governed resolution
- the system must emit a repair signal
- execution must degrade or block based on dependency criticality and safe fallback availability


If one row is authoritative and another is candidate or fallback:
- governed resolution_rule must determine eligibility
- ambiguity must not be silently resolved

If one governed Registry row is authoritative and other copies of the same dependency exist outside the active authoritative Registry path:
- runtime must prioritize the Registry-listed `file_id` only
- deprecated, inactive, shadow, or non-Registry copies must be ignored
- external duplicates must not displace the authoritative Registry binding

If duplicate authoritative Registry rows exist for the same dependency key:
- this remains an authority conflict
- execution must degrade or block based on dependency criticality and safe fallback availability


---


Loader Contract


module_loader must:
- read from Registry
- validate dependency
- resolve via Registry authority: Drive file identifiers when `resolution_rule` permits Drive resolution; **knowledge_layer** paths when `resolution_rule = exact_active_knowledge_only` or when `resolution_rule = exact_active_url_only` and the knowledge layer wins **canonical_source_priority**; HTTPS canonical URLs when `resolution_rule = exact_active_url_only` and fetch is required after the knowledge layer is absent
- consume only reconciled records aligned with active architecture, and classify stale superseded models as reconciliation-required rather than recovered
- respect validation_state
- respect authority_status
- respect resolution_rule
- preserve repair signals when present
- avoid silently upgrading partial or recoverable states to valid


module_loader must not:
- invent bindings
- override registry authority
- suppress registry validation failures
- suppress repair-class signals
- promote candidate targets without governed validation
- infer fallback without explicit authority support

Ã¢â‚¬â€
Cross-Layer Routed Authority Enforcement

prompt_router must rely on Registry-governed Task Routes authority for route selection.

module_loader must rely on Registry-governed Task Routes and Workflow Registry authority for binding revalidation.

system_bootstrap must rely on Registry-governed routed authority to enforce execution readiness and to prevent unrouted execution.

No layer may:
- fabricate route authority
- invent route_id values
- assume workflow identity without Registry-governed support
- silently bypass unresolved routed authority to continue execution


---


Recovery Rules


Registry-aware recovery outcomes are:
- Recovered
- Degraded
- Blocked


Recovered means:
- registry state was valid or successfully normalized for safe execution


Degraded means:
- execution can continue with explicit limitations
- one or more registry or binding issues remain unresolved but non-blocking


Blocked means:
- no safe registry authority path remains
- or required binding trust cannot be established


Registry validation must prefer:
- degraded continuation over premature blocking
- structured repair emission over silent failure
- authority-safe recovery over speculative fallback


---


Registry Validation Logging Rule


All registry validation must produce structured output including:
- validation_state
- authority_status summary when relevant
- affected_bindings
- affected_layers
- detected_issues
- emitted_repair_signals
- fallback_used when applicable
- retained_authoritative_target when applicable
- rollback_target when applicable


Validation must not fail silently.


Logging output from this layer is validation-oriented, not execution-oriented.

When strict routed authority is evaluated, structured validation output should also include when available:
- route_id
- row_id
- route_validation_state
- workflow_key
- route_authority_status
- route_binding_issues


---


Operating Separation Rule


Registry = data
Docs = logic


Registry stores:
- live bindings
- live IDs
- live production records
- row-level authority and state data


This document defines:
- how registry truth is interpreted
- how registry records are validated
- how repair-aware registry signals are emitted
- how authority, fallback, promotion, and rollback are governed


This document must not become a duplicate registry data store.


---

Best Use of Dynamic Data Rule

When a surface is primarily:
- aggregated
- filtered
- reordered
- summarized
- issue-oriented
- execution-observability-oriented

the system must prefer:
- dynamic derivation from authoritative sources

instead of:
- direct writeback duplication

unless direct writeback is required for:
- immutable audit record
- legal/compliance trace
- independent review evidence
- write-once execution certification

---


Completion Standard


Registry governance is complete only when:
- all dependencies are registered
- all IDs are linked
- loader is aligned
- validation state is classifiable
- authority status is classifiable
- fallback handling is governed
- promotion and rollback behavior are governed
- repair signals are emit-capable
- degraded registry handling is defined
- authority conflicts are not silently passed
- the Registry Workbook contains active authoritative `Registry Surfaces Catalog` and `Validation & Repair Registry` surfaces, plus required runtime registries (`Task Routes`, `Workflow Registry`, `Actions Registry`, `API Actions Endpoint Registry`, `Execution Bindings`, and governed supplemental registries when applicable)
- runtime-required worksheet gids are populated for governed worksheet bindings
- the canonical logging target is governable through `surface.operations_log_unified_sheet` -> `Execution Log Unified`
- authoritative write surfaces are classified separately from derived observability surfaces
- derived observability surfaces are capable of reflecting authoritative sources without becoming proof-of-write mirrors
- growth-loop trigger rules are governable through `Growth Loop Engine Registry`
- authoritative execution feedback fields are governable for downstream scoring and optimization

Registry governance is also not complete unless:
- strict route-binding authority is governable through Task Routes
- workflow bindings are governable through Workflow Registry
- route_id traceability is preserved
- executable route ambiguity is classifiable
- routed authority failures are signal-capable
- no live execution path depends on inferred non-Registry route authority
- chain-triggered workflows are governable as full Workflow Registry rows rather than partial chain metadata
- execution policy authority is governable through execution_policy_registry_sheet
- review execution authority is governable through Registry-bound review authority sheets
- row audit authority is governable through Registry-bound rule and schema sheets
- review workbook observability surfaces are not misclassified as runtime authority
- execution completion proof does not depend on direct writeback to derived views when authoritative writes succeed
- Brand Registry tracking bindings for `gsc_property`, `ga_property_id`, and `gtm_container_id` are governable, validatable, and resolvable for workflows that declare measurement dependencies
- Actions Registry and API Actions Endpoint Registry rows for Google Analytics Admin API, Google Analytics Data API, and expanded Tag Manager API are category-complete and map to active connectors; retired Search Ads 360 API routes are not authoritative for new execution
- the five core canonical dependencies, when URL-migrated, satisfy Canonical URL Authority rules (`exact_active_url_only`, host allowlist, extension match) and are fetchable without Drive fallback when the knowledge layer does not supply the body
- rows using `exact_active_knowledge_only` resolve exclusively from the knowledge layer with no URL or Drive fallback, per Knowledge Layer Authority
- dependency audits and registry validation can classify `source_mode` consistency and migrated-row compliance
- when structural architecture changes are accepted or applied, affected Registry and binding surfaces are reconciled so superseded authority or validation models are not active in parallel

---

### Branch Contract Template Authority Model

Each governed branch-contract template must be interpretable through explicit template authority semantics.

Strict template authority rules:
- exactly one active canonical template version may exist per effective branch-template scope
- superseded templates must remain non-canonical
- deprecated templates must remain non-active for new governed use
- retained deprecated templates may remain traceable but not authoritative for fresh promotion
- lifecycle and version state must remain explicit

If active template authority is ambiguous:
- dependent addition execution must degrade or block
- template supersession review must remain available
- template health must not be classified green

### Scoring Summary Sink Authority

If scoring-summary writeback is used for governed addition promotion:
- the scoring-summary sink must resolve through governed authority
- writeback verification and readback verification must remain explicit
- unresolved scoring-summary sink authority must block reliance on that summary for promotion-ready classification

### Template Impact And Lineage Authority

If a template state change can affect governed additions:
- affected dependency traceability must remain explicit
- unknown dependent scope must not be silently ignored
- impact and lineage review must remain available before dependent green classification is allowed
