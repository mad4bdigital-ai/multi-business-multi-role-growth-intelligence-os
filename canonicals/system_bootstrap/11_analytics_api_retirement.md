
Growth loop must not:
- directly mutate starter rows without governed writeback

Growth Loop Evaluation Rule

When `growth_loop_engine_registry_sheet` is available, system_bootstrap should evaluate governed loop rules against the current execution feedback model after authoritative execution logging is prepared.

When evaluation sets `trigger_condition` = TRUE for a governed loop rule, system_bootstrap must follow the **Governed Loop Trigger Execution Path** below (resolve loop Ã¢â€ â€™ load execution_chain Ã¢â€ â€™ execute workflow Ã¢â€ â€™ log loop_execution).

Example governed loop triggers:
- if `seo_score < 60`, trigger `wf_seo_domination`
- if `business_score < 70`, trigger `wf_growth_strategy`
- if `execution_score < 80`, trigger `wf_system_repair`
- if `revenue_score` or conversion signals from Google Analytics Data API fall below a Registry threshold, trigger governed revenue or measurement workflows
- if `tracking_coverage` from Tag Manager validation falls below a Registry threshold, trigger governed GTM remediation or measurement health workflows

Triggered growth loops must remain traceable as governed optimization outcomes and must not bypass routing, logging, review, or trigger-mode governance.

Governed Loop Trigger Execution Path

When a Registry-defined `trigger_condition` evaluates to TRUE for a governed loop rule (including rows resolved from `growth_loop_engine_registry_sheet` and any other Registry-bound loop trigger source), system_bootstrap must treat the following sequence as mandatory orchestration order:

1. **Resolve loop** Ã¢â‚¬â€ Resolve the authoritative loop definition (loop identity, rule binding, and qualifying execution or feedback context). If the loop cannot be resolved, execution must be classified as `Degraded` or `Blocked` under governed continuity rules and must not invent substitute loop authority.

2. **Load execution_chain** Ã¢â‚¬â€ Load the Registry-resolved `execution_chain` for that loop (typically from `execution_chains_registry_sheet` or the chain reference the loop rule specifies). Chain rows must satisfy the same readiness and `target_workflow` resolution rules as other autonomous chain executions.

3. **Execute workflow** Ã¢â‚¬â€ Execute the governed workflow for the active chain step using Workflow RegistryÃ¢â‚¬â€œresolved `target_workflow`, preserving `execution_class` = autonomous chain when the chain registry is the authority source, and without bypassing routing, execution_policy, readiness, logging, or review obligations.

4. **Log loop_execution** Ã¢â‚¬â€ Write a governed `loop_execution` record to the authoritative logging surface designated by Registry (expected `surface.operations_log_unified_sheet` / `Execution Log Unified` for raw execution logging, or a separately registered loop-execution surface when explicitly governed). The record must link `trigger_condition`, loop identity, `chain_id` and step state when applicable, `target_workflow`, execution outcome classification, and timestamps, and must remain consistent with strict logging and chain traceability rules.

If `trigger_condition` is FALSE, this path must not run as an ungoverned side effect; armed, queued, or recommendation-only follow-ups remain subject to existing trigger-mode and re-execution governance.

Review Writeback Ordering Rules

Authoritative execution completion depends on:
- Execution Log Unified as the canonical raw execution record
- review_run_history_sheet when review_required = true
- review_findings_log_sheet when findings exist
- review_stage_reports_sheet when stage reporting is required

Direct Governed Operations Logging Rule

When governed execution is performed through direct Google Workspace mutation paths rather than the normal runtime transport path, system_bootstrap must still append an authoritative execution row to `Execution Log Unified`.

This applies to direct governed operations such as:
- registry mutation
- validation repair
- policy update
- formula repair
- derived surface rebuild
- governed cleanup
- direct review or metrics workbook mutation

For these operations, system_bootstrap must preserve when available:
- `execution_class`
- `entry_source`
- `log_source`
- `target_module`
- `target_workflow`
- `execution_trace_id`
- `execution_ready_status`
- `policy_resolution_status`
- `policy_source`
- `policy_trace_id`

Direct governed operations must not bypass authoritative raw execution logging merely because the mutation occurred through native Google tooling.

repair_control_sheet remains a governed control-surface write target only when repair, rerun, or learning governance applies.

When review_required = true, system_bootstrap must execute authoritative review writeback in this canonical order:

1. review_run_history_sheet
2. review_stage_reports_sheet
3. review_findings_log_sheet
4. repair_control_sheet

Write intent by surface:
- review_run_history_sheet -> one row per governed run
- review_stage_reports_sheet -> one row per stage execution
- review_findings_log_sheet -> write when findings exist
- repair_control_sheet -> write when repair or rerun governance applies, or when CREATE_RULE candidate generation, auto-promotion, or rule_pruning occurs

system_bootstrap must record:
- write_targets_resolved
- write_targets_attempted
- write_targets_succeeded
- write_targets_failed
- review_writeback_status

Allowed review_writeback_status values:
- complete
- partial
- failed
- not_required

If review_required = true and all required or applicable direct-write targets succeed:
- review_writeback_status = complete

If some required or applicable direct-write targets succeed and some fail:
- review_writeback_status = partial
- execution_state must be at least Degraded

If required review writeback cannot safely proceed:
- review_writeback_status = failed
- execution_state must be Degraded or Blocked based on execution continuity

Scope Completion Rule

For any new system scope, scope implementation is not complete unless all required lifecycle layers exist:
- detection through audit or review stage
- findings logging
- repair through a dedicated repair stage or governed mapped handler
- re-validation through a post-repair path
- Registry alignment when the scope touches Registry-governed authority or bindings
- execution routing compatibility for downstream prompt_router and system_bootstrap handoff

If a new system scope is detected and any required lifecycle layer is missing:
- execution_state must be at least Degraded
- a findings-compatible issue_type = incomplete_scope_lifecycle must be created
- completion must be blocked until lifecycle coverage is implemented

Review Stage Enhancement

When `pipeline_surface_activation_review` is active or newly introduced, system_bootstrap must also verify that a corresponding repair path exists before the scope may be treated as complete.

Accepted completion path examples:
- `pipeline_surface_activation_review` -> `pipeline_surface_activation_repair`
- `pipeline_surface_activation_review` -> governed mapped repair handler when a dedicated repair stage is not used

Repair Mapping Registry

When no dedicated repair stage exists for a governed scope, system_bootstrap must validate a governed scope-to-repair mapping before accepting the scope as lifecycle-complete.

Minimum scope-to-repair mappings must support:
- `pipeline_surface_activation` -> `pipeline_surface_activation_repair`
- `row_level_audit` -> `generic_repair`
- `registry_consistency` -> `registry_repair`

Unmapped governed scopes must be treated as incomplete lifecycle coverage.


Repair execution rules:
- if route = system_repair, system_bootstrap must set execution_mode = system_repair
- if route = system_repair, system_bootstrap must enter repair_lifecycle
- repair execution must not be treated as standard execution
- repair classification must be preserved throughout lifecycle
- repair must not be silently downgraded to audit or standard execution
- registry validation state and emitted repair signals must be honored when present
- degraded repair must remain explicit and traceable
- blocked repair must remain explicit and traceable


Autonomous chain execution rules:
- if execution type = autonomous chain, system_bootstrap must preserve chain-aware orchestration state
- target_workflow must resolve against Workflow Registry for every chain execution
- chain workflow rows must be treated as first-class executable workflow rows, not partial chain metadata
- if chain workflows are triggered from Execution Chains Registry, execution_class must remain autonomous chain
- must execute the current chain step using the resolved route/workflow context
- must preserve engine_chain visibility in execution state
- must record next_step status
- if a chain row exists but its workflow row is incomplete or inactive, readiness must fail before execution continues
- must not silently collapse autonomous chain execution into standard execution
- if chain execution degrades, degradation must remain traceable in final output and logging

Ã¢â‚¬â€
Pre-Execution Enforcement Gate

Before loading or executing any target, system_bootstrap must perform the following checks in order:

Step 0 Ã¢â‚¬â€ Canonical dependency bootstrap (when not already satisfied for this execution scope)
- verify `canonical_knowledge_dependency_bootstrap` and `canonical_url_dependency_bootstrap` completed successfully for all required canonical dependencies per **canonical_source_priority** (knowledge_layer, then canonical_url) and per `exact_active_knowledge_only` rules, or classify execution as Degraded or Blocked per bootstrap failure handling
- do not treat prompt_router handoff, module_loader execution preparation, or memory schema interpretation as authoritative if required canonical loads failed while `blocked_if_missing` applies

Step 1 Ã¢â‚¬â€ Intake presence check
- verify routing output is present
- verify strict execution intake fields are present when required

Step 2 Ã¢â‚¬â€ Source validation
- verify source = prompt_router
- if source is absent or invalid, reroute through prompt_router when safe
- if rerouting is not possible, classify as Blocked

Step 3 Ã¢â‚¬â€ Route integrity check
- verify route_id is present for executable routing
- verify route_status is assigned
- verify executable is assigned

Step 4 Ã¢â‚¬â€ Executable readiness check
- if route_status = degraded, do not treat routing as execution-ready
- if route_status = blocked, do not continue
- if executable = false, do not continue as successful execution

Step 4A - Request readiness enforcement
- verify the routed request remains backed by `Task Routes` authority
- verify `target_workflow` remains present for the active handoff
- verify execution logging handoff remains available when `logging_required = true`
- if any of these are missing, classify execution as at least Degraded unless a stricter blocked rule already applies
- preserve traceability of the missing readiness requirement

Step 4B - Chain workflow readiness check
- when execution type = autonomous chain, verify `chain_id` resolves through `Execution Chains Registry`
- verify `target_workflow` resolves to an active Workflow Registry row
- verify `engine_chain` is resolved for the active chain step
- verify route, chain, workflow, and target_module compatibility remain aligned as one governed unit
- if a chain row exists but the workflow row is missing, incomplete, inactive, or incompatible, set `execution_ready_status` to degraded or blocked based on recoverability
- preserve explicit `failure_reason` and `recovery_action` for chain-readiness failure

Step 5 - Registry consistency recheck
- recheck the routed target against `Registry Surfaces Catalog` and `Validation & Repair Registry` authority before final execution
- confirm target_module and target_workflow remain aligned with the routed record
- when execution type = autonomous chain, confirm route_id, chain_id, target_workflow, and target_module remain mutually compatible across Task Routes, Execution Chains Registry, and Workflow Registry

Step 5A - Review writeback plan validation
- if review_required = true, verify review_write_plan is present
- verify direct_write targets are present in the routed handoff
- verify write_order is present
- verify no computed, helper, or non-authoritative surfaces from `Registry Surfaces Catalog` are classified as legal write targets
- if review_write_plan is missing but review_required = true, classify execution as Degraded or Blocked based on whether safe review-compatible continuation exists

Step 5B - Repair Loop Auto-Trigger Gate
- after registry bindings are resolved and review bindings are resolved, evaluate Repair Control before execution proceeds
- repair_candidates = EXISTS Repair Control rows where:
  - repair_required = TRUE and repair_status != "completed"
  - or rerun_gate indicates hold, blocked, or rerun_required
  - or rerun_status exists and rerun_status != "completed" when rerun governance remains active
- if route = system_repair due to forced repair routing, verify auto_repair_trigger = TRIGGER_REPAIR is traceable from governed review or control surfaces
- if forced_repair_routing_applied = true but the trigger is not governed or not traceable, classify execution as Degraded or Blocked
- if repair_candidates = TRUE, set execution_mode = system_repair
- if repair_candidates = TRUE, set repair_memory.repair_active = TRUE
- if repair_candidates = TRUE, set repair_memory.active_route = system_repair
- if repair_candidates = TRUE, set review_context.repair_loop_state = active
- if repair_candidates = FALSE and the loop has been evaluated with no active repair or rerun work remaining, set review_context.repair_loop_state = completed
- if repair loop governance is not yet applicable or not yet evaluated, retain inactive or pending instead of forcing completed

Step 5C - Scope Lifecycle Coverage Check
- before accepting a new scope implementation, verify lifecycle coverage is complete
- if new_scope_detected = true or a new review stage is introduced, verify:
  - detection path exists
  - findings logging path exists
  - repair path exists through a dedicated repair stage or governed repair mapping
  - re-validation path exists
  - Registry alignment exists when applicable
  - execution routing compatibility exists
- if active_review_stage = pipeline_surface_activation_review, verify a corresponding repair path exists
- if no dedicated repair stage or governed repair mapping exists, mark execution as Degraded
- create finding issue_type = incomplete_scope_lifecycle
- block completion until lifecycle coverage is resolved

Step 5D - Pre-Execution Block Flag Enforcement
- if any governed finding has Pre-Execution Block Flag = BLOCK, set execution_ready_status = blocked
- if any governed finding has Pre-Execution Block Flag = BLOCK, set failure_reason = recurring_low_confidence_issue
- if any governed finding has Pre-Execution Block Flag = BLOCK, do not allow normal execution continuation
- if any governed finding has Pre-Execution Block Flag = BLOCK and route = system_repair, only repair_lifecycle may proceed

Step 5E - Brand tracking and measurement readiness
- when the routed workflow, execution chain, category, or autopilot mode requires Search Console, Google Analytics, or Tag Manager: verify `brand_tracking_resolution` has run (or run it here) and that Brand RegistryÃ¢â‚¬â€œauthoritative bindings for `gsc_property`, `ga_property_id`, and `gtm_container_id` meet workflow requirements
- when GA property is required but missing, verify `analytics_discovery` completed or is scheduled per policy; do not proceed as fully ready if discovery is blocked and the workflow requires a property
- when GTM validation is required, verify `measurement_validation` outcome is acceptable or a remediation route is selected
- preserve explicit `tracking_binding_status` and `measurement_readiness` in execution context for logging and memory

Step 5F - Architecture reconciliation enforcement
- when a structural change is accepted or applied, verify `architecture_reconciliation` pass ran across all required affected surfaces
- if stale surface, authority, validation, or execution-model rows remain active in `Registry Surfaces Catalog` or `Validation & Repair Registry`, set execution readiness to Degraded or Blocked based on recoverability
- do not classify execution as Recovered until reconciliation requirements are complete for required affected surfaces

Step 5G - Analytics sheet-sync readiness enforcement
- for analytics sheet-sync workflows, verify active workbook and sheet bindings for governed analytics warehouse targets before write
- verify canonical header schema exists and matches requested source target (GA4 Data vs GSC Data)
- verify request identity is complete (`brand` or governed brand set, `request_date`, `date_from/date_to`, `trigger_mode`)
- if fetch succeeds but transformation/schema/write readiness is incomplete, classify at least Degraded and forbid Recovered

Step 5H - Domain-aware analytics readiness enforcement
- for domain-bound analytics workflows, verify `brand_domain` is resolved for each execution unit before execution classification
- if property binding is present but `brand_domain` is missing, set execution_ready to false and classify Degraded or Blocked by policy
- require brand-domain traceability fields to remain available for logging, review surfaces, validation state, and reconciliation state

Step 5I - Analytics identity defect issue creation enforcement
- for analytics workflows, detect identity defects per execution unit (`brand_domain`, `gsc_property`, `ga_property_id` as applicable by source)
- when a defect is detected, set `execution_ready_status` to Degraded or Blocked and set `analytics_identity_issue_status = required`
- create or deduplicate a governed Review Findings Log issue using key (`brand`, `execution_trace_id`, `defect_type`)
- attach issue context (`brand`, `brand_domain`, property binding status, request_date/date_from/date_to, trigger_mode, request_source)
- if deduplicated, preserve `analytics_identity_issue_dedup_key` and keep traceability in execution outputs
- do not permit `Recovered` while any active analytics identity defect remains unresolved

Step 5J - API endpoint metadata readiness enforcement
- for agent-action-backed tool execution where endpoint metadata is policy-required, verify parent capability in Actions Registry and endpoint row readiness in API Actions Endpoint Registry
- validate required endpoint metadata fields (`OpenAI schema reference`, authentication metadata, privacy reference when policy-mandated)
- if required endpoint metadata is incomplete, set `api_endpoint_metadata_readiness_status = degraded` or `blocked` by policy and forbid `Recovered`
- connector availability alone must not override required endpoint metadata validation failure

Step 5K - Full system intelligence audit readiness enforcement
- when route or target workflow resolves to `full_system_intelligence_audit`, verify staged-audit and component-audit surfaces are resolved and compatible
- verify row-audit rule and schema surfaces are resolved before findings classification
- verify repair_mapping_registry_sheet is resolved when findings may enter governed repair lifecycle
- verify business_intelligence_scoreboard_sheet is treated as downstream summary propagation only, not execution authority
- if governed full-audit dependencies are missing, classify execution readiness as Degraded or Blocked by criticality and preserve traceability
- if findings require repair, trigger repair lifecycle using governed repair mapping outputs and keep findings-to-repair linkage explicit
- when `full_system_intelligence_audit` is the resolved governed route, downstream layers must not downgrade execution into lightweight scoring-only or report-only audit behavior unless degradation is explicitly classified and traceable

Step 5L - Google Workspace native action validation gate
- before governed Google Sheets, Docs, or Drive execution, verify target binding resolves through `Registry Surfaces Catalog` when Registry governance applies
- verify validation-state compatibility through `Validation & Repair Registry`
- verify routed Task Routes and Workflow Registry compatibility still holds
- verify module_loader returned compatible `native_action_readiness`, `target_validation_status`, and `registry_binding_status`
- if required checks fail, classify readiness as Degraded or Blocked and forbid recovered direct native-action execution
- when recoverable, preserve repair-aware continuation through governed repair mapping

Step 5M - Mandatory runtime authority validation hook
- before governed execution begins, run runtime authority validation for Registry bindings, validation-state compatibility, route/workflow authority, dependency readiness, and graph-path readiness when applicable
- if runtime authority validation fails, downstream business execution must not begin
- classify execution as Degraded or Blocked by policy and keep recovered classification forbidden
- enforce this hook for starter, direct governed, repair, retry, graph-auto-routing, governed addition, and governed Google Workspace execution when system resources are affected

Step 6 - Load authorization
- only after successful intake validation may module_loader prepare the execution target

Step 7 Ã¢â‚¬â€ Outcome classification
- failed intake validation must result in explicit Degraded or Blocked classification
- direct execution bypass is prohibited

system_bootstrap must not silently upgrade invalid routing into executable state.

---
