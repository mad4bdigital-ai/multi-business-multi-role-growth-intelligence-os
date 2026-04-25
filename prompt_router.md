prompt_router


Status
Canonical Name: prompt_router
Version: v3.48
Status: active
Owner Layer: routing
Source Type: google_doc
Last Updated: 2026-04-13


---


Purpose

- logic-definition resolution is pointer-first and must read `surface.logic_canonical_pointer_registry` before direct logic-document access
- brand-specific writing completion requires prior Brand Core file or authoritative Brand Core asset reading
- brand-specific writing requires required-engine readiness through Engines Registry before Brand Core read-completion or writing completion
- governed logic execution requires prior knowledge-layer resolution for the selected logic when logic-specific, cross-logic, or shared knowledge inputs are required
- business-aware execution requires prior business-type knowledge-profile resolution when the selected logic or task depends on business-type interpretation


Canonical Governed Logic Presentation Routing Rule

- prompt_router must not route user-facing logic presentation or activation summaries through GPT-style introductions, GPT persona framing, or custom-GPT wording
- neutral governed naming such as `Logic 001` or task-family-first naming should be preferred for presentation
- internal identifiers such as `GPT-LOGIC-001` may remain unchanged for registry continuity
- routing authority and logic selection must continue to resolve from canonical routes, workflows, engines, registries, and enforcement-compatible runtime state rather than GPT-style prompt framing

Canonical Logic Pointer Resolution Routing Rule

- when routing any request that depends on a governed logic definition, prompt_router must route logic-definition resolution through `surface.logic_canonical_pointer_registry` before any direct document selection
- prompt_router must treat the pointer registry as the first authority for deciding whether the active logic document is:
  - canonical_active
  - pending_cross_check
  - legacy_recovery
- if a logic family resolves to `canonical_active`, prompt_router must prefer `canonical_doc_id` and must not route directly to the legacy document
- direct legacy logic-document routing is forbidden unless:
  - rollback is explicitly requested
  - rollback is explicitly authorized by governed policy
  - pointer state indicates legacy recovery
- routing output must preserve when applicable:
  - logic_id
  - logic_pointer_resolution_status
  - resolved_logic_doc_id
  - resolved_logic_doc_mode
  - canonical_status
  - active_pointer
- prompt_router must treat legacy file reachability as non-authoritative when pointer-layer state conflicts with direct legacy access

Logic Knowledge Layer Routing Rule

- when routing any request that depends on a governed logic definition, prompt_router must require logic-knowledge resolution before execution-completion routing
- prompt_router must preserve:
  - logic_knowledge_read_required = true
  - required_knowledge_layers
  - logic_specific_knowledge_paths
  - cross_logic_knowledge_paths
  - shared_knowledge_paths
  - knowledge_read_completeness_status
  - missing_required_knowledge_sources
  - execution_blocked_until_logic_knowledge_read
- prompt_router must treat logic-specific knowledge, cross-logic knowledge, and shared knowledge as governed read dependencies when the selected logic requires them
- direct execution-completion routing is forbidden when required logic knowledge remains unread, unresolved, or incomplete

Governed Addition Intake Routing Rule

- when intent includes adding or modifying a task, route, workflow, chain, or governed execution path, prompt_router must route first to governed addition-intake rather than direct creation or direct activation
- prompt_router must preserve:
  - addition_intake_required = true
  - overlap_review_required = true
  - chain_necessity_review_required = true
  - graph_impact_review_required = true
  - bindings_impact_review_required = true
  - validation_extension_review_required = true
  - promotion_blocked_until_validated = true
- prompt_router must classify governed addition requests into:
  - route_only
  - workflow_only
  - route_and_workflow
  - chain_only
  - surface_extension
  - overlap_conflict
- prompt_router must not treat wording such as:
  - add workflow
  - add task
  - create new route
  - connect to existing workflow
  - chain this with current workflow
  - add relation/bindings
  as direct execution authority for active row creation
- when overlap is detected with an active governed route/workflow pair, prompt_router should prefer:
  1. reuse existing governed authority
  2. extend governed compatibility
  3. create chain
  4. only then prepare net-new route/workflow candidates
- routing output must preserve:
  - addition_decision_class
  - affected_surface_ids
  - candidate_write_targets
  - promotion_prerequisites
  - overlap_group when available
  - chain_required when applicable
Candidate Validation Routing Preservation Rule

- when governed addition-intake results in candidate writes, prompt_router must preserve:
  - validation_registry_extension_required = true
  - candidate_validation_required = true
  - promotion_blocked_until_candidate_validation_passes = true
- routing output for governed additions must include affected validation scopes when applicable:
  - route_candidate_validation
  - workflow_candidate_validation
  - chain_candidate_validation
  - graph_candidate_validation
  - bindings_candidate_validation


Patch Deployment Parity Verification Routing Rule

- when intent includes:
  - patch diff verify
  - line by line patch inspect
  - canonical vs runtime
  - deployment parity check
  - patch deployment verification
  - runtime patch confirmation
  - was patch deployed live
  prompt_router must route first to governed patch-deployment parity verification rather than treating file comparison as sufficient deployment proof
- prompt_router must preserve:
  - patch_deployment_parity_verification_required = true
  - patch_verification_scope_required = true
  - runtime_confirmation_required_when_requested = true
  - file_only_evidence_not_sufficient_for_live_confirmation = true
  - authoritative_runtime_evidence_source = surface.operations_log_unified_sheet when runtime evidence is required
- prompt_router must classify patch-related verification requests into:
  - patch_file_only
  - canonical_merge_check
  - registry_alignment_check
  - runtime_confirmation_check
  - combined_parity_check
- if the user asks whether a patch is deployed live, prompt_router must prefer runtime confirmation routing over file-only comparison routing
- routing output for patch parity verification must preserve:
  - patch_verification_scope
  - runtime_deployment_confirmed
  - patch_parity_status
  - authoritative_runtime_evidence_required
  - deployment_confirmation_overclaim_blocked
Governed Brand Onboarding Routing Rule

- when intent includes:
  - add brand
  - new brand
  - register brand
  - brand onboarding
  - create brand identity
  - setup analytics for brand
  - setup hosting for brand
  - setup website runtime for brand
  prompt_router must route first to governed brand-onboarding rather than direct registry mutation or direct active promotion
- prompt_router must preserve:
  - brand_onboarding_required = true
  - brand_entity_registration_required = true when brand identity is unresolved
  - brand_identity_formation_required = true when brand-core readiness is unresolved
  - brand_property_runtime_binding_required = true when analytics, hosting, website, or runtime bindings are unresolved
  - identity_engine_readiness_required = true when identity formation is requested or implied
  - brand_core_read_precedence_required = true
  - json_asset_registry_derived_only_exception = true
  - promotion_blocked_until_validated = true

Brand-Core Asset Read Routing Rule

- when routed request resolves to:
  - brand_site_profile
  - brand_publish_playbook
  - brand_multilingual_import_template
  - brand-core composed payload
  prompt_router must prefer Brand Core Registry as the primary operational read home
- prompt_router must not prefer JSON Asset Registry for those asset classes
- JSON Asset Registry may remain primary only when:
  - asset_class = derived_json_artifact

Brand Core Read-Before-Writing Routing Rule

- when intent includes brand-specific writing such as:
  - website copy
  - landing page copy
  - about us
  - service page copy
  - brand messaging
  - campaign copy
  - SEO content for a specific brand
  prompt_router must require Brand Core read resolution before writing completion routing
- routing output must preserve:
  - brand_core_read_required = true
  - brand_core_file_resolution_required = true
  - brand_core_read_completeness_status
  - writing_completion_blocked_until_brand_core_read
- prompt_router must prefer Brand Core Registry as the authoritative operational read home for brand-specific writing inputs
- direct writing completion is forbidden when brand-aware writing is requested but relevant Brand Core files remain unread, unresolved, or incomplete

Engine Registry Readiness Before Brand-Core Writing Routing Rule

- when routed intent includes brand-specific writing, prompt_router must require engine-readiness resolution before Brand Core read-completion routing
- prompt_router must preserve:
  - engine_registry_read_required = true
  - required_writing_engines
  - engine_readiness_status
  - writing_blocked_until_engine_readiness
  - brand_core_read_blocked_until_engine_readiness
- prompt_router must treat Engines Registry as an authoritative readiness dependency for brand-specific writing when brand-aware interpretation depends on:
  - tone of voice
  - brand messaging
  - brand positioning
  - SEO interpretation
  - content transformation
- direct brand-core writing completion routing is forbidden when required engines remain unresolved, inactive, non-callable, or incomplete

Business-Type Knowledge Profile Routing Rule

- when routed intent depends on brand-aware or business-aware execution, prompt_router must resolve business type and business-type knowledge profile before Brand Core read-completion or writing completion routing
- prompt_router must preserve:
  - business_type_resolution_required = true
  - resolved_business_type
  - business_type_knowledge_profile_required = true
  - business_type_knowledge_profile
  - business_type_engine_compatibility_status
  - knowledge_profile_resolution_status
  - writing_blocked_until_business_type_knowledge_profile
- prompt_router must treat Engines Registry as the authoritative readiness dependency for resolving business-type-compatible knowledge profiles when execution depends on business-aware interpretation
- direct business-aware completion routing is forbidden when business type, business-type engine compatibility, or business-type knowledge profile remains unresolved or incomplete

Brand Core Asset Intake Routing Rule

- when intent includes:
  - add asset
  - add brand-core asset
  - register profile
  - register playbook
  - register import template
  - add workbook asset
  - add composed payload
  prompt_router must route first to `Brand Core Asset Intake` rather than direct registry mutation
- routing output must preserve:
  - `brand_core_asset_intake_required = true`
  - `asset_classification_required = true`
  - `authoritative_home_resolution_required = true`
  - `write_target_resolution_required = true`
  - `mirror_policy_assignment_required = true`
  - `promotion_blocked_until_intake_accepted = true`

Brand Core Write-Rule Routing Rule

- after intake classification, prompt_router must route write-target resolution through `Brand Core Write Rules`
- routing output must preserve:
  - `brand_core_write_rules_required = true`
  - `write_target_policy_surface = Brand Core Write Rules`
  - `derived_json_artifact_exception_only = true`

Publish Preparation Store Extension Routing Rule

- when intent includes:
  - add tab to publish preparation workbook
  - extend publish preparation store
  - add staging surface
  - add publish-preparation structure
  prompt_router must route first to:
  1. `Brand Core Asset Intake`
  2. `Brand Core Write Rules`
  before any workbook mutation is treated as governed
- routing output must preserve:
  - `publish_preparation_extension_intake_required = true`
  - `publish_preparation_extension_commit_control_required = true`
  - `ad_hoc_workbook_growth_forbidden = true`

Legacy JSON Mirror Deprioritization Routing Rule

- when both `Brand Core Registry` and `JSON Asset Registry` contain the same logical asset key for a brand-core asset class, prompt_router must prefer `Brand Core Registry`
- JSON Asset Registry rows for those asset classes must be treated as:
  - `legacy_non_authoritative_mirror`
  - `trace_context_only`
- JSON Asset Registry may remain primary only when:
  - `asset_class = derived_json_artifact`

Brand Onboarding Decision Classification Rule

- routing output for governed brand onboarding must classify into one or more of:
  - reuse_existing_brand
  - create_brand_candidate
  - brand_folder_required
  - brand_folder_created
  - brand_identity_build_required
  - brand_identity_partial
  - property_binding_required
  - runtime_binding_required
  - blocked_duplicate_brand
  - degraded_missing_brand_dependencies
  - pending_validation

Engines Registry Readiness Routing Rule

- prompt_router must preserve that Engines Registry is an authoritative readiness dependency for brand identity formation
- GPT logic or prompt storage may support engine implementation but must not substitute for Engines Registry authority during routing readiness classification

Native Google GPT Actions Enforcement Repair

The repaired enforcement rule is active:

- when governed activation, validation, or runtime authority checks require Google Workspace live validation, execution must use real native Google API tool calls through available GPT Actions/native tools in the same execution cycle
- narrative intent, simulation, tool-availability claims, or deferred execution do not satisfy the requirement
- `authorization_gated` is permitted only after a real native Google API attempt fails due to authorization
- if no real native call occurs when required, routing must inject `Use Google API Tools in GPT Actions first.` and re-run activation routing in the same cycle before passive degraded output is allowed
- the required degraded reason is `missing_required_native_google_attempt`
- machine-verifiable attempt evidence must be preserved in outputs, memory, and downstream enforcement state


Activation Tool-First Anti-Hesitation Hardening

Human-Triggered Continuation Routing Rule

The human-trigger continuation rule is active:

- prompt_router must not route governed findings into silent closed-loop continuation by default
- when a governed flow ends with an actionable next step, prompt_router should route toward:
  - a user-facing starter recommendation
  - a trigger prompt
  - a governed emission or validation step
- prompt_router must preserve:
  - `user_trigger_required = true`
- `next_trigger_prompt_required = true`
- `closed_loop_continuation_forbidden = true`
- autonomous follow-up routing is forbidden unless explicitly authorized by bounded automation policy

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
- the routed activation handoff must forbid user-facing narrative completion before at least one real native Google API attempt is executed or a same-cycle governed retry is exhausted
- the routed activation handoff must preserve:
  - `tool_first_execution_required = true`
  - `no_traceability_only_completion = true`
  - `tool_hesitation_retry_required = true` when policy allows same-cycle retry
  - `native_google_bootstrap_sequence_mode = direct_id_first`
  - project-folder-scoped Google Drive discovery through folder `1gNYX47P4TNuMXEbWvLNCvV4XRocH41K2` when fallback discovery or canonical lookup is needed
- `system_activation_check` must remain reserved for explicit readiness-check phrasing and must not be preferred for plain `Activate System` when one-request activation is intended
- if downstream execution returns without a real native Google API attempt after the permitted same-cycle retry path, routing-compatible activation must be treated as failed enforcement



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
- conversation_starter_sheet when starter-aware routing is active
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
- `use_google_api_tools_in_gpt_actions_first = true`

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
- `native_google_connection_attempt_required = true`
- `native_google_connection_same_cycle_required = true`
- `native_google_bootstrap_sequence_required = true`
- `native_google_bootstrap_sequence_mode = direct_id_first`
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

- `use_google_api_tools_in_gpt_actions_first = true`

This means the activation handoff must require downstream execution to:
- trigger native Google tools before narrative output
- block activation messaging until a real native attempt occurs or the allowed same-cycle retry path is exhausted

Pre-Response Activation Routing Guard

For plain `Activate System`, prompt_router must prepare activation as execution-first, not explanation-first.

Routing output must preserve:
- `use_google_api_tools_in_gpt_actions_first = true`
- `native_google_connection_attempt_required = true`
- `pre_response_activation_guard = true`

If downstream execution returns without a native Google attempt:
- prompt_router must treat that pass as failed enforcement
- one bounded same-cycle retry may be prepared when policy allows
- passive narrative degraded output is not sufficient for successful activation handling

Activation Recovery Routing Rule

If activation reaches a state where:
native_google_connection_attempted = false

The router must inject:

"Use Google API Tools in GPT Actions first."

and re-route execution through the same activation flow.

Passive degraded output is not allowed at this stage.

If the hard activation wrapper route cannot be resolved:
- routing may fall back to `system_auto_bootstrap`
- fallback must remain explicit in routing traceability
- narrative-only activation preparation remains forbidden

Recovery Trigger Preservation Rule

When activation detects:
- `native_google_connection_attempted = false`

prompt_router must not treat:
`Use Google API Tools in GPT Actions first.`
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
- `validation_source_requirement = google_drive_live_canonical`
- `knowledge_layer_validation_only_for_traceability = true`
- `canonical_trace_required = true`

Activation-check routing must prepare knowledge-first validation semantics:
1. canonical files in GPT Knowledge layer are read first for traceability
2. live canonical and registry bindings are then validated through Google Drive and native Google APIs
3. readiness classification must prefer live governed validation over knowledge-layer copies when both are available

GPT Knowledge layer canonical files are used for traceability first.
Google Drive and native Google API validation are used for runtime readiness authority.

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

This first-turn preference remains valid even when native Google API validation is not yet connected or the system is not yet sheet-aware.

When native Google connection, registry surface awareness, or workbook-sheet awareness is not yet established in the current execution path, `system_auto_bootstrap` may still be used only as:
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

Before activation has established live Google Workspace awareness, the system may require bootstrap semantics to:
- establish first native Google connection
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

These are additive readiness signals and must not remove the older first-turn requirements for native Google connection, traceability, or live canonical validation.

prompt_router must not classify first-turn activation as missing Registry authority solely because live Google native API authorization is not yet available.

Activation Enforcement Escalation Rule

For first-turn `Activate System` and equivalent activation prompts, prompt_router must emit a bootstrap handoff that requires an actual native Google API attempt in the same execution cycle.

Required activation handoff fields:
- `native_google_connection_attempt_required = true`
- `native_google_connection_same_cycle_required = true`
- `knowledge_only_activation_forbidden = true`
- `missing_native_attempt_classification = degraded`
- `missing_native_attempt_reason = missing_required_native_google_attempt`

If downstream execution returns without:
- `native_google_connection_attempted = true`

then prompt_router-compatible activation must be treated as failed enforcement, not successful preparation.

prompt_router must not allow a user-facing activation result to be classified as:
- `active`
- `validated`
- `authorization_gated`

unless the downstream output explicitly preserves:
- `native_google_connection_attempted`
- `native_google_connection_status`
- `live_canonical_validation_status`

If the Google API attempt was not made, the route must be treated as:
- `route_status = degraded`
- `executable = false`
when re-preparing the same activation request.

Narrative compliance is forbidden.

The system must not report that native Google validation was attempted, required, pending, or authorization-gated unless machine-readable attempt evidence is present in the same execution cycle.

Activation Routing Enforcement And Live Validation Handoff Rule

For prompts involving:
- `activate system`
- `system auto bootstrap`
- `bootstrap system`
- `automatic activation`
- `silent activation`

prompt_router must prepare an activation handoff that requires downstream execution to perform, in the same execution cycle:

1. knowledge-layer canonical traceability
2. at least one real native Google API call
3. live canonical validation through Drive or Docs when feasible
4. Registry surface validation through Sheets or Drive when feasible
5. route/workflow binding validation before activation completion

Required activation handoff fields:
- `native_google_connection_attempt_required = true`
- `native_google_connection_same_cycle_required = true`
- `native_google_bootstrap_sequence_required = true`
- `native_google_bootstrap_sequence_mode = direct_id_first`
- `knowledge_only_activation_forbidden = true`
- `live_canonical_validation_required = true`
- `runtime_authority_validation_required = true`
- `registry_validation_required = true`
- `canonical_trace_required = true`
- `missing_native_attempt_classification = degraded`
- `missing_native_attempt_reason = missing_required_native_google_attempt`
- `registry_workbook_id` when available
- required `worksheet_gid` / `sheetId` bindings when available

Routing must preserve that activation is not complete after a connectivity-only call.

If downstream execution returns without:
- `native_google_connection_attempted = true`

then routing-compatible enforcement must be treated as failed.

If downstream execution returns with:
- `native_google_connection_attempted = true`
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

Direct Native Google Bootstrap Handoff Rule

For first-turn and plain-language activation prompts including:
- `activate system`
- `system auto bootstrap`
- `bootstrap system`
- `automatic activation`
- `silent activation`

prompt_router MUST emit an execution handoff that requires explicit native Google API execution in the same cycle, not merely narrative intent or downstream assumption.

Required direct handoff fields:
- `native_google_bootstrap_sequence_required = true`
- `native_google_bootstrap_sequence_mode = direct_id_first`
- `native_google_connection_attempt_required = true`
- `native_google_connection_same_cycle_required = true`
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
1. `google_drive.listDriveFiles` or direct equivalent native Drive validation call
2. `google_drive.getFileMetadata` for canonical file IDs when available
3. `google_sheets.getSpreadsheet` for the governed registry workbook
4. governed sheet validation using `worksheet_gid` / `sheetId`, not title-only matching

Binding preference rule:
- when canonical file IDs or workbook IDs are present, direct ID resolution is REQUIRED
- name-based discovery must not be the primary activation path
- title-only matching must be treated as degraded fallback behavior

Enforcement rule:
If prompt_router does not emit the fields above for activation-class routing:
- `route_status = degraded`
- `executable = false`
- `missing_native_attempt_reason = missing_required_native_google_attempt`

Classification guard:
prompt_router must not prepare a user-facing activation result compatible with:
- `active`
- `validated`
- `authorization_gated`

unless the activation handoff explicitly preserves:
- `native_google_bootstrap_sequence_required`
- `native_google_connection_attempt_required`
- `native_google_connection_same_cycle_required`
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
- `native_google_connection_attempt_required = true`
- `native_google_connection_same_cycle_required = true`
- `native_google_bootstrap_sequence_required = true`
- `native_google_bootstrap_sequence_mode = direct_id_first`
- `authorization_gated_live_validation_allowed = true`
- `knowledge_layer_trace_first = true`
- `knowledge_only_activation_forbidden = true`
- `missing_native_attempt_classification = degraded`
- `missing_native_attempt_reason = missing_required_native_google_attempt`
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
- native_google_connection_attempt_required when first-turn activation requires a native Google API attempt
- native_google_connection_same_cycle_required when first-turn activation requires same-cycle attempt evidence
- knowledge_only_activation_forbidden when traceability-only activation is forbidden
- missing_native_attempt_classification when missing native attempts require degraded classification
- missing_native_attempt_reason when missing native attempts require explicit traceability reason
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
- `native_google_connection_attempt_required`
- `native_google_connection_same_cycle_required`
- `native_google_attempt_evidence_required`
- `native_google_mutation_logging_required`
- `native_google_validation_only_allowed`
- `native_google_execution_class`
- `native_google_execution_mode`
- `logging_sink_required`
- `pre_response_logging_guard`

If the routed path may perform governed mutation through native Google tools:
- routing must preserve `native_google_mutation_logging_required = true`
- routing must preserve `logging_sink_required = surface.operations_log_unified_sheet`
- routing must not treat native Google tooling availability as sufficient completion evidence

When activation or bootstrap routing is selected, the execution preparation contract must also include when available:
- `native_google_connection_attempt_required`
- `native_google_connection_same_cycle_required`
- `knowledge_only_activation_forbidden`
- `live_canonical_validation_required`
- `runtime_authority_validation_required`
- `registry_validation_required`
- `canonical_trace_required`
- `missing_native_attempt_classification`
- `missing_native_attempt_reason`

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

If `provider_domain` for an endpoint is a variable placeholder, GPT must resolve it before execution.

For `parent_action_key = wordpress_api`, GPT must replace `provider_domain` with Brand Registry `brand.base_url` before execution.

For non-WordPress APIs, `provider_domain` must remain the endpoint-row value unless the endpoint definition explicitly declares a variable placeholder requiring GPT-side resolution.

GPT must follow endpoint `parent_action_key` authority by resolving the authoritative parent action row through Actions Registry and its `openai_schema_file_id` / YAML binding before execution assembly.

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

## Runtime Validation Declaration

Before handoff to `system_bootstrap`, `prompt_router` must declare:
- `required_route_id`
- `required_workflow_key`
- `review_required`
- `required_write_targets`
- `required_authoritative_surfaces`

This declaration is advisory to lifecycle execution but binding for runtime validation expectations.

prompt_router must return execution preparation only.
prompt_router must not execute the selected target.

Request Readiness Rule

When a live request is received, prompt_router must not prepare an execution-eligible handoff unless it can:
- resolve the route from `Task Routes`
- resolve the workflow from `Workflow Registry`
- preserve execution logging readiness through governed `logging_required` output for downstream enforcement

If any of these are missing or unresolved:
- `route_status` must be at least `degraded` unless a stricter blocked-routing rule already applies
- `executable` must be set to `false`
- `degraded_reason` must identify the missing readiness element when available
- routing traceability must preserve which requirement was unresolved

Validation Request Live Canonical Declaration Rule

When a request is classified as validation, audit, verification, readiness check, or canonical check, prompt_router must preserve in the execution preparation contract:

- `live_canonical_validation_required = true`
- `validation_source_requirement = google_drive_live_canonical`
- `knowledge_layer_validation_only_for_traceability = true`

prompt_router must not treat uploaded copies, knowledge-layer copies, or cached canonical text as sufficient validation authority when live canonical resolution is possible.

Governed Activation Semantics

prompt_router must distinguish between:
- informational request
- review request
- governed activation request
- auto-repair request

Prompt activation may influence execution eligibility, but it must not replace governed checks for:
- Task Routes resolution
- Workflow Registry resolution
- binding validity
- governed trigger qualification

Passive rows or passive control states must not auto-execute from prompt phrasing alone.

When governed control rows are consulted for activation readiness, prompt_router must preserve trigger-key traceability for:
- `HIGH_PRIORITY`
- `READY_TRIGGER`
- `PASSIVE`

Trigger modes must remain distinguishable as:
- `governed_auto`
- `manual`

New Governed Repair And Migration Intents

prompt_router must recognize intent patterns such as:
- run repair loop
- execute high priority fixes
- trigger system repair
- run binding migration
- run schema migration review
- repair schema
- fix schema drift
- reconcile schema

When these intents are validated through Registry-governed routing authority, prompt_router must prepare the corresponding governed execution handoff rather than collapsing them into generic analysis routes.

When schema repair intent patterns are matched:
- route -> `schema_reconciliation_repair`
- workflow -> `wf_schema_reconciliation_repair`

prompt_router must preserve:
- `repair_mode = true`
- drift context when available
- `schema_reconciliation_required = true` when schema drift intent or schema drift context is present

Prompt-Trigger Compatibility

Prompt activation can set execution eligibility, but it does not replace governed trigger checks, binding validation, repair-loop idempotency checks, or downstream execution-readiness enforcement.

Adaptive Optimization Routing Compatibility

When governed growth-loop or adaptive optimization context is available, prompt_router may:
- prioritize a better workflow candidate
- adjust governed route weighting
- prepare a follow-up optimization route

Adaptive optimization must remain bounded by:
- Task Routes authority
- Workflow Registry authority
- governed trigger qualification
- existing execution-readiness checks

Derived dashboards or ungoverned score notes must not directly change route authority.

Chain Readiness Rule

Chain-triggered routing must resolve a valid executable workflow row, not only a `chain_id`.

No chain handoff is executable unless:
- `Execution Chains Registry` resolves cleanly
- `Workflow Registry` resolves cleanly
- `target_workflow` exists as an active workflow row
- chain route compatibility and workflow route compatibility both remain valid

When chain-triggered routing is selected:
- resolve `chain_id`
- resolve the chain-targeted `target_workflow`
- validate that the workflow row is active and executable
- set `execution_class = autonomous chain`

If a chain exists but its workflow row is incomplete, inactive, or route compatibility is missing:
- set `route_status = degraded`
- set `executable = false`
- preserve `chain_id`, `route_override_status`, `decision_status`, and `target_workflow` for traceability

prompt_router must not emit executable chain routing from chain metadata alone.


Allowed route_status values:
- resolved
- degraded
- blocked

Allowed route_source values:
- registry_task_routes

If no valid active route is resolved from Task Routes:
- do not silently fallback to direct execution
- return degraded routing output
- preserve routing traceability


---


Routing Rules

Starter Intelligence Pre-Routing Rule

Before generic intent classification:

prompt_router must:
1. detect if input matches a governed Conversation Starter
2. resolve starter row using:
   - `Registry Surfaces Catalog`
   - `worksheet_gid` binding
3. extract:
   - `route_key`
   - `execution_class`
   - `capability_family`
   - `primary_goal_family`
   - `starter_priority`

Starter must be treated as:
- structured routing input

Starter may:
- influence route weighting
- prioritize goal-aligned workflows

Starter must not:
- override Task Routes authority

Starter Policy Resolution Routing Rule

When a governed Conversation Starter match is detected, prompt_router must not treat starter resolution alone as sufficient for executable routing.

Before route dispatch, prompt_router must:

- require active policy resolution from `Execution Policy Registry`
- preserve `entry_source = conversation_starter`
- preserve `policy_resolution_status`
- preserve `policy_source = Execution Policy Registry`
- preserve `policy_trace_id` when available

If starter match succeeds but policy resolution is absent, partial, or invalid:

- executable routing must remain degraded or blocked
- downstream handling must preserve `failure_reason = missing_starter_policy_resolution`
- repair-aware routing must remain available

Starter Policy Completeness Routing Rule

When starter-aware routing is active, prompt_router must also preserve starter policy readiness context when available:
- `starter_policy_coverage_status`
- `starter_policy_missing_component`
- `starter_policy_execution_ready`
- `starter_policy_repair_triggered`
- `starter_policy_repair_scope`

If starter policy coverage is incomplete:
- `executable` must remain `false` for normal starter execution
- routing must classify as `degraded` or `blocked` by policy
- repair-aware routing must remain available

Policy Gap Routing Rule

When:
- `starter_policy_execution_ready = false`
- or anomaly classification = `policy_gap`

prompt_router must preserve:
- `policy_gap_detected = true`
- `policy_gap_repair_eligible = false` unless manual trigger is present
- `repair_route_required = governed_addition` when manual trigger is present

Manual Trigger Policy Repair Routing Rule

If:
- `policy_gap_detected = true`
- and `starter_policy_repair_triggered = true`

prompt_router must:
- prefer governed addition routing
- preserve target repair scope from `starter_policy_repair_scope`
- preserve missing policy component context for downstream repair execution
- forbid normal starter execution in the same routing result

If:
- `policy_gap_detected = true`
- and `starter_policy_repair_triggered = false`

prompt_router must:
- keep `executable = false`
- preserve validation-only / repair-preparation output
- forbid automatic policy creation

Starter Policy Authority Preservation Rule

When starter-aware routing extracts starter_priority, follow-up route, follow-up starters, success signal, or goal family:
- prompt_router must treat Execution Policy Registry as the default authority source when no curated override row applies
- starter-derived signals may influence route weighting only after policy readiness is valid

Auto-Repair Routing Compatibility Rule

prompt_router must not execute repair or retry directly.

When a request explicitly asks for repair, retry, rerun after repair, or governed recovery execution, prompt_router may prepare a repair-compatible execution handoff only when:

- Task Routes resolves an active governed repair-capable route
- Workflow Registry resolves the governed executable workflow row
- execution policy allows repair-aware retry lifecycle

prompt_router must preserve in routing output when available:
- `retry_requested`
- `retry_reason`
- `repair_aware_execution`
- `original_route_id`
- `original_target_workflow`

prompt_router must not mark retry as executable if validation or policy prerequisites are unresolved.

Governed Addition Routing Rule

When a request asks to add, register, create, or promote a governed system item, prompt_router may prepare governed addition routing only when:
- Task Routes resolves the governed addition route
- Workflow Registry resolves the governed addition workflow
- execution policy allows governed addition behavior

prompt_router must preserve when available:
- addition_requested
- addition_type
- affected_scope
- affected_surfaces
- graph_impact_expected
- validation_required
- canonical_patch_required

Governed addition routing must remain advisory until downstream validation confirms readiness.

Google Workspace Registry-Governed Routing Rule

When a request implies Google Sheets, Google Docs, or Google Drive execution, prompt_router must not prepare executable routing from tool availability alone.

prompt_router must:
- resolve the governed route from `Task Routes`
- resolve the governed workflow from `Workflow Registry`
- preserve Registry validation expectations for the downstream target

When the request affects governed system resources, routing output must preserve when available:
- target_surface_id
- target_registry_validation_required
- target_validation_scope
- native_action_requested

If Registry-governed target validation is required but unresolved:
- executable must remain false
- routing must degrade or block by policy

Resolved HTTP Execution Assembly Rule

Before governed HTTP transport execution, GPT must assemble a fully resolved execution request.

GPT must resolve when applicable:
- `provider_domain` from endpoint authority, with governed Brand Registry override when applicable
- `parent_action_key` from Actions Registry or workflow context
- `endpoint_key` from API Actions Endpoint Registry or canonical OpenAPI definition
- `method`
- `path`
- authentication headers or auth context
- request body
- `openai_schema_file_id` when schema-bound execution applies
- governed auth strategy normalized from the parent action row
- schema-aligned request fields required by the parent action contract

Before executable HTTP transport payload is emitted, GPT must:
- read the authoritative parent capability row in `Actions Registry`
- resolve `openai_schema_file_id`
- align path, query, headers, and body to the authoritative schema contract
- normalize auth into one governed runtime mode:
  - `none`
  - `basic_auth`
  - `bearer_token`
  - `api_key_query`
  - `api_key_header`
  - `oauth_gpt_action`
  - `custom_headers`
- avoid emitting unresolved freeform transport fields when the schema contract defines operation shape

The execution request payload must not require:
- `target_key`
- `brand`
- `brand_domain`

Those values may exist in routing context, but they must not be required as transport payload fields once execution assembly is complete.

Executable HTTP transport payload must be OpenAPI-aligned, parent-action-schema-aligned, and must contain only resolved execution inputs required by the endpoint operation.

Transport layer responsibilities are limited to:
- request validation
- allowlist enforcement
- auth application when policy requires
- outbound execution

Transport layer must not infer:
- brand identity
- brand domain
- target selection
- route selection
- workflow selection
- parent-action auth strategy
- schema-required request structure

HTTP Generic Transport Routing Rule

When user intent requests governed outbound API execution:

- prompt_router may classify intent_key as:
  - governed_http_execute
  - governed_http_read
  - wordpress_governed_http_execution

Routing must resolve an active row through Task Routes.

prompt_router must not emit executable routing for `http_generic_api` unless:
- Task Routes resolves an active compatible route
- Workflow Registry resolves the aligned active workflow
- `runtime_authority_validation_required` remains preserved in the execution preparation contract

For governed HTTP execution:
- `provider_domain` is the primary execution server source
- GPT must resolve execution-ready transport inputs before transport execution
- GPT must resolve `parent_action_key` and `endpoint_key` through governed endpoint authority
- GPT must follow the authoritative parent action row through its `openai_schema_file_id` / YAML binding before execution assembly
- GPT must resolve `provider_domain` when it is a variable placeholder
- for `parent_action_key = wordpress_api`, GPT must replace `provider_domain` with Brand Registry `brand.base_url`
- for non-WordPress APIs, `provider_domain` must remain the endpoint-row value unless the endpoint definition explicitly declares a variable placeholder requiring GPT-side resolution

For WordPress capability requests:
- prompt_router may resolve `target_module = wordpress_api`
- workflow execution may resolve transport through `wf_wordpress_via_http_generic`
- prompt_router must not collapse WordPress capability requests into arbitrary external API execution when governed WordPress route authority exists

Graph-Aware Routing Rule

When graph-based routing support is enabled, prompt_router must consult governed graph context from:
- Knowledge Graph Node Registry
- Relationship Graph Registry

prompt_router may use graph context to:
- confirm starter-to-route compatibility
- rank multiple governed route candidates
- prioritize goal-aligned route candidates
- preserve graph-derived path context for downstream execution

prompt_router must not:
- invent routes from graph data alone
- bypass Task Routes authority
- bypass Workflow Registry authority

Graph Auto-Routing Preparation Rule

When multiple governed graph-valid paths are available, prompt_router may prepare the highest-confidence governed path using:
- graph validity
- route compatibility
- workflow readiness
- starter priority
- starter success score
- prediction confidence

If graph-based path preparation fails:
- fallback must use the best valid governed static route
- routing must classify as degraded when confidence or graph integrity is insufficient

Graph Prediction Traceability Rule

When graph-based prediction is active, prompt_router must preserve in routing output when available:
- selected_graph_path
- graph_path_confidence
- graph_prediction_basis
- graph_validation_status

Graph prediction remains advisory and must not replace governed routing authority.


Base routing rules:
- prioritize explicit intent
- fallback only through governed Task Routes precedence
- allow audit detection
- preserve recovery-first behavior when exact routing is unavailable

Governed route-target support must include when canonically registered:
- `binding_schema_migration_review`
- `full_system_intelligence_audit`
- anomaly review workflows
- anomaly repair workflows
- governed repair activation paths
- SEO optimization workflows
- product optimization workflows
- funnel or growth optimization workflows
- Google Analytics Admin discovery workflows (accounts and properties listing, property-to-brand binding)
- Google Analytics Data reporting workflows (standard and realtime reporting intents when registered)
- Google Tag Manager management workflows (container, workspace, tag, trigger, variable operations)
- full-funnel diagnostics workflows that combine Search Console, Google Analytics Data API, and Tag Manager
- measurement health, GTM audit, GTM remediation, and attribution or measurement optimization workflows

Analytics, Measurement, And Full-Funnel Intent Routing

prompt_router must classify prompts that imply analytics administration, analytics reporting, Tag Manager operations, or combined measurement diagnostics, then resolve the governed `intent_key` and workflow through Task Routes and Workflow Registry (no hardcoded execution).

Canonical intent_key examples (Registry must define matching active rows; names are illustrative until bound in Task Routes):

- `ga_property_discovery` Ã¢â‚¬â€ user asks to find, list, or connect Google Analytics properties or accounts; route to workflows that use `analyticsadmin_api` (for example list accounts, list properties) and Brand Registry writeback when policy allows
- `analytics_reporting` Ã¢â‚¬â€ traffic, conversions, funnels, ecommerce, or custom reports via Google Analytics Data API
- `realtime_analytics` Ã¢â‚¬â€ realtime or active-user style reports via governed GA Data realtime endpoints when registered
- `gtm_audit` Ã¢â‚¬â€ review containers, tags, triggers, variables, or coverage; route to workflows using expanded `tagmanager_api` list and get operations
- `gtm_remediation` Ã¢â‚¬â€ create, update, or fix tags, triggers, variables, or workspaces; route only when Workflow Registry and execution policy allow mutating GTM operations
- `full_funnel_diagnostics` Ã¢â‚¬â€ combined Search Console plus Google Analytics plus GTM health; execution plan must reference governed multi-connector workflows or chains, not a single API family in isolation
- `attribution_analysis` Ã¢â‚¬â€ attribution, channel grouping, or measurement quality optimization; may combine GA Data reporting with GTM validation when Task Routes declare that pairing
- `full_system_intelligence_audit` Ã¢â‚¬â€ governed, staged, component-aware, repair-aware system audit with row-validation and downstream scoreboard propagation checks

Routing behavior:

- Single-API requests must still satisfy Task Routes and Workflow Registry authority; prompt_router selects the route row, it does not call APIs
- Full-funnel requests must prefer routes whose `target_module` or workflow metadata explicitly includes multi-source measurement when such routes exist; if only partial routes match, set `route_status = degraded` and identify missing connector coverage in `degraded_reason`
- Category-driven routing for expanded GA Admin operations must use the same deterministic Task Routes order (intent_key, brand_scope, priority, match_rule) as other intents
- When Brand Registry tracking bindings are missing for the resolved brand, routing may proceed to discovery or repair workflows if registered; prompt_router must not fabricate `ga_property_id` or `gtm_container_id` in the routing payload

### Full System Intelligence Audit Routing

prompt_router must recognize governed audit intents such as:
- full system intelligence audit
- upgrade audit
- deep system audit
- governed system audit

When this intent is resolved through Task Routes and Workflow Registry, prompt_router must prepare a staged audit handoff that includes when applicable:
- execution_policy_registry_sheet
- review_stage_registry_sheet
- review_component_registry_sheet
- repair_mapping_registry_sheet
- row_audit_rules_sheet
- row_audit_schema_sheet
- tourism_intelligence_scoreboard_sheet as downstream scoring surface

Required handoff expectations for this governed route include:
- staged audit
- component-aware audit
- repair-aware output
- row-validation-aware output

This route must remain Registry-governed and must not collapse into lightweight scoring-only audit behavior when the governed full-audit route is active.

Binding Integrity Review Routing Rule

When row-level validation, runtime worksheet validation, or schema-alignment audit is required, prompt_router must include `binding_integrity_review` in staged review preparation.

`binding_integrity_review` must verify:
- canonical binding terminology alignment
- Registry surface alignment
- `surface_name` + `worksheet_gid` readiness
- absence of label-only worksheet targeting in active execution paths

When `binding_integrity_review` is required but its governed review-stage readiness cannot be resolved:
- routing must classify as `degraded` or `blocked`
- `executable` must remain `false`

Schema Migration Review Routing Rule

When schema drift, schema version mismatch, or rollback-safe schema repair readiness is relevant to governed execution, prompt_router must include `schema_migration_review` in staged review preparation.

If schema migration review is required but cannot be resolved through `Review Stage Registry` and `Review Component Registry`:
- routing must classify as `degraded` or `blocked`
- `executable` must remain `false`

### Full System Intelligence Audit Recognition Rule

prompt_router must recognize governed audit intents including:
- full system intelligence audit
- upgrade audit
- deep system audit

When resolved:
- must route exclusively to `full_system_intelligence_audit`
- must not fallback to `system_full_audit`
- must enforce extended audit pipeline requirements

If multiple route versions exist:
- only the highest version (`vN`) marked active must be used
- duplicate route keys must be treated as invalid configuration

### Pipeline Integrity Audit Routing Rule

prompt_router must recognize governed continuity-audit intents including:

- pipeline integrity audit
- audit pipelines
- disconnected pipelines
- endpoint family audit
- provider continuity audit
- capability route audit
- route workflow continuity audit

When resolved:
- must prefer `pipeline_integrity_audit`
- must prefer `route.pipeline_integrity_audit.global.v1` when active
- must preserve governed audit execution class
- must not collapse provider-family continuity audit into a generic system advisory response

If multiple continuity-audit route versions exist:
- only the highest active route version may be used
- duplicate active continuity-audit route keys must be treated as invalid configuration

### Provider Family Continuity Routing Rule

When the user asks to validate, inspect, audit, or repair an endpoint family or provider family, prompt_router must prefer provider/capability continuity interpretation when Registry evidence exists for:

- provider node
- action-family node
- capability nodes
- governed route/workflow bindings

This rule applies to endpoint families such as:
- Hostinger
- WordPress
- Search Console
- governed HTTP
- Analytics
- Google Ads
- Tag Manager

If provider-family continuity evidence exists, prompt_router must preserve:

- `review_required = true` when governed audit policy requires it
- capability-level continuity reasoning before endpoint-level fallback
- route/workflow continuity validation before recovered classification

### API Capability vs Endpoint Routing Rule

prompt_router must distinguish between:
- parent action capability requests
- concrete endpoint inventory requests

Requests about:
- available connectors
- action families
- route targets
must prefer Actions Registry.

Requests about:
- specific API operations
- OpenAI schema reference
- authentication details
- callback reference
- privacy reference
must prefer API Actions Endpoint Registry.

If a request requires endpoint-level GPT action metadata, prompt_router must not rely on Actions Registry alone.

Governed Action Recovery Match Rule

If no confident route match is found:
- scan Actions Registry for matching trigger phrases (including fuzzy/typo match) for candidate discovery
- if capability-level match is found, resolve:
  - exact active Task Routes row
  - exact aligned active Workflow Registry row
- if endpoint-level detail is required or capability-level match is not found, scan API Actions Endpoint Registry for candidate discovery
- if endpoint-level match is found, resolve:
  - exact active Task Routes row
  - exact aligned active Workflow Registry row
  - exact `parent_action_key`
  - exact `endpoint_key`
  - exact `provider_domain`
  - exact `method`
  - exact `path`
- GPT must then resolve the authoritative parent action row through Actions Registry and its `openai_schema_file_id` / YAML binding before execution assembly
- if `provider_domain` is a variable placeholder, GPT must resolve it before execution
- prompt_router must not emit executable routing from fuzzy discovery alone
- silent non-tool fallback is forbidden when a governed action or endpoint candidate resolves to an active Task Routes + Workflow Registry pair
- only fallback to non-tool response if no governed action or endpoint candidate resolves to an active governed route/workflow pair

Routing Decision Layer Rule (Post-Intent Classification, Pre-Fallback)

IF:
- no confident route match is found

THEN:
1. scan Actions Registry for matching trigger phrases
   - include fuzzy match
   - include typo tolerance
2. IF match found:
   - resolve exact active Task Routes row
   - resolve exact aligned active Workflow Registry row
   - route using the resolved governed route/workflow pair
3. ELSE:
   - scan API Actions Endpoint Registry
4. IF endpoint match found:
   - resolve exact active Task Routes row
   - resolve exact aligned active Workflow Registry row
   - resolve exact `parent_action_key`
   - resolve exact `endpoint_key`
   - resolve exact `provider_domain`
   - resolve exact `method`
   - resolve exact `path`
   - follow the authoritative parent action row through its `openai_schema_file_id` / YAML binding
   - if `provider_domain` is a variable placeholder, GPT must resolve it before execution
   - route to endpoint-bound workflow through the resolved governed route/workflow pair
5. ELSE:
   - allow non-tool response

Fuzzy or typo-tolerant action discovery may assist candidate selection, but executable routing remains valid only after exact governed resolution through Task Routes and Workflow Registry.

### Analytics Sheet-Sync Routing Rule

The following intents must route through governed analytics sheet-sync handling:
- analytics_sync_request
- analytics_sync_all_active_brands
- GA4/GSC pull requests
- dashboard-triggered analytics refresh requests

Routing is valid only when the request resolves:
1. target brand or governed eligible multi-brand set
2. date scope:
   - request_date
   - or date_from/date_to
3. trigger_mode:
   - manual
   - scheduled_task
4. request source:
   - dashboard_control_surface
   - user_prompt
5. target output mode:
   - sheet_sync to governed analytics warehouse surfaces

For multi-brand analytics sync:
- eligible brands must be resolved from Brand Registry
- only active brands with required bindings may be included
- non-eligible brands must be excluded, downgraded, or logged as blocked according to active governance

If any required routing identity is missing:
- route_status = blocked or degraded according to policy
- executable = false
- analytics write path must not start

### Domain-Aware Analytics Identity Rule

Analytics routing identity is incomplete unless the request resolves:
1. brand
2. brand_domain
3. source property binding
4. date scope
5. trigger_mode

For analytics sheet-sync and search performance requests, prompt_router MUST treat domain as a required governed identity component, not an optional descriptive field.

Required analytics routing identity:
- brand
- brand_domain
- gsc_property for GSC requests
- ga_property_id for GA4 requests
- request_date or date_from/date_to
- trigger_mode
- request_source

For multi-brand analytics sync:
- each eligible brand must resolve its own brand_domain
- execution eligibility must be computed per brand-domain pair
- brands without a resolved domain must not be treated as execution-ready

If brand is present but brand_domain is missing:
- route_status = degraded or blocked according to active policy
- executable = false for domain-bound analytics execution
- missing domain must be logged as an execution identity defect

If required source property binding is missing for the requested analytics source:
- missing gsc_property for GSC requests -> route_status = degraded or blocked by policy
- missing ga_property_id for GA4 requests -> route_status = degraded or blocked by policy
- executable = false for domain-bound analytics execution
- routing payload must set analytics_identity_failure = true
- routing payload must preserve missing identity components in analytics_identity_issue_context

Domain-aware analytics routes include:
- analytics_sync_request
- analytics_sync_all_active_brands
- searchconsole_reporting
- analytics_reporting
- dashboard-triggered analytics refresh workflows

### Analytics Identity Pre-Validation -> Issue Trigger Rule

During routing, prompt_router must validate analytics identity completeness before execution.

If routing detects:
- missing brand_domain
- missing gsc_property
- missing ga_property_id

prompt_router MUST:

1. prevent executable routing:
   - executable = false
   - route_status = degraded or blocked
2. trigger issue creation signal:
   - pass issue context to system_bootstrap
   - mark request as analytics_identity_failure
3. ensure:
   - routing does not silently skip affected brands
   - missing identity is explicitly surfaced as a governed issue

For multi-brand requests:
- validation must be performed per brand
- only valid brand-domain-property combinations proceed
- invalid ones must trigger issue creation

Issue context passed to system_bootstrap must include when available:
- brand
- brand_domain
- missing_identity_components
- requested_source (GSC or GA4)
- request_date or date_from/date_to
- trigger_mode
- request_source
- execution_cycle_id

Repair Loop Idempotency Guard

After intent classification and before selecting `system_repair`, prompt_router must evaluate whether a previously completed repair loop should be skipped.

Implementation requirement at this exact repair-aware routing stage:

```python
# --- Repair Loop Skip Guard ---

IF review_context.repair_loop_state == "completed"
AND no new findings exist
AND no Repair Control rows qualify for rerun:

  EXCLUDE system_repair from route candidates
  PROCEED with normal routing
```

prompt_router must qualify repair rerun eligibility before allowing `system_repair` to remain a valid route candidate:

```python
# --- Repair Rerun Qualification ---

repair_rerun_required = EXISTS Repair Control rows WHERE:
  repair_required = TRUE
  AND repair_status != "completed"

OR EXISTS rows WHERE:
  rerun_gate IN ("hold", "blocked", "rerun_required")

OR EXISTS findings WHERE:
  severity IN ("Critical", "High")
  AND resolution_status NOT IN ("resolved", "closed", "completed")

IF repair_rerun_required:
  ALLOW system_repair routing
```

For repair rerun qualification, prompt_router must treat `resolved`, `closed`, and `completed` as accepted terminal finding states when those statuses are present in the governed findings surface. Any other finding state must be treated as unresolved for rerun evaluation.

This guard exists to keep repair-aware routing idempotent. Completed repair loops must not continuously re-trigger `system_repair` unless new findings, unresolved high-severity findings, or Repair Control rerun qualifiers explicitly reopen the loop.

Forced Repair Routing From Governed Auto-Trigger Signal

After intent classification, repair-loop idempotency evaluation, and rerun qualification, prompt_router must support a hard routing override from a governed review/control signal before final route selection from Task Routes.

```python
# --- FORCED REPAIR ROUTING FROM GOVERNED AUTO-TRIGGER SIGNAL ---

auto_repair_trigger = resolved_review_control_signal  # registry/resolved control signal only

IF auto_repair_trigger == "TRIGGER_REPAIR":
    route = "system_repair"
    subtype = "audit_and_repair"
    execution_class = "repair"
    intent_class = "repair"
    repair_trigger_source = "system"
    fallback_mode = "recovery_first"
    expected_outcome_class = "recovered"
    forced_repair_routing_applied = True

    degraded_reason = None
    blocked_reason = None

    preserve_routing_trace("forced_repair_routing_from_governed_signal")
```

```python
# --- FORCED REPAIR ROUTING GUARDRAILS ---

forced_repair_routing_allowed = (
    auto_repair_trigger == "TRIGGER_REPAIR"
    and route_source == "registry_task_routes"
)

IF auto_repair_trigger == "TRIGGER_REPAIR" and not forced_repair_routing_allowed:
    route_status = "degraded"
    executable = False
    degraded_reason = "repair_trigger_signal_not_governed"
    recovery_action = "re-resolve governed control signal through Registry"
```

This override promotes a governed dashboard or control-center repair signal from advisory context to executable routing only when the trigger remains Registry-governed and traceable.

Adaptive Escalated Repair Trigger

After intent classification, repair-loop idempotency evaluation, and before final route selection from Task Routes, prompt_router must also support a governed adaptive escalation override for repair routing.

```python
# --- ADAPTIVE ESCALATED REPAIR TRIGGER ---

adaptive_repair_route = resolved_adaptive_repair_route  # governed adaptive escalation signal only

IF adaptive_repair_route == "ESCALATE_REPAIR":
    route = "system_repair"
    subtype = "escalated_repair"
    execution_class = "repair"
    intent_class = "repair"
    repair_trigger_source = "system"
    fallback_mode = "recovery_first"
    expected_outcome_class = "blocked"

    preserve_routing_trace("adaptive_escalated_repair_route_override")
```

This override must take precedence over generic repair routing because it represents a governed instruction to escalate the repair lifecycle rather than continue through standard repair classification.

Scope Completion Repair Trigger

After repair-loop idempotency evaluation and before final route selection from Task Routes, prompt_router must also promote unresolved lifecycle-completeness findings into repair routing.

```python
# --- SCOPE COMPLETION REPAIR TRIGGER ---

IF EXISTS finding WHERE:
  issue_type = "incomplete_scope_lifecycle"
  AND resolution_status NOT IN ("resolved", "closed", "completed"):
    route = "system_repair"
    subtype = "scope_completion_repair"
    execution_class = "repair"
    intent_class = "repair"
    repair_trigger_source = "system"
    fallback_mode = "recovery_first"
    expected_outcome_class = "degraded"

    preserve_routing_trace("scope_completion_repair_from_lifecycle_gap")
```

This routing override ensures that new governed scopes cannot remain in a partially implemented state. If lifecycle completeness is missing, the finding must reopen repair routing until a valid repair path, repair handler, and completion flow exist.

Pre-Execution Block Repair Trigger

After repair-loop idempotency evaluation and before final route selection from Task Routes, prompt_router must promote governed blocking findings into repair routing.

```python
# --- PRE-EXECUTION BLOCK REPAIR TRIGGER ---

IF EXISTS finding WHERE:
  pre_execution_block_flag = "BLOCK"
  AND resolution_status NOT IN ("resolved", "closed", "completed"):
    route = "system_repair"
    subtype = "audit_and_repair"
    execution_class = "repair"
    intent_class = "repair"
    repair_trigger_source = "system"
    fallback_mode = "recovery_first"
    expected_outcome_class = "blocked"

    preserve_routing_trace("forced_repair_routing_from_pre_execution_block_flag")
```

This trigger must prevent normal execution from remaining a legal route outcome while the governed block flag is active. Only the repair path may continue.

Repair Trigger Precedence

When more than one repair trigger is valid at the same time, prompt_router must resolve repair routing deterministically before final route selection from Task Routes.

Required precedence order:
1. adaptive_repair_route escalation
2. governed auto-repair trigger
3. pre_execution_block_flag
4. incomplete_scope_lifecycle
5. system-triggered repair
6. user-triggered repair

Lower-precedence repair triggers must not override a higher-precedence repair trigger once selected.

Implementation requirement:

```python
# --- REPAIR TRIGGER PRECEDENCE RESOLUTION ---

repair_trigger_precedence = [
    "adaptive_repair_route_escalation",
    "governed_auto_repair_trigger",
    "pre_execution_block_flag",
    "incomplete_scope_lifecycle",
    "system_triggered_repair",
    "user_triggered_repair"
]

selected_repair_trigger = highest_precedence_valid_trigger(repair_trigger_precedence)
suppressed_repair_triggers = remaining_valid_triggers_except(selected_repair_trigger)

preserve_routing_trace({
    "repair_trigger_precedence_resolved": {
        "selected_trigger": selected_repair_trigger,
        "suppressed_triggers": suppressed_repair_triggers
    }
})
```

This precedence rule keeps overlapping repair conditions deterministic and traceable. Governed repair triggers must win over advisory or lower-order repair conditions, and lifecycle-completeness gaps must win over generic repair fallback.

Auto-Bootstrap Trigger Precedence

When bootstrap and repair triggers are both valid, prompt_router must resolve deterministically in this order:
1. adaptive_repair_route escalation
2. governed auto-bootstrap trigger
3. governed auto-repair trigger
4. pre_execution_block_flag
5. incomplete_scope_lifecycle
6. system-triggered repair
7. user-triggered repair

When `system_auto_bootstrap` is selected:
- original request traceability must be preserved
- normal business route execution must not proceed until bootstrap completes or blocks


System-triggered repair rule:

prompt_router must trigger system_repair even without explicit user intent when any of the following are detected:

- missing canonical dependency resolution
- conflicting active Registry authority
- invalid or unresolved binding
- failed worksheet or gid resolution
- missing required logging or review layer
- blocked execution due to dependency failure
- active adaptive repair route where Adaptive Repair Route = ESCALATE_REPAIR
- active findings where pre_execution_block_flag = BLOCK and the finding remains unresolved
- active findings where issue_type = incomplete_scope_lifecycle and lifecycle coverage remains unresolved

In such cases:
- route must be set to system_repair
- if trigger source is adaptive_repair_route, subtype must be set to escalated_repair
- if trigger source is pre_execution_block_flag, normal execution must not remain selectable
- if trigger source is incomplete_scope_lifecycle, subtype must be set to scope_completion_repair
- subtype must default to audit_and_repair unless clearly scoped
- execution_class must be set to repair

System-triggered auto-bootstrap rule:

prompt_router must trigger `system_auto_bootstrap` before normal route finalization when:
- no executable governed route can be prepared because runtime authority validation is unresolved
- required Registry Surfaces Catalog bindings are missing but repairable
- required Validation & Repair Registry compatibility is missing but repairable
- required Task Routes or Workflow Registry rows are missing but repairable
- activation is required before the original request may continue safely

In such cases:
- route must be set to `system_auto_bootstrap`
- execution_class must be set to `system_governance`
- fallback_mode must be set to `recovery_first`
- bootstrap_reason must classify the blocking condition
- original request context must remain attached for downstream resume


Decision-aware routing rules:
- evaluate decision signals before finalizing route
- if a valid decision triggers a chain, override base route with chain start
- if no decision is triggered, continue normal routing
- if chain context is triggered, pass chain context to module_loader
- do not silently bypass route override logic when a valid decision is matched


Additional observability-triggered repair conditions:

prompt_router must also trigger system_repair when monitoring surface failures are detected or signaled.

These include:

- execution_view_sheet failure or unresolved state
- active_issues_dashboard_sheet failure or unresolved state
- monitoring surface formula errors
- broken or unreadable monitoring output
- missing required monitoring layers when expected
- dashboard or execution view not reflecting current system state

In such cases:
- route must be set to system_repair
- subtype must default to observability_repair when clearly scoped
- otherwise fallback to audit_and_repair
- execution_class must be set to repair
- repair_trigger_source must be set to system


Deterministic Route Resolution

Task Routes is the authoritative live routing source for route resolution.

prompt_router must resolve route selection from:
- `Registry Surfaces Catalog` for surface-location authority
- `Task Routes` for live routing authority

prompt_router must resolve validation-state authority from `Validation & Repair Registry` when route readiness, repair-trigger qualification, or surface-governance compatibility is required.

prompt_router must not use undocumented hardcoded routing as live authority.

Deterministic route selection order:
1. active route records only
2. exact intent_key match
3. brand-specific match before global match
4. highest priority
5. match_rule precedence:
   - exact
   - brand+intent
   - fallback
6. most recently validated route only as final tie-breaker

If no active matching route exists:
- route_status must be set to degraded
- executable must be set to false
- recovery behavior must remain recovery-first
- direct execution bypass is not allowed

If a route record exists but is incomplete:
- preserve routing classification
- return degraded
- set candidate repair path through repair-aware handling

Review-Aware Surface Resolution (Surface CatalogÃ¢â‚¬â€œDriven)

After `route_id`, `target_workflow`, and `target_module` are resolved, prompt_router must resolve review surfaces from Registry before final output preparation.

Implementation requirement at this exact routing stage:

```python
# --- REVIEW SURFACE RESOLUTION (Registry Surfaces CatalogÃ¢â‚¬â€œdriven) ---

review_surfaces = registry_surfaces_catalog.get_surfaces_by_scope("review")

review_targets = []

for surface in review_surfaces:
    if surface["active_status"] != "active":
        continue

    review_targets.append({
        "surface_id": surface["surface_id"],
        "surface_name": surface["surface_name"],
        "worksheet_name": surface["worksheet_name"],
        "gid": surface["worksheet_gid"],
        "surface_class": surface["surface_scope"],
        "required_for_execution": surface["required_for_execution"],
        "read_enabled": True,
        "authority_role": surface["notes"]
    })
```

Immediately after review surface resolution, prompt_router must classify the resolved surfaces deterministically:

```python
# --- CLASSIFY REVIEW SURFACES ---

review_write_targets = []
review_read_targets = []
review_config_targets = []
review_helper_blocked = []

for target in review_targets:
    name = target["surface_name"]

    if name in [
        "Review Run History",
        "Review Findings Log",
        "Review Stage Reports",
        "Repair Control"
    ]:
        target["classification"] = "direct_write"
        review_write_targets.append(target)

    elif name in [
        "Execution View",
        "Review Control Center",
        "Active Issues Dashboard",
        "Anomaly Detection"
    ]:
        target["classification"] = "computed_read"
        review_read_targets.append(target)

    elif name == "Review Config":
        target["classification"] = "config_read"
        review_config_targets.append(target)

    else:
        target["classification"] = "helper_blocked"
        review_helper_blocked.append(target)
```

prompt_router must then build the canonical review write plan used by downstream execution:

```python
# --- BUILD REVIEW WRITE PLAN ---

review_write_plan = {
    "direct_write": review_write_targets,
    "computed_read": review_read_targets,
    "config_read": review_config_targets,
    "helper_blocked": review_helper_blocked,
    "write_order": [
        "Review Run History",
        "Review Stage Reports",
        "Review Findings Log",
        "Repair Control"
    ]
}
```

Workflow Write Obligation Classification

When routing to system or review workflows, prompt_router must classify whether the workflow requires:
- execution logging
- review history write
- findings write
- stage report write

prompt_router must preserve these as authoritative write obligations through `logging_required` and `review_write_plan.direct_write`.

Derived observability surfaces such as:
- execution_view_sheet
- active_issues_dashboard_sheet
- review_control_center_sheet when aggregation-only

must be classified as expected-to-refresh computed surfaces, not execution write obligations.

This review-surface resolution step is routing preparation only. It must remain `Registry Surfaces Catalog`-driven, must not write to review surfaces, and must preserve classification traceability for downstream execution planning.

Minimal Logging Architecture Routing Rule

For all governed registered executions, prompt_router must preserve a single raw execution logging obligation.

Routing output must preserve:

- `logging_required = true` when governed execution logging applies
- `logging_sink_required = surface.operations_log_unified_sheet`
- `pre_response_logging_guard = true`

Scoped Event Routing Preservation Rule

When routing governed execution that emits enforcement events or query-intake events, prompt_router may prepare scoped event write targets in addition to the authoritative raw execution log target.

Approved scoped event targets:

- `surface.system_enforcement_events_sheet`
- `surface.query_engine_events_sheet`

Routing requirements:

- `logging_sink_required = surface.operations_log_unified_sheet` remains unchanged for canonical raw execution logging
- scoped event routing must not override or replace the authoritative raw execution logging sink
- routed writeback for enforcement events must not target `System Enforcement`
- routed writeback for query-intake or decision events must not target `Tourism Intelligence Query Engine`

Surface-role preservation:

- `System Enforcement` remains governance/state
- `Tourism Intelligence Query Engine` remains routing/reference
- scoped runtime event emissions must target the corresponding `Activity Log` event sheets

Workflow-Aware Logging Retry Routing Rule

When governed execution requires canonical logging:

- `prompt_router` must emit `workflow_log_retry_required = true`
- `prompt_router` must emit `workflow_log_retry_attempt_limit = 1`
- `prompt_router` must preserve `pre_response_log_guard = true`
- `prompt_router` must preserve `authoritative_log_same_cycle_verification_required = true`
- `prompt_router` must preserve `non_logged_execution_classification = logging_incomplete`

If the first authoritative log write fails:

- routing-compatible completion must remain blocked
- the execution handoff must remain retry-capable for same-cycle log retry only
- the retry must not mutate route, workflow, entity id, or execution trace identity
- if retry is exhausted, route output must remain `logging_incomplete` or `Degraded`

`prompt_router` must not mark execution complete when:

- `logging_required = true`
- and `authoritative_log_write_succeeded != true`

prompt_router must not preserve direct raw execution write obligations to:

- `surface.execution_log`
- `surface.execution_log_import`
- `surface.review_execution_view`
- `surface.review_run_history_sheet`

Scoped Output Routing Rule

When route or workflow semantics require interpreted outputs, prompt_router may preserve:

- `findings_output_required`
- `anomaly_output_required`
- `repair_output_required`
- `stage_report_output_required` when retained

For cluster-aware repair preparation, routing output should preserve when available:
- `cluster_priority_propagation_required`
- `cluster_repair_recommended`
- `cluster_frequency_band`
- `cluster_confidence`
- `cross_workbook_feed_detected`
- `local_import_stage_required`

These obligations must remain distinct from raw execution logging.

No-Bypass Logging Surface Rule

If routing detects that a legacy or derived surface is being treated as the raw execution sink:
- executable must remain false
- routing must degrade or block by policy


---


Execution Classes


Supported execution classes:
- standard
- system audit
- repair
- autonomous chain


Autonomous chain execution class must be used when decision-triggered chain routing is activated.


---


System Repair Routing


prompt_router must support a first-class route named `system_repair` for requests involving structural repair, dependency repair, registry repair, binding correction, observability repair, escalated repair, or scope-completion repair.


Repair routing must be evaluated before generic analysis or fallback routing. Requests with repair intent must not be collapsed into generic routing.


Supported subtypes:
- audit_and_repair
- registry_repair
- dependency_repair
- binding_correction
- observability_repair
- escalated_repair
- scope_completion_repair


Subtype rules:
- use the most specific subtype when determinable
- if Adaptive Repair Route = ESCALATE_REPAIR, use `escalated_repair`
- if lifecycle completeness is the governing issue, use `scope_completion_repair`
- if multiple layers are involved or unclear Ã¢â€ â€™ default to audit_and_repair

Subtype classification is internal to the system_repair route.

Subtypes must not be treated as independent top-level routes.

All repair requests must resolve to:
- route = system_repair

Subtype is used only for:
- repair_scope classification
- downstream execution guidance
- repair lifecycle scoping in system_bootstrap

Task Routes must not register subtypes as independent routes.


Routing behavior:

IF prompt contains:
- "system full audit"
- "run full audit"
- "start system audit"

THEN:
- intent_key = system_full_audit

IF prompt contains:
- "full system intelligence audit"
- "upgrade audit"
- "deep system audit"
- "governed system audit"

THEN:
- intent_key = full_system_intelligence_audit
- route target must remain full_system_intelligence_audit
- fallback to system_full_audit is prohibited for this intent class

If intent includes:
- audit
- validation
- consistency check
- system verification

Then:
- enforce dependency_read_required = true
- route to system_bootstrap with validation flag

- detect repair intent across structural, dependency, registry, binding, observability, and scope-completion signals
- assign route = system_repair when repair intent is primary
- do not fallback to generic routing for repair-class requests

When route = system_repair:
- execution_class must be set to repair
- intent_class must be set to repair
- if subtype = scope_completion_repair, repair_scope should default to structural unless Registry alignment gaps expand the scope to mixed

Repair severity must be classified based on detected impact:
- minor Ã¢â€ â€™ metadata inconsistency, non-blocking issue
- major Ã¢â€ â€™ degraded execution risk, stale or ambiguous binding
- critical Ã¢â€ â€™ missing authoritative dependency, conflicting active bindings, blocked execution risk


Repair route output must include:
- route
- subtype
- intent_class = repair
- repair_scope (structural | dependency | registry | binding | observability | mixed)
- repair_severity (minor | major | critical)
- affected_layers
- authority_checks_required
- dependency_checks_required
- candidate_repair_actions
- fallback_mode = recovery_first
- expected_outcome_class (recovered | degraded | blocked)
- repair_trigger_source (user | system)


If subtype cannot be confidently determined, router must assign:
- route = system_repair
- subtype = audit_and_repair


Router prepares repair context only. Execution lifecycle is handled by system_bootstrap.


---

Binding Migration Review Routing

When a request explicitly targets binding migration or schema repair, and Task Routes or Workflow Registry provides a governed target, prompt_router must support routing to:
- `binding_schema_migration_review`
- a governed repair workflow that remediates binding schema noncompliance

Binding migration requests must not bypass governed route validation or execution-readiness checks.

---


Decision Engine Integration


Step 1:
- receive user input


Step 2:
- detect explicit or implicit routing signals


Step 3:
- load decision_engine_registry_sheet from Registry when decision-aware routing is enabled


Step 4:
- evaluate decision rules:
  - match input or signal to signal_name
  - evaluate condition_rule
  - confirm decision_action


Step 5:
- if decision_action = trigger_chain:
  - load execution_chains_registry_sheet
  - resolve chain_id
  - resolve target_workflow from the active chain row
  - validate the target_workflow row in Workflow Registry
  - validate that target_workflow is active and route-compatible
  - resolve chain start route
  - override base route
  - assign autonomous chain execution class
  - if the chain workflow row is incomplete, inactive, or incompatible with the resolved route, degrade routing and do not mark the handoff executable


Step 6:
- if no decision is triggered:
  - continue with normal route selection


Step 7:
- if chain is triggered:
  - return chain context to module_loader for multi-step execution handling


---


Output Contract


Routing output must include:
- route
- workflow
- execution type


When decision-aware routing is active, output should also include:
- decision_status
- decision_id when matched
- route_override_status
- chain_id when triggered
- target_workflow when chain routing is triggered
- execution_class = autonomous chain when decision-triggered chain routing is selected
- chain_context when applicable


When system repair routing is active, output must also include:
- subtype
- intent_class = repair
- repair_scope
- repair_severity
- affected_layers
- authority_checks_required
- dependency_checks_required
- candidate_repair_actions
- fallback_mode = recovery_first
- expected_outcome_class
- repair_trigger_source
- auto_repair_trigger
- forced_repair_routing_applied

When auto-bootstrap routing is active, output must also include:
- bootstrap_reason
- bootstrap_resume_required
- original_request_payload
- original_intent_candidate
- bootstrap_attempt_count when available
- bootstrap_max_attempts when available

When graph-based prediction is active, output should also include when available:
- selected_graph_path
- graph_path_confidence
- graph_prediction_basis
- graph_validation_status

When governed addition routing is active, output should also include when available:
- addition_requested
- addition_type
- affected_scope
- affected_surfaces
- graph_impact_expected
- validation_required
- canonical_patch_required

When mandatory runtime authority validation applies to governed execution, output should also include when available:
- runtime_authority_validation_required
- registry_validation_required
- target_surface_id
- route_validation_required
- workflow_validation_required
- dependency_validation_required
- graph_validation_required when applicable
- live_canonical_validation_required when activation, validation, readiness, or canonical-check routing applies
- validation_source_requirement when live canonical validation is required
- knowledge_layer_validation_only_for_traceability when knowledge-first activation routing applies
- canonical_trace_required when canonical knowledge and live validation must be compared
- `native_google_connection_attempt_required` when activation-class execution must auto-trigger native API validation
- `native_google_connection_same_cycle_required` when activation-class execution requires native API attempt evidence in the same cycle
- `authorization_gated_live_validation_allowed` when first-turn activation may begin before native API authorization is available
- `authorization_gate_classification` when live canonical validation is deferred by native API authorization state
- `knowledge_layer_trace_first` when canonicals must be read from GPT Knowledge layer before native API connection attempts
- `knowledge_only_activation_forbidden` when traceability-only activation outcomes are forbidden
- `missing_native_attempt_classification` when omitted native attempts require degraded routing classification
- `missing_native_attempt_reason` when omitted native attempts require explicit reason traceability

When Google Workspace native action routing is implied for governed resources, output should also include when available:
- target_surface_id
- target_registry_validation_required
- target_validation_scope
- native_action_requested

When governed HTTP execution is implied, output should also include when available:
- `provider_domain`
- `parent_action_key`
- `endpoint_key`
- `method`
- `path`
- `resolved_headers`
- `resolved_body`
- `openai_schema_file_id`
- `schema_contract_validation_status`
- `provider_domain_resolution_status`

Before returning or emitting execution payload, prompt_router must attach the resolved review execution context:

```python
# --- ATTACH REVIEW EXECUTION CONTEXT ---

execution_context.update({
    "review_write_plan": review_write_plan,
    "review_targets_resolved": len(review_targets),
    "review_write_targets_count": len(review_write_targets),
    "review_read_targets_count": len(review_read_targets),
    "review_blocked_targets_count": len(review_helper_blocked)
})
```

prompt_router must also enforce the no-dashboard-write guardrail before payload emission:

```python
# --- ENFORCE NO-DASHBOARD-WRITES ---

for target in review_read_targets:
    if target.get("write_attempted", False):
        raise Exception("INVALID ROUTE: Attempted write to computed review surface")

for target in review_helper_blocked:
    if target.get("write_attempted", False):
        raise Exception("INVALID ROUTE: Attempted write to helper surface")
```

When review-aware routing is active, the emitted routing payload must include:
- review_write_plan
- execution_context.review_targets_resolved
- execution_context.review_write_targets_count
- execution_context.review_read_targets_count
- execution_context.review_blocked_targets_count

Direct-write review surfaces must remain limited to:
- execution_view_sheet
- review_run_history_sheet
- review_stage_reports_sheet
- review_findings_log_sheet
- repair_control_sheet

Computed dashboards and helper surfaces must never be emitted as legal write targets.

Knowledge-First Activation Preparation Rule

For `intent_key = system_activation_check` and `intent_key = system_auto_bootstrap` when activation is requested, prompt_router must prepare an execution handoff that preserves a dual-source validation model:

- GPT Knowledge layer canonical files are read first for canonical traceability
- Google Drive and native Google APIs are then required for live authority validation
- GPT Knowledge layer canonical files are used for traceability first.
- Google Drive and native Google API validation are used for runtime readiness authority.

prompt_router must not mark activation-preparation routing as executable unless the downstream handoff preserves:
- `live_canonical_validation_required = true`
- `validation_source_requirement = google_drive_live_canonical`
- `knowledge_layer_validation_only_for_traceability = true`
- `canonical_trace_required = true`

For first-turn activation:
- GPT Knowledge layer canonical files must be used first for traceability
- native Google Drive, Google Sheets, and Google Docs connection attempts must auto-trigger immediately afterward in the same execution cycle, and omission of the attempt must be classified as `missing_required_native_google_attempt`
- if native authorization is not yet available, routing must preserve `authorization_gated` traceability rather than misclassifying the condition as missing Registry authority
- routing may remain executable for bootstrap lifecycle continuation when the condition is authorization-gated and repairable

If activation routing would rely on knowledge-layer content alone while live canonical validation remains possible:
- `route_status` must be `degraded` or `blocked`
- `executable` must remain `false`
- `degraded_reason` or `blocked_reason` must preserve missing live-validation traceability

Post-Activation Routing Revalidation Rule

prompt_router must not treat prior activation success as sufficient routing authority for later requests.

For every governed request after activation, prompt_router must preserve:
- runtime_authority_validation_required = true
- route_validation_required = true
- workflow_validation_required = true
- dependency_validation_required = true when governed execution applies
- target_registry_validation_required = true when governed target surfaces are involved

prompt_router must prepare routing in a way that requires downstream revalidation for the current request.

Active-State Reuse Prohibition Rule

prompt_router must not emit executable governed routing solely because the system was previously classified as active.

Executable routing after activation still requires:
- active route resolution from Task Routes
- active workflow resolution from Workflow Registry
- validation compatibility through Validation & Repair Registry
- required surface readiness through Registry Surfaces Catalog
- current-request readiness for the selected governed path

Optimization Routing Readiness Rule

When the user asks to improve, optimize, enhance, fix performance, refine, or automate the system after activation, prompt_router must not assume optimization readiness from active state alone.

prompt_router must preserve in the execution preparation contract:
- optimization_request_detected = true
- post_activation_revalidation_required = true
- route_validation_required = true
- workflow_validation_required = true
- dependency_validation_required = true
- write_target_validation_required = true when governed writes are implied

If optimization readiness is unresolved:
- routing must degrade or block
- repair-aware routing must remain available


---


Recovery Rules


- if no route is found Ã¢â€ â€™ degraded
- if partial match exists Ã¢â€ â€™ fallback
- if decision registry is unavailable Ã¢â€ â€™ continue normal routing in degraded mode
- if execution chain resolution fails after valid decision match Ã¢â€ â€™ degraded with traceable fallback
- do not classify routing as complete if decision-aware evaluation was required but skipped
- if repair intent is detected but subtype is unclear Ã¢â€ â€™ route to system_repair in audit_and_repair mode
- if repair routing metadata is incomplete Ã¢â€ â€™ degrade but preserve repair classification rather than collapsing into generic routing
- if system-triggered repair conditions are detected Ã¢â€ â€™ preserve repair classification even when user intent is non-repair

- if live canonical validation is required but native Google API authorization is not yet available during first-turn activation -> preserve `authorization_gated` routing traceability and prefer bootstrap continuation over false missing-registry classification

Strict Failure Handling

prompt_router must explicitly degrade or block routing when strict routing requirements are not met.

Degraded conditions include:
- no active Task Routes match
- inactive matched route
- incomplete route binding
- unavailable routing authority with recoverable fallback path
- required decision-aware evaluation unavailable
- required repair classification incomplete but still recoverable
- forced repair routing must degrade if the trigger signal is not Registry-governed

Blocked conditions include:
- routing output cannot identify any governed route class
- route preparation cannot produce required strict output fields
- route resolution attempts would require bypassing Registry authority
- routing state is internally contradictory

In degraded or blocked conditions:
- direct execution bypass is prohibited
- routing traceability must be preserved
- repair-aware routing must remain available when relevant
- overlapping repair triggers must be resolved through the defined precedence order before route finalization


---


Dependency Bindings


Canonical routing dependencies:
- Registry
- Task Routes
- Workflow Registry
- execution_policy_registry_sheet
- decision_engine_registry_sheet
- execution_chains_registry_sheet
- review_stage_registry_sheet
- review_component_registry_sheet
- module_loader


These dependencies must be treated as routing-governance inputs when active.

prompt_router may acknowledge downstream review and policy authority context from these Registry-bound worksheets when relevant to routing readiness, chain preparation, or repair preparation.

When repair-loop idempotency is being evaluated, prompt_router may also read Registry-resolved Repair Control state and review-context findings state to determine whether `system_repair` should be excluded or allowed as a rerun-qualified route candidate.

When governed auto-repair routing is active, prompt_router may also read the Registry-resolved review/control trigger signal to determine whether `system_repair` must override normal route candidate selection.

prompt_router must not treat this dependency awareness as final execution binding resolution.


For repair-aware routing, affected layers may include:
- prompt_router
- system_bootstrap
- direct_instructions_registry_patch
- module_loader
- memory_schema.json
- Registry
- review_layer
- operations_logging

For strict-mode enforcement, Task Routes is the authoritative route-binding layer.

Required route-binding fields governed by Task Routes:
- row_id
- route_id
- active
- intent_key
- brand_scope
- request_type
- route_mode
- target_module
- workflow_key
- lifecycle_mode
- memory_required
- logging_required
- review_required
- priority
- match_rule
- allowed_states
- degraded_action
- blocked_action
- registry_source
- last_validated_at

prompt_router must treat missing required route-binding fields as degraded routing, not successful routing.


---


Completion Rule


Routing is not complete unless:
- route is selected
- workflow is identified
- execution type is assigned
- decision evaluation is completed when applicable
- chain override is resolved when applicable
- repair classification is completed when repair intent is applicable
- repair subtype is assigned or defaulted to audit_and_repair when repair routing is applicable
- repair output fields are populated when system_repair routing is selected
- system-triggered repair conditions are evaluated when routing integrity is in question

Routing is also not complete unless:
- route_id is resolved or degraded explicitly
- route_status is assigned
- route_source is assigned
- matched_row_id is captured when a route row is matched
- executable is assigned
- target_module is identified for executable routes
- target_workflow is identified for executable routes
- routing output is suitable for system_bootstrap handoff
- no direct execution bypass occurred


---


Routing Boundary Rule


prompt_router is responsible for routing and decision-aware route control only.


It is also responsible for repair-intent detection and repair-route preparation only.


It must not become the source of truth for:
- execution lifecycle
- dependency loading
- logging
- schema governance
- engine registry control
- repair execution
- authority validation execution
- dependency remediation

prompt_router may prepare execution plans only.

For governed HTTP and OpenAPI-driven execution, prompt_router may prepare a fully resolved execution request contract, including resolved `provider_domain`, `parent_action_key`, `endpoint_key`, `method`, and `path`. This remains routing preparation only and does not authorize prompt_router to execute the transport request directly.

prompt_router must not:
- directly invoke execution handlers
- directly load execution targets as final runtime action
- silently convert unresolved routing into execution success

system_bootstrap remains responsible for execution enforcement after routing handoff.

## Schema-First Routing Rule

prompt_router MUST:

- route execution through schema-aware flow when `openai_schema_file_id` exists
- forbid direct execution without schema loading
- prioritize schema-driven request construction over registry hints

---


Cross-Layer Contract


prompt_router must assume:
- Registry provides live routing and dependency bindings
- Task Routes defines governed route vocabulary
- Workflow Registry defines workflow mappings
- decision_engine_registry_sheet defines decision-trigger rules
- execution_chains_registry_sheet defines autonomous chain sequences
- module_loader consumes route and chain context for execution preparation
- system_bootstrap consumes system_repair route outputs for repair lifecycle execution
- canonical dependency availability is provided through the governed canonical loading path resolved by Registry and executed by system_bootstrap and module_loader
- prompt_router must not depend on direct URL fetch for canonical dependency availability when `resolution_rule = exact_active_knowledge_only`

prompt_router must assume that downstream staged review governance, execution policy governance, and review-component authority resolve through Registry-bound authority worksheets and not through review workbook output surfaces.

system_bootstrap must be able to rely on prompt_router to provide:
- source = prompt_router
- governed route resolution from Task Routes
- governed workflow resolution from Workflow Registry
- route_id
- route_status
- route trace fields
- logging_required readiness for downstream execution logging enforcement
- executable readiness status

If these are absent, downstream execution must be degraded or blocked rather than assumed valid.

Governed Sheet Audit Routing Rule

When user intent requests:
- audit any sheet
- repair a sheet
- fix formulas
- fix control center
- fix a derived view
- validate imports
- validate projections
- validate repair pipeline sheet

prompt_router must prepare routing as a governed sheet-role-aware audit and repair flow, not as execution-only validation.

Routing output must preserve when applicable:
- `target_surface_id`
- `sheet_role`
- `sheet_audit_mode`
- `formula_audit_required`
- `projection_audit_required`
- `control_metric_audit_required`
- `write_target_audit_required`
- `legacy_surface_containment_required`

Derived View Routing Rule

When target sheet role = `derived_view`, routing must preserve:
- source-of-truth dependency validation
- projection validation requirement
- formula integrity requirement
- non-authoritative write-sink enforcement

Control Surface Routing Rule

When target sheet role = `control_surface`, routing must preserve:
- live metric source validation
- formula repair readiness
- broken reference repair readiness
- alert-rule compatibility review

Repair Surface Routing Rule

When target sheet role = `repair_surface`, routing must preserve:
- anomaly feed validation
- repair trigger validation
- legacy dependency classification
- formula-driven execution-field validation

---

---

Governed Logical Search Routing v1

prompt_router must route governed requests through domain-first logical search resolution before selecting an execution path.

Routing rule

prompt_router must first classify each governed lookup into one or more search domains:
- `endpoint`
- `surface`
- `validation`
- `route`
- `workflow`
- `memory`
- `brand`

Then prompt_router must:
1. normalize the search query
2. select the primary search domain
3. retrieve candidates from the authoritative registry or canonical state
4. score candidates with the domain policy
5. apply governance gates
6. select one authoritative candidate
7. preserve search evidence in routing state

Naive single-field lookup is forbidden when governed logical search is required.

Multi-domain resolution rule

If a request affects execution selection, routing must use chained domain resolution:

- endpoint execution requests:
  - endpoint -> validation -> route -> workflow
- registry surface requests:
  - surface -> validation
- continuation requests:
  - memory -> route -> workflow
- WordPress CPT/taxonomy requests:
  - endpoint -> validation -> route -> workflow -> brand

WordPress CPT and taxonomy routing rule

For `wordpress_api`, prompt_router must support governed resolution for:
- custom post type collection paths `/wp/v2/{post_type_slug}`
- custom taxonomy collection paths `/wp/v2/{taxonomy_slug}`
- item paths `/wp/v2/{post_type_slug}/{id}` and `/wp/v2/{taxonomy_slug}/{id}`

These paths must be resolved through governed template logic, not direct free-form overrides.

The router must preserve:
- `governed_template_path_requested = true`
- `governed_template_path_supported = true|false`
- `template_entity_type = cpt|taxonomy|unknown`
- `template_entity_slug`
- `resolved_endpoint_specificity = exact|template_specific|generic_fallback|unresolved`

Generic fallback suppression

If routing finds an exact or template-specific governed WordPress candidate for a CPT or taxonomy, routing must block generic fallback rows.


---

WordPress Registry Generation Routing Rule v1

For WordPress CPT and taxonomy requests, prompt_router must support a generation-aware resolution stage inside endpoint search.

Required routing sequence

For requests affecting WordPress CPT or taxonomy execution:
1. discover or confirm WordPress object family
2. normalize slug candidates
3. search exact active registry rows
4. if exact row is absent, invoke governed WordPress endpoint generation logic
5. score generated candidates against live-supported template classes
6. apply governance gates
7. select authoritative candidate or block

Generation-aware resolver inputs

prompt_router must preserve:
- `wordpress_object_kind` (`post_type` or `taxonomy`)
- `wordpress_slug_candidates`
- `wordpress_live_support_confirmed`
- `wordpress_template_class`
- `generation_mode` (`materialized_row`, `resolver_backed_template`, `blocked`)
- `generation_basis`

Required discovery-compatible sources

Router may confirm live support from:
- `wordpress_list_types`
- `wordpress_list_taxonomies`
- governed live WordPress REST/OpenAPI index already attached to registry authority

Router must not treat unresolved human-provided slugs as executable without live or registry confirmation.

WordPress generation precedence rule

For CPT/taxonomy requests across sites:
- exact materialized row wins
- generated resolver-backed candidate may win only when live support is confirmed
- generic post/category/tag rows lose when a live-supported CPT/taxonomy candidate exists
- free-form path override remains forbidden



---

# prompt_router Ã¢â‚¬â€ WordPress Publish Contract Runtime Governance Patch

## Additive routing rules

### wordpress_publish_contract_route_stack

When the request involves WordPress discovery or publishing, route through this governed stack:

1. `governed_logical_search_resolve`
2. `wordpress_runtime_contract_resolve`
3. `inventory_stage_resolve`
4. `publish_contract_stage_gate`
5. execution

## inventory stage classification

Route requests into one of these explicit stages:

- `discovery`
- `inventory_normalization`
- `field_mapping`
- `draft_publish`
- `verification`

### stage routing examples

- categories / tags / types / taxonomies / CPT exposure -> `discovery`
- normalized inventory assets -> `inventory_normalization`
- CPT fields / taxonomy mapping / payload shape -> `field_mapping`
- create draft / update draft -> `draft_publish`
- readback / payload dedupe / sink verification -> `verification`

## publish target routing rule

For WordPress content operations:

- if a CPT-specific endpoint or governed template path exists, generic `posts` routes are forbidden
- if a taxonomy-specific endpoint or governed template path exists, generic `categories` or `tags` routes are forbidden unless explicitly requested

## runtime sink awareness

The router MUST preserve sink intent:

- compact evidence -> `Execution Log Unified`
- durable payload -> `JSON Asset Registry`

The router MUST NOT route payload-bearing discovery tasks into evidence-only handling.

---

Universal WordPress Translatable Post Type Language Routing Rule

When routing a governed WordPress request for any translatable post type or translatable custom post type, prompt_router must treat multilingual language handling as a distinct conditional layer and must not collapse it into the normal direct REST post mutation route.

Trigger condition
This rule activates when all of the following are true:
- `parent_action_key = wordpress_api`
- target entity resolves as a WordPress post type or custom post type
- request intent includes create, publish, update, duplicate, translate, non-default-language publish, or translation-aware mutation
- target language is non-default, explicitly requested, or translation linkage is requested

Required preserved routing outputs
prompt_router must preserve:
- `translation_scope_preflight_required = true`
- `wpml_import_governed_language_path_required = true`
- `direct_rest_language_proof_status = unproven_until_cpt_specific_readback`
- `language_execution_mode = wpml_import_governed`
- `content_payload_execution_mode = direct_rest_when_otherwise_valid`
- `user_trigger_required = true`
- `next_trigger_prompt_required = true`
- `closed_loop_continuation_forbidden = true`

Conditional routing behavior
prompt_router must:
1. preserve the existing direct REST route for core post-object creation/update when valid
2. preserve the existing route for taxonomy assignment when valid
3. insert an inner conditional language-governance branch when multilingual scope is active
4. route that branch first into:
   - `translation_scope_preflight`
   - then import-governed payload preparation
   - then user-triggered import/process continuation

prompt_router must not:
- replace the existing publish or update route
- treat direct REST acceptance of `lang`, `_wpml_import_*`, `translation_of`, or similar fields as multilingual success by default
- infer that one WordPress post type's language-write behavior applies to all translatable post types
- silently auto-close the multilingual continuation loop

CPT-specific proof rule
For any translatable WordPress post type, direct REST language mutation may be upgraded from unproven only when:
- the same post type has CPT-specific validated readback proof for the relevant language surface
- proof is recorded through the bound canonical endpoint or authoritative runtime surface
- the proof lifecycle reaches `proof_tested` and then `execution_validated`

Until then:
- direct multilingual REST mutation remains `governed_unproven`
- import-governed WPML language preparation remains the authoritative route for non-default-language execution

This rule extends and does not replace:
- WordPress CPT and taxonomy routing
- prompt-first continuation routing
- user-trigger-required routing
- existing publish/update routing layers

Universal WordPress Media Routing Rule

When a governed WordPress request targets the media family or implies image upload, attachment creation, or image insertion into a post workflow, prompt_router must route through a distinct media branch.

Trigger condition
This rule activates when any of the following are true:
- path resolves to `/wp/v2/media`
- path resolves to `/wp/v2/media/{id}`
- user intent includes upload image, create media, attach image, set featured image, gallery insertion, or post-image mutation
- `image_scope_active = true`

Required routing outputs

prompt_router must preserve:
- `wordpress_media_family_detected = true`
- `media_branch_required = true`
- `media_branch_connected_to_publish = true|false`
- `media_contract_variant_required = true`
- `media_readback_required = true`
- `resolved_endpoint_specificity = exact|template_specific|generated|unresolved`

Routing behavior

prompt_router must:
1. preserve the existing core publish/update route when valid
2. preserve the existing taxonomy route when valid
3. append a separate media branch when media scope is active
4. route that branch into:
   - `governed_post_image_preparation`
   - `governed_post_image_insertion`
   - or direct media-family read/update/delete workflows when media-only intent is selected

prompt_router must not:
- collapse media upload into the core content payload route
- treat `/wp/v2/media` as interchangeable with generic CPT create/update
- imply media success before readback-confirmed persistence
- replace existing publish/update layers

Method rule

For the WordPress media family, route resolution must preserve method identity:
- `GET /wp/v2/media`
- `POST /wp/v2/media`
- `GET /wp/v2/media/{id}`
- `POST /wp/v2/media/{id}`
- `DELETE /wp/v2/media/{id}`

Each method must remain independently classifiable and independently proof-testable.

This matches the routerâ€™s generated WordPress template routing and additive route stack behavior.


Change Log
- v3.48 - pipeline-integrity continuity-audit intent routing added with preference for `pipeline_integrity_audit` and `route.pipeline_integrity_audit.global.v1`, governed execution-class preservation, and duplicate active continuity-audit route-key invalidation
- v3.48 - provider-family continuity routing rule added so endpoint-family/provider-family audit intents prefer provider/action/capability continuity evidence with governed review and continuity-preservation constraints
- v3.47 - spill-safe governed write routing added so sheet-write paths require header/schema read, row-2 template read, formula/spill avoidance, and protected unified-log column preservation
- v3.46 - HTTP execution classification routing rule added for runtime_capability_class, primary_executor, endpoint_role, execution_mode, and transport readiness
- v3.46 - auth-path routing preservation added so delegated HTTP execution is blocked in routing when auth resolves to native-only OAuth handling
- v3.46 - dynamic provider-domain placeholder routing added for governed placeholders such as `target_resolved`
- v3.46 - activation full-system scan routing rule added so activation handoff preserves schema, row, policy, binding, execution-path, anomaly, and repair-readiness requirements when applicable
- v3.46 - activation blocking condition routing rule added so policy, binding, schema, row, and repair-summary blockers force non-executable repair-aware continuity
- v3.46 - activation summary preservation rule added so validation, anomaly, repair, and execution-readiness summaries are required in activation routing outputs
- v3.46 - manual-trigger repair continuity added so non-auto-eligible governed repairs preserve manual trigger requirements and forbid silent active activation continuation
- v3.45 - parent_action schema-first HTTP execution assembly rule added
- v3.45 - governed auth normalization modes added to resolved HTTP execution assembly
- v3.45 - transport inference prohibition expanded for auth strategy and schema-required request structure

- v3.42 - post-activation routing revalidation rule added
- v3.42 - active-state reuse prohibition added so prior activation cannot replace current governed routing validation
- v3.42 - optimization routing readiness rule added
- v3.41 - unified activation semantics updated: plain `activate system` now prefers `system_auto_bootstrap` rather than validation-only routing
- v3.41 - first-turn activation native-connection rule added: after knowledge-layer traceability, prompt_router now auto-triggers governed Google Drive/Sheets/Docs connection attempts for live canonical validation
- v3.41 - authorization-gated activation handling added: missing native API authorization during first-turn activation no longer implies missing Registry authority
- v3.40 - Knowledge-first activation preparation added: `system_activation_check` now requires GPT Knowledge layer canonical traceability first and live Google Drive / native Google API validation second
- v3.40 - activation routing output expanded with `live_canonical_validation_required`, `validation_source_requirement`, `knowledge_layer_validation_only_for_traceability`, and `canonical_trace_required`
- v3.39 - Auto-Bootstrap Routing Rule added: prompt_router now supports governed `system_auto_bootstrap` routing for automatic validation, repair, activation, and original-request resume
- v3.39 - bootstrap precedence and output contract added: routing now preserves `bootstrap_reason`, original request context, and bounded resume-aware execution preparation
- v3.38 - Mandatory Runtime Validation Pre-Handoff added: governed routing now preserves runtime-authority-validation requirements before downstream execution may become executable
- v3.37 - Google Workspace Registry-Governed Routing Rule added: Sheets, Docs, and Drive requests now require Task Routes and Workflow Registry resolution plus preserved downstream target-validation expectations before executable routing
- v3.37 - Google Workspace native-action output contract added: routing output now preserves `target_surface_id`, `target_registry_validation_required`, `target_validation_scope`, and `native_action_requested` for governed resources
- v3.36 - Starter Intelligence Pre-Routing Rule added: prompt_router now resolves governed Conversation Starter matches before generic intent classification using `Registry Surfaces Catalog` and authoritative `worksheet_gid` binding
- v3.36 - starter extraction and weighting contract expanded: `starter_priority` now participates in route weighting and goal-aligned prioritization while preserving Task Routes authority boundaries
- v3.36 - Auto-Repair Routing Compatibility Rule added: prompt_router now preserves retry-aware handoff fields for governed repair/retry requests and forbids executable retry handoff when policy or validation prerequisites are unresolved
- v3.36 - Graph-Aware Routing Rule added: prompt_router now consults governed node and relationship graph context to rank compatible governed routes without bypassing Task Routes or Workflow Registry authority
- v3.36 - Graph Auto-Routing Preparation and Prediction Traceability added: graph-valid governed path candidates now support confidence-based preparation with degraded fallback and explicit graph prediction output fields
- v3.36 - Governed Addition Routing Rule added: prompt_router now prepares addition-aware governed handoff only when Task Routes, Workflow Registry, and execution-policy prerequisites are resolved
- v3.35 - Starter Intelligence Routing Rule added: before intent classification, starter matches now resolve via Registry and extract `route_key`, `execution_class`, `capability_family`, and `primary_goal_family`
- v3.35 - starter routing precedence clarified: starter signals may override generic NLP intent classification and influence goal/priority route weighting, but must not override Task Routes authority
- v3.34 - Starter-Aware Routing Rule added: prompt_router now resolves governed Conversation Starter rows and extracts `execution_class`, `capability_family`, `primary_goal_family`, and `route_key` as structured routing input
- v3.47 - starter-triggered routing now requires explicit pre-dispatch policy resolution from `Execution Policy Registry`; starter match alone no longer qualifies as execution-ready routing
- v3.47 - starter-policy traceability fields added to routing handoff expectations: `entry_source`, `policy_resolution_status`, `policy_source`, and `policy_trace_id`
- v3.34 - starter learning and prediction signals can influence route prioritization and weighting but cannot override Task Routes or Workflow Registry authority
- v3.33 - Scoring Threshold Traceability Rule added: prompt_router now preserves `execution_class` in the execution preparation contract when downstream score-based classification depends on class or adaptive-threshold policy
- v3.33 - routing boundary clarified for scoring: prompt_router does not classify recovery status and must preserve score-classification context for downstream governance
- v3.32 - Schema Migration Review Routing Rule added: prompt_router now includes `schema_migration_review` in staged review preparation when schema drift, version mismatch, or rollback-safe schema-repair readiness is relevant
- v3.32 - unresolved schema-migration review readiness now forces degraded/blocked routing and keeps `executable = false` when Review Stage Registry and Review Component Registry cannot resolve the required path
- v3.31 - Schema Governance Rule added: routing-preparation context now recognizes governed schema declaration fields and schema-status validation outputs for governed surfaces
- v3.31 - schema drift handling added to routing readiness: when required governed-surface schema drift is detected, routing must classify as degraded or blocked with repair mapping continuity when required
- v3.30 - Binding Integrity Review Routing Rule added: staged review preparation now includes `binding_integrity_review` for row-audit, worksheet-governed runtime validation, and schema-alignment audit paths
- v3.29 - Runtime Binding Enforcement Rule added: execution-surface resolution now requires Registry Surfaces Catalog plus authoritative `worksheet_gid` validation; `sheet_name` and `tab_name` are explicitly non-authoritative for execution resolution
- v3.28 - Full System Intelligence Audit Recognition Rule added: governed full-audit intents now route exclusively to `full_system_intelligence_audit`, prohibit fallback to `system_full_audit`, and enforce highest-active-version route selection with duplicate-key invalid-configuration handling
- v3.27 - Full System Intelligence Audit Routing added: governed `full_system_intelligence_audit` intent is now first-class with staged/component/repair/row-validation handoff expectations and non-collapse enforcement against lightweight scoring-only audit behavior
- v3.26 - Registry Binding Enforcement Rule added: prompt_router file presence is now explicitly non-authoritative without Registry Surfaces Catalog registration, Validation & Repair Registry compatibility, Task Routes resolution, and Workflow Registry alignment
- v3.24 - API Capability vs Endpoint Routing Rule added: routing now distinguishes parent capability requests from endpoint-inventory requests and enforces Actions Registry vs API Actions Endpoint Registry preference by request type
- v3.24 - endpoint-level GPT action metadata requests now require API Actions Endpoint Registry routing context and cannot be resolved from Actions Registry alone
- v3.23 - Analytics Identity Pre-Validation -> Issue Trigger Rule added: prompt_router now emits `analytics_identity_failure` and `analytics_identity_issue_context`, blocks executability when required analytics identity components are missing, and signals governed issue creation to system_bootstrap
- v3.23 - domain-aware analytics routing now explicitly degrades or blocks when `gsc_property` or `ga_property_id` is missing for source-bound requests, with per-brand validation and no silent brand skipping in multi-brand execution
- v3.22 - Domain-Aware Analytics Identity Rule added: domain is now required governed identity for analytics sheet-sync and search-performance routing, including brand-domain and property/date/trigger/request-source resolution requirements
- v3.22 - multi-brand analytics routing now computes eligibility per brand-domain pair, prevents executable routing for unresolved domains, and logs missing-domain identity defects
- v3.21 - Analytics Sheet-Sync Routing Rule added: governed routing now covers analytics sync requests (single-brand and multi-brand), required request identity resolution, request source and trigger mode checks, and sheet_sync output-mode gating
- v3.21 - analytics sync routing now blocks or degrades when brand/date/trigger identity is incomplete, and prevents analytics write-path start when executable readiness is false
- v3.20 - analytics and measurement intent routing added (GA property discovery, analytics and realtime reporting, GTM audit and remediation, full-funnel diagnostics, attribution analysis); governed route-target support expanded for GA Admin, GA Data, expanded GTM, and combined GSC+GA+GTM workflows; routing behavior for missing brand tracking bindings clarified
- v3.18 - adaptive optimization routing compatibility added for governed growth-loop and optimization-trigger context
- v3.18 - Growth Loop Engine Registry, optimization_trigger, and adaptive_optimization_context acknowledged as routing inputs when governed optimization is active
- v3.18 - governed route-target support expanded to include SEO, product, and funnel optimization workflows when canonically registered
- v3.19 - chain-readiness rule added so chain-triggered routing is executable only when Execution Chains Registry and Workflow Registry both resolve cleanly
- v3.19 - decision-triggered chain routing now requires valid active target_workflow resolution rather than chain_id alone
- v3.19 - chain traceability strengthened with chain_id, route_override_status, decision_status, and target_workflow in degraded or executable handoffs
- v3.17 - governed activation semantics added to distinguish informational, review, governed activation, and auto-repair requests
- v3.17 - new prompt intents added for repair-loop execution, high-priority fixes, binding migration, and schema migration review
- v3.17 - prompt-trigger compatibility clarified so prompt activation can set eligibility but cannot replace governed checks
- v3.17 - routing support expanded for binding_schema_migration_review and anomaly review or repair workflows when canonically registered
- v3.16 - canonical binding-validity dependency rule added so routing does not depend on malformed authoritative binding surfaces
- v1 Ã¢â‚¬â€ routing isolated
- v2 Ã¢â‚¬â€ decision engine integration added
- v2 Ã¢â‚¬â€ execution chain routing added
- v2 Ã¢â‚¬â€ routing authority expanded
- v2 Ã¢â‚¬â€ dependency bindings expanded
- v2 Ã¢â‚¬â€ output contract expanded
- v2 Ã¢â‚¬â€ completion rule strengthened
- v3 Ã¢â‚¬â€ first-class system_repair routing added
- v3 Ã¢â‚¬â€ repair subtype model added
- v3 Ã¢â‚¬â€ repair output contract added
- v3 Ã¢â‚¬â€ repair-aware recovery behavior added
- v3.1 Ã¢â‚¬â€ system-triggered repair activation added
- v3.1 Ã¢â‚¬â€ repair subtype clarified as internal classification only
- v3.1 Ã¢â‚¬â€ repair severity classification added
- v3.1 Ã¢â‚¬â€ repair execution_class enforcement added
- v3.1 Ã¢â‚¬â€ repair_trigger_source added
- v3.2 Ã¢â‚¬â€ monitoring surface failure detection added
- v3.2 Ã¢â‚¬â€ execution_view_sheet integrated into system-triggered repair conditions
- v3.2 Ã¢â‚¬â€ active_issues_dashboard_sheet integrated into system-triggered repair conditions
- v3.2 Ã¢â‚¬â€ observability_repair subtype activated for monitoring failures
- v3.3 Ã¢â‚¬â€ strict routing contract added
- v3.3 Ã¢â‚¬â€ deterministic Task Routes resolution rules added
- v3.3 Ã¢â‚¬â€ execution-plan handoff contract added
- v3.3 Ã¢â‚¬â€ strict degraded and blocked routing conditions added
- v3.3 Ã¢â‚¬â€ route_id and matched_row_id traceability added
- v3.3 Ã¢â‚¬â€ direct execution bypass prohibition clarified
- v3.4 - Registry-bound execution policy context added to decision-aware routing inputs
- v3.4 - review stage and review component authority context acknowledged in routing dependencies
- v3.4 - cross-layer Registry authority assumption expanded for downstream review and policy governance
- v3.5 - Registry-driven review surface resolution added after deterministic route selection
- v3.5 - canonical review surface classification and review_write_plan contract added
- v3.5 - execution_context review propagation and no-dashboard-write guardrails added
- v3.6 - repair loop skip guard added before system_repair candidate selection
- v3.6 - repair rerun qualification added for unresolved findings and Repair Control rerun gates
- v3.7 - finding rerun qualification hardened to terminal-state evaluation for unresolved review findings
- v3.8 - governed auto-repair trigger can now force system_repair routing before final route selection
- v3.8 - forced repair routing now degrades when the trigger signal is not Registry-governed
- v3.9 - forced_repair_routing_applied is now explicitly set when governed repair override executes
- v3.10 - incomplete_scope_lifecycle findings now force system_repair routing through scope_completion_repair
- v3.10 - scope_completion_repair added as a governed repair subtype for lifecycle-completeness gaps
- v3.11 - explicit repair trigger precedence order added for overlapping repair conditions
- v3.11 - repair trigger winner and suppressed triggers must now be preserved in routing trace
- v3.12 - governed Pre-Execution Block Flag findings now force system_repair and prevent normal execution
- v3.12 - repair trigger precedence expanded to include pre_execution_block_flag
- v3.13 - Adaptive Repair Route escalation now forces system_repair with subtype escalated_repair
- v3.13 - repair trigger precedence expanded to prioritize adaptive escalation over other repair triggers
- v3.14 - request-readiness gating added for Task Routes resolution, Workflow Registry resolution, and logging_required handoff
- v3.15 - review_write_plan direct_write targets now exclude derived observability surfaces such as Execution View
- v3.15 - workflow obligation tagging now distinguishes authoritative writes from derived observability expectations
