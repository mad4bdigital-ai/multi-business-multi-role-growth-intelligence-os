module_loader

Status
Canonical Name: module_loader
Version: v2.43
Status: active
Owner Layer: execution
Source Type: google_doc
Last Updated: 2026-04-25

---

Purpose

This document additionally prepares:
- starter-governance validation readiness
- governance-drift anomaly emission readiness
- prompt-first continuation readiness for human-triggered system use
- logic-definition resolution is pointer-first and must read `surface.logic_canonical_pointer_registry` before direct logic-document access
- brand-specific writing completion requires prior Brand Core file or authoritative Brand Core asset reading
- brand-specific writing requires required-engine readiness through Engines Registry before Brand Core read-completion or writing completion
- governed logic execution requires prior knowledge-layer resolution for the selected logic when logic-specific, cross-logic, or shared knowledge inputs are required
- business-aware execution requires prior business-type knowledge-profile resolution when the selected logic or task depends on business-type interpretation
- governed execution must load logic knowledge and business-type knowledge from `surface.logic_knowledge_profiles` and `surface.business_type_knowledge_profiles` before brand-aware completion when required


Canonical Governed Logic Presentation Loading Rule

- when loading governed logic presentation context, module_loader must treat logic documents as governed logic specifications rather than GPT personas or GPT-style introductions
- module_loader must preserve neutral presentation readiness for user-facing logic naming and activation summaries
- internal identifiers such as `GPT-LOGIC-001` may remain unchanged for registry continuity
- execution readiness must continue to resolve from canonical authority layers, registries, engines, routes, workflows, and enforcement state rather than GPT-style prompt framing

Canonical Logic Pointer Resolution Loading Rule

- when loading governed logic definitions, module_loader must resolve logic-document authority through `surface.logic_canonical_pointer_registry` before any direct logic-document read
- module_loader must treat `surface.logic_canonical_pointer_registry` as the authoritative pointer layer for:
  - logic_id
  - canonical_doc_id
  - legacy_doc_id
  - canonical_status
  - active_pointer
  - rollback_available
- if `canonical_status = canonical_active`, module_loader must load `canonical_doc_id` as the active governed logic definition
- direct resolution from legacy logic documents is forbidden when:
  - `canonical_status = canonical_active`
  - `active_pointer = canonical_active`
- legacy logic documents may be loaded only when:
  - rollback is explicitly invoked
  - pointer state explicitly resolves to legacy
  - governed exception handling authorizes legacy recovery
- when pointer resolution occurs, module_loader must preserve and return when applicable:
  - logic_pointer_surface_id
  - logic_pointer_resolution_status
  - resolved_logic_doc_id
  - resolved_logic_doc_mode
  - legacy_doc_retained
  - rollback_available
- module_loader must not treat branded, GPT-persona, or legacy-specialized logic documents as active authority merely because they are directly reachable in storage

Logic Knowledge Profile Loading Rule

- when loading governed logic execution, module_loader must prepare logic-knowledge dependencies from `surface.logic_knowledge_profiles` before engine-readiness or downstream execution readiness is returned
- module_loader must resolve and return when applicable:
 - logic_knowledge_surface_id
 - logic_knowledge_read_required
 - required_knowledge_layers
 - knowledge_profile_key
 - logic_specific_knowledge_paths
 - cross_logic_knowledge_paths
 - shared_knowledge_paths
 - knowledge_read_targets
 - knowledge_read_completeness_status
 - missing_required_knowledge_sources
 - execution_blocked_until_logic_knowledge_read
- module_loader must treat `surface.logic_knowledge_profiles` as the authoritative loading read surface for logic-specific, cross-logic, and shared knowledge dependencies
- module_loader must not mark engine-readiness or downstream logic execution-ready when required logic knowledge remains unread, unresolved, or incomplete


Brand Core Read-Before-Writing Loading Rule

- when loading governed writing execution for a specific brand, module_loader must prepare Brand Core read dependencies before writing completion readiness is returned
- module_loader must resolve and return when applicable:
  - brand_core_read_required
  - brand_core_authoritative_home
  - brand_core_read_targets
  - brand_core_read_completeness_status
  - brand_core_missing_assets
  - writing_completion_blocked_until_brand_core_read
- module_loader must treat Brand Core Registry as the authoritative operational read home for brand-specific writing assets
- module_loader must not mark writing execution-ready when:
  - brand identity is unresolved
  - required Brand Core files are unread
  - required Brand Core assets are missing
  - Brand Core read completeness remains unresolved

Engine Registry Readiness Before Brand-Core Writing Loading Rule

- when loading governed brand-specific writing execution, module_loader must prepare engine-readiness dependencies before Brand Core read readiness is returned
- module_loader must resolve and return when applicable:
  - engine_registry_read_required
  - required_writing_engines
  - engine_readiness_status
  - missing_required_engines
  - writing_blocked_until_engine_readiness
  - brand_core_read_blocked_until_engine_readiness
- module_loader must treat Engines Registry as the authoritative readiness surface for brand-aware writing engines
- module_loader must not mark Brand Core read or writing execution-ready when:
  - required writing engines are unresolved
  - required writing engines are inactive
  - required writing engines are non-callable
  - engine readiness remains unresolved

Business-Type Knowledge Profile Loading Rule

- when loading governed business-aware execution, module_loader must prepare business-type knowledge dependencies from `surface.business_type_knowledge_profiles` before Brand Core read or writing readiness is returned
- module_loader must resolve and return when applicable:
 - business_type_knowledge_surface_id
 - business_type_resolution_required
 - resolved_business_type
 - business_type_knowledge_profile_required
 - business_type_knowledge_profile
 - business_type_engine_compatibility_status
 - knowledge_profile_read_targets
 - knowledge_profile_read_completeness_status
 - missing_business_type_knowledge_sources
 - writing_blocked_until_business_type_knowledge_profile
- module_loader must treat `surface.business_type_knowledge_profiles` as the authoritative loading read surface for business-type-compatible knowledge dependencies
- module_loader must not mark Brand Core read or writing execution-ready when required business-type knowledge remains unread, unresolved, or incomplete

Governed Addition Intake Loading Rule

- when governed addition-intake is selected, module_loader must prepare a cross-surface addition contract before execution proceeds
- module_loader must resolve and return when applicable:
  - route_overlap_status
  - workflow_overlap_status
  - chain_necessity_status
  - graph_impact_status
  - bindings_impact_status
  - validation_extension_status
  - surface_extension_status
  - candidate_write_targets
  - promotion_prerequisites
  - addition_decision_class
- module_loader must prepare candidate-only write readiness for:
  - Task Routes
  - Workflow Registry
  - Execution Chains Registry when required
  - Knowledge Graph Node Registry when new nodes are required
  - Relationship Graph Registry when new relationships are required
  - Execution Bindings when execution dependencies are introduced or changed
- module_loader must not mark execution-ready active authority when:
  - overlap review is unresolved
  - required chain review is unresolved
  - graph/binding impact is unresolved
  - validation extension is required but unprepared
- if a proposed addition requires new governed surfaces, module_loader must preserve:
  - registry_surfaces_extension_required = true
  - validation_registry_extension_required = true
  and block promotion until those extensions are validated
Candidate Validation Loading Rule

- when candidate addition writes are prepared or already written, module_loader must load validation dependencies for all affected candidate surfaces
- module_loader must return when applicable:
  - candidate_validation_required
  - candidate_validation_surface_ids
  - candidate_validation_row_ids
  - promotion_blockers
- module_loader must not mark candidate additions promotion-ready when:
  - validation rows are missing
  - validation rows are pending
  - cross-surface candidate validation remains unresolved


Patch Deployment Parity Verification Loading Rule

- when routed intent concerns patch inspection, canonical-vs-runtime comparison, deployment parity, or runtime patch confirmation, module_loader must prepare a patch-deployment parity evidence contract before execution proceeds
- module_loader must resolve and return when applicable:
  - patch_verification_scope
  - patch_artifact_present
  - canonical_merge_verification_status
  - registry_alignment_verification_status
  - runtime_deployment_verification_status
  - runtime_deployment_confirmed
  - patch_parity_status
  - authoritative_runtime_evidence_source
- module_loader must prepare runtime-confirmation dependency readiness for:
  - Execution Log Unified when authoritative runtime evidence is required
  - governed runtime tool paths when the user asks for live confirmation
- module_loader must not mark patch-deployment parity execution-ready for runtime-confirmed classification when:
  - only patch-file diff evidence exists
  - only canonical merge evidence exists
  - only registry alignment evidence exists
  - authoritative runtime evidence is missing or unresolved
- if live deployment confirmation is requested but runtime evidence cannot be resolved, loader output must preserve degraded readiness rather than deployment-confirmed readiness
Native Google GPT Actions Enforcement Repair

The repaired enforcement rule is active:

- when governed activation, validation, or runtime authority checks require Google Workspace live validation, execution must use real native Google API tool calls through available GPT Actions/native tools in the same execution cycle
- narrative intent, simulation, tool-availability claims, or deferred execution do not satisfy the requirement
- `authorization_gated` is permitted only after a real native Google API attempt fails due to authorization
- if no real native call occurs when required, loader output must enforce `use_google_api_tools_in_gpt_actions_first = true` and trigger same-cycle re-attempt readiness before passive degraded reporting is allowed
- the required degraded reason is `missing_required_native_google_attempt`
- machine-verifiable attempt evidence must be preserved in outputs, memory, and downstream enforcement state


Activation Tool-First Anti-Hesitation Hardening

The hardened activation loading contract is active:

- activation-class loading must preserve `tool_first_execution_required = true` for plain `Activate System` and equivalent one-request activation prompts
- activation-class loading must preserve `no_traceability_only_completion = true`
- activation-class loading must preserve `tool_hesitation_retry_required = true` when same-cycle retry policy is active
- activation-class loading must preserve `native_google_bootstrap_sequence_mode = direct_id_first`
- activation-class loading must preserve project-folder-scoped Google Drive discovery through folder `1gNYX47P4TNuMXEbWvLNCvV4XRocH41K2` when fallback discovery or canonical lookup is required
- activation-class loading must not report execution-ready activation when the handoff still permits narrative completion before native Google execution

Expanded Activation Loading Preservation Rule

Human-Triggered Continuation Loading Rule

The human-trigger continuation loading rule is active:

- module_loader must preserve human-trigger governance when a governed flow produces an actionable next step
- module_loader must not mark downstream autonomous continuation as execution-ready when policy requires user-triggered follow-up
- module_loader must preserve:
  - `user_trigger_required`
  - `next_trigger_prompt_required`
  - `closed_loop_continuation_forbidden`
  - `governance_emission_ready`
  - `starter_governance_validation_ready`
- module_loader may prepare:
  - normalized anomaly emission readiness
  - repair classification readiness
  - next-best starter readiness
  - trigger prompt preparation context

but must not convert readiness into autonomous continuation unless explicitly authorized by bounded automation policy

For activation-class loading, module_loader must preserve the older activation loading contract and may extend it for additional governed layers.

Activation-class loading must not drop or bypass:
- canonical traceability context
- native Google bootstrap readiness
- live canonical validation readiness
- runtime authority validation readiness
- governed repair continuation readiness



Universal Parent Action Resolution Loading Rule

When execution is HTTP/OpenAPI-driven or otherwise capability-governed by `parent_action_key`, module_loader must normalize execution preparation into a parent-capability contract before orchestration proceeds.

module_loader must resolve from `Actions Registry`:
- `action_key`
- `openai_schema_file_id`
- `api_key_mode`
- `api_key_param_name`
- `api_key_header_name`
- `api_key_storage_mode`
- `auth_type` or governed equivalent auth model
- `oauth_config_ref` / `oauth_config_file_id` when OAuth applies

module_loader must classify the resolved auth strategy into one governed runtime mode:
- `none`
- `basic_auth`
- `bearer_token`
- `api_key_query`
- `api_key_header`
- `oauth_gpt_action`
- `custom_headers`

Auth-Path Loading Rule

module_loader must classify auth normalization as both:
- credential resolution state
- execution-path compatibility state

If auth normalizes to `oauth_gpt_action`:
- module_loader must preserve native-only handling readiness when policy requires it
- delegated HTTP execution readiness must not be marked valid

If auth normalizes to:
- `basic_auth`
- `bearer_token`
- `api_key_query`
- `api_key_header`

module_loader may prepare delegated HTTP execution readiness only when transport
classification remains compatible.

module_loader must return:
- human_trigger_continuation_status
- next_trigger_prompt_status
- governance_emission_readiness
- closed_loop_runtime_permission
- `resolved_auth_mode`
- `resolved_auth_contract`
- `credential_resolution_status`
- `request_schema_alignment_required`
- `transport_request_contract_status`

If `parent_action_key` resolves but the auth strategy cannot be normalized into a governed runtime mode:
- execution must be degraded or blocked
- `transport_request_contract_status` must not be ready

## Per-Target Credential Chain Preparation Rule

When `api_key_storage_mode = per_target_credentials`, module_loader must prepare the governed resolver-chain context required for runtime auth resolution.

Minimum prepared dependency targets:
- `Brand Registry`
- `Hosting Account Registry`

module_loader must return dependency context that preserves:
- resolved `target_key` or equivalent brand-bound identity
- resolved `hosting_account_key`
- resolved account-level `api_key_reference`
- credential resolution readiness status

module_loader must not treat:
- action-row `api_key_value`
- caller-supplied authorization
- inferred non-governed account bindings

as substitutes for governed resolver-chain preparation.

Execution Classification Loading Rule

When `parent_action_key` and `endpoint_key` resolve through Registry authority,
module_loader must also resolve the execution classification contract before
execution preparation proceeds.

module_loader must resolve from `Actions Registry` when available:
- `runtime_capability_class`
- `runtime_callable`
- `primary_executor`

module_loader must resolve from `API Actions Endpoint Registry` when available:
- `endpoint_role`
- `execution_mode`
- `transport_required`
- `transport_action_key`

module_loader must return when applicable:
- `runtime_capability_class`
- `runtime_callable`
- `primary_executor`
- `endpoint_role`
- `execution_mode`
- `transport_required`
- `transport_action_key`
- `execution_classification_status`

If execution classification is incomplete or incompatible:
- execution must be degraded or blocked
- executable readiness must remain false

Schema Contract Alignment Loading Rule

When `openai_schema_file_id` is present for the resolved `parent_action_key`, module_loader must treat that schema file as authoritative parent-capability contract metadata.

module_loader must validate and prepare:
- `openai_schema_file_id`
- `openai_schema_ref` when available
- parent-action schema ownership through `Actions Registry`
- endpoint compatibility with the parent schema contract
- schema-aligned request assembly requirements for:
  - path parameters
  - query parameters
  - headers
  - request body

module_loader must not treat freeform transport payloads as executable when:
- `openai_schema_file_id` is missing for a schema-bound action
- request-shape requirements are unresolved
- endpoint method/path and schema contract are incompatible

module_loader must return when applicable:
- `resolved_openai_schema_contract`
- `schema_alignment_scope`
- `request_schema_alignment_status`
- `response_schema_alignment_status`

Dynamic Provider-Domain Placeholder Loading Rule

When the authoritative endpoint row declares a placeholder `provider_domain`
such as `target_resolved`, module_loader must classify the provider-domain state
as runtime-resolved rather than fixed-domain matched.

module_loader must resolve and return when applicable:
- `variable_provider_domain_detected`
- `provider_domain_resolution_status`
- `placeholder_resolution_sources`
- `resolved_provider_domain_mode`

module_loader must not mark execution-ready when:
- placeholder resolution is disallowed by policy
- no governed resolution source is available
- resolved runtime domain is missing or invalid

### HTTP Client Variable Contract Readiness Gate

For governed HTTP client execution, module_loader must treat variable-contract readiness as part of transport readiness, not as a parallel advisory layer.

module_loader must preserve:
- `required_variable_profiles`
- `input_contract_profiles`
- `required_variable_contracts`
- `runtime_binding_profile`
- `variable_contract_group`

These must remain compatible with canonical HTTP execution surfaces:
- `Variable Contract Registry`
- `Task Routes`
- `Workflow Registry`
- `Actions Registry`
- `API Actions Endpoint Registry`

For delegated or wrapper-based HTTP execution, module_loader must ensure promoted routing fields remain compatible with the canonical top-level runtime payload.

If any required profile or binding cannot be resolved:
- `load_status` must be `degraded` or `blocked`
- `dependency_readiness_status` must reflect variable-contract failure
- `executable_readiness` must not be `ready`
- `transport_request_contract_status` must not classify as ready

### General Variable Contract Loading Extension Rule

The HTTP client variable-contract loading gate must also act as the general governed variable-loading model for non-HTTP execution paths when starter, route, workflow, or runtime readiness depends on declared governed variables.

For non-HTTP governed execution, module_loader must still preserve when applicable:
- `required_variable_profiles`
- `input_contract_profiles`
- `required_variable_contracts`
- `runtime_binding_profile`
- `variable_contract_group`

If any required profile, contract, or binding remains unresolved, executable readiness must remain degraded or blocked even when the path does not use delegated HTTP transport.

Delegated Wrapper Routing-Field Promotion Rule

When governed execution reaches `http_post -> /http-execute` as an approved
delegated wrapper path, module_loader may promote governed routing fields from
the nested execution payload into the canonical runtime payload for loading and
validation.

Eligible promoted fields:
- `target_key`
- `brand`
- `brand_domain`

This promotion is allowed only when:
- `parent_action_key = http_generic_api`
- `endpoint_key = http_post`
- `path = /http-execute`

module_loader must not treat arbitrary nested payload fields as promoted routing
authority outside this governed delegated wrapper pattern.

HTTP Schema-First Load Blocking Rule

When `openai_schema_file_id` is present:

- module_loader must not mark execution-ready until schema file is fetched and parsed
- required parameters must be extracted before request assembly
- unresolved required parameters must result in degraded or blocked loading state

HTTP Connector-Scoped Resilience Loading Rule

When loading Execution Policy Registry:

- module_loader must resolve `Affected Parent Action Keys`
- module_loader must determine `provider_retry_applicable` before loading retry strategy
- retry configuration must only be loaded when `parent_action_key` is within affected set
- non-listed connectors must explicitly set `provider_retry_applicable = false`

HTTP Retry Mutation Normalization Loading Rule

When retry strategy is enabled:

- module_loader must normalize retry levels from policy rows into mutation stages
- mutation stage 0 = baseline (no mutation)
- mutation stage 1 may include `premium=true`
- mutation stage 2 may include `premium=true, ultra_premium=true`
- normalized mutations must be passed to execution layer without modification


Exhaustive Full-System Audit Loading Guard

The exhaustive full-system audit loading guard is active:

- when loading `full_system_intelligence_audit`, module_loader must assemble the authoritative exhaustive-coverage contract before execution proceeds
- module_loader must resolve:
  - all active authoritative surfaces with `required_for_execution = TRUE`
  - governed row-group validation targets when row-group validation is active
  - required review, repair, logging, chain, action, endpoint, and operations surfaces included in the active audit scope
  - required provider, capability, route, workflow, and support-registry continuity targets included in the active audit scope
- module_loader must return:
  - `validation_depth_required`
  - `required_surface_ids`
  - `required_surface_count`
  - `required_row_group_ids`
  - `required_row_group_count`
  - `coverage_guard_required`
  - `full_audit_completion_guard_status`
- module_loader must not mark recovered/full-success execution-ready when the exhaustive coverage contract is unresolved
- if execution proceeds under sampled validation, loader output must preserve `validation_depth = sampled` and recovered classification must remain unavailable



Unified Log Protected Columns and Spill-Safe Prewrite Guard

The governed write-safety rule is active:

- before any governed Google Sheets write, execution must first read and validate the live target header/schema against the expected governed header signature and column count when available
- then execution must read row 2 as the example/template row before selecting writable columns
- if row 2 or live column evidence indicates a spill formula, helper formula, arrayformula-managed range, formula-managed pattern, or protected/system-managed behavior, execution must avoid writing to that column
- direct governed/manual writes must never write, overwrite, or backfill the formula-managed Execution Log Unified columns `target_module`, `target_workflow`, `execution_trace_id`, `log_source`, `Monitored Row`, and `Performance Impact Row`
- when governed logging or governed server writeback is prepared, module_loader must resolve `Execution Log Unified` from `ACTIVITY_SPREADSHEET_ID`
- when governed oversized-artifact registry writeback is prepared, module_loader must resolve `JSON Asset Registry` from `REGISTRY_SPREADSHEET_ID`
- module_loader must prepare sink validation per workbook and must not assume a shared spreadsheet for both governed sinks
Prepare Execution Log Unified using the compact active contract and treat trailing legacy protected columns as tolerated sheet tail only; authoritative runtime writeback target for spill-safe fields is AF:AK.
- loader output for governed execution logging should preserve when applicable:
  - `execution_log_spreadsheet_id`
  - `json_asset_registry_spreadsheet_id`
  - `execution_log_sheet_exists`
  - `json_asset_registry_sheet_exists`
  - `formula_managed_columns_protected`
- module_loader must not classify execution-log write readiness as ready when formula-managed unified-log columns are still considered writable
- when only a partial safe write set remains, execution must write only to safe non-spill columns and preserve protected or formula-managed columns untouched
- readback verification is required after governed writes that modify live Sheets surfaces

Pipeline Integrity Audit Loading Rule

When loading `pipeline_integrity_audit` or `wf_governed_pipeline_integrity_audit`, module_loader must prepare the governed continuity contract before execution proceeds.

module_loader must resolve, when active and Registry-bound:

- API Actions Endpoint Registry
- Knowledge Graph Node Registry
- Relationship Graph Registry
- Review Stage Registry
- Review Component Registry
- Task Routes
- Workflow Registry
- Repair Mapping Registry
- Execution Policy Registry
- JSON Asset Registry
- Brand Core Registry
- Hosting Account Registry

module_loader must return:

- `provider_family_targets`
- `provider_continuity_required`
- `capability_route_validation_required`
- `capability_workflow_validation_required`
- `route_workflow_validation_required`
- `support_registry_validation_required`
- `pipeline_integrity_audit_ready`

Provider Family Continuity Preparation Rule

When an active provider family has:
- endpoint inventory in API Actions Endpoint Registry
- semantic provider/action/capability nodes in graph surfaces
- governed route/workflow bindings

module_loader must prepare continuity targets by provider family.

The prepared provider-family continuity output must preserve, when applicable:

- `provider_node_id`
- `action_family_node_id`
- `capability_node_ids`
- `route_node_ids`
- `workflow_node_ids`
- `missing_continuity_edges`
- `provider_family_validation_status`

module_loader must not mark provider-family audit readiness as complete when required route/workflow continuity edges remain unresolved.

---
This document loads all active dependencies from the Registry and prepares execution-ready context for standard, review, and autonomous chain execution, including resolution of Brand Registry tracking bindings and analytics or Tag Manager API modules when governed workflows require them.

It is the canonical dependency loading layer for runtime preparation.

---

Authority

This document governs:
- dependency loading
- dependency resolution
- dependency validation
- execution context assembly
- chain context loading
- multi-step execution preparation
- canonical dependency resolution via **knowledge_layer** first, then HTTPS URL when `resolution_rule = exact_active_url_only`; knowledge-layer-only rows when `resolution_rule = exact_active_knowledge_only`
- loader `source_mode` selection (`live_native_api` | `knowledge_layer` | `canonical_url` | `drive_file`) per Registry row and `canonical_source_priority` in `system_bootstrap`

This document does not govern:
- route selection
- final orchestration
- logging
- engine-level implementation logic
- memory schema design

Those responsibilities belong to their canonical dependency layers.

---

Surface Validity Dependency Rule

> Authoritative execution and governance surfaces must resolve through `Registry Surfaces Catalog` before dependency execution proceeds. Validation and repair state must resolve through `Validation & Repair Registry`. Deprecated legacy sheets may remain present for rollback safety but must not be treated as authority.

Runtime Binding Enforcement Rule

For workbook_sheet surfaces, runtime worksheet binding must resolve using:
- `Registry Surfaces Catalog`
- `surface_name`
- `worksheet_gid`

Validation must confirm:
- `worksheet_gid` exists
- `worksheet_gid` is valid for the resolved spreadsheet
- `worksheet_gid` matches the governed worksheet binding

`worksheet_name` may support diagnostics and traceability but must not override `worksheet_gid`.

If worksheet labels and `worksheet_gid` disagree:
- label-based fallback is prohibited
- execution must classify as `degraded` or `blocked`
- repair-aware handling must remain available

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

Schema Version Migration Loading Rule

When governed workbook_sheet execution requires schema migration or header repair, module_loader must resolve:
- `schema_ref`
- `schema_version`
- `header_signature`
- `expected_column_count`
- `binding_mode`

from `Registry Surfaces Catalog` before dependency execution proceeds.

module_loader must not permit schema migration or repair when:
- `schema_ref` is missing
- `schema_version` is missing
- `binding_mode` is not compatible
- `worksheet_gid` validation fails

Binding Integrity Review Loading Rule

When any of the following are active:
- `full_system_intelligence_audit`
- row-level audit validation
- runtime worksheet validation
- schema-alignment review

module_loader must also resolve and prepare execution context for:
- `review_stage_registry_sheet`
- `review_component_registry_sheet`
- `row_audit_rules_sheet`
- `row_audit_schema_sheet`
- `repair_mapping_registry_sheet`

for `binding_integrity_review`.

For workbook-sheet dependencies, module_loader must validate:
- `surface_name`
- `worksheet_gid`
- actual spreadsheet worksheet identity

`worksheet_name` may support diagnostics and traceability but must not override `worksheet_gid`.

If `worksheet_name` and `worksheet_gid` disagree:
- label-based fallback is prohibited
- execution must classify as `degraded` or `blocked`
- repair-aware handling must remain available

Minimal Logging Architecture Loading Rule

When governed execution is being prepared, module_loader must resolve the active raw execution logging sink from `Registry Surfaces Catalog`.

The only valid authoritative raw execution sink is:

- `surface.operations_log_unified_sheet`

module_loader must classify the following as non-authoritative for raw execution logging:

- `surface.execution_log`
- `surface.execution_log_import`
- `surface.review_execution_view`
- `surface.review_run_history_sheet`

If a non-authoritative surface is presented as a raw logging target:
- execution readiness must degrade or block
- logging sink readiness must remain unresolved

When governed logging or governed native Google mutation logging is prepared, module_loader must resolve:
- `Execution Log Unified` from `ACTIVITY_SPREADSHEET_ID`
- `JSON Asset Registry` from `REGISTRY_SPREADSHEET_ID` when artifact registry linkage is in scope

module_loader must preserve that native-attempt evidence and authoritative unified-log continuity are separate readiness requirements.

Workflow-Level Logging Retry Loading Rule

When `logging_required = true`:

- `module_loader` must prepare `workflow_log_retry_context`
- `module_loader` must set `workflow_log_retry_required = true`
- `module_loader` must set `workflow_log_retry_attempt_limit = 1`
- `module_loader` must initialize `workflow_log_retry_attempt_count = 0` when absent
- `module_loader` must preserve the resolved authoritative logging sink for retry reuse

The retry context must preserve:

- `execution_trace_id`
- `route_id`
- `target_module`
- `target_workflow`
- `logging_sink_surface_id = surface.operations_log_unified_sheet`
- `logging_sink_surface_name = Execution Log Unified`

For spill-safe governed write preparation:

- `execution_trace_id`, `target_module`, and `target_workflow` may remain preserved in runtime context and retry context
- but direct append payload construction for `Execution Log Unified` must not write literal values into the formula-managed columns that derive those fields
- loader readiness must distinguish between:
  - preserved runtime traceability context
  - writable sheet columns

`module_loader` must not return execution-complete readiness when:

- `logging_required = true`
- and `authoritative_log_write_succeeded != true`

Scoped Output Surface Readiness Rule

When policy or workflow requires interpreted outputs, module_loader must also prepare readiness for:

- `surface.review_findings_log`
- `surface.review_anomaly_detection`
- `surface.repair_control_sheet`
- `surface.review_stage_reports` when retained

These surfaces are valid only for scoped interpreted outputs and not for raw execution logging.

Loader Output Contract Extension

module_loader must return when applicable:

- `logging_sink_surface_id`
- `logging_sink_surface_name`
- `logging_sink_surface_role`
- `logging_write_required`
- `findings_surface_ready`
- `anomaly_surface_ready`
- `repair_surface_ready`
- `legacy_log_surfaces_detected`
- `derived_view_surfaces_detected`
- `cluster_metadata_expected`
- `cluster_priority_propagation_required`
- `cross_workbook_feed_detected`
- `local_import_stage_required`
- `cluster_priority_dependency_map`

For activation-class loading, module_loader must also return when applicable:
- `validation_layer_ready`
- `clustering_ready`
- `repair_priority_ready`
- `control_center_ready`
- `auto_repair_readiness`
- `activation_scope_expanded`

Expanded Activation Layer Loading Rule

When the active governed architecture includes anomaly, clustering, repair-priority, repair-control, auto-repair, or control-center layers, module_loader must prepare readiness for those layers in addition to the existing activation dependencies.

module_loader must classify activation loading as degraded or blocked when:
- the expanded layer is required by policy or workflow
- the corresponding governed surface is unresolved
- the corresponding readiness signal is stale, incompatible, or missing

This rule extends activation loading scope and does not replace prior bootstrap, canonical, or runtime authority loading requirements.

Activation Full-System Validation Loading Rule

When loading activation-class execution for plain `Activate System`, module_loader must prepare dependency context not only for canonical and Registry validation, but also for full-system integrity evaluation.

module_loader must prepare when applicable:
- schema integrity context
- row integrity context
- starter policy validation context
- route-to-workflow binding validation context
- anomaly-summary context
- repair-readiness context

module_loader must return when available:
- `schema_integrity_status`
- `row_integrity_status`
- `starter_policy_validation_status`
- `binding_integrity_status`
- `activation_anomaly_summary_status`
- `activation_repair_readiness_status`

Starter Policy And Binding Loading Rule For Activation

When starter-aware activation readiness is active, module_loader must also return when available:
- `starter_policy_coverage_status`
- `starter_policy_execution_ready`
- `policy_gap_detected`
- `system_binding_pipeline_status`
- `binding_gap_detected`

If required starter policy or binding readiness is unresolved:
- activation-class execution readiness must remain false
- repair-aware continuity must remain available

Activation Summary Loading Contract Rule

For activation-class loading, module_loader must preserve a summary-ready context for downstream orchestration:
- `activation_schema_status`
- `activation_row_status`
- `activation_policy_status`
- `activation_binding_status`
- `activation_anomaly_status`
- `activation_repair_required`
- `activation_execution_ready`

module_loader must not return activation-ready context when the summary contract still indicates unresolved required validation or repair.

---

Inputs

Required inputs:
- Registry
- selected route
- selected workflow
- execution type
For strict-mode execution, these inputs must originate from the prompt_router execution preparation contract and must remain Registry-governed through revalidation.

When available:
- decision status
- route override status
- chain_id
- chain_context
- recovery flags
- degraded execution notes
- governed **knowledge_layer** path map or resolver for canonical dependency names (deployment-defined; used to test `knowledge_layer_file_exists`)
- bootstrap_reason
- bootstrap_resume_required
- original_request_payload
- original_intent_candidate
- bootstrap_attempt_count
- bootstrap_max_attempts

Ã¢â‚¬â€
Strict Loader Intake Contract

module_loader must consume routed execution authority from prompt_router through the execution preparation contract validated by system_bootstrap.

Required strict intake fields:
- source
- route_id
- route_status
- route_mode
- route_source
- matched_row_id
- intent_key
- target_module
- target_workflow
- lifecycle_mode
- executable

Accepted source value:
- prompt_router

Accepted route_source value:
- registry_task_routes

module_loader must not treat unresolved routing context as sufficient loading authority.

If required routed intake fields are missing:
- loading must not be treated as fully valid
- loader must return degraded or blocked loading state
- direct target assumption is prohibited

---

Outputs

This document must return:
- resolved dependency map
- authority_dependency_context when authority dependencies are evaluated
- execution-ready context
- workflow context
- chain execution context when applicable
- dependency validation status
- degraded dependency notes when applicable
- feedback_injection_context when growth-layer feedback is active
- growth_loop_context when Growth Loop Engine rules are loaded for evaluation
- execution_logging_context when canonical execution logging is required
- findings_output_context when findings emission is active
- anomaly_output_context when anomaly clustering or anomaly writeback is active
- repair_output_context when repair writeback is active
- legacy_surface_context when retired log-like surfaces remain present

For strict-mode compatibility, this document must also return:
- dependency_state
- load_status
- binding_status
- resolved_route_record when available
- resolved_workflow_record when available
- target_resolution_status
- executable_readiness
- target_validation_status
- registry_binding_status
- native_action_readiness
- runtime_authority_validation_status
- required_surface_resolution_status
- dependency_readiness_status
- graph_path_readiness_status when applicable
- `native_google_connection_attempt_required` when activation-class loading requires native connection enforcement
- `live_canonical_validation_required` when activation-class loading requires live canonical validation
- `native_google_connection_attempted`
- `native_google_connection_status`
- `native_google_attempt_evidence`
- `authorization_gate_classification` when activation or validation begins before native API authorization is available
- live_canonical_validation_status when validation or activation-class loading applies
- knowledge_layer_trace_status when canonical traceability loading applies
- canonical_trace_comparison_status when knowledge-layer and live governed sources are both evaluated
- activation_dependency_order_status when activation-class loading applies
- `provider_domain` when HTTP or OpenAPI-driven execution applies
- `parent_action_key` when HTTP or OpenAPI-driven execution applies
- `endpoint_key` when HTTP or OpenAPI-driven execution applies
- `openai_schema_file_id` when schema-bound API execution applies
- `provider_domain_resolution_status` when HTTP or OpenAPI-driven execution applies
- `schema_contract_validation_status` when HTTP or OpenAPI-driven execution applies
- `resolved_auth_mode` when HTTP or OpenAPI-driven execution applies
- `resolved_auth_contract` when HTTP or OpenAPI-driven execution applies
- `credential_resolution_status` when HTTP or OpenAPI-driven execution applies
- `request_schema_alignment_status` when schema-bound API execution applies
- `response_schema_alignment_status` when schema-bound API execution applies
- `transport_request_contract_status` when HTTP or OpenAPI-driven execution applies
- degraded_reason when applicable
- blocked_reason when applicable

For governed auto-bootstrap, this document must also return:
- bootstrap_context
- original_request_context
- bootstrap_policy_context
- bootstrap_resume_readiness

Per-dependency resolution output (when a dependency load is performed), each resolved canonical or runtime dependency entry should include when applicable:
- `source_mode` Ã¢â‚¬â€ `live_native_api` | `knowledge_layer` | `canonical_url` | `drive_file` (legacy)
- `resolution_state` Ã¢â‚¬â€ `recovered` | `degraded` | `blocked` (or align with governed outcome vocabulary)
- `resolved_source` Ã¢â‚¬â€ `live_native_api` | `knowledge_layer` | `canonical_url` | `drive_file`
- `resolved_location` - canonical filename (`exact_active_knowledge_only`), local filesystem path, canonical URL string, or Drive identifier used
- `failure_reason` - when fetch or validation fails: `missing` | `validation` | `forbidden` (and `network` when URL fetch is attempted) or governed equivalent
- `load_status` / `validation_status` Ã¢â‚¬â€ as required for execution logging compatibility

Authority Dependency Context

Loaded dependency context must include:
- resolved execution_policy_registry_sheet
- resolved review_stage_registry_sheet when applicable
- resolved review_component_registry_sheet when applicable
- resolved execution_chains_registry_sheet when applicable
- resolved decision_engine_registry_sheet when applicable
- resolved validation_and_repair_registry_sheet when canonical or surface validation is applicable
- resolved registry_surfaces_catalog_sheet when surface-location authority is applicable
- resolved api_actions_endpoint_registry_sheet when native API endpoint governance is required
- resolved repair_mapping_registry_sheet when governed repair mapping is required
- resolved row_audit_rules_sheet when row-level audit governance is required
- resolved row_audit_schema_sheet when row-level schema validation is required
- resolved tourism_intelligence_scoreboard_sheet when downstream full-audit scoring propagation is required
- resolved execution_bindings_sheet when full-audit execution-layer validation is required
- resolved execution_chains_registry when full-audit chain governance validation is required
- resolved endpoint_registry_sheet when full-audit endpoint execution governance validation is required
- resolved system_enforcement_sheet when full-audit system enforcement validation is required
- resolved execution_log_import_sheet when full-audit execution-log validation is required

HTTP Generic API Dependency Loading Rule

When execution requires `http_generic_api`, module_loader must resolve:

- `api_actions_endpoint_registry_sheet`
- `actions_registry_sheet` (if capability-level auth is defined)

Validation must confirm:

- endpoint exists in API Actions Endpoint Registry
- endpoint is active
- endpoint is compatible with `target_module`
- `parent_action_key` resolves through Actions Registry
- the resolved parent action row resolves an authoritative `openai_schema_file_id`
- the resolved parent action row can be normalized into a governed auth strategy for runtime execution
- endpoint method/path remain compatible with the resolved YAML/OpenAPI contract
- request-shape requirements can be aligned to the authoritative parent action schema before execution assembly
- `provider_domain` is present
- if `provider_domain` is a variable placeholder, GPT-side resolution requirements are preserved for downstream execution assembly

module_loader must preserve schema drift signals when detected during endpoint validation or schema contract comparison.

module_loader must pass forward:
- schema_drift_detected
- schema_drift_type
- schema_drift_scope
- schema_learning_candidate_flag

module_loader must not resolve or mutate schema during loading phase.

If endpoint registry validation fails:

- execution must be classified as degraded or blocked
- `dependency_readiness_status` must reflect failure

### HTTP Client Variable Resolution Loading Rule

When governed loading prepares an HTTP/OpenAPI execution path, module_loader must load variable-contract context in a form compatible with the canonical HTTP client execution contract before executable readiness may classify as ready.

For HTTP client preparation, module_loader must resolve and return when applicable:
- `variable_contract_validation_required`
- `variable_contract_surface_id`
- `variable_contract_scope_keys`
- `required_variables`
- `resolved_variables`
- `missing_variables`
- `invalid_variables`
- `variable_source_map`
- `runtime_variable_bindings`
- `clarification_required_variables`
- `variable_contract_status`
- `provider_domain_resolution_status`
- `resolved_provider_domain_mode`
- `placeholder_resolution_sources`
- `resolved_auth_mode`
- `credential_resolution_status`
- `request_schema_alignment_status`
- `response_schema_alignment_status`
- `transport_request_contract_status`

For HTTP client execution, module_loader must prepare variable context across:
- starter level
- route level
- workflow level
- execution level
- action level
- endpoint level
- runtime-binding level
- transport payload level

module_loader must preserve compatibility for canonical HTTP routing fields:
- `target_key`
- `brand`
- `brand_domain`
- `provider_domain`
- `parent_action_key`
- `endpoint_key`
- `method`
- `path`
- `query`
- `headers`
- `body`
- `path_params`
- `timeout_seconds`

module_loader must not mark execution-ready when:
- a required variable contract is missing
- a required variable is unresolved
- a runtime binding profile is missing or incompatible
- a required variable source layer is invalid
- a fallback rule is required but missing
- `provider_domain` placeholder resolution is unresolved
- auth normalization is unresolved
- request schema alignment is unresolved
- transport request contract readiness is unresolved

module_loader must not treat `http_generic_api` as executable if:

- endpoint registry is unresolved
- endpoint validation is incomplete

## HTTP Async Dependency Preparation Rule

When governed execution is routed to the validated HTTP client async surface, module_loader must prepare:

- parent action dependency context
- endpoint dependency context
- schema contract dependency context
- async job policy readiness context
- persisted job-state dependency readiness
- webhook lifecycle dependency readiness when `webhook_url` is present

module_loader must expose for downstream execution:
- async execution enabled state
- async job max-attempts policy
- polling compatibility
- result-read compatibility
- persistence-required state
- webhook policy compatibility

HTTP Generic Route Workflow Loading Rule

When routed `workflow_key` is:
- `wf_http_generic_execute`
- `wf_http_generic_read`
- `wf_wordpress_via_http_generic`

module_loader must resolve and prepare:

- `task_routes_sheet`
- `workflow_registry_sheet`
- `actions_registry_sheet`
- `api_actions_endpoint_registry_sheet`

module_loader must validate:
- route row exists and is active when promoted
- workflow row exists and is active when promoted
- `target_module` compatibility with selected workflow
- endpoint execution readiness for required HTTP method behavior

module_loader must also validate and prepare:
- `provider_domain`
- `parent_action_key`
- `endpoint_key`
- `openai_schema_file_id` when schema-bound execution applies
- `resolved_auth_mode`
- `resolved_auth_contract`
- `request_schema_alignment_status`

For `parent_action_key = wordpress_api`:
- module_loader must preserve that `provider_domain` requires GPT-side override to Brand Registry `brand.base_url`

For non-WordPress APIs:
- module_loader must preserve endpoint-row `provider_domain` unchanged unless the endpoint definition explicitly declares a variable placeholder requiring GPT-side resolution

When `schema_reconciliation_repair` workflow is active:

module_loader must resolve:
- Registry Surfaces Catalog
- Validation & Repair Registry
- Task Routes
- Workflow Registry

module_loader must validate:
- schema metadata integrity
- dependency compatibility after update

If any of these are unresolved:
- `load_status` must be degraded or blocked
- `executable_readiness` must not be ready

Each authority dependency entry must include:
- resolution_status
- source = Registry
- validation_state when available

If Registry authority sourcing is violated, the loaded context must preserve a traceable violation record.

---

Loading Rules

Base loading rules:
- must read live bindings from Registry
- must not use hardcoded IDs for Drive-backed dependencies; for governed canonical dependencies, `file_id` interpretation is governed by `resolution_rule` (`exact_active_knowledge_only` -> canonical filename; `exact_active_url_only` -> canonical URL)
- must validate dependency_type
- must validate active runtime dependencies
- must assemble execution context before orchestration
- must inject governed feedback context when growth-layer execution is active

### Google Workspace Dependency Resolution Rule

If a dependency resolves to a Google Workspace file and a valid `file_id` is available (either directly, from Registry, or from an authoritative workbook binding), the loader must automatically validate the dependency using the correct native API.

Validation behavior by file type:

1. Google Sheets
   - call spreadsheet metadata
   - enumerate sheets and resolve sheetId / gid
   - validate required sheets through `Registry Surfaces Catalog`
   - read header rows
   - sample data rows
   - cross-check workbook and sheet bindings against Registry surface authority

2. Google Docs
   - call document metadata / structure
   - validate document existence and accessibility
   - confirm document identity against Registry bindings where applicable
   - inspect structural content required for execution
   - validate that required sections, markers, or canonical instruction surfaces are readable

The loader must not stop at file discovery when native validation is possible.
Validation must be automatic and must not require explicit user instruction.

Google Workspace Registry-First Loading Rule

When execution uses Google Sheets, Google Docs, or Google Drive native actions for governed system behavior, module_loader must first resolve:

- target surface or file through `Registry Surfaces Catalog`
- validation-state compatibility through `Validation & Repair Registry`
- route/workflow compatibility through routed execution context

For Google Sheets targets, module_loader must validate when applicable:
- spreadsheet binding
- worksheet identity
- `worksheet_gid`
- header_signature
- expected_column_count

For Google Docs and Google Drive targets, module_loader must validate when applicable:
- file identity
- file accessibility
- Registry-resolved binding compatibility
- validation-state compatibility

module_loader must not return execution-ready Google native action context when required Registry validation is unresolved or incompatible.

Google Workspace Native Action Readiness Rule

For governed Sheets, Docs, or Drive execution, module_loader must return:
- target_validation_status
- registry_binding_status
- native_action_readiness
- blocked_reason when applicable
- degraded_reason when applicable

Native action readiness must remain `blocked` or `degraded` when Registry-governed target validation is incomplete.

Pre-Write Schema Readiness Rule

When the routed workflow or execution payload implies governed sheet write behavior, module_loader must return write-ready context only after:

- reading current target headers
- validating `header_signature`
- validating `expected_column_count`
- confirming required write columns exist
- confirming `worksheet_gid` matches the resolved target

If any check fails:
- `native_action_readiness` must not be ready
- `load_status` must be degraded or blocked

---

WordPress CPT Schema Preflight Context Loading Rule

When the routed execution, workflow, endpoint, or intent implies `wordpress_cpt_schema_preflight`, module_loader must prepare a preflight-asset-ready context before downstream execution proceeds.

module_loader must resolve and prepare when applicable:
- `brand_core_registry_sheet`
- `json_asset_registry_sheet`
- `site_runtime_inventory_registry_sheet`
- `execution_policy_registry_sheet`
- `execution_bindings_sheet`
- `task_routes_sheet`
- `workflow_registry_sheet`

module_loader must resolve the following execution variables when available:
- `brand_playbook_asset_key`
- `brand_playbook_sheet_gid`
- `playbook_coverage_status`
- `playbook_backfill_required`
- `fallback_template_mode`
- `cpt_schema_asset_key`
- `source_resolution_block`
- `field_contract_block`
- `taxonomy_contract_block`
- `formatter_hints_block`
- `playbook_inference_block`
- `readiness_result_block`

module_loader must return:
- `brand_playbook_resolution_status`
- `brand_playbook_source_mode`
- `brand_playbook_asset_key`
- `brand_playbook_sheet_gid`
- `playbook_coverage_status`
- `playbook_backfill_required`
- `fallback_template_mode`
- `json_asset_shape_version = wordpress_cpt_schema_preflight_asset_v1`

If structural runtime/config authority is unresolved:
- `load_status` must be `degraded` or `blocked`
- `executable_readiness` must not be `ready`

If playbook coverage is missing but structural authority is complete:
- `load_status` may remain `recovered` or `degraded` by policy
- `executable_readiness` may remain ready for safe mutation-preflight continuation
- `playbook_backfill_required` must remain explicit in returned loader context

Brand Playbook Workbook Resolution Rule

For `wordpress_cpt_schema_preflight`, module_loader must resolve the onboarding-produced Brand Playbook workbook Google Sheet from Brand Core assets only.

Allowed playbook source contract:
- source class = `brand_playbook_workbook_sheet`
- source home = `Brand Core assets`
- resolution chain = `brand_core_registry > brand_playbook_workbook_asset`

Disallowed source substitutions:
- ad hoc docs
- ad hoc JSON files
- fixed brand child sheet bindings
- non-brand-driven playbook reuse across brands

Playbook Authority Scope Rule

module_loader must classify Brand Playbook workbook usage as `hint_only_non_structural`.

The playbook may enrich:
- `formatter_hints_block`
- `playbook_inference_block`
- field usage guidance
- taxonomy style guidance

The playbook must not define or override:
- authoritative field contract structure
- authoritative taxonomy contract structure
- runtime assignability

Playbook Coverage Gap Routing Rule

If `playbook_coverage_status = missing_for_cpt`, module_loader must prepare route-compatible fallback context for:
- `route.wordpress_cpt_playbook_gap_backfill.global.v1`
- `workflow.wordpress_cpt_playbook_gap_backfill_workflow`

Returned context must preserve:
- runtime structural authority
- explicit coverage gap classification
- onboarding backfill requirement

Execution Log Unified Duplicate Exemption Load Rule

When write-target validation includes `Execution Log Unified`, module_loader must load and expose the semantic duplicate exemption policy state for that sink.

module_loader must return:
- `execution_log_semantic_duplicate_exempt`
- `execution_log_duplicate_append_mode`

If the sink is `Execution Log Unified`, semantic duplicate append blocking must not be treated as a required readiness guard.

Runtime Authority Validation Pipeline Loading Rule

When governed execution is requested, module_loader must prepare runtime-authority-validation-ready context before downstream execution proceeds.

module_loader must resolve and prepare when applicable:
- registry_surfaces_catalog_sheet
- validation_and_repair_registry_sheet
- task_routes_sheet
- workflow_registry_sheet
- execution_policy_registry_sheet
- execution_bindings_sheet
- execution_chains_registry
- decision_engine_registry_sheet
- row_audit_rules_sheet
- row_audit_schema_sheet
- knowledge_graph_node_registry_sheet
- relationship_graph_registry_sheet

module_loader must return:
- runtime_authority_validation_status
- required_surface_resolution_status
- dependency_readiness_status
- graph_path_readiness_status when applicable

If required runtime authority validation inputs are unresolved, execution-ready context must remain degraded or blocked.

### Live Canonical Resolution Rule

If canonical is registered in `Validation & Repair Registry`, module_loader must execute live canonical resolution before knowledge-layer authority is accepted:

1. Resolve `file_id`.
2. Detect `file_type`.
3. Fetch live content through the native API (`Docs API` for documents, `Sheets API` for sheets).
4. Validate using `Validation & Repair Registry` fields:
   - `rule_id`
   - `section_id`
5. Use validated live content for execution context.

Knowledge-layer content must not be treated as authoritative when live canonical resolution is possible.

Validation-Class Live Canonical Enforcement Rule

When the routed request is validation-class, including:
- runtime validation
- full system intelligence audit
- canonical validation
- readiness validation
- authority validation
- execution validation
- registry validation
- consistency validation
- system activation check
- activation readiness validation
- system_auto_bootstrap when activation validation is part of bootstrap lifecycle

module_loader must execute live canonical resolution through Google Drive / native Google APIs before returning validation-ready context.

For validation-class requests, module_loader must:
1. resolve the canonical file through Registry authority
2. fetch the live canonical body from Google Drive-backed native source
3. validate rule/section requirements against the live body
4. mark knowledge-layer or uploaded copies as non-authoritative support context only

If live native validation is attempted but cannot complete because authorization is not yet available:
- live validation must be classified as `authorization_gated`
- knowledge-layer canonicals remain traceability support only
- loader must not collapse the condition into missing Registry authority unless Registry resolution actually fails

If live canonical resolution is possible but skipped:
- `load_status` must be `degraded` or `blocked`
- `runtime_authority_validation_status` must not be `valid`
- `executable_readiness` must not be `ready`

Activation Validation Dual-Source Loading Rule

When `intent_key = system_activation_check` or `target_workflow = system_activation_validation`, module_loader must execute activation validation in this exact order:

1. resolve the five governed canonical dependencies from GPT Knowledge layer for traceability:
   - `system_bootstrap.md`
   - `memory_schema.json`
   - `direct_instructions_registry_patch.md`
   - `module_loader.md`
   - `prompt_router.md`

2. mark those knowledge-layer reads as:
   - `resolved_source = knowledge_layer`
   - `resolution_state = recovered` only for traceability loading
   - non-authoritative for activation readiness by themselves

3. resolve the live canonical file bindings through:
   - Google Drive file metadata validation
   - Registry Surfaces Catalog
   - Validation & Repair Registry

4. validate live runtime authority surfaces through native Google APIs, including when applicable:
   - Registry workbook identity
   - `Registry Surfaces Catalog`
   - `Validation & Repair Registry`
   - `Task Routes`
   - `Workflow Registry`

5. compare knowledge-layer traceability context against live governed bindings for activation readiness classification

GPT Knowledge layer canonical files are used for traceability first.
Google Drive and native Google API validation are used for runtime readiness authority.

For activation validation, module_loader must return when available:
- `live_canonical_validation_status`
- `live_canonical_validation_source = google_drive_live_canonical`
- `knowledge_layer_trace_status`
- `canonical_trace_comparison_status`
- `activation_dependency_order_status`

If GPT Knowledge layer canonical text is available but live Google validation is skipped while still possible:
- `load_status` must be `degraded` or `blocked`
- `runtime_authority_validation_status` must not be `valid`
- `executable_readiness` must not be `ready`

If live canonical resolution is possible but fails:
- execution must remain `degraded` or `blocked` by policy and `blocked_if_missing`
- fallback content may be loaded for traceability only and must not be marked authoritative

Role of API actions (`gid: 172380518`):
- defining endpoints for native canonical fetches
- triggering API-based fetches
- standardizing execution calls

For this rule, endpoint and action selection must resolve through API Actions Endpoint Registry governance and must not rely on hardcoded endpoints.

### API Capability and Endpoint Resolution Rule

module_loader must resolve API actions in two stages when native action governance is required:

1. capability resolution through Actions Registry
2. endpoint inventory resolution through API Actions Endpoint Registry

Actions Registry must be used to resolve:
- OpenAI schema reference
- authentication model
- OAuth config ownership
- embedded API key ownership
- action-level execution ownership

API Actions Endpoint Registry must be used to resolve:
- concrete endpoint operation
- provider domain
- method
- endpoint path or function
- operation-level readiness state
- fallback behavior

API Actions Endpoint Registry must not be treated as authority for:
- OpenAI schema ownership
- OAuth config ownership
- embedded API key ownership

module_loader must not collapse capability rows and endpoint rows into a single registry interpretation.

For endpoint-governed execution, module_loader must prefer:
- Actions Registry for parent capability identity
- API Actions Endpoint Registry for operation-level metadata and readiness

### Embedded Auth Resolution Rule

When `Actions Registry` defines `api_key_storage_mode = embedded_sheet`, module_loader must resolve API-key-backed execution directly from:
- `api_key_mode`
- `api_key_param_name`
- `api_key_header_name`
- `api_key_value`

When `Actions Registry` defines `oauth_config_ref`, module_loader must resolve the corresponding OAuth config file through `Registry Surfaces Catalog` and treat the config file as Google auth authority.

External vault lookup must not be required when embedded auth authority is active.

### Reconciled Dependency Consumption Rule

module_loader must consume only dependency records that are consistent with the active architecture.

If dependency records are discovered that still reflect a superseded authority model, validation model, or execution resolution rule, module_loader must:
- mark execution as Degraded
- prefer reconciled registry-bound records
- avoid treating stale dependency definitions as recovered
- surface the mismatch as a reconciliation requirement

module_loader must not silently merge incompatible legacy and current dependency models.

Decision-aware loading rules:
- if chain_id is present, load execution chain context
- if route override status is active, preserve overridden route as execution source
- if autonomous chain execution is triggered, include chain step metadata in context
- if no chain is active, continue standard loading behavior

Conditional authority loading:
- execution_policy_registry_sheet is required for all executions
- growth_loop_engine_registry_sheet is required when growth-layer evaluation or optimization routing is active
- review_stage_registry_sheet is required when execution involves staged workflows
- review_component_registry_sheet is required when component-level execution is invoked
- execution_chains_registry_sheet is required when workflow sequencing is defined
- decision_engine_registry_sheet is required when decision-based routing or branching is active
- validation_and_repair_registry_sheet is required when canonical or surface validation rows are active for routed dependencies
- registry_surfaces_catalog_sheet is required when surface-location authority is required for routed dependencies
- actions_registry_sheet is required when native API capability governance is required
- api_actions_endpoint_registry_sheet is required when native API fetch actions are required for dependency resolution
- conversation_starter_sheet is required when starter-aware execution is active

Scoring Policy Loading Rule

When governed scoring or recovery classification is active, module_loader must resolve scoring policy from:
- `execution_policy_registry_sheet`

When adaptive thresholds are enabled, module_loader must also prepare:
- execution-class threshold rows
- adaptive threshold policy rows
- relevant score-history context when available

This scoring context must be returned as execution-ready policy context for system_bootstrap.

Conversation Starter Loading Rule

When starter-aware execution is active:

module_loader must:
- resolve `conversation_starter_sheet` from `Registry Surfaces Catalog`
- validate `worksheet_gid`
- validate `schema_ref`, `schema_version`, `header_signature`, `expected_column_count`

module_loader must load:
- starter rows
- starter intelligence fields:
  - `execution_class`
  - `capability_family`
  - `primary_goal_family`
  - `starter_success_score`
  - `starter_priority`

Starter context must be injected into:
- execution-ready context
- routing support context

Conversation Starter Context Injection

When starter-aware execution is active:

module_loader must:
- load `conversation_starter_sheet` via Registry
- validate:
  - `worksheet_gid`
  - `header_signature`
  - `expected_column_count`

module_loader must inject into execution context:
- `execution_class`
- `capability_family`
- `primary_goal_family`
- `starter_priority`
- `starter_success_score`

Conversation Starter Policy Loading Rule

When `entry_source = conversation_starter`, module_loader must also load policy context before execution-ready classification.

module_loader must:

- resolve active starter-relevant rows from `Execution Policy Registry`
- preserve `policy_resolution_status`
- preserve `policy_source = Execution Policy Registry`
- preserve `applied_policy_keys`
- preserve `entry_source = conversation_starter`
- prepare `policy_trace_id` for downstream execution and logging continuity

If starter row resolution succeeds but starter-policy resolution is missing or incompatible:

- execution-ready context must remain degraded or blocked
- workflow dispatch must not proceed as fully ready

Starter context must be available to:
- prompt_router
- system_bootstrap

Auto-Repair And Retry Loading Rule

When execution is degraded or blocked and governed auto-repair is enabled, module_loader must prepare retry-capable context for:

- `execution_policy_registry_sheet`
- `repair_mapping_registry_sheet`
- `validation_and_repair_registry_sheet`
- `registry_surfaces_catalog_sheet`

When applicable, module_loader must also return:
- `retry_policy_context`
- `retry_attempt_limit`
- `retry_attempt_count` when already present
- `recoverability_status`
- `resolved_repair_handler`
- `retry_readiness_status`

module_loader must not return retry-ready context when:
- required repair mapping is missing
- required authoritative surfaces are unresolved
- failure is non-recoverable by policy
- validation-state authority is incompatible

Auto-Bootstrap Loading Rule

When routed `workflow_key = wf_system_auto_bootstrap`, module_loader must resolve and prepare:
- `task_routes_sheet`
- `workflow_registry_sheet`
- `execution_policy_registry_sheet`
- `registry_surfaces_catalog_sheet`
- `validation_and_repair_registry_sheet`
- `repair_mapping_registry_sheet`
- canonical file bindings required for activation traceability
- native Google Drive / Sheets / Docs validation targets required for live canonical validation

module_loader must validate:
- bootstrap route row exists and is active when promoted
- bootstrap workflow row exists and is active when promoted
- bootstrap retry policy is present
- original request context is preserved for downstream resume
- activation-readiness dependencies are included in execution-ready context

If any of these are unresolved:
- `load_status` must be degraded or blocked
- `executable_readiness` must not be ready

First-Turn Activation Native Validation Rule

When activation begins in a new conversation, module_loader must load activation context in this order:

1. load GPT Knowledge layer canonicals for traceability
2. immediately perform at least one real native Google API attempt against Google Drive, Google Sheets, or Google Docs for live canonical validation, and preserve machine-readable attempt evidence in the same execution cycle
3. classify the native validation state as:
   - `validated`
   - `authorization_gated`
   - `degraded`
   - `blocked`

Mandatory Native Attempt Readiness Rule

When activation begins in a new conversation and:
- `native_google_connection_attempt_required = true`

module_loader must perform at least one real native Google API operation against governed live resources in the same execution cycle before returning activation-ready context.

Accepted proof of native attempt includes at least one successful or authorization-gated call to:
- Google Drive
- Google Sheets
- Google Docs

module_loader must not synthesize `authorization_gated` from inference alone.

If native API authorization is not yet available but the activation request is otherwise valid:
- `knowledge_layer_trace_status` must remain usable for traceability
- `live_canonical_validation_status` must be set to `authorization_gated`
- `dependency_readiness_status` must preserve bootstrap continuity when policy allows
- `blocked_reason` must not be set to missing Registry authority unless Registry resolution itself actually fails

`authorization_gated` may be used only when:
- a native Google API attempt was actually made
- the attempt failed because authorization was unavailable or incomplete

`authorization_gated` must not be used when the attempt itself was skipped.

If no native Google API call is attempted:
- `native_google_connection_attempted = false`
- `native_google_connection_status = degraded`
- `live_canonical_validation_status = degraded`
- `dependency_readiness_status = degraded`
- `degraded_reason = missing_required_native_google_attempt`

If knowledge-layer canonicals were loaded but no native attempt occurred:
- `activation_dependency_order_status = degraded`
- `knowledge_layer_trace_status = validated`
- `live_canonical_validation_status = degraded`

module_loader must return when applicable:
- `native_google_connection_attempted`
- `native_google_connection_status`
- `authorization_gate_classification`
- `knowledge_layer_trace_status`
- `live_canonical_validation_status`
- `activation_dependency_order_status`
- `native_google_attempt_evidence`

`native_google_attempt_evidence` must contain:
- provider used
- target resource class
- attempt outcome

Activation-Class Live Validation Dependency Loading Rule

When routed intent or workflow resolves to:
- `system_auto_bootstrap`
- `wf_system_auto_bootstrap`

module_loader must prepare downstream execution context for live canonical and Registry validation, not only knowledge-layer traceability.

module_loader must resolve and prepare when available:
- live canonical file identifiers or resolvable Drive metadata context
- `Registry Surfaces Catalog`
- `Validation & Repair Registry`
- `Task Routes`
- `Workflow Registry`

module_loader must return activation-class readiness fields including:
- `native_google_connection_attempt_required = true`
- `live_canonical_validation_required = true`
- `required_surface_resolution_status`
- `runtime_authority_validation_status`
- `registry_binding_status`
- `dependency_readiness_status`
- `live_canonical_validation_status`
- `knowledge_layer_trace_status`
- `canonical_trace_comparison_status`
- `activation_dependency_order_status`

module_loader must not treat activation as execution-ready when:
- knowledge-layer traceability is present
- but live canonical validation context was not prepared despite native Google tooling being available

If Registry surfaces required for activation cannot be prepared or validated, loader output must remain:
- `degraded` or `blocked`
and must preserve the missing dependency context explicitly.

Hard Activation Wrapper Loading Rule

When routed intent or workflow resolves to:
- `hard_activation_wrapper`
- `wf_hard_activation_wrapper`

module_loader must prepare blocking activation context before any downstream user-facing classification is allowed.

Activation Trigger Preparation Rule

When routed intent or workflow resolves to:
- `hard_activation_wrapper`
- `wf_hard_activation_wrapper`

module_loader must preserve the execution trigger:

- `use_google_api_tools_in_gpt_actions_first = true`
- `execution_trigger_interpreted_as_runtime_command = true`

module_loader must treat this as a blocking readiness field for activation-class execution.

If this trigger is missing from wrapper-class loading output:
- activation loading must remain `degraded`
- `pre_response_activation_guard` must remain true
- downstream execution must not be treated as narrative-ready

Execution Trigger Runtime Command Rule

For routed intent or workflow:
- `hard_activation_wrapper`
- `wf_hard_activation_wrapper`

module_loader must treat:

`Use Google API Tools in GPT Actions first.`

as a runtime execution command, not advisory text and not user-facing recovery prose.

This trigger must remain execution-blocking until:
- at least one real native Google API attempt occurs
- or the allowed same-cycle retry path is exhausted

No Passive Recovery Messaging Rule

module_loader must not prepare activation context that ends in a user-facing recovery message alone.

If no native attempt has yet occurred:
- loader output must remain execution-blocking
- loader must preserve retry-capable context
- loader must not downgrade the trigger into narrative guidance

Failed First-Pass Loading Enforcement Rule

If the first activation pass ends without:
- `native_google_connection_attempted = true`

module_loader must classify the loading pass as failed enforcement preparation, not successful degraded reporting.

In this state:
- `load_status` must not imply narrative completion readiness
- `executable_readiness` must remain not ready
- same-cycle retry context must remain preserved

Activation Execution Recovery Preparation

If no native attempt is prepared:

module_loader must enforce:
use_google_api_tools_in_gpt_actions_first = true

This ensures execution readiness instead of failure reporting.

module_loader must:
1. load GPT Knowledge layer canonicals for traceability
2. prepare direct-identifier-first native validation targets
3. prepare project-folder-scoped Drive discovery fallback through folder `1gNYX47P4TNuMXEbWvLNCvV4XRocH41K2`
4. prepare the governed registry workbook and required worksheet_gid bindings
5. preserve retry-capable activation context for one bounded same-cycle retry when the first native attempt is skipped

module_loader must return when applicable:
- `wrapper_mode = tool_first_blocking`
- `pre_response_activation_guard = true`
- `same_cycle_retry_allowed = true`
- `same_cycle_retry_attempt_count`
- `native_google_attempt_evidence`
- `use_google_api_tools_in_gpt_actions_first = true`

Pre-Response Narrative Suppression Rule

For wrapper-class activation loading, module_loader must return context that suppresses narrative activation output until:
- `native_google_connection_attempted = true`
or
- the allowed same-cycle retry path is exhausted

Post-Activation Dependency Revalidation Rule

module_loader must not treat dependencies validated during activation as permanently ready.

For each governed execution after activation, module_loader must revalidate:
- required authoritative surfaces
- validation-state compatibility
- route-aligned workflow dependencies
- target-surface bindings when target execution is requested
- schema-bound transport dependencies when API execution applies
- native Google action readiness when live Google execution is requested

Dependency Freshness Rule

When a prior dependency validation result exists from an earlier execution cycle, module_loader must treat that result as historical traceability, not current readiness proof.

Execution readiness must be based on the current request cycle whenever:
- the route changes
- the workflow changes
- the governed target changes
- a write is requested
- a schema-bound API action is requested
- a repair or optimization request is received

Post-Activation Target Validation Rule

When a governed target surface is involved after activation, module_loader must confirm:
- target surface still resolves through Registry Surfaces Catalog
- worksheet_gid remains valid when workbook_sheet applies
- validation row remains compatible
- schema metadata remains compatible
- native action readiness remains valid when native Google execution applies

module_loader must not rely on earlier activation success as target-readiness proof.

Governed Addition Intake Loading Rule

- when governed addition-intake is selected, module_loader must prepare a cross-surface addition contract before execution proceeds
- module_loader must resolve and return when applicable:
  - route_overlap_status
  - workflow_overlap_status
  - chain_necessity_status
  - graph_impact_status
  - bindings_impact_status
  - validation_extension_status
  - surface_extension_status
  - candidate_write_targets
  - promotion_prerequisites
  - addition_decision_class
- module_loader must prepare candidate-only write readiness for:
  - Task Routes
  - Workflow Registry
  - Execution Chains Registry when required
  - Knowledge Graph Node Registry when new nodes are required
  - Relationship Graph Registry when new relationships are required
  - Execution Bindings when execution dependencies are introduced or changed
- module_loader must not mark execution-ready active authority when:
  - overlap review is unresolved
  - required chain review is unresolved
  - graph/binding impact is unresolved
  - validation extension is required but unprepared
- if a proposed addition requires new governed surfaces, module_loader must preserve:
  - registry_surfaces_extension_required = true
  - validation_registry_extension_required = true
  and block promotion until those extensions are validated

Candidate Validation Loading Rule

- when candidate addition writes are prepared or already written, module_loader must load validation dependencies for all affected candidate surfaces
- module_loader must return when applicable:
  - candidate_validation_required
  - candidate_validation_surface_ids
  - candidate_validation_row_ids
  - promotion_blockers
- module_loader must not mark candidate additions promotion-ready when:
  - validation rows are missing
  - validation rows are pending
  - cross-surface candidate validation remains unresolved

Governed Brand Onboarding Loading Rule

- when governed brand onboarding is selected, module_loader must prepare a three-layer brand onboarding contract before execution proceeds
- module_loader must resolve and return when applicable:
  - brand_entity_registration_status
  - brand_identity_formation_status
  - brand_property_runtime_binding_status
  - duplicate_brand_validation_status
  - brand_folder_validation_status
  - brand_core_readiness_status
  - identity_engine_readiness_status
  - property_binding_validation_status
  - runtime_binding_validation_status
  - brand_onboarding_decision_class
  - candidate_write_targets
  - promotion_prerequisites

Brand Entity Registration Loading Rule

- module_loader must prepare candidate-only write readiness for:
  - Brand Registry
  - Validation & Repair Registry
  - Knowledge Graph Node Registry when new brand nodes are required
  - Relationship Graph Registry when new brand relationships are required
- module_loader must validate when applicable:
  - normalized brand name
  - duplicate validation inputs
  - brand folder id readiness
  - root folder id readiness
  - target_key readiness
  - site alias readiness

Brand Identity Formation Loading Rule

- module_loader must prepare identity-readiness context for:
  - Brand Core Registry
  - Engines Registry
  - Validation & Repair Registry
- module_loader must resolve and return when applicable:
  - required_identity_engine_ids
  - identity_engine_readiness_status
  - brand_core_asset_read_home_status
  - brand_core_ready_status
  - maturity_readiness_status
- module_loader must not mark brand identity promotion-ready when:
  - required identity engines are missing
  - required identity engines are inactive
  - required identity engines are non-callable
  - Brand Core identity assets are missing or unresolved

Brand Core Read-Home Loading Rule

- for brand-core asset classes including:
  - profile
  - playbook
  - import template
  - composed payload
  module_loader must resolve Brand Core Registry as the primary operational read home
- JSON Asset Registry must not be treated as the primary operational read home for those asset classes
- JSON Asset Registry may remain authoritative only when:
  - asset_class = derived_json_artifact
- serialized JSON form alone must not reclassify a brand-core asset into JSON Asset Registry authority

Brand Property And Runtime Binding Loading Rule

- module_loader must prepare binding readiness for:
  - Brand Registry
  - Hosting Account Registry when applicable
  - Site Runtime Inventory Registry when applicable
  - Site Settings Inventory Registry when applicable
  - Plugin Inventory Registry when applicable
  - Validation & Repair Registry
  - Execution Bindings
- module_loader must resolve and return when applicable:
  - ga_property_binding_status
  - gtm_binding_status
  - gsc_binding_status
  - hosting_binding_status
  - website_runtime_binding_status
  - transport_binding_status
  - auth_binding_status
  - framework_classification_status

Brand Onboarding Promotion Guard Loading Rule

- module_loader must not mark brand onboarding promotion-ready when:
  - candidate validation rows are missing
  - candidate validation rows are pending
  - duplicate validation is unresolved
  - brand-core asset home validation is unresolved
  - identity engine readiness is unresolved
  - property/runtime binding validation is unresolved



Governed Addition Loading Rule

- when governed addition class = brand_onboarding, module_loader must apply the governed brand onboarding loading rule set before generic addition promotion logic

When governed addition behavior is active, module_loader must prepare addition-capable context for:
- registry_surfaces_catalog_sheet
- validation_and_repair_registry_sheet
- task_routes_sheet when routes are affected
- workflow_registry_sheet when workflows are affected
- execution_policy_registry_sheet when policy is affected
- repair_mapping_registry_sheet when repair behavior is affected
- row_audit_schema_sheet and row_audit_rules_sheet when validation coverage is affected
- knowledge_graph_node_registry_sheet and relationship_graph_registry_sheet when graph impact is expected

module_loader must return:
- addition_context
- affected_surface_map
- validation_requirements
- graph_requirements when applicable
- promotion_readiness_status

Brand Core Asset Intake Loading Rule

- when governed addition intent resolves to a brand-core asset write, module_loader must prepare intake-first loading before execution proceeds
- module_loader must resolve and return when applicable:
  - `asset_class`
  - `authoritative_home_candidate`
  - `write_target_candidate`
  - `mirror_policy_candidate`
  - `brand_core_asset_intake_status`
  - `brand_core_write_rules_status`
  - `intake_decision_status`
- module_loader must not mark execution-ready brand-core mutation when:
  - `asset_class` is unresolved
  - `authoritative_home_candidate` is unresolved
  - `write_target_candidate` is unresolved
  - `mirror_policy_candidate` is unresolved
  - intake decision is not `accepted`

Brand Core Write-Rule Loading Rule

- module_loader must treat `Brand Core Write Rules` as the authoritative policy surface for write-target determination
- module_loader must return when applicable:
  - `write_target_policy_surface_id`
  - `write_target_resolution_status`
  - `derived_json_artifact_exception_status`
- module_loader must preserve:
  - workbook assets -> `Brand Core Registry`
  - brand-core serialized assets -> `Brand Core Registry`
  - derived JSON artifacts -> `JSON Asset Registry`
  - legacy JSON mirrors -> non-authoritative context only

Publish Preparation Store Extension Loading Rule

- when governed execution proposes a publish-preparation workbook extension, module_loader must prepare:
  - `publish_preparation_extension_status`
  - `workbook_extension_intake_status`
  - `workbook_extension_commit_status`
  - `workbook_extension_write_target_status`
- module_loader must not mark workbook extension commit ready when:
  - intake decision is not `accepted`
  - authoritative home is unresolved
  - write target is unresolved
  - mirror policy is unresolved
  - workbook extension classification is unresolved

Legacy JSON Mirror Loading Rule

- for profile, playbook, import template, composed payload, and workbook asset classes:
  - module_loader must resolve `Brand Core Registry` as primary read home
  - module_loader may load `JSON Asset Registry` rows only as:
    - `legacy_non_authoritative_mirror`
    - `trace_context`
- module_loader must return when applicable:
  - `primary_read_home`
  - `legacy_mirror_present`
  - `legacy_mirror_deprioritized`

Graph Intelligence Loading Rule

When graph-based validation, prediction, or auto-routing is active, module_loader must resolve:
- knowledge_graph_node_registry_sheet
- relationship_graph_registry_sheet

module_loader must validate:
- graph sheet binding through Registry Surfaces Catalog
- worksheet_gid
- schema_ref
- schema_version
- header_signature
- expected_column_count

module_loader must return graph-ready context including when available:
- resolved_graph_nodes
- resolved_graph_relationships
- graph_validation_status
- graph_path_candidates
- graph_prediction_context

Execution Graph Validation Loading Rule

For starter-aware or graph-aware execution, module_loader must prepare the required path segments for validation:

- starter -> route
- route -> workflow
- workflow -> execution_chain when applicable
- decision -> chain or decision -> route when applicable
- chain -> engine when applicable

If required execution-critical path segments are missing or unresolved:
- graph validation status must not be treated as recovered
- execution must remain degraded or blocked by policy

Conditional authority loading for governed audit expansion:

When target_workflow or route intent resolves to full_system_intelligence_audit, module_loader must also resolve:
- execution_policy_registry_sheet
- review_stage_registry_sheet
- review_component_registry_sheet
- repair_mapping_registry_sheet
- row_audit_rules_sheet
- row_audit_schema_sheet
- tourism_intelligence_scoreboard_sheet

Missing required audit-governance dependencies must classify execution as degraded or blocked according to dependency criticality.
Tourism Intelligence Scoreboard may remain downstream-summary-only and must not be promoted to authority for execution decisions.

Authority dependency_state classification:
- missing required authority dependency -> invalid
- partially resolved required authority dependency -> degraded
- fully resolved required authority dependency -> valid

For full_system_intelligence_audit governance:
- missing execution_policy_registry_sheet, review_stage_registry_sheet, review_component_registry_sheet, repair_mapping_registry_sheet, row_audit_rules_sheet, or row_audit_schema_sheet must classify as degraded or blocked by criticality
- missing tourism_intelligence_scoreboard_sheet must classify as degraded only when downstream summary propagation is required; it must not override core authority readiness by itself

Full Audit Dependency Enforcement

When workflow = `wf_full_system_intelligence_audit`, module_loader must resolve and classify:
- execution_bindings_sheet
- execution_chains_registry
- decision_engine_registry_sheet
- actions_registry_sheet
- endpoint_registry_sheet
- system_enforcement_sheet
- execution_log_import_sheet

Missing critical dependencies must result in degraded or blocked classification.

For `wf_full_system_intelligence_audit` dependency_state outcomes:
- missing execution_bindings_sheet, execution_chains_registry, decision_engine_registry_sheet, actions_registry_sheet, endpoint_registry_sheet, system_enforcement_sheet, or execution_log_import_sheet must not classify as recovered
- classify degraded or blocked according to dependency criticality and governed continuity rules

module_loader must not fabricate, bypass, or silently substitute missing authority dependencies.

Ã¢â‚¬â€
Strict Loading Enforcement

module_loader must only prepare execution context for targets that are both:
- routed through prompt_router
- revalidated against Registry-governed bindings

Strict loading sequence:
1. validate routed intake presence
2. verify source attribution
3. verify route_id and target binding fields
4. resolve Task Routes record for route_id
5. resolve Workflow Registry record for target_workflow
6. when execution_class = autonomous chain, resolve execution_chains_registry_sheet for chain_id
7. when execution_class = autonomous chain, revalidate route_id, chain_id, target_workflow, and target_module as one governed unit
8. resolve Brand Registry tracking bindings for the active brand when the workflow, chain, category, or target_module requires Search Console, Google Analytics, or Tag Manager; attach `gsc_property`, `ga_property_id`, `gtm_container_id`, and `binding_status` to execution context before building API-specific dependency maps
9. verify target_module and target_workflow alignment
10. resolve knowledge-layer canonicals when selected dependency rows use `resolution_rule = exact_active_knowledge_only`; treat `file_id` as canonical filename, validate allowlist membership, and enforce no URL/Drive fallback
11. for canonical dependencies registered in `Validation & Repair Registry`, run live canonical resolution: resolve `file_id`, detect `file_type`, fetch via governed native API actions, validate `rule_id` and `section_id`, and use live content for execution
12. build dependency_map only for governed targets, including `analyticsdata_api`, `analyticsadmin_api`, and expanded `tagmanager_api` when Registry-resolved actions or endpoints require them
13. for native API execution paths, resolve parent capability through Actions Registry first, then resolve concrete endpoint metadata through API Actions Endpoint Registry; do not collapse these stages
14. for analytics workflows, validate execution-unit identity completeness (`brand_domain`, `gsc_property` for GSC, `ga_property_id` for GA4); when missing, stop that unit, flag the trace, and propagate analytics identity issue signal to system_bootstrap
15. for analytics sheet-sync workflows, resolve request identity including `brand_domain`, transform connector output into governed warehouse schema, append transformed rows to resolved analytics sheet targets, and preserve request metadata on each written row
16. return explicit load_status
17. when `intent_key = system_activation_check` or `target_workflow = system_activation_validation`, load the five canonical files from GPT Knowledge layer first for traceability
18. then validate their live file bindings through Google Drive and Registry-governed surface resolution
19. then validate live registry authority surfaces through Google Sheets metadata and governed sheet reads
20. compare knowledge-layer traceability against live governed readiness before returning activation-ready context

module_loader must not:
- invent missing target bindings
- assume workflow identity from prose
- prepare execution-ready context for unregistered targets
- silently continue from contradictory route and workflow inputs

---

Resolution Rules

Supported source modes:
- `live_native_api`
- `knowledge_layer`
- `canonical_url`
- `drive_file` (legacy only)

Dependency resolution:
- file -> active_file_id, except for governed canonical dependencies:
  - if `resolution_rule = exact_active_knowledge_only`, treat `file_id` as canonical filename, set `source_mode = knowledge_layer`, and resolve only from the active knowledge layer (no URL, no Drive, no fallback)
  - if `resolution_rule = exact_active_url_only`, apply **canonical_source_priority**: if `knowledge_layer_file_exists`, read knowledge path; else treat `file_id` as `canonical_url` and fetch via HTTPS (no Drive resolution)
- document -> active_file_id
- worksheet -> active_file_id + gid
- folder -> production_folder_id

Extended Registry authority dependencies:
- execution_policy_registry_sheet
- review_stage_registry_sheet
- review_component_registry_sheet
- execution_chains_registry_sheet
- decision_engine_registry_sheet when routing decisions require it

These authority dependencies must resolve through the authoritative Registry and be included in loaded dependency context only when relevant to the routed execution.

module_loader must not assume authority dependencies exist outside Registry resolution.

Routing-aware resolution:
- selected route must resolve against Task Routes
- selected workflow must resolve against Workflow Registry

Chain-aware resolution:
- chain_id must resolve against execution_chains_registry_sheet when autonomous chain mode is active
- chain workflow rows must be treated exactly like normal Workflow Registry authority rows
- chain_id, route_id, target_workflow, and target_module must revalidate as one governed unit for autonomous chain execution
- decision context must resolve against decision_engine_registry_sheet when provided
- next_step must remain available in chain context until execution completes or reaches END

Strict routed resolution:
- route_id must resolve to an active Task Routes record for executable loading
- matched_row_id should remain traceable when provided by prompt_router
- target_module must align with the resolved Task Routes record
- target_workflow must align with Workflow Registry authority
- resolved route and workflow mismatches must not be treated as valid execution-ready state

If route_id is missing but routing is degraded:
- preserve degraded loading state
- do not fabricate route resolution

---

Knowledge-Layer Canonical Dependency Loading

Purpose: resolve governed canonical dependencies from the active knowledge layer when the corresponding canonical surface in `Registry Surfaces Catalog` is active and authoritative.

Required behavior for `exact_active_knowledge_only` rows:

- read canonical surface row from `Registry Surfaces Catalog`
- set `source_mode = knowledge_layer`
- set `canonical_filename` from the governed canonical surface identity
- do not treat canonical surface authority as deprecated dependency-sheet authority
- do not use Drive fallback when knowledge-only loading is required
- do not use URL fallback unless explicitly governed for that canonical surface

Governed canonical filename allowlist:

- `system_bootstrap.md`
- `memory_schema.json`
- `direct_instructions_registry_patch.md`
- `module_loader.md`
- `prompt_router.md`

Resolution logic:

1. Read canonical surface row from `Registry Surfaces Catalog`.
2. If the canonical surface is governed as knowledge-layer authoritative:
   - set `source_mode = knowledge_layer`
   - set `canonical_filename` from canonical surface identity, not deprecated dependency-sheet authority
   - validate `canonical_filename` is in the governed canonical filename allowlist.
   - if filename is outside allowlist: classify invalid, preserve traceability, set `resolution_state = degraded` or `blocked` by policy/`blocked_if_missing`, set `failure_reason = validation`, and stop without fallback.
   - resolve and load `canonical_filename` from the current knowledge layer governed canonical set.
   - if canonical file is missing: set `resolution_state = degraded` or `blocked`, set `failure_reason = missing`, and honor `blocked_if_missing`.
   - if canonical file is inaccessible by policy: set `failure_reason = forbidden`; do not fallback.
   - on any failure in this rule: set `resolved_source = knowledge_layer`, set `resolved_location = <attempted canonical filename>`, and keep traceability without fallback.
   - on successful load and validation: set `resolved_source = knowledge_layer`, `resolved_location = <canonical filename>`, `resolution_state = recovered`.

URL-Only Canonical Dependency Loading (`exact_active_url_only`)

Purpose: for the five core canonical dependencies, allow knowledge-layer first and HTTPS canonical URL fallback only when `resolution_rule = exact_active_url_only`.

Dependencies governed by this path:

- `system_bootstrap`
- `memory_schema.json`
- `direct_instructions_registry_patch`
- `module_loader`
- `prompt_router`

This section applies only to `exact_active_url_only` rows. `exact_active_knowledge_only` rows must resolve exclusively through Knowledge-Layer Canonical Dependency Loading.

canonical source priority (must align with `system_bootstrap`; applies to `exact_active_url_only`):

1. `knowledge_layer` - if the governed knowledge-layer file for this `dependency_name` exists and is readable (`knowledge_layer_file_exists`), load from that path (`source_mode = knowledge_layer`).
2. `canonical_url` - otherwise fetch from `canonical_url` derived from Registry `file_id`.

Loader mode contract:

- `source_mode = knowledge_layer` - read dependency body from the governed knowledge-layer path; no HTTPS fetch and no Drive export for that load.
- `source_mode = canonical_url` - fetch remote dependency body over HTTPS from `canonical_url`; do not use Drive export or download for that row.
- `source_mode = drive_file` - legacy mode for dependencies not migrated to canonical URL authority.

Resolution logic:

1. Read canonical surface row from `Registry Surfaces Catalog`.
2. If `resolution_rule == exact_active_url_only`:
   - resolve the governed knowledge-layer candidate path for this `dependency_name`.
   - if `knowledge_layer_file_exists` for that path: read file, validate, set `source_mode = knowledge_layer`, `resolved_source = knowledge_layer`, `resolved_location = <path>`; do not use Drive and do not require URL fetch for success.
   - else: treat `file_id` as `canonical_url`, validate URL (host, scheme, extension), fetch dependency content from URL, set `source_mode = canonical_url`; reject Drive fallback for that row.
3. If `notes = canonical_url_migrated` (when used), Drive-based resolution is prohibited for that row regardless of other hints.
4. If URL fetch fails (when knowledge layer was not used and URL is required):
   - mark dependency resolution as `degraded` or `blocked` per `blocked_if_missing` and execution policy
   - log `failure_reason` (`network` | `validation` | `missing` | `forbidden` or governed equivalent)
   - honor `blocked_if_missing` when TRUE for required canonical dependencies

Validation rules for `exact_active_url_only` rows:

- URL must start with `https://canonicals.wovacation.com/`
- Extension must match dependency:
  - `memory_schema.json` -> path must end with `.json`
  - `system_bootstrap`, `direct_instructions_registry_patch`, `module_loader`, `prompt_router` -> path must end with `.md` (or governed equivalent registered for that environment)

Reference canonical URL map (Registry `file_id` must match these paths unless a governed registry change updates the row):

- `system_bootstrap` -> `https://canonicals.wovacation.com/system_bootstrap.md`
- `memory_schema.json` -> `https://canonicals.wovacation.com/memory_schema.json`
- `direct_instructions_registry_patch` -> `https://canonicals.wovacation.com/direct_instructions_registry_patch.md`
- `module_loader` -> `https://canonicals.wovacation.com/module_loader.md`
- `prompt_router` -> `https://canonicals.wovacation.com/prompt_router.md`

Output state:

- On successful knowledge-layer read and validation: `resolution_state = recovered`, `resolved_source = knowledge_layer`, `resolved_location = <path or canonical filename>`
- On successful URL fetch and validation: `resolution_state = recovered`, `resolved_source = canonical_url`, `resolved_location = <url>`
- On failure: `resolution_state = degraded` or `blocked`, `resolved_source` reflects the attempted mode (`knowledge_layer` or `canonical_url`), `resolved_location` set, `failure_reason` set

Disabled behavior:

- Do not attempt Drive export/download for any dependency with `resolution_rule = exact_active_url_only`, `resolution_rule = exact_active_knowledge_only`, or `notes = canonical_url_migrated`.
- Do not attempt URL fetch for any dependency with `resolution_rule = exact_active_knowledge_only`.
- Do not allow mixed interpretation of `file_id` for `exact_active_knowledge_only` rows (filename only; never URL or Drive ID).
---

Segmented Canonical Reconstruction Support

When a governed canonical dependency cannot be fully retrieved in one read due to size limits, transport limits, or non-exportable file-type constraints, module_loader may perform segmented retrieval and deterministic reconstruction under the resolved Registry identity.

This rule applies only when:
- the dependency remains Registry-resolved and authoritative
- knowledge_layer did not satisfy the required read
- direct full-body retrieval is unavailable, unreliable, or size-limited
- the dependency is required for canonical validation, audit, reconciliation, repair diagnostics, or governed execution preparation

module_loader must:
- preserve the resolved Registry file identity
- preserve ordered chunk reads
- reconstruct the full body exactly
- run integrity validation before marking the dependency readable for validation or execution preparation

Integrity validation must confirm:
- chunk count is explicit and traceable
- chunk order is preserved
- reconstructed length matches the retrieved aggregate length
- reconstructed content exactly matches the ordered chunk concatenation
- no omission, overlap, or duplication occurred

If segmented reconstruction fails integrity validation:
- dependency resolution must classify as `degraded` or `blocked`
- `Recovered` classification is forbidden
- `failure_reason` must preserve segmented reconstruction failure traceability

module_loader must not treat segmented retrieval as a separate authority path.

For segmented canonical reconstruction output, the resolved dependency entry should include when applicable:
- `source_mode`
- `resolved_source`
- `resolved_location`
- `retrieval_mode = segmented_reconstruction`
- `chunk_count`
- `reconstruction_status`
- `integrity_validation_status`
- `resolution_state`
- `failure_reason` when reconstruction fails

Validation Rules

Deep Validation Layer Support

module_loader must support:
1. structural validation
2. column contract validation
3. row logic validation
4. cross-sheet validation
5. behavioral validation

Validation must be driven by:
- Row Audit Schema
- Row Audit Rules
- Registry Surfaces Catalog

Validation outputs must align with:
- Validation & Repair Registry schema
- enforcement matrix levels

Base validation rules:
- status must be active when runtime-required
- required fields must exist
- gid required for worksheet
- expected filename must match when applicable

Live canonical validation rules (when canonical dependency is registered in Validation & Repair Registry):
- `rule_id` must be present and valid for the resolved canonical dependency
- `section_id` must be present and resolvable for the selected canonical content region
- `file_type` must map to the correct native API family (`google_doc` -> Docs API, `google_sheet` -> Sheets API)
- if live resolution is possible, knowledge-layer-only authority is invalid for runtime-ready classification

Exact knowledge-layer canonical filename validation (`exact_active_knowledge_only`):
- `file_id` must exactly match one governed canonical filename: `system_bootstrap.md`, `memory_schema.json`, `direct_instructions_registry_patch.md`, `module_loader.md`, or `prompt_router.md`
- if `file_id` is outside the governed set: mark invalid, preserve traceability, and do not silently fallback to URL or Drive

Chain validation rules:
- chain_id required when execution type = autonomous chain
- chain route must resolve to a valid governed route
- chain workflow must resolve when explicitly defined
- chain workflow completeness must be validated before dependency loading
- if chain_id resolves but target_workflow is incomplete, execution-ready state must be refused
- if chain workflow exists without required registry-governed fields, execution-ready state must be refused
- chain engine_chain must be preserved in context
- invalid chain resolution must trigger degraded mode, not silent drop

Authority source constraint:
- execution-governing authority must not load from Review workbook sheets
- execution-governing authority must not load from Review Config
- execution-governing authority must not load from inferred or cached structures
- execution-governing authority must be sourced exclusively from Registry-bound dependencies

If authority is sourced outside Registry:
- dependency_state must be marked invalid
- violation must be traceable in authority_dependency_context or equivalent output context

---

Degradation Rules

Degraded conditions:
- missing non-blocking dependency
- invalid non-blocking dependency
- multiple active bindings for the same dependency with recoverable path
- stale dependency rows from superseded architecture model are still present but a reconciled authority-safe path exists
- analytics fetch succeeded but governed schema transformation or sheet append write did not complete
- analytics property binding exists but `brand_domain` is missing for a domain-bound request
- one or more analytics execution units are identity-invalid but other units can continue safely with explicit per-unit traceability
- route_status already degraded from prompt_router
- missing route resolution with preserved routing traceability
- unresolved decision-linked registry surface with safe bounded fallback
- missing derived observability surface that is non-blocking for the selected execution path
- partial workflow resolution with explicit downstream limitation

Blocked conditions:
- missing required routed intake for executable loading
- invalid source attribution
- missing route_id for executable loading
- unresolved active Task Routes record for executable loading
- unresolved Workflow Registry binding for executable loading
- required dependency can be resolved only through stale superseded architecture rows and no reconciled authority-safe path exists
- required analytics sheet target binding is unresolved or schema is malformed on an authoritative write surface
- domain-bound analytics execution requires `brand_domain` but it is unresolved and no safe degraded path exists
- missing `gsc_property` for a required GSC execution unit and no safe degraded path exists
- missing `ga_property_id` for a required GA4 execution unit and no safe degraded path exists
- target_module mismatch against governed route binding
- contradictory route/workflow binding state
- loading would require ungoverned execution target assumption
- activation validation requires live Google Drive or Google Sheets validation but only knowledge-layer traceability was loaded
- activation dependency order requires knowledge-first traceability plus live governed validation, but either phase is skipped or contradictory

In degraded or blocked states:
- load_status must be explicit
- binding_status must be explicit
- traceability must be preserved
- silent promotion to execution-ready is prohibited

Ã¢â‚¬â€

Strict Binding Validation Rules

The following validations are required for execution-ready loading:

Route binding validation:
- route_id exists
- route_id resolves to exactly one active governed route when executable = true
- target_module matches the active routed binding
- route_source remains registry-governed

Workflow validation:
- target_workflow exists
- target_workflow resolves in Workflow Registry
- workflow binding is compatible with the selected route
- autonomous chains must validate chain workflow completeness using the same executable workflow requirements as normal workflow rows
- chain workflow validation outcomes must populate dependency_state, binding_status, target_resolution_status, and executable_readiness

Dependency validation:
- all runtime-required dependencies for the resolved route are registry-bound
- required worksheet bindings include `worksheet_gid` when applicable
- `worksheet_gid` must exist, be valid, and match the actual Registry surface binding
- `sheet_name` and `tab_name` may support diagnostics but must not be used for execution resolution
- schema-governed surfaces must include `schema_ref`, `schema_version`, `header_signature`, `expected_column_count`, and `binding_mode`
- schema validation must return explicit `schema_validation_status`, `header_match_status`, and `schema_drift_detected`
- schema drift on required governed surfaces must classify execution as degraded or blocked by criticality and must preserve repair mapping context when required
- required authority dependencies for the selected execution context must resolve through Registry
- authority dependency validation must populate dependency_state and authority_dependency_context
- unresolved required dependencies must not be upgraded to execution-ready status

Monitoring validation readiness:
- if monitoring surfaces are required downstream, their bindings must be explicitly attached or degraded explicitly

---

Analytics And Tag Manager Module Bindings

Governed module keys for Google Analytics and Tag Manager must resolve through Registry (`Registry Surfaces Catalog`, Actions Registry, and API Actions Endpoint Registry) without hardcoded property or container IDs.

Canonical module bindings:

- `analyticsdata_api` Ã¢â‚¬â€ Google Analytics Data API; connector resolves through Registry to the governed Google Analytics / Google APIs connector (for example `analytics_googleapis_com_connector` or the Registry-listed equivalent)
- `analyticsadmin_api` Ã¢â‚¬â€ Google Analytics Admin API; connector resolves through the same governed Google Analytics connector family as registered
- `tagmanager_api` Ã¢â‚¬â€ Google Tag Manager API with expanded surface (containers, workspaces, tags, triggers, variables); connector resolves to the governed Tag Manager connector (for example `tagmanager_googleapis_com_connector` or the Registry-listed equivalent)

Rules:

- `searchads360_api` must not be loaded as an active required dependency for new or migrated workflows; if present only as deprecated, loader must treat it as non-authoritative per `direct_instructions_registry_patch`
- Property and container identifiers must come from Brand Registry tracking columns after resolution, not from user prompt text alone
- When `analyticsadmin_api` is loaded for discovery flows, loader must still require routed workflow authority; discovery must not bypass Task Routes or Workflow Registry

Brand tracking injection:

- Before resolving analytics or GTM API handlers, module_loader must attach `brand_tracking_bindings` (or equivalent structure) to execution context populated from Brand Registry rows for the active brand
- Missing required bindings for the selected workflow must yield explicit `degraded` or `blocked` load_status, not silent omission

### Analytics Sheet Transformation and Write Rule

For analytics sheet-sync workflows, module_loader MUST not treat raw connector output as a complete execution result.

For governed analytics requests, module_loader must:
1. resolve target source:
   - GA4 Data
   - GSC Data
2. resolve request identity:
   - brand or eligible multi-brand brand set
   - request_date
   - date_from/date_to
   - trigger_mode
3. transform connector output into the governed warehouse schema
4. append transformed rows to the resolved analytics sheet surface
5. preserve request metadata on every written row

Governed GSC sheet schema:
- brand
- brand_domain
- date
- page
- clicks
- impressions
- ctr
- position
- request_date
- date_from
- date_to
- trigger_mode

Governed GA4 sheet schema:
- brand
- date
- page
- sessions
- users
- conversions
- revenue
- source
- medium
- request_date
- date_from
- date_to
- trigger_mode

module_loader must refuse recovered classification for analytics sheet-sync executions when:
- schema transformation is skipped
- append_rows does not complete
- request metadata is missing
- target analytics sheet binding is unresolved

For multi-brand analytics sync, module_loader must execute per eligible brand and preserve brand-separated row writes without collapsing brands into a single anonymous write state.

### Domain-Aware Analytics Load Rule

For analytics workflows, module_loader MUST resolve and carry `brand_domain` as part of executable request identity.

For each analytics execution unit, module_loader must attach:
- brand
- brand_domain
- source binding:
  - gsc_property
  - ga_property_id
- request_date
- date_from/date_to
- trigger_mode

For multi-brand analytics sync:
- module_loader must build execution units as brand-domain scoped records
- each brand-domain scoped record must remain isolated through fetch, transform, write, and logging stages

For GSC sheet-sync writes, transformed rows must preserve:
- brand
- brand_domain
- date
- page
- clicks
- impressions
- ctr
- position
- request_date
- date_from
- date_to
- trigger_mode

module_loader must not classify analytics execution as complete when:
- brand_domain is unresolved
- property is resolved but brand_domain is absent
- required gsc_property is missing for a GSC execution unit
- required ga_property_id is missing for a GA4 execution unit
- domain-aware row metadata is missing from the write payload

If multiple domains exist for a single brand, module_loader must preserve domain-separated execution handling and must not collapse them into one anonymous brand-level payload.

### Analytics Identity Integrity Enforcement Rule

module_loader must validate identity completeness before processing any analytics execution unit.

For each execution unit (brand-domain scope):

If any of the following is missing:
- brand_domain
- gsc_property (for GSC)
- ga_property_id (for GA4)

module_loader MUST:

1. stop execution for that unit
2. flag identity failure in execution trace
3. propagate issue creation signal to system_bootstrap
4. prevent:
   - API calls
   - transformation
   - sheet writes

module_loader must not:
- silently skip invalid brands
- collapse invalid and valid brands into a single execution state

Each failed unit must remain:
- traceable
- independently logged
- issue-bound

---

Dependency Bindings

Canonical loading dependencies:
- Registry
- system_bootstrap
- prompt_router
- direct_instructions_registry_patch
- memory_schema.json
- execution_policy_registry_sheet
- review_stage_registry_sheet
- review_component_registry_sheet
- decision_engine_registry_sheet
- execution_chains_registry_sheet
- validation_and_repair_registry_sheet
- registry_surfaces_catalog_sheet
- actions_registry_sheet
- api_actions_endpoint_registry_sheet (`gid: 172380518`)
- repair_mapping_registry_sheet
- row_audit_rules_sheet
- row_audit_schema_sheet
- tourism_intelligence_scoreboard_sheet
- execution_bindings_sheet
- execution_chains_registry
- endpoint_registry_sheet
- system_enforcement_sheet
- execution_log_import_sheet

Runtime authoritative execution and review surfaces when applicable:
- Task Routes
- Workflow Registry
- history_sheet
- review_run_history_sheet
- review_findings_log_sheet
- review_stage_reports_sheet

Derived observability surfaces when applicable:
- execution_view_sheet
- active_issues_dashboard_sheet
- review_control_center_sheet when aggregation-only

For strict-mode loading, authoritative route-binding inputs must resolve from:
- Task Routes
- Workflow Registry

Required route-binding fields for executable preparation:
- row_id
- route_id
- active
- target_module
- workflow_key
- route_mode
- lifecycle_mode
- logging_required
- memory_required
- review_required

module_loader must treat missing required route-binding fields as invalid executable preparation state.

---

Execution Context Contract

The loader must build:
- dependency_map
- authority_dependency_context when authority dependencies are evaluated
- selected_route
- selected_workflow
- execution_type
- routing_context
- memory_context when applicable
- decision_context when applicable
- chain_context when applicable
- monitoring_context when applicable
- brand_tracking_bindings when measurement, analytics, GTM, or full-funnel workflows apply
- degraded_notes when applicable

For strict-mode handoff, execution context must also include:
- dependency_state
- load_status
- binding_status
- route_id
- route_status
- route_source
- matched_row_id when available
- resolved_route_record when available
- resolved_workflow_record when available
- target_resolution_status
- executable_readiness

Execution context must distinguish:
- routing resolved but not load-ready
- load-ready but degraded
- blocked loading state

---

Observability Dependency Tiering

When observability-aware execution is active, module_loader must resolve dependencies in separate tiers:
- authoritative binding surfaces
- authoritative execution dependencies
- authoritative review dependencies
- derived observability dependencies
- governed control surfaces

Derived observability dependencies must remain distinguishable from authoritative write surfaces in loaded context.

Repair-Aware Binding Resolution

When `binding_schema_migration_review` repairs or migrates authoritative binding rows:
- module_loader must resolve against the repaired canonical rows
- superseded legacy rows must not remain live authority
- recovered rows may continue as runtime authority only when canonical schema validity is restored
- degraded rows must preserve explicit traceability in loading output
- blocked rows must prevent dependent loading from being treated as fully valid

If a derived observability dependency is broken or unresolved:
- do not block engine execution by itself
- return degraded observability state when safe
- preserve traceability for downstream observability validation

Feedback Injection Contract

When the growth layer is active, module_loader must resolve and inject feedback context from governed authoritative sources such as:
- `Growth Loop Engine Registry`
- `Metrics Warehouse`
- `Execution Log Unified`
- governed review feedback surfaces when applicable

module_loader must:
- separate authoritative feedback sources from derived score or dashboard views
- resolve against repaired canonical rows when binding migration changed the authoritative source
- exclude superseded legacy feedback bindings from live authority
- return feedback_injection_context only from Registry-governed or otherwise governed authoritative sources

Execution Log Unified Append Payload Rule

When module_loader prepares append-ready execution payloads for `Execution Log Unified`:

- writable append payload must be limited to columns `A:AD`
- columns `AE:AJ` must be treated as formula-managed spill columns
- payload preparation must not include literal values for:
  - `target_module`
  - `target_workflow`
  - `execution_trace_id`
  - `log_source`
  - `Monitored Row`
  - `Performance Impact Row`

If outgoing payload width or mapping would write into `AE:AJ`, loader readiness must degrade and preserve logging-repair continuity.

If feedback context is partially available:
- loading may continue in degraded mode when safe
- missing feedback must not be silently fabricated
- derived dashboards must not stand in for authoritative feedback history by default

---

Monitoring Surface Context Contract

When registry-governed monitoring or derived observability surfaces are active or required for the selected execution path, module_loader must resolve and prepare monitoring surface context for downstream validation.

Registered monitoring surfaces include:
- execution_view_sheet
- active_issues_dashboard_sheet
- review_control_center_sheet when aggregation-only
- anomaly detection or equivalent governed derived observability surface when registered
- execution_log_unified or equivalent governed derived observability surface when registered

module_loader must:
- resolve monitoring surfaces through Registry
- separate authoritative execution/review dependencies from derived observability dependencies
- confirm worksheet accessibility metadata is present
- include resolved monitoring bindings in dependency_map when available
- attach monitoring_context when monitoring validation is expected downstream
- preserve degraded_notes when monitoring surfaces fail to resolve safely

monitoring_context should include when available:
- execution_view_binding
- active_issues_dashboard_binding
- monitoring_resolution_status
- derived_view_refresh_expected
- observability_validation_state
- observability_issues
- monitoring_degraded_notes

If a derived observability surface is missing or unresolved:
- do not silently ignore
- preserve traceability in degraded_notes
- do not block engine execution by itself
- allow downstream classification by system_bootstrap

If monitoring surfaces are non-blocking for the selected execution path:
- continue in degraded mode when safe

---

Autonomous Chain Contract

When execution type = autonomous chain, module_loader must:
- resolve chain_id
- load initial chain step
- preserve engine_chain
- preserve next_step condition
- return chain-aware context to system_bootstrap
- avoid collapsing chain execution into standard execution without explicit degraded note

---

Completion Rule

Loading is not complete unless:
- all required dependencies are resolved
- authority_dependency_context is attached when authority dependencies are evaluated
- execution context is built
- route/workflow context is attached
- chain context is attached when applicable
- monitoring_context is attached when monitoring surfaces are required
- brand_tracking_bindings are resolved and attached when the routed workflow requires Search Console, Google Analytics, or Tag Manager identifiers
- dependency validation state is recorded

Loading is also not complete unless:
- routed intake is validated
- route_id is preserved or degraded explicitly
- target binding is revalidated against Registry
- workflow binding is revalidated against Workflow Registry
- stale-vs-current dependency-model mismatches are surfaced as reconciliation requirements when detected
- for analytics sheet-sync workflows, governed schema transformation, append_rows completion, and request metadata preservation are confirmed before recovered classification
- for domain-aware analytics workflows, `brand_domain` resolution and domain-aware row metadata preservation are confirmed before recovered classification
- dependency_state is assigned
- load_status is assigned
- binding_status is assigned
- executable_readiness is assigned
- no ungoverned execution target was prepared

Execution must not be marked fully ready when:
- raw execution logging is required
- and `surface.operations_log_unified_sheet` is unresolved
- or a legacy / derived surface is being treated as the raw execution sink

---

Loader Boundary Rule

module_loader is responsible for loading and context preparation only.

It must not become the source of truth for:
- routing decisions
- final orchestration
- logging writes
- schema governance
- engine registry control

module_loader may revalidate routed bindings and prepare governed execution context.

module_loader must not:
- replace prompt_router as routing authority
- replace system_bootstrap as execution authority
- convert degraded routing into assumed executable readiness
- fabricate missing Registry bindings

Duplicate Header Intolerance Rule

module_loader must not silently accept duplicate authoritative header names on
governed workbook surfaces used for execution-critical resolution.

If duplicate header names are detected on:
- `Actions Registry`
- `API Actions Endpoint Registry`
- `Execution Policy Registry`
- `Brand Registry`

module_loader must:
- classify the dependency state as blocked
- preserve duplicate-header traceability
- forbid recovered or ready classification
- emit registry repair requirement

## Schema Loading Enforcement

module_loader MUST:

- detect `openai_schema_file_id`
- fetch schema file using google Drive API tool before request construction
- parse schema into structured object
- expose:

  resolved_schema_contract:
    - paths
    - methods
    - parameters
    - requestBody
    - headers

- set:
  schema_loaded = true
  schema_parse_status = success | failed

---

Cross-Layer Contract

module_loader must assume:
- prompt_router determines selected route, workflow, and chain trigger state
- Registry provides live dependency bindings
- direct_instructions_registry_patch defines dependency governance rules
- memory_schema.json governs memory/state structure
- system_bootstrap consumes prepared execution context for final orchestration

module_loader must assume:
- prompt_router provides the canonical routed execution contract
- system_bootstrap has already enforced canonical bootstrap policy (including `canonical_url_dependency_bootstrap` and `canonical_source_priority`) before dependent stages
- direct_instructions_registry_patch governs validity and allowed usage of `exact_active_knowledge_only`
- Registry Surfaces Catalog is the authoritative source of canonical surface identity and location
- Validation & Repair Registry is the authoritative source of canonical and surface validation state
- runtime registries remain the authoritative source for route, workflow, action, endpoint, and brand bindings

module_loader must assume:
- system_bootstrap is responsible for execution logging writes
- system_bootstrap is responsible for anomaly writeback
- system_bootstrap is responsible for governed repair execution after anomaly-cluster trigger

### Native Google Logging Preparation Rule

When module loading detects that the governed path may execute through native Google Drive, Google Sheets, or Google Docs actions, `module_loader` must prepare logging readiness without becoming the logging writer.

`module_loader` must prepare and return when applicable:
- `native_google_action_path_possible`
- `native_google_connection_attempt_required`
- `native_google_attempt_evidence_required`
- `native_google_mutation_logging_required`
- `native_google_execution_class`
- `native_google_execution_mode`
- `logging_required`
- `logging_sink_required`
- `authoritative_logging_surface_id`
- `pre_response_log_guard_required`

`module_loader` must not:
- write execution logs directly
- treat native Google attempt evidence as sufficient replacement for authoritative logging
- mark executable readiness as recovered when native Google governed mutation logging readiness is unresolved

If raw execution logging is required and `surface.operations_log_unified_sheet` is unresolved:
- executable readiness must remain false
- degraded or blocked loading must remain explicit

module_loader is the governed binding-resolution bridge between routed intent and orchestration, not an independent execution authority.

Governed Sheet Audit Loading Rule

When routed execution selects:
- full_system_intelligence_audit
- binding_integrity_review
- schema validation
- control surface repair
- derived view repair
- formula repair
- projection repair

module_loader must resolve governed sheet audit context for the target workbook_sheet.

module_loader must prepare when applicable:
- `sheet_role`
- `sheet_audit_mode`
- `formula_audit_required`
- `projection_audit_required`
- `control_metric_audit_required`
- `write_target_audit_required`
- `legacy_surface_containment_required`

When routed execution or repair validation involves a governed `anomaly_surface` with cluster metadata, module_loader must also prepare:
- `cluster_metadata_expected`
- `cluster_priority_propagation_required`
- `cross_workbook_feed_detected`
- `local_import_stage_required`

Supported sheet audit modes:
- `schema_audit`
- `formula_audit`
- `projection_audit`
- `control_surface_audit`
- `write_target_audit`
- `anomaly_repair_audit`
- `legacy_containment_audit`

Scoped Event Surface Loading Rule

module_loader must classify the following as scoped event surfaces:

- `surface.system_enforcement_events_sheet`
- `surface.query_engine_events_sheet`

Classification requirements:

- scoped event surfaces are execution-adjacent write targets
- scoped event surfaces are not authoritative raw execution logging sinks
- scoped event surfaces must not be promoted into `logging_sink_surface_id` when resolving canonical raw execution logging

Surface-role loading requirements:

- `System Enforcement` resolves as governance/state
- `Tourism Intelligence Query Engine` resolves as routing/reference
- if either surface is presented as a runtime event write target, execution preparation must redirect to the corresponding scoped event surface
- if either surface is presented as the authoritative raw execution sink, loading must degrade or block

Approved scoped routing:

- governance or enforcement event writeback -> `surface.system_enforcement_events_sheet`
- query intake or decision event writeback -> `surface.query_engine_events_sheet`

Derived View Loading Rule

For sheets classified as `derived_view`, module_loader must validate and prepare:
- source surface dependency map
- formula anchor presence
- key-based projection fields when applicable
- row-position mirroring risk classification
- authoritative source replacement mapping when the source surface was retired or reclassified

Control Surface Loading Rule

For sheets classified as `control_surface`, module_loader must validate and prepare:
- metric source surfaces
- formula dependency map
- alert threshold readiness
- broken reference detection readiness
- live-source compatibility with current Registry authority

When control metrics depend on anomaly-cluster-driven repair prioritization, module_loader must preserve cluster-aware dependency context without converting anomaly metadata into raw execution truth.

Repair Surface Loading Rule

For sheets classified as `repair_surface`, module_loader must validate and prepare:
- anomaly feed dependencies
- trigger field dependencies
- execution field dependencies
- priority/dispatch field dependencies
- legacy input dependency map when formula fields still reference pre-normalized columns

Anomaly Surface Loading Rule

For sheets classified as `anomaly_surface`, module_loader must validate and prepare when applicable:
- anomaly formula anchor presence
- cluster metadata header presence
- cluster metadata spill-width compatibility
- repair handoff readiness
- cluster-priority propagation readiness
- cross-workbook source usage
- staged local import readiness when remote workbook data is consumed

module_loader must classify as degraded or repair-required when:
- cluster metadata headers exist but live anomaly formulas emit fewer columns than the governed surface schema
- repeated direct IMPORTRANGE calls are chained inside the anomaly formula rather than staged locally
- cluster-informed repair recommendations exist but cannot be propagated into the governed repair surface

Loader Output Extension For Governed Sheet Audit

module_loader must return when applicable:
- `sheet_role`
- `sheet_audit_mode`
- `formula_dependency_map`
- `projection_dependency_map`
- `control_metric_dependency_map`
- `legacy_input_dependency_map`
- `sheet_repair_candidate_types`

---

Starter Addition Loading Contract

The starter-addition loading contract is active:

- when execution intent is add starter, register starter, promote starter, or repair starter metadata, module_loader must prepare starter-addition execution readiness before orchestration proceeds
- module_loader must preserve:
  - `starter_addition_governed = true`
  - `starter_addition_validation_required = true`
  - `starter_post_insert_readback_required = true`
  - `starter_override_resolution_required_when_applicable = true`

Starter Classification Preparation Rule

module_loader must classify starter-addition intent into one governed class before write preparation:

- `general_starter`
- `system_starter`
- `override_required_starter`
- `predictive_starter`

module_loader must prepare this classification from available starter metadata including:
- starter title
- intent category
- route_key
- execution_class
- predictive field state
- governance and runtime route family

Starter Addition Override Resolution Rule

When starter classification resolves to `override_required_starter`, module_loader must prepare:
- override registry target readiness
- override validation readiness
- post-insert override readback readiness

Starter Addition Readback Preparation Rule

module_loader must not report starter-addition execution-ready state unless it has prepared readback validation for:
- inserted row existence
- aligned execution_class
- override coverage when required
- starter-governance persistence

Starter Policy Bundle Loading Rule

When starter-aware execution or starter addition is active, module_loader must resolve the starter policy bundle for the active route from Execution Policy Registry.

The starter policy bundle must include when available:
- `starter_priority_policy`
- `starter_followup_route_policy`
- `starter_followup_starters_policy`
- `starter_success_signal_policy`
- `starter_goal_family_policy`

module_loader must return:
- `starter_policy_coverage_status`
- `starter_policy_missing_component`
- `starter_policy_execution_ready`
- `starter_policy_authority_source = execution_policy_registry_sheet`

If any required starter policy row is missing:
- execution-ready status must remain `false`
- policy-gap traceability must be preserved
- repair-aware context must remain available

Starter Policy Repair Context Loading Rule

When starter policy coverage is incomplete, module_loader must also prepare:
- `starter_policy_repair_eligible`
- `starter_policy_repair_triggered`
- `starter_policy_repair_scope`
- `starter_policy_missing_component_set`
- `policy_gap_detected`

Default behavior:
- `starter_policy_repair_eligible = false` unless manual trigger is present

Policy-Driven Starter Defaults Loading Rule

For default starter behavior, module_loader must load policy-governed values for:
- `starter_priority`
- `suggested_followup_route`
- `suggested_followup_starters`
- `success_signal_source`
- `primary_goal_family`

Curated override rows may supersede policy values where override authority applies, but missing override rows must not force hardcoded non-policy defaults when policy rows are available.


---

Governed Logical Search Loader Contract v1

module_loader must prepare governed logical search infrastructure before execution selection.

Required loader outputs

module_loader must prepare:
- `governed_search_enabled = true`
- `governed_search_domain`
- `governed_search_adapter`
- `governed_search_policy`
- `governed_search_constraints`
- `governed_search_template_support`
- `governed_search_fallback_policy`

Required adapters:
- endpoint registry adapter
- registry surface adapter
- validation registry adapter
- task route adapter
- workflow registry adapter
- memory adapter
- brand runtime adapter

Required search policy fields

module_loader output must preserve:
- `exact_id_weight`
- `exact_key_weight`
- `exact_path_weight`
- `entity_slug_weight`
- `action_match_weight`
- `method_match_weight`
- `domain_match_weight`
- `authority_match_weight`
- `validation_match_weight`
- `dependency_match_weight`
- `generic_fallback_penalty`

WordPress template support

For `wordpress_api`, module_loader must prepare governed template-path support for all CPT and taxonomy families across WordPress sites.

Supported template classes:
- `wordpress_cpt_collection`
- `wordpress_taxonomy_collection`
- `wordpress_cpt_item`
- `wordpress_taxonomy_item`

Template expansion readiness requires:
- resolved brand base URL
- provider family continuity = wordpress
- schema-aligned transport path
- entity slug normalization
- method compatibility
- governed candidate evidence or active resolver template support

When template-path support is active, loader output must preserve:
- `wordpress_dynamic_entity_resolution_enabled = true`
- `wordpress_dynamic_cpt_support = true`
- `wordpress_dynamic_taxonomy_support = true`
- `template_path_governed_only = true`


---

WordPress Endpoint Generation Loader Contract v1

module_loader must prepare generation-aware endpoint support for custom WordPress CPTs and taxonomies across sites.

Required loader outputs

When `parent_action_key = wordpress_api`, loader must prepare:
- `wordpress_endpoint_generation_enabled = true`
- `wordpress_endpoint_generation_mode`
- `wordpress_supported_template_classes`
- `wordpress_live_object_inventory`
- `wordpress_generation_policy`
- `wordpress_materialization_preference`

Required template classes

Loader must support:
- `wordpress_cpt_collection`
- `wordpress_cpt_item`
- `wordpress_taxonomy_collection`
- `wordpress_taxonomy_item`

Optional classes when live-supported:
- `wordpress_cpt_revision_collection`
- `wordpress_cpt_revision_item`
- `wordpress_cpt_autosave_collection`
- `wordpress_cpt_autosave_item`

Required generation policy

Loader must prepare canonical mappings:

CPT:
- list -> `GET /wp/v2/{post_type_slug}`
- create -> `POST /wp/v2/{post_type_slug}`
- get -> `GET /wp/v2/{post_type_slug}/{id}`
- update -> `POST /wp/v2/{post_type_slug}/{id}`
- delete -> `DELETE /wp/v2/{post_type_slug}/{id}`

Taxonomy:
- list -> `GET /wp/v2/{taxonomy_slug}`
- create -> `POST /wp/v2/{taxonomy_slug}`
- get -> `GET /wp/v2/{taxonomy_slug}/{id}`
- update -> `POST /wp/v2/{taxonomy_slug}/{id}`
- delete -> `DELETE /wp/v2/{taxonomy_slug}/{id}`

Required loader evidence

Loader output must preserve:
- `wordpress_generation_slug`
- `wordpress_generation_kind`
- `wordpress_generation_candidate_key`
- `wordpress_generation_candidate_path`
- `wordpress_generation_basis`
- `wordpress_materialized_row_exists`
- `wordpress_generation_confidence`

Materialization preference rule

Loader must prefer:
1. active materialized registry row
2. resolver-backed generated candidate
3. generic core fallback only when no specific supported candidate exists



---

# module_loader â€” WordPress Publish Contract Runtime Governance Patch

## Additive loader bindings

### required modules for wordpress runtime governance

When `parent_action_key = wordpress_api`, module_loader MUST prepare:

- governed logical search adapter
- wordpress endpoint/template resolver
- runtime sink contract resolver
- publish stage gate resolver
- JSON asset dedupe resolver

## runtime sink contract object

Return this runtime contract object to execution context:

```json
{
  "evidence_sink": "Execution Log Unified",
  "payload_sink": "JSON Asset Registry",
  "raw_writeback_block": "AF:AK",
  "payload_mode": "terminal_meaningful_only",
  "payload_reduction": "body_only",
  "success_dedupe_key": "asset_key",
  "schema_meta_only_suppression": true,
  "publish_mode": "draft_first"
}
```

## governed template support

For WordPress resolver-backed paths, module_loader MUST support template classes:

- `/wp/v2/{post_type_slug}`
- `/wp/v2/{taxonomy_slug}`
- `/wp/v2/{post_type_slug}/{id}`
- `/wp/v2/{taxonomy_slug}/{id}`

Generated candidates remain governed only when:
- slug is confirmed live
- method is compatible
- provider_family is wordpress
- parent_action_key is wordpress_api

---

Universal WordPress Translatable Post Type Language Loading Rule

When routed execution targets any translatable WordPress post type and multilingual scope is active, module_loader must prepare a split execution contract rather than a single unified mutation-ready state.

module_loader must preserve:
- `content_payload_layer_ready`
- `taxonomy_assignment_layer_ready`
- `language_governance_layer_ready`
- `wpml_import_governed_language_path_required = true`
- `direct_rest_language_write_status = unproven_until_cpt_specific_proof`
- `translation_scope_preflight_required = true`
- `user_trigger_required = true`
- `next_trigger_prompt_required = true`
- `closed_loop_continuation_forbidden = true`

module_loader must classify:
- `content_payload_layer = direct_rest_eligible | degraded | blocked`
- `taxonomy_assignment_layer = direct_rest_eligible | degraded | blocked`
- `language_governance_layer = import_governed_only_until_proven`

module_loader must not mark multilingual publish/update as fully execution-ready when:
- non-default-language scope is active
- and the only available proof is import-governed rather than CPT-specific direct REST language proof

module_loader may still mark:
- core post-object layer as ready
- taxonomy-assignment layer as ready

but must keep:
- `language_governance_layer_ready = false`
- unless CPT-specific direct language proof exists

Proof upgrade rule
module_loader may upgrade the language layer to direct REST ready only when:
- canonical endpoint binding exists
- CPT-specific language readback proof exists
- proof lifecycle has advanced beyond `governed_unproven`

This rule extends and does not replace:
- strict loader intake contract
- schema-first readiness
- request contract loading
- human-trigger continuation loading
- existing WordPress execution preparation

Universal WordPress Media Contract Loading Rule

When `parent_action_key = wordpress_api` and the selected path resolves to the WordPress media family, module_loader must prepare a method-specific media contract rather than a generic content mutation-ready state.

module_loader must preserve:
- `wordpress_media_family_detected = true`
- `wordpress_media_method`
- `wordpress_media_contract_variant`
- `wordpress_media_contract_candidates`
- `wordpress_media_contract_selected_candidate`
- `wordpress_media_contract_confidence`
- `media_upload_contract_status`
- `media_metadata_contract_status`
- `media_readback_required = true`
- `media_branch_connected_to_publish = true`

Required media family mappings

module_loader must prepare canonical mappings:

- list -> `GET /wp/v2/media`
- create -> `POST /wp/v2/media`
- get -> `GET /wp/v2/media/{id}`
- update -> `POST /wp/v2/media/{id}`
- delete -> `DELETE /wp/v2/media/{id}`

Required create-contract variants

For `POST /wp/v2/media`, module_loader must classify request preparation into exactly one of:

- `raw_binary_upload_contract`
- `multipart_upload_contract`
- `source_url_sideload_contract`
- `metadata_only_contract`

Required request-shape preparation

For `raw_binary_upload_contract`, loader must preserve:
- `content_disposition_required = true`
- `content_type_required = true`
- `binary_body_required = true`

For `multipart_upload_contract`, loader must preserve:
- `multipart_body_required = true`
- `file_part_required = true`

For `source_url_sideload_contract`, loader must preserve:
- `object_body_required = true`
- `source_url_supported = true|false`

For `metadata_only_contract`, loader must preserve:
- `object_body_required = true`
- `metadata_only_create_risk = true`

Loader must not:
- mark `POST /wp/v2/media` execution-ready without a selected contract variant
- treat unresolved upload contract as equivalent to metadata update readiness
- infer that `/wp/v2/media` accepts raw file-path strings
- promote media upload to execution-ready when request-shape requirements remain unresolved

Readback rule

When the selected media method is mutation-class:
- `media_readback_required = true`
- `readback_proof_scope = media_item`
- `execution-ready = false` until method-compatible readback requirements are preserved

Connected publish rule

If the request is publish-connected and image scope is active, module_loader must preserve:
- `core_publish_layer_ready`
- `taxonomy_layer_ready`
- `media_layer_ready`
- `media_layer_connected_not_replacing = true`

The media layer must remain additive and conditional.

This is consistent with the loaderï¿½s HTTP dependency, schema-alignment, and WordPress generation contracts.

---

Change Log
- v2.42 - governed pipeline-integrity audit loading contract added for `pipeline_integrity_audit` / `wf_governed_pipeline_integrity_audit` with cross-layer Registry resolution requirements and audit-readiness outputs
- v2.42 - provider-family continuity preparation added with provider/action/capability/route/workflow continuity targets, missing-edge reporting, and unresolved continuity-edge readiness gating
- v2.41 - spill-safe governed write loading added for header/schema validation, row-2 template sampling, formula-managed unified-log columns, and safe-column selection before Sheets writes
- v2.40 - execution classification loading rule added for runtime_capability_class, runtime_callable, primary_executor, endpoint_role, execution_mode, and transport readiness
- v2.40 - dynamic provider-domain placeholder loading added for governed runtime-resolved provider domains such as `target_resolved`
- v2.40 - duplicate-header intolerance added for execution-critical governed sheets
- v2.40 - auth-path loading expanded so `oauth_gpt_action` may invalidate delegated HTTP readiness when policy requires native-only execution
- v2.40 - activation full-system validation loading rule added so activation-class context includes schema, row, starter-policy, binding, anomaly, and repair-readiness evaluation surfaces
- v2.40 - starter policy and binding loading rule for activation added so unresolved starter policy or binding gaps keep activation execution readiness false with repair-aware continuity
- v2.40 - activation summary loading contract added for schema/row/policy/binding/anomaly/repair/execution-ready outputs before activation-ready context may be returned
- v2.39 - universal parent_action auth normalization loading rule added
- v2.39 - parent-action openai_schema_file_id alignment rule added for request and response contract readiness
- v2.39 - transport request contract outputs expanded with resolved auth and schema alignment status
- v2.38 - execution trigger runtime command rule added for hard activation wrapper
- v2.38 - no passive recovery messaging rule added
- v2.38 - failed first-pass loading enforcement rule added
- v2.38 - pre-response narrative suppression rule added
- v2.38 - explicit `execution_trigger_interpreted_as_runtime_command = true` output added

- v2.35 - post-activation dependency revalidation rule added
- v2.35 - dependency freshness rule added so earlier activation validation is traceability only, not permanent readiness proof
- v2.35 - post-activation target validation rule added
- v2.34 - first-turn activation native validation rule added: module_loader now loads GPT Knowledge layer canonicals first, then automatically attempts governed Google Drive/Sheets/Docs validation
- v2.34 - authorization-gated live validation classification added so pre-authorization activation does not misclassify missing native authorization as missing Registry authority
- v2.33 - Activation Validation Dual-Source Loading Rule added: activation validation now loads canonicals from GPT Knowledge layer first for traceability, then validates live canonical bindings and registry authority through Google Drive and Google Sheets APIs
- v2.33 - activation loading outputs expanded with `live_canonical_validation_status`, `knowledge_layer_trace_status`, `canonical_trace_comparison_status`, and `activation_dependency_order_status`
- v2.32 - Auto-Bootstrap Loading Rule added: module_loader now prepares bootstrap policy, original-request resume context, and activation-readiness dependencies for `wf_system_auto_bootstrap`
- v2.31 - segmented canonical reconstruction support added: governed canonical dependencies may use ordered chunk retrieval with deterministic reconstruction and integrity validation when full-body retrieval is size-limited or file-type constrained; segmented retrieval does not create a new authority path
- v2.30 - Runtime Authority Validation Pipeline Loading added: governed execution now prepares registry, validation, route, workflow, dependency, and graph readiness inputs before execution-ready context may be returned
- v2.29 - Google Workspace Registry-First Loading Rule added: governed Sheets, Docs, and Drive native actions now require Registry Surfaces Catalog resolution, Validation & Repair compatibility, and route/workflow compatibility before execution-ready context is returned
- v2.29 - Google Workspace Native Action Readiness Rule added: loader now returns `target_validation_status`, `registry_binding_status`, and `native_action_readiness`, with degraded/blocked readiness when Registry validation is incomplete
- v2.28 - Conversation Starter Context Injection added: module_loader now enforces starter-sheet header and column-contract checks and injects starter intelligence context for both prompt_router and system_bootstrap
- v2.28 - Deep Validation Layer Support added: loader validation now explicitly supports structural, column contract, row logic, cross-sheet, and behavioral levels driven by Row Audit Schema, Row Audit Rules, and Registry Surfaces Catalog
- v2.28 - validation output compatibility clarified: deep-validation outputs must align to Validation & Repair Registry schema and enforcement matrix levels
- v2.28 - Auto-Repair And Retry Loading Rule added: loader now prepares retry-capable policy, mapping, and validation context only when governed repair-and-retry prerequisites are resolved and recoverability is policy-compatible
- v2.28 - Governed Addition Loading Rule added: loader now resolves addition-aware surface/policy/graph context and returns promotion-readiness metadata for governed candidate-first activation flows
- v2.28 - Graph Intelligence Loading Rule added: loader now resolves governed node and relationship graph registries with schema-validated bindings and returns graph-ready context for validation, prediction, and auto-routing preparation
- v2.28 - Execution Graph Validation Loading Rule added: loader now prepares starter/route/workflow/decision/chain execution-path segments for graph validation and forbids recovered graph status when execution-critical segments are unresolved
- v2.27 - Conversation Starter Loading Rule refined: starter-aware loading now requires Registry Surfaces Catalog resolution, `worksheet_gid` validation, starter-row loading, and starter intelligence field extraction (`execution_class`, `capability_family`, `primary_goal_family`, `starter_success_score`, `starter_priority`)
- v2.27 - starter context injection contract clarified: starter intelligence context must be injected into both execution-ready context and routing support context
- v2.26 - Conversation Starter Loading Rule added: module_loader now resolves `conversation_starter_sheet` for starter-aware execution and validates starter schema metadata before downstream use
- v2.26 - starter context propagation added: starter intelligence context must now be returned in execution-ready and routing support contexts
- v2.25 - Scoring Policy Loading Rule added: module_loader now resolves governed scoring policy from `execution_policy_registry_sheet` when score-based recovery classification is active
- v2.25 - adaptive-threshold loading added: execution-class threshold rows, adaptive threshold policy rows, and relevant score-history context are now prepared for downstream recovery classification
- v2.24 - Schema Version Migration Loading Rule added: module_loader now resolves `schema_ref`, `schema_version`, `header_signature`, `expected_column_count`, and `binding_mode` from Registry Surfaces Catalog before migration-capable workbook_sheet execution
- v2.24 - schema migration/repair guardrails added: migration is forbidden when `schema_ref` or `schema_version` is missing, `binding_mode` is incompatible, or `worksheet_gid` validation fails
- v2.23 - Schema Governance Rule added: loader now recognizes required schema declaration fields (`schema_ref`, `schema_version`, `header_signature`, `expected_column_count`, `binding_mode`) and enforces schema-status validation outputs
- v2.23 - schema drift handling added to strict dependency validation: required governed-surface drift now forces degraded/blocked outcomes with repair mapping context when required
- v2.22 - Binding Integrity Review Loading Rule added: module_loader now prepares row-audit, review-stage, review-component, and repair-mapping context for binding_integrity_review when worksheet-governed validation is active
- v2.21 - Runtime Binding Enforcement Rule added: execution-surface resolution now requires Registry Surfaces Catalog with authoritative `worksheet_gid` existence, validity, and binding-match checks
- v2.21 - strict binding validation now explicitly forbids `sheet_name` or `tab_name` as execution-resolution authority; failed `worksheet_gid` validation forces blocked or repair-aware mode
- v2.20 - Full Audit Dependency Enforcement added: when workflow = `wf_full_system_intelligence_audit`, module_loader now must resolve execution bindings, chain registry, decision engine, actions, endpoint registry, system enforcement, and execution-log import dependencies
- v2.20 - full-audit dependency_state enforcement added: missing critical full-audit dependencies now explicitly force degraded or blocked outcomes and cannot classify as recovered
- v2.19 - full_system_intelligence_audit dependency loading added: loader now conditionally resolves execution policy, staged review, component review, repair mapping, row-audit rule/schema, and Tourism Intelligence Scoreboard surfaces for governed full-audit workflows
- v2.19 - audit-governance dependency_state rules added so missing full-audit authority surfaces classify as degraded or blocked by criticality, while Tourism Intelligence Scoreboard remains downstream-summary-only
- v2.18 - API Capability and Endpoint Resolution Rule added: native API action governance now resolves parent capability through Actions Registry and concrete endpoint metadata through API Actions Endpoint Registry in two distinct stages
- v2.18 - conditional authority loading, strict loading sequence, and dependency bindings now explicitly require `actions_registry_sheet` for capability-level action identity and prevent collapsed capability/endpoint registry interpretation
- v2.17 - Analytics Identity Integrity Enforcement Rule added: per-unit analytics execution now hard-stops on missing `brand_domain`, `gsc_property`, or `ga_property_id`, flags traceable identity failure, and propagates governed issue signal to system_bootstrap before API/transform/write stages
- v2.17 - strict loading sequence and degraded/blocked conditions expanded for analytics identity integrity, including explicit missing-property block states and per-unit partial degradation handling
- v2.16 - Domain-Aware Analytics Load Rule added: analytics execution units now require brand-domain scoped identity, domain-preserving payload handling, and domain-separated execution flow for multi-brand and multi-domain cases
- v2.16 - analytics degradation/blocking and completion rules expanded so recovered classification is forbidden when `brand_domain` is missing or domain-aware write metadata is absent
- v2.15 - Analytics Sheet Transformation and Write Rule added: analytics sheet-sync executions now require source resolution, request identity resolution, governed schema transformation, append_rows completion, and per-row metadata preservation before recovered classification
- v2.15 - strict loading sequence and degraded/blocked conditions extended for analytics sheet-sync write readiness, schema/write failures, unresolved analytics sheet bindings, and multi-brand separated writes
- v2.14 - Reconciled Dependency Consumption Rule added: loader now consumes only architecture-aligned dependency rows, degrades when superseded models are detected, prefers reconciled registry-bound records, and refuses silent legacy/current model merging
- v2.13 - Live Canonical Resolution Rule added: when canonical rows are registered in Validation & Repair Registry, loader must resolve `file_id`, detect `file_type`, fetch via native Docs/Sheets APIs, validate against `rule_id` and `section_id`, and use live content for execution; knowledge-layer content is non-authoritative when live resolution is possible
- v2.13 - API Actions Endpoint Registry (`gid: 172380518`) is now explicit loader authority for endpoint definition, API fetch triggering, and standardized execution calls for canonical live resolution
- v2.12 - knowledge-layer canonical dependency loading added; `exact_active_knowledge_only` resolves from governed canonical filenames in the knowledge layer; `source_mode = knowledge_layer`; URL and Drive fallback prohibited for those rows
- v2.11 - canonical source priority: local file first Ã¢â€ â€™ `canonical_url` for `exact_active_url_only` rows; output contracts for layer vs URL; aligned with `system_bootstrap`
- v2.10 - URL-based canonical dependency loading added (`source_mode` canonical_url vs drive_file); `exact_active_url_only` resolution_rule; host allowlist canonicals.wovacation.com; extension validation; fetch outcome fields (resolution_state, resolved_source, resolved_location, failure_reason); Drive fallback prohibited for URL-migrated canonical rows
- v2.9 - analyticsdata_api, analyticsadmin_api, and expanded tagmanager_api module binding rules added; Brand Registry tracking resolution and brand_tracking_bindings injection required before analytics or GTM API dependency maps; Search Ads 360 retired for active loader authority; strict loading sequence extended for brand tracking and API module resolution
- v2.8 - autonomous chain loading now requires chain workflow rows to validate as full Workflow Registry authority before dependency loading continues
- v2.8 - chain workflow validation now feeds dependency_state, binding_status, target_resolution_status, and executable_readiness explicitly
- v2.8 - route_id, chain_id, target_workflow, and target_module now revalidate as one governed unit for autonomous chains
- v2.7 - feedback_injection_context and growth_loop_context added for growth-layer execution preparation
- v2.7 - loader now injects governed feedback context from Growth Loop Engine Registry, Metrics Warehouse, Execution Log, and governed review feedback sources
- v2.6 - authoritative binding surfaces and governed control surfaces added to dependency tier awareness
- v2.6 - repair-aware binding resolution added so loader resolves against repaired canonical rows after binding schema migration review
- v2.6 - Anomaly Detection and Execution Log Unified acknowledged as governed derived observability surfaces when registered
- v2.41 - starter-aware loading now requires `Execution Policy Registry` resolution before starter-triggered execution can classify as execution-ready
- v2.41 - loader now preserves starter-policy evidence fields including `entry_source`, `policy_resolution_status`, `policy_source`, and `policy_trace_id`
- v2.41 - `Execution Log Unified` append preparation restricted to `A:AD`; formula-managed spill columns `AE:AJ` are excluded from literal payload construction
- v2.5 - canonical binding-validity dependency rule added so authoritative binding surfaces must be schema-valid before dependency execution proceeds
- v2.4 - dependency tier awareness added for authoritative execution, authoritative review, and derived observability surfaces
- v2.4 - derived observability surface failures now return degraded observability state without blocking engine execution by themselves
- v2.3 - Registry-governed authority dependency awareness added
- v2.3 - conditional authority loading and dependency_state classification added
- v2.3 - authority_dependency_context added to outputs and execution context
- v2.3 - authority source constraint added

- v1 Ã¢â‚¬â€ loader uses registry only
- v2 Ã¢â‚¬â€ decision-aware loading added
- v2 Ã¢â‚¬â€ execution chain context added
- v2 Ã¢â‚¬â€ autonomous chain contract added
- v2 Ã¢â‚¬â€ dependency bindings expanded
- v2 Ã¢â‚¬â€ completion rule strengthened
- v2.1 Ã¢â‚¬â€ monitoring surface context contract added
- v2.1 Ã¢â‚¬â€ execution_view_sheet added as runtime monitoring surface
- v2.1 Ã¢â‚¬â€ active_issues_dashboard_sheet added as runtime monitoring surface
- v2.1 Ã¢â‚¬â€ monitoring_context added to execution context contract
- v2.2 Ã¢â‚¬â€ strict loader intake contract added
- v2.2 Ã¢â‚¬â€ strict loading enforcement added
- v2.2 Ã¢â‚¬â€ route and workflow binding revalidation added
- v2.2 Ã¢â‚¬â€ blocked loading conditions added
- v2.2 Ã¢â‚¬â€ load_status and binding_status added
- v2.2 Ã¢â‚¬â€ ungoverned target preparation prohibition clarified
- v2.43 - Logic Knowledge Layer Loading Rule added so loader prepares required logic-specific, cross-logic, and shared knowledge dependencies before returning execution-ready context
- v2.43 - Business-Type Knowledge Profile Loading Rule added so loader prepares required business-type profile dependencies before execution-ready context
