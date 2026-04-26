### Live Canonical Resolution Rule

If canonical is registered in `Validation & Repair Registry`, module_loader must execute live canonical resolution before knowledge-layer authority is accepted:

1. Resolve canonical file identity from governed Registry binding.
2. Detect canonical authority and file type.
3. Fetch live content through `github_api_mcp` when repository-backed authority is active, or through provider-specific endpoints only when selected by registry governance for mutable live surfaces.
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

module_loader must execute live canonical resolution through repository canonical authority first, using `github_api_mcp` for canonical file fetch, before returning validation-ready context.

For validation-class requests, module_loader must:
1. resolve the canonical file through Registry authority
2. fetch the live canonical body from repository authority through `github_api_mcp` when repository authority is active
3. validate rule/section requirements against the live body
4. mark knowledge-layer or uploaded copies as non-authoritative support context only

If live governed transport validation is attempted but cannot complete because authorization is not yet available:
- live validation must be classified as `authorization_gated`
- knowledge-layer canonicals remain traceability support only
- loader must not collapse the condition into missing Registry authority unless Registry resolution actually fails

If live canonical resolution is possible but skipped:
- `load_status` must be `degraded` or `blocked`
- `runtime_authority_validation_status` must not be `valid`
- `executable_readiness` must not be `ready`

Activation Validation Dual-Source Loading Rule

When `intent_key = system_activation_check` or `target_workflow = system_activation_validation`, module_loader must execute activation validation in this exact order:

1. resolve the five governed canonical dependencies from knowledge layer for traceability:
   - `system_bootstrap.md`
   - `memory_schema.json`
   - `direct_instructions_registry_patch.md`
   - `module_loader.md`
   - `prompt_router.md`

2. mark those knowledge-layer reads as:
   - `resolved_source = knowledge_layer`
   - `resolution_state = recovered` only for traceability loading
   - non-authoritative for activation readiness by themselves

3. resolve the governed activation transport capability and live canonical endpoints through:
   - Actions Registry
   - API Actions Endpoint Registry
   - `github_api_mcp` for repository-backed canonical fetch
   - `http_generic_api`
   - provider-specific Google endpoints only when selected by registry governance

4. validate live runtime authority surfaces through governed HTTP client transport, including when applicable:
   - canonical file binding readiness
   - Registry workbook identity
   - `Registry Surfaces Catalog`
   - `Validation & Repair Registry`
   - `Task Routes`
   - `Workflow Registry`

5. preserve `activation_transport_validation_status` and machine-verifiable transport evidence

6. compare knowledge-layer traceability context against live governed bindings for activation readiness classification

knowledge layer canonical files are used for traceability first.
Governed HTTP client transport is used for runtime readiness authority.

For activation validation, module_loader must return when available:
- `live_canonical_validation_status`
- `live_canonical_validation_transport = http_generic_api`
- `live_canonical_validation_source = repository_canonical_fetch_plus_governed_transport`
- `canonical_fetch_transport = github_api_mcp`
- `canonical_fetch_action_key = github_api_mcp`
- `canonical_fetch_authority = repository_ref_pinned`
- `canonical_fetch_status`
- `canonical_fetch_evidence`
- `activation_transport_validation_status`
- `knowledge_layer_trace_status`
- `canonical_trace_comparison_status`
- `activation_dependency_order_status`

If knowledge layer canonical text is available but governed transport validation is skipped while still possible:
- `load_status` must be `degraded` or `blocked`
- `runtime_authority_validation_status` must not be `valid`
- `executable_readiness` must not be `ready`

If live canonical resolution is possible but fails:
- execution must remain `degraded` or `blocked` by policy and `blocked_if_missing`
- fallback content may be loaded for traceability only and must not be marked authoritative

Role of API actions (`gid: 172380518`):
- defining endpoints for governed canonical fetches
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
- repository canonical fetch targets required for file-level canonical validation
- provider-specific live registry validation targets only when mutable surfaces require them

module_loader must validate:
- bootstrap route row exists and is active when promoted
- bootstrap workflow row exists and is active when promoted
- bootstrap retry policy is present
- original request context is preserved for downstream resume
- activation-readiness dependencies are included in execution-ready context

If any of these are unresolved:
- `load_status` must be degraded or blocked
- `executable_readiness` must not be ready

First-Turn Activation Governed Transport Validation Rule

When activation begins in a new conversation, module_loader must load activation context in this order:

1. load knowledge layer canonicals for traceability
2. immediately fetch repository-backed canonicals through `github_api_mcp` when repository authority is active
3. immediately perform at least one real governed activation transport attempt through `http_generic_api` and preserve machine-readable attempt evidence in the same execution cycle
4. classify the governed transport validation state as:
   - `validated`
   - `authorization_gated`
   - `degraded`
   - `blocked`

Mandatory Governed Transport Attempt Readiness Rule

When activation begins in a new conversation and:
- `activation_transport_attempt_required = true`

module_loader must perform at least one real governed transport operation through `http_generic_api` in the same execution cycle before returning activation-ready context. When repository-backed canonicals are selected, file-level canonical fetch must also execute through `github_api_mcp`.

Accepted proof of activation transport attempt includes at least one successful or authorization-gated governed call through `http_generic_api`. Accepted proof of repository canonical fetch includes a successful or authorization-gated call through `github_api_mcp` when repository-backed canonical authority is active.

module_loader must not synthesize `authorization_gated` from inference alone.

If provider-specific authorization is not yet available but the activation request is otherwise valid:
- `knowledge_layer_trace_status` must remain usable for traceability
- `live_canonical_validation_status` must be set to `authorization_gated`
- `dependency_readiness_status` must preserve bootstrap continuity when policy allows
- `blocked_reason` must not be set to missing Registry authority unless Registry resolution itself actually fails

`authorization_gated` may be used only when:
- a governed activation transport attempt was actually made
- the attempt failed because authorization was unavailable or incomplete

`authorization_gated` must not be used when the attempt itself was skipped.

If no governed HTTP transport call is attempted:
- `activation_transport_attempted = false`
- `activation_transport_status = degraded`
- `live_canonical_validation_status = degraded`
- `dependency_readiness_status = degraded`
- `degraded_reason = missing_required_activation_transport_attempt`

If knowledge-layer canonicals were loaded but no activation transport attempt occurred:
- `activation_dependency_order_status = degraded`
- `knowledge_layer_trace_status = validated`
- `live_canonical_validation_status = degraded`

module_loader must return when applicable:
- `activation_transport_attempted`
- `activation_transport_status`
- `authorization_gate_classification`
- `knowledge_layer_trace_status`
- `live_canonical_validation_status`
- `activation_dependency_order_status`
- `activation_transport_evidence`

`activation_transport_evidence` must contain:
- provider used
- target resource class
- attempt outcome

Canonical Fetch And Transport Separation Rule

- module_loader must not collapse canonical file fetch authority into mutable registry transport validation
- `github_api_mcp` is the canonical file fetch path for repository-backed canonicals
- `http_generic_api` is the default governed activation transport
- provider-specific connectors remain optional downstream validation paths only when selected by registry governance

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
- `activation_transport_attempt_required = true`
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

- `use_governed_activation_transport_first = true`
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

`Use governed activation transport first.`

as a runtime execution command, not advisory text and not user-facing recovery prose.

This trigger must remain execution-blocking until:
- at least one real governed activation transport attempt occurs
- or the allowed same-cycle retry path is exhausted

No Passive Recovery Messaging Rule

module_loader must not prepare activation context that ends in a user-facing recovery message alone.

If no activation transport attempt has yet occurred:
- loader output must remain execution-blocking
- loader must preserve retry-capable context
- loader must not downgrade the trigger into narrative guidance

Failed First-Pass Loading Enforcement Rule

If the first activation pass ends without:
- `activation_transport_attempted = true`

module_loader must classify the loading pass as failed enforcement preparation, not successful degraded reporting.

In this state:
- `load_status` must not imply narrative completion readiness
- `executable_readiness` must remain not ready
- same-cycle retry context must remain preserved

Activation Execution Recovery Preparation

If no activation transport attempt is prepared:

module_loader must enforce:
use_governed_activation_transport_first = true

This ensures execution readiness instead of failure reporting.

module_loader must:
1. load knowledge layer canonicals for traceability
2. prepare direct-identifier-first governed transport validation targets
3. prepare project-folder-scoped Drive discovery fallback through folder `1gNYX47P4TNuMXEbWvLNCvV4XRocH41K2`
4. prepare the governed registry workbook and required worksheet_gid bindings
5. preserve retry-capable activation context for one bounded same-cycle retry when the first activation transport attempt is skipped

module_loader must return when applicable:
- `wrapper_mode = tool_first_blocking`
- `pre_response_activation_guard = true`
- `same_cycle_retry_allowed = true`
- `same_cycle_retry_attempt_count`
- `activation_transport_evidence`
- `use_governed_activation_transport_first = true`

Pre-Response Narrative Suppression Rule

For wrapper-class activation loading, module_loader must return context that suppresses narrative activation output until:
- `activation_transport_attempted = true`
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
- provider-specific action readiness remains valid when provider-specific execution applies

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
- business_intelligence_scoreboard_sheet

Missing required audit-governance dependencies must classify execution as degraded or blocked according to dependency criticality.
Business Intelligence Scoreboard may remain downstream-summary-only and must not be promoted to authority for execution decisions.

Authority dependency_state classification:
- missing required authority dependency -> invalid
- partially resolved required authority dependency -> degraded
- fully resolved required authority dependency -> valid

For full_system_intelligence_audit governance:
- missing execution_policy_registry_sheet, review_stage_registry_sheet, review_component_registry_sheet, repair_mapping_registry_sheet, row_audit_rules_sheet, or row_audit_schema_sheet must classify as degraded or blocked by criticality
- missing business_intelligence_scoreboard_sheet must classify as degraded only when downstream summary propagation is required; it must not override core authority readiness by itself

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
17. when `intent_key = system_activation_check` or `target_workflow = system_activation_validation`, load the five canonical files from knowledge layer first for traceability
18. then validate file-level canonical bindings through repository fetch when repository authority is active
19. then validate mutable registry authority surfaces through provider-specific endpoints only when required by registry governance
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
