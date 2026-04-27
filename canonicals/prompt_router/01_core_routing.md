### HTTP Client Variable-Aware Routing Rule

prompt_router must not route governed HTTP execution by intent match alone when the candidate route or workflow requires governed variables that are missing, ambiguous, not execution-ready, or not compatible with canonical HTTP client execution.

For selected or candidate HTTP routes/workflows, prompt_router must preserve when applicable:
- `required_variable_profiles`
- `input_contract_profiles`
- `required_variables`
- `resolved_variables`
- `missing_variables`
- `clarification_required_variables`
- `variable_contract_status`
- `provider_domain_resolution_status`
- `resolved_provider_domain_mode`
- `request_schema_alignment_status`
- `transport_request_contract_status`

If multiple governed route candidates are semantically valid, prompt_router must prefer the candidate with:
1. complete required variable contract coverage
2. valid runtime binding compatibility
3. fewer unresolved required variables
4. less clarification burden
5. higher governed HTTP execution readiness

If a route requires variables that are missing but collectable:
- prompt_router must route to clarification or governed variable collection
- direct executable HTTP routing is forbidden

If a route requires variables that are missing and not safely collectable:
- prompt_router must degrade or block rather than emit executable HTTP routing

Prompt-First Actionability Routing

When routing detects:
- governance drift
- repairable anomaly
- audit completion with next step
- starter-route-workflow-policy inconsistency

prompt_router should prefer:
1. validation route
2. normalized anomaly emission route when governed
3. user trigger prompt for the next recommended step

rather than autonomous continuation into downstream execution.

### HTTP Client Variable Contract Preservation Rule

For governed HTTP execution, prompt_router must preserve variable-contract readiness for canonical transport fields:
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

prompt_router must not emit executable HTTP routing when:
- delegated transport variables lack active contract rows
- runtime-binding profiles are unresolved
- required transport variables are unresolved
- clarification is required but has not been handled
- promoted wrapper routing fields would not preserve canonical top-level routing fields

Executable HTTP routing must preserve:
- `required_variable_contracts`
- `runtime_binding_profile`
- `variable_contract_status`
- `variable_resolution_status`
- `request_schema_alignment_status`
- `transport_request_contract_status`

### General Variable-Aware Routing Extension Rule

The HTTP client variable-aware routing rules must also be treated as the canonical routing model for non-HTTP governed execution when route, workflow, or starter readiness depends on declared governed variables.

For non-HTTP governed execution, prompt_router must still preserve when applicable:
- `required_variable_profiles`
- `input_contract_profiles`
- `required_variables`
- `resolved_variables`
- `missing_variables`
- `clarification_required_variables`
- `variable_contract_status`

If required variables are missing but collectable:
- prompt_router must prefer clarification or governed variable collection

If required variables are missing and not safely collectable:
- prompt_router must degrade or block instead of emitting executable routing

The hardened activation routing wrapper is active:

- for plain `Activate System` and equivalent one-request activation prompts, `prompt_router` must emit a tool-first governed activation handoff
- the routed activation handoff must forbid user-facing narrative completion before at least one real governed activation transport attempt is executed or a same-cycle governed retry is exhausted
- the routed activation handoff must preserve:
  - `tool_first_execution_required = true`
  - `no_traceability_only_completion = true`
  - `tool_hesitation_retry_required = true` when policy allows same-cycle retry
  - `activation_transport_sequence_mode = registry_endpoint_first`
  - project-folder-scoped Google Drive discovery through folder `1gNYX47P4TNuMXEbWvLNCvV4XRocH41K2` when fallback discovery or canonical lookup is needed
- `system_activation_check` must remain reserved for explicit readiness-check phrasing and must not be preferred for plain `Activate System` when one-request activation is intended
- if downstream execution returns without a real governed activation transport attempt after the permitted same-cycle retry path, routing-compatible activation must be treated as failed enforcement



Exhaustive Full-System Audit Routing Guard

The exhaustive full-system audit routing guard is active:

- when intent resolves to `full_system_intelligence_audit`, routing must preserve:
  - `full_audit_coverage_required = true`
  - `full_audit_exhaustive_required = true`
  - `completion_guard = all_required_surfaces_validated`
  - `validation_depth_required = exhaustive`
- routing must not mark full-system audit execution-ready for recovered/full-success completion when exhaustive coverage requirements are unresolved
- routing output must preserve:
  - `required_surface_ids`
  - `required_row_group_ids` when governed row-group validation is active
  - `required_surface_count`
  - `required_row_group_count`
  - `coverage_guard_required`
- plain audit phrasing may route into the full-system audit workflow, but recovered/full-success wording remains blocked unless downstream exhaustive coverage evidence is returned



Unified Log Protected Columns and Spill-Safe Prewrite Guard

The governed write-safety rule is active:

- before any governed Google Sheets write, execution must first read and validate the live target header/schema against the expected governed header signature and column count when available
- then execution must read row 2 as the example/template row before selecting writable columns
- if row 2 or live column evidence indicates a spill formula, helper formula, arrayformula-managed range, formula-managed pattern, or protected/system-managed behavior, execution must avoid writing to that column
- direct governed/manual writes must never write, overwrite, or backfill the legacy formula-managed Execution Log Unified columns `target_module`, `target_workflow`, `execution_trace_id`, `log_source`, `Monitored Row`, and `Performance Impact Row`
- routing must preserve that those fields may exist in runtime execution context while remaining non-writable in direct append payload construction
- the active runtime write contract for `Execution Log Unified` is the compact 37-column contract through `performance_impact_row_writeback`
- trailing legacy protected columns may remain physically present on sheet but are outside the active server payload contract
- authoritative spill-safe runtime writeback target for the compact raw block is `AF:AK`
- routing must preserve that `JSON Asset Registry` is the durable payload sink while `Execution Log Unified` remains compact execution evidence
- when only a partial safe write set remains, execution must write only to safe non-spill columns and preserve protected or formula-managed columns untouched
- readback verification is required after governed writes that modify live Sheets surfaces

---

This document routes user intent into system workflows and governs decision-aware routing behavior.

It is also the canonical routing layer for:
- starter-governance validation routing
- governance-drift anomaly emission routing
- prompt-first continuation routing for governed next actions


It is the canonical routing layer for:
- route selection
- workflow matching
- decision-trigger evaluation
- route override handling
- execution chain initiation


---


Authority


This document governs:
- user-trigger-required routing preservation
- prompt-first next-step routing
- governance-drift validation and emission route preference
- route selection
- workflow matching
- execution class assignment
- decision-trigger evaluation
- route override resolution
- execution chain initiation
- fallback routing behavior
- repair-intent detection
- repair-route preparation

Cluster-Aware Repair Routing Preparation Rule

When governed routing receives anomaly or repair intents and cluster-aware anomaly intelligence is available, prompt_router may preserve cluster-aware repair preparation context including:
- `cluster_priority_propagation_required`
- `cluster_repair_recommended`
- `cluster_frequency_band`
- `cluster_confidence`

prompt_router must not:
- convert a governed recommendation into silent autonomous continuation when policy requires a user trigger
- bypass user-visible trigger preparation after anomaly normalization or repair classification
- treat anomaly clustering as raw execution authority
- bypass Task Routes or Workflow Registry because a cluster appears urgent

Cluster signals may strengthen repair-route preparation and urgency weighting, but must remain subordinate to:
- Registry authority
- Validation & Repair Registry compatibility
- governed repair execution prerequisites


This document does not govern:
- final execution
- logging
- dependency resolution
- dependency typing rules
- engine-level implementation logic
- memory schema design
- repair execution
- authority validation execution
- dependency remediation


Those responsibilities belong to their canonical dependency layers.


---

Binding Validity Dependency Rule

> Route preparation may proceed only when required surfaces resolve through `Registry Surfaces Catalog` and their validation state is compatible through `Validation & Repair Registry`. Deprecated legacy sheets must not be used as binding authority.

Registry Binding Enforcement Rule


`prompt_router` file existence, accessibility, or editability must not be treated as routing authority by itself.


`prompt_router` becomes execution-eligible only when all of the following are true:
- the file is registered as the active authoritative routing surface in `Registry Surfaces Catalog`
- the corresponding validation row is compatible in `Validation & Repair Registry`
- `Task Routes` resolves an active governed route row
- `Workflow Registry` resolves the governed executable workflow row aligned to that route


If the file exists but those bindings are absent, stale, conflicting, or unresolved:
- routing must classify as `degraded` or `blocked`
- `executable` must remain `false`
- direct file presence must not be used as a fallback authority signal
- recovery must point to Registry binding repair, not document-only editing


This rule prevents the routing layer from appearing healthy when the routing document exists but is not canonically bound to Registry authority.

Mandatory Runtime Validation Pre-Handoff Rule

prompt_router must not prepare final executable governed routing until runtime authority validation requirements are preserved in routing output.

For governed execution, routing output must preserve when available:
- runtime_authority_validation_required
- target_surface_id
- route_validation_required
- workflow_validation_required
- dependency_validation_required
- graph_validation_required when applicable

If mandatory runtime authority validation is required but unresolved, executable must remain false and routing must degrade or block by policy.

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

---


Inputs


Required inputs:
- user prompt
- Registry
- Task Routes
- Workflow Registry


Decision-aware inputs when available:
- decision_engine_registry_sheet
- execution_chains_registry_sheet
- review_stage_registry_sheet when staged review governance affects chain preparation
- review_component_registry_sheet when review-component execution context affects routing readiness
- execution_policy_registry_sheet when policy-aware routing behavior or repair-preparation context is required
- growth_loop_engine_registry_sheet when governed growth-loop routing or adaptive optimization is active
- resolved_review_control_signal when governed auto-repair routing is active
- resolved_adaptive_repair_route when governed adaptive repair escalation is active
- optimization_trigger when a prior governed execution qualifies follow-up optimization routing
- adaptive_optimization_context when governed priority weights or workflow preferences are available
- review_context when repair-loop skip, rerun qualification, or findings-driven repair routing is required
- repair_control_sheet when repair rerun qualification is required
- review_control_center_sheet when governed control-signal resolution is required
- split conversation starter authority surfaces when starter-aware routing is active:
  - `conversation_starters_main_surface` for normal user-facing starters
  - `conversation_starters_system_surface` for system, governance, monitoring, repair, runtime-validation, analytics-sync, and activation starters
- `conversation_starter_sheet` may be used only as a non-authoritative legacy fallback and must not make a route executable by itself
- knowledge_graph_node_registry_sheet when graph-based routing support is enabled
- relationship_graph_registry_sheet when graph-based routing support is enabled
- review findings summary when `incomplete_scope_lifecycle` or pre-execution block repair routing is required
- routing context
- prior audit or system signals when applicable


---


Outputs


This document must return:
- selected route
- selected workflow
- target_workflow
- execution type
- execution_class
- decision status
- route override status
- chain_id when triggered
- chain context when applicable

Strict Routing Contract

prompt_router is the mandatory routing entry point for all live platform executions.

All incoming requests must:
- normalize input
- classify intent
- resolve the active route from Registry authority
- return a structured execution plan
- stop at routing preparation and not perform workload execution

HTTP Generic API Routing Hint

Prompts involving:
- external API execution
- WordPress REST operations
- governed outbound HTTP requests

may resolve to:

- `target_module = http_generic_api`

Routing must still be validated through Task Routes and Workflow Registry.

prompt_router must not directly assume `http_generic_api` execution without Registry-backed route resolution.

When HTTP/OpenAPI execution is prepared:
- `provider_domain` must be treated as the primary execution server source
- `parent_action_key` and `endpoint_key` must resolve through governed Registry authority
- the authoritative parent action row must resolve through Actions Registry
- the authoritative parent action row must provide `openai_schema_file_id`
- execution preparation must remain compatible with the resolved YAML/OpenAPI contract

HTTP Execution Classification Routing Rule

When routing governed HTTP or OpenAPI execution, prompt_router must preserve the
Registry-governed execution classification contract and must not collapse distinct
execution paths into a generic HTTP-ready state.

Routing output must preserve when applicable:
- `runtime_capability_class`
- `runtime_callable`
- `primary_executor`
- `endpoint_role`
- `execution_mode`
- `transport_required`
- `transport_action_key`

prompt_router must require that:
- `native_direct` endpoints are not prepared for delegated HTTP transport execution
- `http_delegated` endpoints preserve delegated transport readiness requirements
- `external_action_only` capabilities are not treated as native execution-ready
- `pending_binding` capabilities are not treated as execution-ready

HTTP Schema-First Routing Enforcement Rule

When routing HTTP or OpenAPI execution:

- routing must preserve `openai_schema_file_id` as required execution input
- routing must not mark execution as ready when schema-bound parameters are unresolved
- routing must enforce that request construction is blocked until schema is read

Auth-Path Routing Preservation Rule

When preparing execution for a governed capability, prompt_router must preserve
auth-path readiness as part of execution preparation.

Routing output should preserve when available:
- `resolved_auth_mode`
- `credential_resolution_status`
- `transport_request_contract_status`

prompt_router must not prepare delegated HTTP execution as executable when:
- auth strategy is unresolved
- auth strategy normalizes to `oauth_gpt_action` and policy requires native-only handling
- delegated transport requirements remain unresolved

## HTTP Async Routing Rule

When the user intent or governed execution path requires asynchronous external API execution:

- prompt_router may route to governed async HTTP execution only when:
  - `http_generic_api` remains the authoritative transport
  - the selected action and endpoint are execution-ready
  - async execution is allowed by active Execution Policy Registry rows
  - job polling and result retrieval remain compatible with the selected workflow

prompt_router must preserve explicit route intent for:
- async job creation
- async job status polling
- async job result retrieval

prompt_router must not:
- collapse async lifecycle requests into generic sync HTTP execution
- bypass schema-first request preparation
- bypass parent action or endpoint authority
- bypass credential resolver chain requirements when per-target credentials apply

When `api_key_storage_mode = per_target_credentials`:
- prompt_router must preserve brand-bound target identity
- prompt_router must not downgrade target-bound execution into action-only auth resolution
- routed execution context must preserve the information needed for Brand Registry to Hosting Account Registry credential resolution

This keeps routing compatible with the async endpoints and the new credential chain. The need for this comes from the backend and policy, even though the current prompt_router snippet was not retrieved in full.

HTTP Connector-Scoped Resilience Routing Rule

When preparing HTTP execution:

- routing must not assume retry capability for all connectors
- retry readiness must only be attached when `parent_action_key` is listed in `Affected Parent Action Keys`
- resilience behavior must remain subordinate to schema validation and execution governance

Dynamic Provider-Domain Placeholder Routing Rule

When the authoritative endpoint row declares a placeholder `provider_domain`
such as `target_resolved`, prompt_router must preserve the placeholder as a
governed resolution state and must not treat it as a literal fixed domain.

Routing output must preserve:
- `provider_domain_resolution_status`
- placeholder detection status
- allowed runtime resolution source context when available

prompt_router must not mark execution-ready when placeholder provider-domain
resolution remains unresolved.

System Activation And Bootstrap Routing Rule

Prompts involving:
- activate system
- run full activation
- repair and activate system
- auto bootstrap
- system auto bootstrap
- automatic activation
- silent activation
- bootstrap system

must prefer:

- `intent_key = hard_activation_wrapper`
- `target_module = system_bootstrap`
- `target_workflow = wf_hard_activation_wrapper`

For this route, prompt_router must preserve the execution trigger:
- `use_governed_activation_transport_first = true`

Hard Activation Wrapper Routing Rule

For plain-language activation prompts including:
- `activate system`
- `run full activation`
- `repair and activate system`
- `auto bootstrap`
- `system auto bootstrap`
- `automatic activation`
- `silent activation`
- `bootstrap system`

prompt_router must prefer the governed interception route:

- `intent_key = hard_activation_wrapper`
- `target_module = system_bootstrap`
- `target_workflow = wf_hard_activation_wrapper`

This wrapper must execute before standard `system_auto_bootstrap` lifecycle orchestration and must preserve:
- `activation_transport_attempt_required = true`
- `activation_transport_same_cycle_required = true`
- `activation_transport_sequence_required = true`
- `activation_transport_sequence_mode = registry_endpoint_first`
- `knowledge_only_activation_forbidden = true`
- `live_canonical_validation_required = true`
- `runtime_authority_validation_required = true`
- `registry_validation_required = true`

Activation Scope Preservation Routing Rule

For plain `Activate System`, routed activation must preserve both:
- the prior governed activation lifecycle
- the expanded readiness scope for active downstream governance layers

prompt_router must not collapse activation into a narrower registry-only or canonical-only interpretation when the governed architecture also depends on:
- validation surfaces
- anomaly surfaces
- clustering signals
- repair surfaces
- control-center health signals

When the expanded governed layers are active, routed activation handoff should also preserve when available:
- `validation_layer_readiness_required = true`
- `anomaly_detection_readiness_required = true`
- `clustering_readiness_required = true`
- `repair_priority_readiness_required = true`
- `repair_control_readiness_required = true`
- `auto_repair_readiness_required = true`
- `control_center_health_required = true`

Activation Trigger Instruction Preservation Rule

When preparing the activation handoff, prompt_router must preserve the activation trigger instruction:

- `use_governed_activation_transport_first = true`

This means the activation handoff must require downstream execution to:
- trigger governed activation transport tools before narrative output
- block activation messaging until a real activation transport attempt occurs or the allowed same-cycle retry path is exhausted

Pre-Response Activation Routing Guard

For plain `Activate System`, prompt_router must prepare activation as execution-first, not explanation-first.

Routing output must preserve:
- `use_governed_activation_transport_first = true`
- `activation_transport_attempt_required = true`
- `pre_response_activation_guard = true`

If downstream execution returns without a native Google attempt:
- prompt_router must treat that pass as failed enforcement
- one bounded same-cycle retry may be prepared when policy allows
- passive narrative degraded output is not sufficient for successful activation handling

Activation Recovery Routing Rule

If activation reaches a state where:
activation_transport_attempted = false

The router must inject:

"Use governed activation transport first."

and re-route execution through the same activation flow.

Passive degraded output is not allowed at this stage.

If the hard activation wrapper route cannot be resolved:
- routing may fall back to `system_auto_bootstrap`
- fallback must remain explicit in routing traceability
- narrative-only activation preparation remains forbidden

Recovery Trigger Preservation Rule

When activation detects:
- `activation_transport_attempted = false`

prompt_router must not treat:
`Use governed activation transport first.`
as advisory narrative.

It must preserve it as a runtime execution trigger for the same activation cycle.

Prompts involving:
- activation check
- system activation check
- validate activation order
- check activation readiness
- validate system readiness
- activate via knowledge layer

may resolve to:

- `intent_key = system_activation_check`
- `target_module = system_activation_validation_engine`
- `target_workflow = system_activation_validation`

Routing must still be validated through:
- `Task Routes`
- `Workflow Registry`

prompt_router must not treat activation-check phrasing alone as sufficient execution authority.

Executable routing is allowed only when:
- an active governed Task Routes row resolves for `system_activation_check`
- an active governed Workflow Registry row resolves for `system_activation_validation`
- mandatory runtime authority validation requirements remain preserved in the execution preparation contract

When activation-check routing is selected, routing output should preserve:
- required authoritative surfaces
- phase-ordered validation expectation
- `runtime_authority_validation_required = true`
- `live_canonical_validation_required = true`
- `validation_source_requirement = repository_canonical_fetch_plus_governed_transport`
- `canonical_fetch_required = true`
- `canonical_fetch_transport = github_api_mcp`
- `canonical_fetch_action_key = github_api_mcp`
- `canonical_fetch_authority = repository_ref_pinned`
- `knowledge_layer_validation_only_for_traceability = true`
- `canonical_trace_required = true`

Activation-check routing must prepare knowledge-first validation semantics:
1. canonical files in knowledge layer are read first for traceability
2. repository-backed canonical files are fetched through `github_api_mcp`
3. activation transport is validated through `http_generic_api`
4. mutable registry bindings are validated through provider-specific endpoints only when required by registry governance
5. readiness classification must prefer live governed validation over knowledge-layer copies when both are available

knowledge layer canonical files are used for traceability first.
Governed HTTP client transport is used for runtime readiness authority.

Knowledge-layer canonical text must support traceability only and must not be treated as sufficient readiness authority when live governed validation is possible.

Activation-Check Scope Compatibility Rule

`system_activation_check` remains valid for explicit readiness-check phrasing and must not be removed.

However, when the active governed architecture includes expanded validation, anomaly, clustering, repair, or control layers, activation-check routing should preserve that those layers may be included in readiness evaluation when policy or workflow requires them.

This extends readiness-check scope and does not replace the narrower activation-check route identity.

First-Turn Activation Native-Connection Rule

On the first activation turn in a conversation, plain `Activate System` must still prefer the governed interception route:
- `intent_key = hard_activation_wrapper`
- `target_module = system_bootstrap`
- `target_workflow = wf_hard_activation_wrapper`

This first-turn preference remains valid even when governed transport validation is not yet connected or the system is not yet sheet-aware.

When activation transport connection, registry surface awareness, or workbook-sheet awareness is not yet established in the current execution path, `system_auto_bootstrap` may still be used only as:
- governed fallback when the hard activation wrapper cannot fully resolve
- governed continuation after wrapper interception
- bootstrap-before-resume lifecycle support

`system_auto_bootstrap` must not replace `hard_activation_wrapper` as the preferred plain-language activation interceptor.

This rule preserves:
- hard activation wrapper interception
- same-cycle native-attempt enforcement
- tool-first execution requirements
- bootstrap fallback and continuation semantics when pre-connection or pre-awareness state exists

Pre-Connection Bootstrap Compatibility Rule

Before activation has established governed transport and provider-specific live-surface awareness, the system may require bootstrap semantics to:
- establish first activation transport connection
- validate governed registry and workbook surfaces
- become sheet-aware for downstream activation checks

This requirement does not change the preferred plain activation entry route.

The preferred plain activation entry route remains:
- `hard_activation_wrapper`

Bootstrap semantics through `system_auto_bootstrap` are compatible only as fallback, continuation, or resume-support behavior.

Expanded First-Turn Activation Readiness Preservation Rule

For first-turn plain activation, prompt_router should preserve when available:
- `validation_layer_readiness_required`
- `anomaly_detection_readiness_required`
- `clustering_readiness_required`
- `repair_priority_readiness_required`
- `repair_control_readiness_required`
- `auto_repair_readiness_required`
- `control_center_health_required`

These are additive readiness signals and must not remove the older first-turn requirements for activation transport connection, traceability, or live canonical validation.

prompt_router must not classify first-turn activation as missing Registry authority solely because provider-specific authorization is not yet available.

Activation Enforcement Escalation Rule

For first-turn `Activate System` and equivalent activation prompts, prompt_router must emit a bootstrap handoff that requires an actual governed activation transport attempt in the same execution cycle.

Required activation handoff fields:
- `activation_transport_attempt_required = true`
- `activation_transport_same_cycle_required = true`
- `knowledge_only_activation_forbidden = true`
- `missing_activation_transport_attempt_classification = degraded`
- `missing_activation_transport_attempt_reason = missing_required_activation_transport_attempt`

If downstream execution returns without:
- `activation_transport_attempted = true`

then prompt_router-compatible activation must be treated as failed enforcement, not successful preparation.

prompt_router must not allow a user-facing activation result to be classified as:
- `active`
- `validated`
- `authorization_gated`

unless the downstream output explicitly preserves:
- `activation_transport_attempted`
- `activation_transport_status`
- `live_canonical_validation_status`

If the Google API attempt was not made, the route must be treated as:
- `route_status = degraded`
- `executable = false`
when re-preparing the same activation request.

Narrative compliance is forbidden.

The system must not report that governed transport validation was attempted, required, pending, or authorization-gated unless machine-readable attempt evidence is present in the same execution cycle.

Activation Routing Enforcement And Live Validation Handoff Rule

For prompts involving:
- `activate system`
- `system auto bootstrap`
- `bootstrap system`
- `automatic activation`
- `silent activation`

prompt_router must prepare an activation handoff that requires downstream execution to perform, in the same execution cycle:

1. knowledge-layer canonical traceability
2. at least one real governed HTTP transport call
3. live canonical validation through Drive or Docs when feasible
4. Registry surface validation through Sheets or Drive when feasible
5. route/workflow binding validation before activation completion

Required activation handoff fields:
- `activation_transport_attempt_required = true`
- `activation_transport_same_cycle_required = true`
- `activation_transport_sequence_required = true`
- `activation_transport_sequence_mode = registry_endpoint_first`
- `knowledge_only_activation_forbidden = true`
- `live_canonical_validation_required = true`
- `runtime_authority_validation_required = true`
- `registry_validation_required = true`
- `canonical_trace_required = true`
- `missing_activation_transport_attempt_classification = degraded`
- `missing_activation_transport_attempt_reason = missing_required_activation_transport_attempt`
- `registry_workbook_id` when available
- required `worksheet_gid` / `sheetId` bindings when available

Routing must preserve that activation is not complete after a connectivity-only call.

If downstream execution returns without:
- `activation_transport_attempted = true`

then routing-compatible enforcement must be treated as failed.

If downstream execution returns with:
- `activation_transport_attempted = true`
but without completion of feasible live canonical and registry validation, routing must not permit activation to be treated as:
- `active`
- `validated`

Routing must preserve readiness validation requirements for:
- `Registry Surfaces Catalog`
- `Validation & Repair Registry`
- `Task Routes`
- `Workflow Registry`

### Native Google Mutation Routing Clarification

For activation, validation, schema reconciliation, governed repair, registry refresh, validation-registry refresh, or other governed native Google write-affecting paths:

- `prompt_router` must distinguish:
  - `native_attempt_evidence_required`
  - `native_governed_mutation_logging_required`
- routing must not collapse governed mutation logging into connectivity evidence
- if the routed path includes governed native Google mutation, `logging_required` remains true
- routing must preserve that authoritative unified-log continuity is still required before final success phrasing

Activation Full-System Scan Routing Rule

For plain `Activate System`, prompt_router must preserve that activation is a full-system scan and not only a connectivity or canonical-availability check.

Activation handoff must preserve when available:
- `schema_integrity_required = true`
- `row_integrity_required = true`
- `starter_policy_validation_required = true`
- `binding_integrity_required = true`
- `execution_path_validation_required = true`
- `anomaly_summary_required = true`
- `repair_readiness_evaluation_required = true`

Activation Blocking Condition Routing Rule

If routing-context, loader-context, or prior validation context indicates any of the following:
- `policy_gap_detected = true`
- `binding_gap_detected = true`
- `schema_validation_status = degraded` or `blocked`
- row-integrity failure requiring repair
- activation-summary repair requirement

prompt_router must:
- keep `executable = false` for normal activation completion
- preserve repair-aware routing continuity
- forbid active/recovered activation classification in routing preparation

Activation Summary Preservation Rule

For plain `Activate System`, routing output must preserve when available:
- `activation_validation_summary_required = true`
- `activation_anomaly_summary_required = true`
- `activation_repair_summary_required = true`
- `activation_execution_readiness_required = true`

These summary requirements are additive to native Google attempt enforcement, live canonical validation, Registry validation, and route/workflow validation.

Manual-Trigger Repair Continuity Rule For Activation

When activation detects governed repair requirements that are not eligible for automatic repair:
- prompt_router must preserve repair-preparation context
- prompt_router must not silently continue to active activation classification
- prompt_router must preserve `manual_repair_trigger_required = true` when policy says repair is manual-triggered

Direct Governed Activation Transport Handoff Rule

For first-turn and plain-language activation prompts including:
- `activate system`
- `system auto bootstrap`
- `bootstrap system`
- `automatic activation`
- `silent activation`

prompt_router MUST emit an execution handoff that requires explicit governed activation transport execution in the same cycle, not merely narrative intent or downstream assumption.

Required direct handoff fields:
- `activation_transport_sequence_required = true`
- `activation_transport_mode = governed_http_client`
- `live_canonical_validation_transport = http_generic_api`
- `canonical_fetch_required = true`
- `canonical_fetch_transport = github_api_mcp`
- `canonical_fetch_action_key = github_api_mcp`
- `canonical_fetch_authority = repository_ref_pinned`
- `activation_transport_default = http_generic_api`
- `activation_transport_action_key = http_generic_api`
- `activation_transport_sequence_mode = registry_endpoint_first`
- `activation_transport_attempt_required = true`
- `activation_transport_same_cycle_required = true`
- `live_canonical_validation_required = true`
- `runtime_authority_validation_required = true`
- `registry_validation_required = true`
- `canonical_trace_required = true`
- `knowledge_only_activation_forbidden = true`

When available, prompt_router MUST also pass:
- `canonical_file_id_system_bootstrap`
- `canonical_file_id_prompt_router`
- `canonical_file_id_module_loader`
- `canonical_file_id_direct_instructions_registry_patch`
- `canonical_file_id_memory_schema`
- `registry_workbook_id`
- `registry_surfaces_catalog_gid`
- `validation_and_repair_registry_gid`
- `task_routes_gid`
- `workflow_registry_gid`

Required downstream execution order to preserve in handoff:
1. preserve knowledge-layer canonical traceability
2. fetch repository-backed canonicals through `github_api_mcp`
3. resolve activation transport capability through Actions Registry
4. resolve concrete validation endpoints through API Actions Endpoint Registry
5. execute governed HTTP client validation calls through `http_generic_api`
6. validate mutable workbook and authority-surface readiness through provider-specific endpoints only when required by registry governance
7. preserve machine-verifiable transport evidence for each attempted endpoint

Binding preference rule:
- when canonical file IDs, workbook IDs, or endpoint keys are present, registry-backed direct resolution is REQUIRED
- name-based discovery must not be the primary activation path unless selected as a provider-specific fallback by the registry
- title-only matching must be treated as degraded fallback behavior

Enforcement rule:
If prompt_router does not emit the fields above for activation-class routing:
- `route_status = degraded`
- `executable = false`
- `missing_activation_transport_attempt_reason = missing_required_activation_transport_attempt`

Classification guard:
prompt_router must not prepare a user-facing activation result compatible with:
- `active`
- `validated`
- `authorization_gated`

unless the activation handoff explicitly preserves:
- `activation_transport_sequence_required`
- `activation_transport_mode = governed_http_client`
- `live_canonical_validation_transport = http_generic_api`
- `activation_transport_attempt_required`
- `activation_transport_same_cycle_required`
- `live_canonical_validation_required`
- direct identifier fields when available

Narrative-only activation preparation is forbidden.

Auto-Bootstrap Routing Rule

Prompts or runtime conditions involving:
- system auto bootstrap
- automatic activation
- silent activation
- bootstrap system
- activation required before normal execution
- runtime authority missing before request execution

may resolve to:

- `intent_key = system_auto_bootstrap`
- `target_module = system_bootstrap`
- `target_workflow = wf_system_auto_bootstrap`

Routing must still be validated through:
- `Task Routes`
- `Workflow Registry`

prompt_router must not treat bootstrap phrasing alone as sufficient execution authority.

Executable routing is allowed only when:
- an active governed Task Routes row resolves for `system_auto_bootstrap`
- an active governed Workflow Registry row resolves for `wf_system_auto_bootstrap`
- mandatory runtime authority validation requirements remain preserved in the execution preparation contract

When auto-bootstrap routing is selected, routing output should preserve:
- required authoritative surfaces
- original_request_payload
- original_intent_candidate
- bootstrap_reason
- bootstrap_resume_required = true
- `runtime_authority_validation_required = true`
- `activation_transport_attempt_required = true`
- `activation_transport_same_cycle_required = true`
- `activation_transport_sequence_required = true`
- `activation_transport_sequence_mode = registry_endpoint_first`
- `authorization_gated_live_validation_allowed = true`
- `knowledge_layer_trace_first = true`
- `knowledge_only_activation_forbidden = true`
- `missing_activation_transport_attempt_classification = degraded`
- `missing_activation_transport_attempt_reason = missing_required_activation_transport_attempt`
- `registry_workbook_id` when available
- required `worksheet_gid` / `sheetId` bindings when available

prompt_router must never directly execute:
- business logic
- repair actions
- workflow handlers
- engine logic
- logging operations
- dependency remediation

For strict-mode routing enforcement, this document must also return:
- route_id
- route_status
- route_mode
- route_source
- matched_row_id
- intent_key
- target_module
- target_workflow
- lifecycle_mode
- memory_required
- logging_required when canonical execution logging is mandatory
- logging_sink_required
- pre_response_logging_guard
- findings_output_required when applicable
- anomaly_output_required when applicable
- repair_output_required when applicable
- review_required
- executable
- degraded_reason when applicable
- blocked_reason when applicable
- analytics_identity_failure when analytics identity pre-validation fails
- analytics_identity_issue_context when analytics identity pre-validation fails
- runtime_authority_validation_required when governed execution requires runtime validation
- registry_validation_required when governed execution requires Registry authority validation
- activation_transport_attempt_required when first-turn activation requires a governed activation transport attempt
- activation_transport_same_cycle_required when first-turn activation requires same-cycle attempt evidence
- knowledge_only_activation_forbidden when traceability-only activation is forbidden
- missing_activation_transport_attempt_classification when missing activation transport attempts require degraded classification
- missing_activation_transport_attempt_reason when missing activation transport attempts require explicit traceability reason
- target_surface_id when governed target identity is available
- route_validation_required when governed route validation is required
- workflow_validation_required when governed workflow validation is required
- dependency_validation_required when governed dependency validation is required
- graph_validation_required when graph-aware governed execution applies

Strict execution-plan handoff fields:

Routing output must be returned as an execution preparation contract for system_bootstrap.

The execution preparation contract must include:
- source = prompt_router
- route_id
- route_status
- route_mode
- route_source = registry_task_routes
- matched_row_id
- intent_key
- target_module
- target_workflow
- lifecycle_mode
- memory_required
- logging_required
- logging_sink_required
- pre_response_logging_guard
- findings_output_required when applicable
- anomaly_output_required when applicable
- repair_output_required when applicable
- review_required
- executable
- analytics_identity_failure when analytics identity pre-validation fails
- analytics_identity_issue_context when analytics identity pre-validation fails

When governed execution may use native Google Drive, Sheets, or Docs actions, the execution preparation contract must also preserve when available:
- `native_google_action_path_possible`
- `activation_transport_attempt_required`
- `activation_transport_same_cycle_required`
- `activation_transport_evidence_required`
- `native_google_mutation_logging_required`
- `native_google_validation_only_allowed`
- `native_google_execution_class`
- `native_google_execution_mode`
- `logging_sink_required`
- `pre_response_logging_guard`

If the routed path may perform governed mutation through governed activation transport tools:
- routing must preserve `native_google_mutation_logging_required = true`
- routing must preserve `logging_sink_required = surface.operations_log_unified_sheet`
- routing must not treat native Google tooling availability as sufficient completion evidence

When activation or bootstrap routing is selected, the execution preparation contract must also include when available:
- `activation_transport_attempt_required`
- `activation_transport_same_cycle_required`
- `knowledge_only_activation_forbidden`
- `live_canonical_validation_required`
- `runtime_authority_validation_required`
- `registry_validation_required`
- `canonical_trace_required`
- `missing_activation_transport_attempt_classification`
- `missing_activation_transport_attempt_reason`

When transport execution is HTTP or OpenAPI-driven, the execution preparation contract must also include when available:
- `provider_domain`
- `parent_action_key`
- `endpoint_key`
- `method`
- `path`
- `resolved_headers`
- `resolved_body`
- `openai_schema_file_id`
- `schema_contract_validation_status`

`provider_domain` is the primary execution server source for HTTP client requests.

If `provider_domain` for an endpoint is a variable placeholder, agent runtime must resolve it before execution.

For `parent_action_key = wordpress_api`, agent runtime must replace `provider_domain` with Brand Registry `brand.base_url` before execution.

For non-WordPress APIs, `provider_domain` must remain the endpoint-row value unless the endpoint definition explicitly declares a variable placeholder requiring agent-runtime-side resolution.

agent runtime must follow endpoint `parent_action_key` authority by resolving the authoritative parent action row through Actions Registry and its `openai_schema_file_id` / YAML binding before execution assembly.

Executable HTTP/OpenAPI routing preparation is incomplete unless:
- `parent_action_key` resolves
- `endpoint_key` resolves
- the parent action row resolves `openai_schema_file_id`
- the execution request remains compatible with the authoritative YAML/OpenAPI contract

prompt_router must preserve schema drift awareness signals when present:
- schema_drift_detected
- schema_drift_scope

prompt_router must not interpret or resolve schema drift.
Drift handling remains execution-layer responsibility.

When routing is degraded, output must also include:
- degraded_reason
- recovery_action

When routing is blocked, output must also include:
- blocked_reason

Scoring Threshold Traceability Rule

When governed scoring classification depends on execution class or adaptive threshold policy, prompt_router must preserve `execution_class` in the execution preparation contract for downstream threshold resolution.

prompt_router must not classify recovery status itself, but it must preserve routing context required for score-based classification.

### Surface Addition Auto-Branch Routing Rule

After governed addition classification, prompt_router must support deterministic branch routing for the universal addition control plane.

Resolved addition families must route as follows:
- `registry_surface_addition`
- `workbook_sheet_addition`
- `external_workbook_surface_addition`
  -> `wf_surface_addition_registry_branch`

- `route_addition`
- `workflow_addition`
- `execution_chain_addition`
  -> `wf_surface_addition_execution_branch`

- `graph_node_addition`
- `graph_relationship_addition`
- `decision_signal_addition`
- `growth_loop_addition`
  -> `wf_surface_addition_intelligence_branch`

- `policy_addition`
- `repair_mapping_addition`
- `autopilot_rule_addition`
- `governance_rule_addition`
  -> `wf_surface_addition_governance_branch`

- `brand_core_asset_addition`
- `derived_artifact_addition`
- `workbook_reference_addition`
- `governed_asset_addition`
  -> `wf_surface_addition_asset_branch`

If branch classification is ambiguous or conflicting:
- prompt_router must not guess
- prompt_router must route to:
  - `route.surface_addition_intake_manual_review.global.v1`
  - `wf_surface_addition_intake_manual_review`

### Addition Review Routing Extension

prompt_router must also support governed routing for:
- scoring refresh
- scoring writeback review
- verification-loop review
- framework-health review
- template lifecycle review
- template supersession review
- template health review
- template impact review
- template lineage review
