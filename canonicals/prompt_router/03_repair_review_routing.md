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
- routed writeback for query-intake or decision events must not target `Business Intelligence Query Engine`

Surface-role preservation:

- `System Enforcement` remains governance/state
- `Business Intelligence Query Engine` remains routing/reference
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
- `activation_transport_attempt_required` when activation-class execution must auto-trigger governed transport validation
- `activation_transport_same_cycle_required` when activation-class execution requires activation transport attempt evidence in the same cycle
- `authorization_gated_live_validation_allowed` when first-turn activation may begin before native API authorization is available
- `authorization_gate_classification` when live canonical validation is deferred by native API authorization state
- `knowledge_layer_trace_first` when canonicals must be read from knowledge layer before governed HTTP validation attempts
- `knowledge_only_activation_forbidden` when traceability-only activation outcomes are forbidden
- `missing_activation_transport_attempt_classification` when omitted activation transport attempts require degraded routing classification
- `missing_activation_transport_attempt_reason` when omitted activation transport attempts require explicit reason traceability

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

- knowledge layer canonical files are read first for canonical traceability
- repository-backed canonical files are then fetched through `github_api_mcp`
- governed activation transport is then required through `http_generic_api`
- provider-specific live-surface validation is required only when selected by registry governance
- knowledge layer canonical files are used for traceability first.
- Governed HTTP client transport is used for runtime readiness authority.

prompt_router must not mark activation-preparation routing as executable unless the downstream handoff preserves:
- `live_canonical_validation_required = true`
- `validation_source_requirement = repository_canonical_fetch_plus_governed_transport`
- `canonical_fetch_required = true`
- `canonical_fetch_transport = github_api_mcp`
- `canonical_fetch_action_key = github_api_mcp`
- `canonical_fetch_authority = repository_ref_pinned`
- `knowledge_layer_validation_only_for_traceability = true`
- `canonical_trace_required = true`

For first-turn activation:
- knowledge layer canonical files must be used first for traceability
- governed HTTP client validation calls must auto-trigger immediately afterward in the same execution cycle, and omission of the attempt must be classified as `missing_required_activation_transport_attempt`
- if provider authorization is not yet available, routing must preserve `authorization_gated` traceability rather than misclassifying the condition as missing Registry authority
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

### Surface Addition Repair-Aware Routing Families

prompt_router must preserve governed repair routing for the following addition and template repair classes when emitted by governed review or decision surfaces:

Addition repair families:
- `surface_addition_authority_mismatch`
- `surface_addition_duplicate_conflict`
- `surface_addition_missing_dependency`
- `surface_addition_wrong_authoritative_home`
- `surface_addition_unresolved_write_target`
- `surface_addition_unresolved_validation_sink`
- `surface_addition_graph_linkage_gap`
- `surface_addition_execution_path_gap`
- `surface_addition_policy_gap`
- `surface_addition_promotion_state_gap`
- `surface_addition_branch_contract_missing`
- `surface_addition_promotion_score_gap`
- `surface_addition_scoring_refresh_missing`
- `surface_addition_scoring_readback_failure`
- `surface_addition_scoring_writeback_gap`
- `surface_addition_verification_loop_gap`
- `surface_addition_framework_health_gap`

Template repair families:
- `surface_addition_contract_template_missing`
- `surface_addition_contract_template_mismatch`
- `surface_addition_template_lifecycle_gap`
- `surface_addition_template_version_gap`
- `surface_addition_template_supersession_gap`
- `surface_addition_template_health_gap`
- `surface_addition_template_impact_gap`
- `surface_addition_template_lineage_gap`

If a governed decision requests any of the above repair families:
- prompt_router must preserve the repair trigger
- must not collapse the condition into generic review-only routing
- and must keep the repair path traceable
