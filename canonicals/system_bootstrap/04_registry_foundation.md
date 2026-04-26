
Before migration or repair begins, system_bootstrap must capture:
- `before_header_signature`
- `expected_column_count`
- governed `schema_version`

If repair or migration fails readback validation:
- rollback must be applied when rollback support is enabled
- recovered classification is forbidden
- execution must remain degraded or blocked

After repair, migration, or rollback:
- `Validation & Repair Registry` schema fields must be updated
- governed dashboard/log surfaces must receive outcome propagation

Schema Feedback Reconciliation Rule

When a governed workbook surface experiences:
- column addition
- column removal
- header rename
- header reorder
- header signature change
- expected column count change

system_bootstrap must trigger a schema feedback reconciliation process before the surface may return to recovered state.

The schema feedback reconciliation process must:

1. read current live headers from the affected surface
2. recompute `header_signature`
3. recompute `expected_column_count`
4. update Registry Surfaces Catalog schema metadata
5. update Validation & Repair Registry schema-state fields
6. review dependent routes, workflows, write rules, and validation rules for compatibility
7. preserve degraded or blocked state until reconciliation completes

Recovered classification is forbidden until:
- Registry Surfaces Catalog is refreshed
- Validation & Repair Registry is refreshed
- dependent-surface impact review is complete
- required readback succeeds

Embedded Auth Execution Rule

For Google-backed actions:
- authentication may resolve directly from `google_oauth_gpt_actions_configuration.json`

For API-key-backed actions:
- authentication may resolve directly from `Actions Registry` when:
  - `api_key_value` is present
  - `api_key_storage_mode = embedded_sheet`

In embedded-auth mode, execution must not require external vault lookup.

Per-Target Credential Resolver Chain Rule

When `api_key_storage_mode = per_target_credentials` for a governed API action:

- system_bootstrap must not require action-row embedded secret values
- credential resolution must remain subordinate to governed registry authority
- Brand Registry must resolve the active target or brand binding first
- Hosting Account Registry must resolve the account-level credential reference second
- secret reference resolution must occur only after both governed registry steps succeed

Minimum governed resolver chain:
1. `Brand Registry`
2. `Hosting Account Registry`
3. account-level `api_key_reference`
4. runtime secret resolution

Execution must classify as degraded or blocked when:
- target-to-account binding is missing
- Hosting Account Registry is missing
- account-level secret reference is missing
- resolved credential is empty
- resolver chain is bypassed in favor of caller-supplied auth

This matches the new Hostinger credential model and the new policy rows you added.

HTTP Execution Classification Enforcement Rule

When governed execution resolves through `parent_action_key` and `endpoint_key`,
system_bootstrap must preserve and enforce the execution classification contract
returned by Registry-governed surfaces.

The execution classification contract must include when applicable:
- `runtime_capability_class`
- `runtime_callable`
- `primary_executor`
- `endpoint_role`
- `execution_mode`
- `transport_required`
- `transport_action_key`

system_bootstrap must require that:
- `native_direct` endpoints do not execute through delegated HTTP transport
- `http_delegated` endpoints execute only when `primary_executor = http_client_backend`
- delegated endpoints with `transport_required = true` must preserve a supported `transport_action_key`
- non-primary endpoint roles must not be treated as direct execution-ready
- inventory-only endpoint rows must not be treated as direct execution-ready

Execution must classify as degraded or blocked when:
- execution classification is missing
- execution mode and executor are incompatible
- delegated transport is required but unresolved
- a native-only capability is routed into delegated HTTP execution

Dynamic Provider-Domain Placeholder Resolution Rule

When `provider_domain` on the authoritative endpoint row is a governed placeholder
such as `target_resolved`, system_bootstrap must not treat the placeholder as a
literal execution server value.

system_bootstrap must require:
- placeholder provider-domain resolution is enabled by active Execution Policy Registry rows
- runtime provider-domain resolution is traceable
- placeholder resolution uses only governed sources allowed by policy
- unresolved placeholder provider-domain state blocks execution

Allowed placeholder resolution must remain subordinate to:
- parent action authority
- endpoint authority
- schema-first execution
- auth-path routing policy

Recovered classification is forbidden unless placeholder resolution and final
provider-domain validation succeed in the current execution cycle.

Auth-Path Routing Enforcement Rule

system_bootstrap must treat auth normalization as an execution-path decision, not
only a credential decision.

When `resolved_auth_mode = oauth_gpt_action`:
- delegated HTTP execution must not proceed when policy requires native-only handling
- execution must degrade or block into governed native connector handling

When `resolved_auth_mode` is one of:
- `basic_auth`
- `bearer_token`
- `api_key_query`
- `api_key_header`

delegated HTTP execution may proceed only when:
- delegated transport classification is valid
- schema alignment is valid
- credential resolution is valid
- transport contract readiness is valid

HTTP Schema-First Blocking Enforcement Rule

When HTTP or OpenAPI execution is schema-bound:

- execution must block if `openai_schema_file_id` is present but schema file was not read through governed Google Drive API in the same execution cycle
- execution must block if required query, header, path, or body parameters defined in the schema are unresolved
- execution must not proceed with partial request construction
- schema validation must occur before transport execution, not after

HTTP Connector-Scoped Resilience Enforcement Rule

When provider resilience policies are active:

- retry behavior must be applied only when `parent_action_key` is included in `HTTP Execution Resilience | Affected Parent Action Keys`
- resilience applicability must be evaluated before reading retry strategy, retry levels, retry trigger, or retry limits
- connectors outside the affected set must execute single-attempt transport only
- retry logic must not be globally applied across connectors

HTTP Provider Retry Escalation Enforcement Rule

When connector-scoped resilience applies:

- attempt 0 must use baseline validated request (no mutation)
- attempt 1 may apply `premium=true` when defined by policy
- attempt 2 may apply `premium=true, ultra_premium=true` when defined by policy
- retry escalation must occur only when upstream response satisfies the governed retry trigger
- successful upstream response must terminate retry flow immediately

---

Dynamic Observability Execution Rule

> Authoritative records are written to canonical source surfaces. Aggregated, monitoring, and observability surfaces are computed dynamically from authoritative sources whenever possible.

---

### Architecture Reconciliation Rule

When a structural system change is accepted or applied, system_bootstrap MUST trigger a reconciliation pass before the updated architecture may be treated as recovered.

Structural changes include:
- canonical rule updates
- dependency model changes
- authority-source changes
- registry schema additions
- validation model changes
- execution-path changes
- binding-governance changes

The reconciliation pass must:
1. identify dependent surfaces registered in `Registry Surfaces Catalog` and their linked validation rows in `Validation & Repair Registry`
2. detect mismatched legacy rows, notes, statuses, and resolution rules
3. rewrite or downgrade stale records so they align with the new architecture
4. prevent stale authority models from remaining active in parallel with the new model
5. classify the system as Degraded until reconciliation is complete
6. classify as Recovered only after required affected surfaces are aligned

No architectural change is complete if mismatching surface records or validation records remain active in authoritative surfaces.

---

Inputs

Required inputs:
- routing output
- selected workflow
- execution payload
- loaded dependency context
- execution status context when applicable

When available:
- decision_status
- route_override_status
- chain_id
- chain_context
- engine_chain
- next_step
- recovery flags
- degraded execution notes
- review findings summary
- review_write_plan
- execution_context
- review_targets_resolved
- review_write_targets_count
- review_read_targets_count
- review_blocked_targets_count
- auto_repair_trigger
- forced_repair_routing_applied
- runtime_authority_validation_required when governed execution requires mandatory runtime validation
- route_validation_required when governed route validation must be preserved from routing handoff
- workflow_validation_required when governed workflow validation must be preserved from routing handoff
- dependency_validation_required when governed dependency validation must be preserved from routing handoff
- graph_validation_required when graph-aware governed execution requires graph-path validation
- native_action_requested when governed Google Sheets, Docs, or Drive execution is requested
- target_surface_id when governed Google Workspace target identity is available
- target_validation_status when module_loader returns Registry-governed target validation
- registry_binding_status when module_loader returns Registry-governed binding compatibility
- native_action_readiness when module_loader returns Google native action readiness
- provider_domain when HTTP or OpenAPI-driven execution preserves execution server identity
- parent_action_key when HTTP or OpenAPI-driven execution preserves parent capability authority
- endpoint_key when HTTP or OpenAPI-driven execution preserves endpoint authority
- method when HTTP or OpenAPI-driven execution preserves governed operation method
- path when HTTP or OpenAPI-driven execution preserves governed operation path
- resolved_headers when HTTP or OpenAPI-driven execution preserves assembled header context
- resolved_body when HTTP or OpenAPI-driven execution preserves assembled body context
- openai_schema_file_id when schema-bound API execution preserves parent action YAML authority
- schema_contract_validation_status when schema-bound API execution preserves YAML/OpenAPI compatibility status
- provider_domain_resolution_status when HTTP or OpenAPI-driven execution preserves provider-domain resolution readiness
- active_review_stage when scope lifecycle enforcement is active
- new_scope_detected when a new governed system scope or review stage is introduced
- learning_trigger when governed learning writeback is required
- schema_drift_detected when HTTP or OpenAPI-driven execution emits drift classification
- schema_drift_type when HTTP or OpenAPI-driven execution emits drift classification
- schema_drift_scope when HTTP or OpenAPI-driven execution emits drift classification
- schema_learning_candidate_emitted when candidate-only schema learning output exists
- schema_reconciliation_required when governed schema repair is required
- repair_mapping_registry when scope-to-repair lifecycle validation is required
- row_audit_rules_sheet when learning-trigger candidate writeback, active-rule enforcement, or row-level validation is required
- growth_loop_engine_registry_sheet when growth-loop evaluation is active
- metrics_feedback_summary when performance or business scoring is available
- review_feedback_summary when governed review scoring is available
- prior_execution_scores when feedback injection or adaptive optimization is active
- adaptive_optimization_context when governed optimization weights or workflow preferences are available

When route = system_repair:
- subtype
- repair_scope
- repair_severity
- repair_trigger_source
- affected_layers
- authority_checks_required
- dependency_checks_required
- candidate_repair_actions

When route intent resolves to `system_auto_bootstrap`:
- bootstrap_reason
- bootstrap_resume_required
- original_request_payload
- original_intent_candidate
- bootstrap_attempt_count when available
- bootstrap_max_attempts when available

When route intent or target workflow resolves to `full_system_intelligence_audit`:
- execution_policy_registry_sheet
- review_stage_registry_sheet
- review_component_registry_sheet
- repair_mapping_registry_sheet
- row_audit_rules_sheet
- row_audit_schema_sheet
- business_intelligence_scoreboard_sheet (downstream summary surface)

When registry-aware validation is available:
- validation_state
- affected_bindings
- detected_issues
- emitted_repair_signals
- authority_state
- dependency_state

---
Strict Execution Intake Contract

system_bootstrap is the canonical pre-execution enforcement layer.

Before any execution begins, system_bootstrap must receive an execution preparation contract from prompt_router.

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
- memory_required
- logging_required
- review_required
- executable

When routed execution is HTTP or OpenAPI-driven, required intake fields must also include when available:
- `provider_domain`
- `parent_action_key`
- `endpoint_key`
- `method`
- `path`

If the routed execution requires schema-bound API execution, system_bootstrap must also preserve:
- `openai_schema_file_id`
- `schema_contract_validation_status`

When routed execution preserves schema drift context, system_bootstrap must also preserve when available:
- `schema_drift_detected`
- `schema_drift_type`
- `schema_drift_scope`
- `schema_learning_candidate_emitted`
- `schema_reconciliation_required`

If `provider_domain` is variable and unresolved:
- execution must not proceed
- outcome must be classified as Degraded or Blocked by policy

Accepted source value:
- prompt_router

Accepted route_status values:
- resolved
- degraded
- blocked

If the execution preparation contract is missing:
- execution must not proceed
- outcome must be classified as Blocked unless safe rerouting is explicitly possible

If source is not prompt_router:
- system_bootstrap must not trust the handoff as execution-ready
- rerouting through prompt_router is required before execution can continue

system_bootstrap must treat routing handoff validation as a required precondition, not an optional enhancement.

Request Execution Readiness Rule

For any received request intended for execution, system_bootstrap must verify:
- route resolution remains traceable to `Task Routes`
- workflow resolution remains present and aligned to the routed handoff
- execution logging can be handed off explicitly when `logging_required = true`

If any of these are missing or unresolved:
- execution must be classified as at least `Degraded` unless a stricter blocked rule already applies
- `execution_ready_status` must not be treated as `ready`
- `failure_reason` or `recovery_action` must identify the missing readiness element when available
- execution must not be treated as fully ready even if other inputs are present

Chain Execution Readiness Rule

For all chain executions, system_bootstrap must enforce `target_workflow` resolution against `Workflow Registry`.

Chain workflows must be treated as first-class executable workflow rows, not partial chain metadata.

When a chain workflow is triggered from `Execution Chains Registry`:
- `execution_class` must remain `autonomous chain`
- `target_workflow` must resolve to an active executable workflow row
- readiness must fail if the chain row exists but the workflow row is incomplete or inactive

If chain readiness fails because of missing workflow authority or route compatibility:
- execution must be classified as `Degraded` or `Blocked` based on recoverability
- `execution_ready_status` must not be treated as `ready`
- `failure_reason` and `recovery_action` must remain explicit

Canonical Stage Order

The canonical stage order for governed execution is:

1. `canonical_knowledge_dependency_bootstrap`
2. `canonical_url_dependency_bootstrap`
