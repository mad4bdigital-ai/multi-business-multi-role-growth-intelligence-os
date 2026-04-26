- derived_surfaces_expected_to_refresh
- observability_validation_state
- observability_issues when applicable
- execution_trigger
- execution_status
- execution_result
- repair_execution_feed_status when governed repair execution is active
- unified_log_state when authoritative raw execution log state is updated
- output_quality_score when available
- seo_score when available
- business_score when available
- execution_score when available
- optimization_trigger when a governed growth rule matches
- loop_execution_log_status when a governed loop trigger path executed
- loop_id or loop_rule_ref when a governed loop trigger path executed and Registry supplies them

Policy Traceability

Execution outputs should include:
- applied_policy_keys
- policy_resolution_status
- policy_source = execution_policy_registry_sheet

Review Traceability

When review-aware execution is active, outputs should also include:
- review_write_plan
- review_targets_resolved
- review_write_targets_count
- review_read_targets_count
- review_blocked_targets_count

Execution-State Semantics

`execution_trigger` must identify why execution became eligible, including governed auto conditions, human activation input, or repair-triggered continuation.

`execution_status` must track runtime progression such as pending, active, completed, degraded, or blocked.

`execution_result` must reflect the final governed result state:
- `Recovered`
- `Degraded`
- `Blocked`

Repair execution is a governed execution subtype and must not be treated as an ungoverned side effect when route = `system_repair` or when governed repair activation is the active execution path.

Growth Feedback And Optimization Semantics

When the growth layer is active, system_bootstrap must preserve the governed loop:

`Execution -> Scoring -> Logging -> Analysis -> Optimization -> Re-execution`

The scoring feedback model should support:
- `output_quality_score`
- `seo_score`
- `business_score`
- `execution_score`

When available, these scores must be attached to the authoritative execution record and made available for downstream metrics, review, and optimization analysis.

`optimization_trigger` must remain explicit when a governed Growth Loop Engine rule qualifies a follow-up action.

Growth-loop analysis may recommend or arm re-execution, but re-execution must not occur unless the governing trigger mode, routing authority, and execution-readiness checks all permit it.

---

Review Writeback Enforcement

When review_required = TRUE:

system_bootstrap must consume the Registry-resolved review_write_plan emitted by prompt_router.

Authoritative review write surfaces are limited to:
- review_run_history_sheet
- review_stage_reports_sheet when stage reporting is required
- review_findings_log_sheet when findings exist

Governed control-surface writes may also include:
- repair_control_sheet when repair, rerun, or learning governance applies

Derived / aggregation observability surfaces include:
- Execution View
- Active Issues Dashboard
- Review Control Center
- Anomaly Detection

Registry-resolved bindings for derived review or observability surfaces may include:
- execution_view_sheet
- review_control_center_sheet
- active_issues_dashboard_sheet

Config / non-runtime-write surface:
- review_config_sheet

Helper surfaces must never be treated as runtime write targets.

system_bootstrap must:
- resolve all review targets through Registry authority
- honor review_write_plan.write_order
- write only to direct_write targets
- treat computed surfaces as read/validation-only
- treat config surfaces as read-only unless a governed config update path explicitly applies
- block helper-surface writes
- treat derived observability surfaces as expected-to-refresh outputs rather than mandatory direct-write targets when authoritative sources are available
- require writes only to authoritative surfaces and governed control surfaces
- never require direct writes to Execution View
- never require direct writes to Active Issues Dashboard
- enforce raw execution logging to Execution Log Unified through governed logging lifecycle rules

Writeback must include, when applicable:
- route_id
- target_workflow
- target_module
- execution_state
- intake_validation_status
- execution_ready_status
- execution_trace_id
- timestamps
- source attribution
- logging_status
- review_writeback_status
- outcome summary

If any required direct-write review surface fails to resolve or fails to write:
- execution_state must degrade or block based on criticality
- failure must be logged
- review_writeback_status must be explicit
- execution must not be considered fully complete

Logging to non-authoritative legacy surfaces alone is not sufficient when review_required = TRUE.

---

Surface and Validation Preflight

Before dependency execution proceeds, system_bootstrap must:
- validate authoritative surfaces through `Registry Surfaces Catalog`
- confirm `validation_registry_review` completed after `surface_catalog_validation`
- repair or migrate legacy rows when a governed repair path is available
- continue only when authoritative surface and validation state are not blocked

If authoritative surface rows or validation rows remain blocked after review:
- dependency execution must not continue
- execution must be classified as `Blocked` or `Degraded` based on governed continuity rules
- traceability of the blocked surface must be preserved in findings, review output, or repair diagnostics

Execution Validation Enforcement Gate

system_bootstrap must apply validation enforcement before execution.

Enforcement source:
- Validation & Repair Registry
- enforcement matrix columns (`sheet_name`, `structural_level`, `column_contract_level`, `row_logic_level`, `cross_sheet_level`, `behavioral_level`)

Evaluation order:
1. structural
2. column_contract
3. row_logic
4. cross_sheet
5. behavioral

Execution classification rules:
- if any required surface resolves to `block`, set `execution_status = BLOCKED` and do not proceed
- if no required surface resolves to `block` but any required surface resolves to `degrade`, set `execution_status = DEGRADED` and proceed only with reduced confidence
- if required surfaces resolve only to `warn`, proceed and log all warnings

Required surfaces:
- Registry Surfaces Catalog
- Validation & Repair Registry
- Task Routes
- Workflow Registry
- Execution Policy Registry
- Execution Chains Registry
- Execution Bindings
- Decision Engine Registry
- Conversation Starter

When `Conversation Starter` is the execution entry surface:

- starter row resolution alone is insufficient for execution readiness
- `Execution Policy Registry` must be re-read for active policy compatibility before dispatch
- starter-triggered execution must preserve policy-read evidence in downstream execution context and authoritative logging

Governance support surfaces:
- Review Stage Registry
- Review Component Registry
- Repair Mapping Registry
- Row Audit Rules
- Row Audit Schema

Governance support surfaces may:
- degrade or warn
- not block unless explicitly required by policy

Auto-Repair And Retry Loop Rule

When execution is classified as `Degraded` or `Blocked` by governed validation, system_bootstrap may initiate a governed auto-repair loop only when:

- repair mapping exists in `Repair Mapping Registry`
- required authoritative surfaces are resolved through `Registry Surfaces Catalog`
- validation-state authority is resolved through `Validation & Repair Registry`
- execution policy allows repair and retry
- the failure is classified as recoverable

Auto-repair loop stages:

1. classify blocking or degraded validation outcome
2. resolve governed repair handler from `Repair Mapping Registry`
3. execute repair through governed repair lifecycle
4. re-run required validation stages
5. re-run execution-readiness gating
6. retry execution only if repaired state is compatible

Retry loop constraints:

- retry must remain bounded by governed retry policy
- repeated retries without state improvement are forbidden
- recovered classification is forbidden unless post-repair validation succeeds
- retry must preserve traceability to the original execution attempt
- retry must not bypass `prompt_router`, `module_loader`, validation gating, scoring, or logging requirements

Persistent Job-State Enforcement Rule

When governed async HTTP execution is enabled and policy requires persistent job state:

- system_bootstrap must not treat in-memory-only async state as sufficient for recovered classification
- persisted job state must survive process restart boundaries
- job-state load, write, and flush readiness must be explicit
- queued, running, retrying, succeeded, failed, and cancelled states must remain traceable

Required persisted job-state readiness must include:
- state file or equivalent durable backend availability
- job-state load success
- job-state write success
- post-write durability confirmation when available

If persistent job-state policy is active and persistence is unavailable:
- async execution must degrade or block
- recovered classification is forbidden

This lines up with the new persistent JSON-backed job state in server.js.

Auto-Bootstrap Retry Constraints

For governed auto-bootstrap:
- retry must remain bounded by `Auto Bootstrap Max Attempts`
- repeated bootstrap retries without state improvement are forbidden
- original request must not be resumed until activation succeeds
- bootstrap retry must preserve traceability to the original blocked or degraded request
- bootstrap must not bypass prompt_router, module_loader, validation gating, scoring, or logging requirements

Required retry writeback:

system_bootstrap must preserve:
- original execution_status
- repair action taken
- retry_attempt_count
- retry_outcome
- final execution classification

Required auto-bootstrap writeback:

system_bootstrap must preserve:
- bootstrap_attempt_count
- bootstrap_reason
- bootstrap_validation_outcome
- bootstrap_repair_outcome
- bootstrap_activation_outcome
- original_request_resume_status
- final execution classification

If repair fails or retry eligibility is not satisfied:
- execution must remain `Degraded` or `Blocked`
- repair-aware notes must remain explicit

Graph-Based Validation Stage

When graph intelligence is enabled, system_bootstrap must execute graph-based validation before final execution readiness classification.

Graph-based validation must verify:
- required nodes exist
- required execution-critical relationships exist
- selected execution path is graph-valid
- selected path remains compatible with Task Routes and Workflow Registry

Required execution path checks may include:
- starter -> route
- route -> workflow
- workflow -> chain
- decision -> chain or route
- chain -> engine

If graph validation fails:
- execution must be classified as Degraded or Blocked according to enforcement policy
- recovered classification is forbidden

---


Execution Rules

If execution requires dependency validation and dependencies are not explicitly loaded or read:

- classify execution as degraded
- attach degraded_reason = "missing_live_validation"
- preserve traceability in repair_memory

Base execution rules:
- must receive routed execution from prompt_router
- must consume loaded dependency context from module_loader
- must finalize user-facing output
- must classify execution outcome
- must trigger logging handoff
- must preserve recovery-first behavior
- must treat authoritative surfaces as write obligations and derived surfaces as refresh expectations
- must evaluate scoring feedback and optimization eligibility when the growth layer is active

Activation Trigger Enforcement Rule

For plain `Activate System` and equivalent activation prompts, system_bootstrap must enforce the activation trigger line:

`Use governed activation transport first.`

This means:
- native Google Drive, Google Sheets, or Google Docs execution must begin before any narrative activation response
- activation must not finalize as explanation-first
- traceability may occur first, but user-facing activation output must remain blocked until a real activation transport attempt occurs or the allowed same-cycle retry path is exhausted

Governed Auto-Bootstrap Execution Rule

Activation Scope Preservation Rule

For governed activation, the newer activation scope must extend and not replace the prior activation lifecycle.

system_bootstrap must preserve all existing activation stages including:
1. knowledge layer canonical traceability
2. same-cycle governed activation transport attempt
3. live canonical validation
4. runtime authority validation
5. governed repair lifecycle when needed
6. post-repair revalidation
7. governed activation validation
8. original-request resume when allowed by policy

Activation scope expansion may add readiness validation for additional governed layers, but must not remove or bypass the older stages above.

Expanded Activation Layer Readiness Rule

When the governed architecture includes active validation, anomaly, clustering, repair-priority, repair-control, auto-repair, or control-layer surfaces, activation validation must also evaluate readiness for:

- validation layer readiness
- anomaly detection readiness
- anomaly clustering readiness
- cluster-informed repair priority readiness
- repair control readiness
- auto-repair readiness
- control-center health readiness

These checks are additive to canonical validation, registry validation, runtime authority validation, and repair-aware bootstrap flow.

Recovered or active activation classification is forbidden when one of the above governed layers is required by the active architecture and remains unresolved, degraded, or stale without explicit policy exclusion.

Activation Full-System Scan Execution Rule

For plain `Activate System` and governed activation workflows including `wf_hard_activation_wrapper` and `wf_system_auto_bootstrap`, system_bootstrap must execute a full-system integrity scan before activation may classify as active or recovered.

The required activation scan must evaluate when applicable:
1. schema integrity
2. row integrity
3. starter policy coverage integrity
4. route-to-workflow binding integrity
5. execution-path integrity
6. anomaly-state integrity
7. repair-readiness integrity

Activation Summary Output Rule

After the governed activation scan, system_bootstrap must preserve activation-summary outputs including when available:
- `activation_schema_status`
- `activation_row_status`
- `activation_policy_status`
- `activation_binding_status`
- `activation_anomaly_status`
- `activation_repair_required`
- `activation_execution_ready`

These outputs must be preserved before final activation classification.

Activation Repair Readiness Rule

When the governed activation scan detects:
- policy gaps
- binding gaps
- schema drift requiring governed repair
- row-validation failure
- anomaly severity that blocks readiness

system_bootstrap must:
- preserve `repair_required = true`
- resolve governed repair eligibility
- preserve `repair_scope`
- preserve whether repair is auto-eligible or manual-triggered
- forbid active/recovered activation classification until post-repair validation succeeds

Activation Execution-Readiness Gate Rule

For activation-class execution, `activation_execution_ready = true` is permitted only when:
- native Google attempt requirements are satisfied
- live canonical validation requirements are satisfied
- Registry and binding validation requirements are satisfied
- no required schema, row, policy, or binding repair remains unresolved
- no required blocking anomaly remains unresolved by policy

If any of the above remain unresolved:
- activation must remain `validating`, `degraded`, or `blocked`
- success-style activation output is forbidden

When routed `target_workflow = wf_system_auto_bootstrap`, system_bootstrap must execute the following lifecycle in order:

1. preserve original request context
2. preserve knowledge layer canonical traceability context
3. resolve activation transport through the registries and immediately auto-trigger at least one governed HTTP client validation call for live canonical validation while preserving attempt evidence
4. classify native live-validation state as validated, authorization_gated, degraded, or blocked
5. run runtime authority validation using all validated live surfaces available in the same execution cycle
6. classify bootstrap readiness as recovered, degraded, blocked, or authorization_gated when policy allows
7. if degraded and repairable, resolve governed repair handler from `Repair Mapping Registry`
8. execute governed repair lifecycle
9. re-run runtime authority validation
10. if validation succeeds, execute governed activation validation
11. if activation succeeds and resume is allowed by policy, resume the original request through governed routing
12. preserve bootstrap outcome, native-validation outcome, repair outcome, activation outcome, and resume outcome in execution outputs

Hard Activation Wrapper Guard

For wrapper-class plain-language activation requests, including `target_workflow = wf_hard_activation_wrapper` and governed fallback or continuation into `wf_system_auto_bootstrap`:

- `system_bootstrap` must enforce a pre-response activation guard
- if `activation_transport_attempted != true` after the first activation pass, one bounded same-cycle retry must be attempted when policy allows
- no normal activation narrative may be returned before the retry path completes
- if the retry path still does not produce a real activation transport attempt, activation must be classified as failed enforcement with `degraded_reason = missing_required_activation_transport_attempt`

Tool-First Activation Wrapper Requirement

For wrapper-class activation:
- `use_governed_activation_transport_first = true` must be preserved
- system_bootstrap must treat that field as execution-gating, not advisory
- if no native tool attempt occurs before narrative completion, the activation pass must be treated as failed enforcement

Narrative-Only Output Prohibition

For wrapper-class activation:
- system_bootstrap must not return a user-facing message that merely says:
  `Use governed activation transport first.`

Instead, system_bootstrap must execute that instruction as runtime behavior before degraded termination is allowed.

Recovered classification is forbidden unless:
- post-repair validation succeeds
- activation validation succeeds
- resume-readiness is compatible when resume is attempted

Activation Completion Compatibility Rule

Activation may classify as recovered or active only when:
- prior governed activation scope remains satisfied
- expanded layer-readiness checks are satisfied for active governed layers
- no stale narrower activation model remains active in parallel with the expanded model

Missing Native Attempt Guardrail

For wrapper-class activation and governed auto-bootstrap continuation, system_bootstrap must verify before any user-facing activation classification:

- `activation_transport_attempt_required = true`
- `activation_transport_attempted` is present
- `activation_transport_status` is present

If `activation_transport_attempt_required = true` and
- `activation_transport_attempted != true`

then system_bootstrap must:
- apply: `Use governed activation transport first.`
- immediately trigger a native Google Drive, Sheets, or Docs call in the same execution cycle
- if the retry path still fails to produce a real activation transport attempt:
  - classify execution as `degraded`
  - set `degraded_reason = missing_required_activation_transport_attempt`
  - forbid `authorization_gated`
  - forbid `validated`
  - forbid `active`
  - forbid `recovered`

Pre-Response Guard Enforcement

Before any activation narrative is returned:
- `activation_transport_attempted` must be true

If false:
- normal activation output remains blocked
- same-cycle retry may execute when policy allows
- explanation-first completion is forbidden

Skipped activation transport attempt is an execution failure, not an authorization-gated state.

Authorization-gated classification is allowed only when:
- `activation_transport_attempted = true`
- the native API result shows an auth-dependent failure
- governed live validation could not continue because of authorization state

User-facing activation output must preserve:
- `activation_transport_attempted`
- `activation_transport_status`
- `activation_transport_evidence`
- `live_canonical_validation_status`
- `activation_dependency_order_status`

Expanded Activation Output Requirement

When the expanded governed layers are active, user-facing activation output must also preserve when available:

- `validation_layer_readiness_status`
- `anomaly_detection_readiness_status`
- `clustering_readiness_status`
- `repair_priority_readiness_status`
- `repair_control_readiness_status`
- `auto_repair_readiness_status`
- `control_center_health_status`

These fields extend activation evidence and do not replace the existing native-attempt, live-canonical, or activation-dependency-order outputs.

system_bootstrap must not finalize activation messaging until these fields are present for first-turn activation.

Narrative-Only Activation Prohibition

If activation reaches user-facing output without:
- a real governed activation transport attempt
- or an exhausted allowed same-cycle retry path

then system_bootstrap must:
- classify activation as `degraded`
- set `activation_enforcement_status = failed`
- preserve `degraded_reason = missing_required_activation_transport_attempt`

Authorization-Gated First-Turn Activation Rule

When first-turn activation begins before native Google API authorization is available, system_bootstrap must:

- preserve knowledge layer canonicals as traceability support
- auto-trigger governed native Google Drive, Google Sheets, and Google Docs connection attempts
- classify the live validation gap as `authorization_gated` when provider authorization is the blocking condition
- forbid false classification of the condition as missing Registry authority unless Registry resolution itself fails
- preserve bootstrap continuity when policy allows later live revalidation in the same lifecycle or on resumed execution

For authorization-gated activation:
- `Recovered` and `active` classification remain forbidden until live validation succeeds
- `Blocked` must not be used when the primary failure is missing provider authorization and the condition is recoverable by governed bootstrap continuation
- traceability outputs must preserve that live validation was attempted

If provider authorization is unavailable, the outcome may be `authorization_gated` only after a real governed HTTP transport attempt.

If no real governed HTTP transport call occurs:
- `Use governed activation transport first.`
- Immediately trigger a native Google Drive, Sheets, or Docs call in the same execution cycle.

Activation must not terminate in a narrative degraded state without attempting this instruction.

Narrative compliance is forbidden.

The system must not report that governed transport validation was attempted, required, pending, or authorization-gated unless machine-readable attempt evidence is present in the same execution cycle.

Mandatory Governed HTTP Activation Transport And Live Validation Rule (Activation)

For any execution where:
- route intent = `system_auto_bootstrap`
- target workflow = `wf_system_auto_bootstrap`
- or user input matches activation triggers such as:
  - `activate system`
  - `system auto bootstrap`
  - `bootstrap system`
  - `automatic activation`
  - `silent activation`

system_bootstrap MUST, in the same execution cycle:

1. preserve knowledge-layer canonical traceability first
2. resolve activation transport capability through Actions Registry
3. resolve activation validation endpoints through API Actions Endpoint Registry
4. execute at least one real governed HTTP transport call through `http_generic_api`
5. continue into live canonical validation when governed activation transport remains available
6. continue into Registry surface and binding validation when governed transport validation is feasible
7. preserve machine-verifiable HTTP transport evidence before activation classification
8. classify activation only after those steps are attempted

Accepted activation transport:
- `activation_transport_mode = governed_http_client`
- `live_canonical_validation_transport = http_generic_api`
- provider-specific Google Drive, Sheets, or Docs endpoints only when selected by Actions Registry and API Actions Endpoint Registry

Minimum activation execution requirement:
- at least one real governed HTTP transport call must occur in the same execution cycle

Minimum live validation scope after connectivity attempt:
1. validate at least one live canonical source through governed HTTP client transport
2. validate Registry-governed surface availability through governed HTTP client transport
3. validate registry-binding readiness for:
   - `Registry Surfaces Catalog`
   - `Validation & Repair Registry`
   - `Task Routes`
   - `Workflow Registry`

Preferred validation order:
1. knowledge-layer traceability
2. Actions Registry activation capability resolution
3. API Actions Endpoint Registry endpoint resolution
4. governed HTTP client validation calls through `http_generic_api`
5. live canonical and registry-surface readiness validation
6. route/workflow/binding readiness validation
7. activation classification

system_bootstrap MUST preserve machine-verifiable evidence for the activation transport attempt:
- `activation_transport_attempted = true`
- `activation_transport_status`
- `activation_transport_mode = governed_http_client`
- `live_canonical_validation_transport = http_generic_api`
- `activation_transport_evidence.provider`
- `activation_transport_evidence.resource_type`
- `activation_transport_evidence.attempt_outcome`

system_bootstrap MUST also preserve:
- `live_canonical_validation_required = true`
- `live_canonical_validation_source = repository_canonical_fetch_plus_governed_transport`
- `canonical_fetch_transport = github_api_mcp`
- `canonical_fetch_action_key = github_api_mcp`
- `canonical_fetch_authority = repository_ref_pinned`
- `live_canonical_validation_status`
- `knowledge_layer_trace_status`
- `canonical_trace_comparison_status`
- `activation_dependency_order_status`
- `registry_binding_status`
- `required_surface_resolution_status`
- `runtime_authority_validation_status`
- `dependency_readiness_status`

Classification rules:
- if no governed HTTP transport call occurs on the first activation pass:
  - apply:
    `Use governed activation transport first.`
  - trigger one bounded same-cycle retry when policy allows
- if no governed HTTP transport call occurs after the allowed retry path:
  - `activation_status = degraded`
  - `degraded_reason = missing_required_activation_transport_attempt`
  - `activation_enforcement_status = failed`
- if a governed HTTP transport call is attempted but authorization prevents live validation:
  - `activation_transport_status = authorization_gated`
  - `authorization_gate_classification = authorization_gated`
  - activation may remain `validating` or `degraded` by policy
- if connectivity succeeds but live canonical and registry validation remain incomplete:
  - activation must remain `validating` or `degraded`
- only when activation transport attempt, live canonical validation, required Registry surface resolution, and route/workflow binding validation are complete may activation be classified as:
  - `validated`
  - `active`

It is forbidden to:
- skip the governed HTTP transport call when activation transport is available
- stop at knowledge-layer-only activation when governed transport validation is available
- stop at connectivity-only success when live canonical or registry validation is still feasible
- simulate transport validation
- classify activation as `active`, `validated`, or `authorization_gated` without machine-verifiable transport attempt evidence

Direct Governed HTTP Activation Transport Enforcement Rule

For activation-class executions (`system_auto_bootstrap`), execution must not rely on implicit or deferred provider calls.

system_bootstrap MUST execute the following sequence in the SAME execution cycle:

1. resolve `http_generic_api` activation capability through Actions Registry
2. resolve canonical, workbook, and authority-surface validation endpoints through API Actions Endpoint Registry
3. assemble governed HTTP requests with fully resolved `provider_domain`, method, path, auth profile, and validation contract
4. execute governed HTTP client validation calls
5. validate canonical/workbook/surface readiness from transport responses
6. preserve activation transport evidence for every attempted endpoint

Provider-Specific Google Scope Enforcement Rule

When the registry selects a Google Drive provider-specific validation endpoint for activation-class fallback discovery, Drive discovery must be restricted to the governed project folder:

- `project_folder_id = 1gNYX47P4TNuMXEbWvLNCvV4XRocH41K2`

Required Drive query scope:
- `'1gNYX47P4TNuMXEbWvLNCvV4XRocH41K2' in parents`
- `trashed = false`

Drive discovery must not list files outside the project folder during activation bootstrap.

If canonical file IDs, workbook IDs, or endpoint keys are already available:
- registry-backed direct ID resolution remains preferred
- folder-scoped listing is allowed only for validation, reconciliation, or fallback discovery when selected by endpoint governance

Execution Requirements:

- activation_transport_sequence_required = true
- activation_transport_mode = governed_http_client
- live_canonical_validation_transport = http_generic_api
- activation_transport_sequence_mode = registry_endpoint_first
- activation_transport_attempted must be TRUE before any classification
- omission of the governed HTTP transport attempt invalidates activation

Failure Handling:

If any of the above steps are skipped:

- `Use governed activation transport first.`
- immediately trigger a governed HTTP client validation call in the same execution cycle
- if the recovery attempt still fails to produce a real activation transport call:
  - activation_status = degraded
  - degraded_reason = missing_required_activation_transport_attempt
  - activation_enforcement_status = failed

Classification Guard:

system_bootstrap MUST NOT allow:
- active
- validated
- authorization_gated

unless:
- all required steps executed
- activation_transport_evidence is present

Binding Mode Enforcement:

When canonical file IDs, workbook IDs, or endpoint keys are available:

- discovery via file name is PROHIBITED unless selected as a provider-specific fallback by registry governance
- execution must prefer registry-backed direct ID or endpoint resolution

Governed Addition Pipeline Rule

When governed addition execution is selected, system_bootstrap must:

1. classify the addition type
2. identify affected surfaces
3. write candidate or inactive rows first
4. run required validation layers
5. run graph validation when graph impact exists
6. run enforcement gating when execution-critical surfaces are affected
7. promote the added item only if governed validation is compatible

Governed addition must preserve:
- addition_type
- affected_surfaces
- promotion_status
- validation_outcome
- graph_outcome when applicable
- final activation status

Recovered classification is forbidden for governed addition when newly added items remain unvalidated, graph-invalid, or execution-incompatible.

Graph-Based Prediction And Auto-Routing Rule

When graph-based prediction or graph-based auto-routing is enabled, system_bootstrap may:

1. evaluate governed graph path candidates
2. score governed graph path candidates
3. select the highest-confidence governed path
4. revalidate the selected path
5. execute only through the normal governed lifecycle

Graph-based path selection must remain bounded by:
- Task Routes authority
- Workflow Registry authority
- execution policy
- validation gating
- scoring
- logging

If no graph-valid candidate remains:
- fallback must use the best valid governed static route
- degraded classification must remain explicit when fallback confidence is reduced

Graph Learning Writeback Rule

After execution completes, system_bootstrap may write back:
- selected_graph_path
- graph_path_confidence
- graph_prediction_basis
- graph_outcome_status

Graph learning writeback must remain advisory for future optimization and must not rewrite authority surfaces as if they were runtime route authority.

Google Workspace Native Action Validation Gate

Before executing governed Google Sheets, Google Docs, or Google Drive actions, system_bootstrap must verify:

- target binding is resolved through `Registry Surfaces Catalog` when Registry governance applies
- target validation-state is compatible through `Validation & Repair Registry`
- execution remains compatible with routed Task Routes and Workflow Registry authority
- native action readiness returned by module_loader is compatible

For activation-class and bootstrap-class execution, governed native Google action connection attempts must auto-trigger immediately after knowledge-layer traceability when live validation is required.

If any required Registry validation check fails:
- execution must be classified as `Degraded` or `Blocked`
- direct native action execution must not be treated as recovered
- repair-aware handling may proceed when governed repair mapping exists

### Native Google Governed Mutation Logging Rule

When a real native Google Drive, Google Sheets, or Google Docs action is executed through available agent execution actions/native tools and the action performs a governed mutation or governed write-affecting validation step, `system_bootstrap` must treat that step as execution-class activity requiring authoritative logging continuity.

For native Google governed mutation or governed validation execution, `system_bootstrap` must:

- preserve `activation_transport_attempted = true`
- preserve machine-verifiable `activation_transport_evidence`
- determine whether the native Google step is:
  - `native_validation_attempt_only`
  - `native_governed_mutation`
  - `native_governed_mutation_with_readback`
- preserve `logging_required = true` when the native Google step mutates, repairs, reconciles, refreshes validation state, or performs governed writeback
- preserve `logging_sink_required = surface.operations_log_unified_sheet`
- require authoritative `Execution Log Unified` append continuity before recovered or equivalent success classification
- preserve `execution_logging_path = authoritative_unified_log`
- preserve `native_google_execution_class`
- preserve `native_google_execution_mode = governed_native_google_action`

If the native Google step is validation-only and produces no governed mutation:
- attempt evidence remains mandatory
- authoritative execution logging may still be required when policy or route/workflow contract marks `logging_required = true`

If a native Google governed mutation occurs without authoritative unified-log continuity:
- classification must remain `degraded`
- `degraded_reason = native_google_logging_incomplete`
- recovered, validated, active, and equivalent success phrasing are forbidden

This rule applies even when execution occurs outside the normal transport path.

Google Workspace Direct-Action Boundary Rule

Availability of native Sheets, Docs, or Drive tools must not be treated as sufficient execution authority.

system_bootstrap may execute native Google actions only after:
- routing handoff is valid
- Registry validation is compatible
- enforcement gating is satisfied
- required write/readback expectations remain explicit

Starter Intelligence Feedback and Prediction Loop

After execution:

system_bootstrap must:
1. update:
   - `starter_success_score`
   - `usage_count`
   - `last_used_at`

2. inject scoring:
   - `execution_score` -> `starter_success_score`

3. trigger learning:
   - `followup_selection` tracking

4. compute prediction:
   - `predicted_next_best_starter`
   - `predicted_next_best_route`
   - `prediction_confidence`
   using:
   - `goal_family`
   - `execution_class`
   - `capability_family`
   - historical performance

5. compute goal-based prediction:
   - `predicted_goal_best_starter`
   - `predicted_goal_best_route`

Prediction must:
- remain advisory
- not override routing authority

Starter-Aware Retry Compatibility

When starter-aware execution is active and auto-repair succeeds, system_bootstrap may continue starter learning and prediction writeback only after repaired execution completes and validation remains compatible.

Starter prediction must not be updated from failed retry attempts as if they were successful recovered executions.

Starter Goal Intelligence Rule

If starter contains `primary_goal_family`:

system_bootstrap must:
- validate workflow alignment with goal
- adjust scoring thresholds dynamically
- influence growth-loop trigger eligibility

Goal signals must not override:
- `execution_policy_registry`
- route authority

Starter Growth Loop Integration Rule

Starter performance signals must feed:

- Growth Loop Engine Registry
- optimization_trigger evaluation

Starter signals must include:
- `starter_success_score`
- `execution_score`
- `followup_selection_rate`

Growth loop may:
- recommend better starter
- adjust starter_priority
