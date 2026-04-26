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

module_loader must preserve that activation-transport evidence and authoritative unified-log continuity are separate readiness requirements.

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
- `activation_transport_attempt_required` when activation-class loading requires native connection enforcement
- `live_canonical_validation_required` when activation-class loading requires live canonical validation
- `activation_transport_attempted`
- `activation_transport_status`
- `activation_transport_evidence`
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
- resolved business_intelligence_scoreboard_sheet when downstream full-audit scoring propagation is required
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
- if `provider_domain` is a variable placeholder, agent-runtime-side resolution requirements are preserved for downstream execution assembly

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
- module_loader must preserve that `provider_domain` requires agent-runtime-side override to Brand Registry `brand.base_url`

For non-WordPress APIs:
- module_loader must preserve endpoint-row `provider_domain` unchanged unless the endpoint definition explicitly declares a variable placeholder requiring agent-runtime-side resolution

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

The loader must not stop at file discovery when governed transport validation is possible.
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
