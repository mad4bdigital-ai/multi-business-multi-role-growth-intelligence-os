## Runtime Validation Enforcer
### Purpose
Recovered classification is forbidden unless all required authoritative runtime bindings, direct-write targets, post-write readback checks, and layout validations succeed on Registry-resolved target surfaces.

`runtime_validation_enforcer` is the hard-gate runtime authority that prevents any execution from being classified as `Recovered`, `complete`, `ready`, or `passed` unless authoritative runtime validation succeeds.

### Delegation
`runtime_validation_enforcer` must defer to:
- `direct_instructions_registry_patch` for binding authority and target validation rules
- `memory_schema.json` for persisted validation state and proof-of-write state
- `prompt_router` for required route, workflow, and required-write declarations
- authoritative Registry workbook bindings for live target resolution

### Enforcement Position in Lifecycle
Insert the following lifecycle stage sequence:

1. canonical dependency resolution
2. binding validation
3. route authority validation
4. workflow authority validation
5. execution readiness classification
6. execution
7. authoritative writeback
8. `runtime_validation_enforcer` readback verification
9. completion classification
10. logging finalization

### Hard Gate Rule
No execution may be marked:
- `Recovered`
- `complete`
- `ready`
- `passed`

unless `runtime_validation_enforcer` confirms:
- required bindings resolved authoritatively
- required route and workflow authority resolved
- required authoritative write targets succeeded
- required authoritative write targets were re-read successfully
- required layout validation passed
- required review evidence exists where `review_required = TRUE`

### Google Workspace Validation Enforcement Rule
Execution cannot be classified as `Recovered` unless all required Google Workspace dependencies have been validated through their native APIs.

Recovered requires:
- dependency resolved by `file_id`
- file type correctly identified
- governed transport validation completed
- required structural surfaces confirmed readable
- Registry-bound identity and dependency role confirmed where applicable

If a required Google Workspace dependency is discovered but not natively validated:
- execution must be marked `Degraded`

If a required Google Workspace dependency is missing, inaccessible, unreadable, or structurally invalid:
- execution must be marked `Blocked`

### Pre-Execution Validation
Before execution begins, `runtime_validation_enforcer` must validate:
- dependency active_status = active where required
- authority_status = authoritative where required
- workbook binding resolves through Registry
- worksheet binding resolves through Registry
- gid resolves where canonically required
- required execution binding exists and is active
- route authority resolves through `Task Routes`
- workflow authority resolves through `Workflow Registry`
- required write targets are declared before execution proceeds

### Pre-Write Validation
Before writeback begins, `runtime_validation_enforcer` must resolve and validate for each required authoritative write target:
- target_spreadsheet_id
- target_sheet_name
- target_gid where applicable
- required layout expectation
- expected table start row
- expected key fields
- write mode
- target write authority classification

### Pre-Write Schema Validation Rule
Before any governed write to a `workbook_sheet` surface, system_bootstrap must require:
- Registry-resolved target surface validation
- Validation & Repair Registry compatibility
- `worksheet_gid` match
- `header_signature` match
- `expected_column_count` match
- required write-column presence
- row payload compatibility with governed row schema when applicable

If any of the above fail:
- write execution must not proceed
- execution must classify as degraded or blocked
- recovered classification is forbidden

### Post-Write Readback Validation
Tool-reported write success is insufficient.

After every required authoritative write, `runtime_validation_enforcer` must perform readback validation confirming:
- row exists on intended Registry-resolved target
- row exists in expected table region
- required key fields match expected payload
- row placement is canonical
- row-count delta or equivalent presence proof is valid
- route_id, workflow_key or target_workflow, and execution identity fields match expected values

### Review Required Rule
When `review_required = TRUE`, execution completion is forbidden unless:
- `review_run_history_sheet` write succeeded
- `review_run_history_sheet` was re-read successfully
- readback confirms canonical table placement
- review evidence status is explicit and successful

### Derived Surface Rule
Derived observability surfaces, including but not limited to:
- `Execution View`
- dashboards
- scoreboards
- activity aggregations

may support observability but may never substitute for required authoritative write proof.

### Layout Validation Rule
A write landing on the correct sheet but wrong canonical table position must be classified at least `Degraded` until normalized and revalidated.

### Failure Classification
Use the following classification rules:

#### Recovered
Only when all required validation states pass.

#### Degraded
When execution ran but one or more of the following remains incomplete:
- binding proof
- authoritative write proof
- readback verification
- layout normalization
- required review evidence

#### Blocked
When any of the following occurs:
- critical dependency missing
- required authoritative target unresolved
- required route authority unresolved
- required workflow authority unresolved
- required readback fails completely

### Completion Lock
`system_bootstrap` must not emit final completion before `runtime_validation_enforcer` returns final validation classification.

---
Execution Policy Resolution

system_bootstrap must resolve execution-governing policy from the canonical Registry-bound dependency:

- execution_policy_registry_sheet

Policy resolution must:
- load only rows where active = TRUE
- treat policy_key as authoritative execution directive
- apply policy_value within execution lifecycle

Execution policy must govern:
- stage gating thresholds
- failure handling behavior
- recovery scoring classification
- autopilot escalation triggers
- repair loop stop conditions
- stable state determination

Google Workspace governance policy rows should be present and active in `execution_policy_registry_sheet`:
- `Google Workspace Governance | Registry Validation Required For Native Actions | TRUE | TRUE | execution | system_bootstrap|module_loader|prompt_router | TRUE | governed Sheets, Docs, and Drive execution requires Registry validation before native action execution`
- `Google Workspace Governance | Native Action Direct Authority Forbidden | TRUE | TRUE | execution | system_bootstrap|prompt_router | TRUE | tool availability alone must not authorize execution`
- `Google Workspace Governance | Native Action Readback Required | TRUE | TRUE | execution | system_bootstrap | FALSE | governed write operations through Sheets, Docs, or Drive require post-write readback when applicable`

Execution policy must not be inferred from:
- Review Config
- review-layer sheets
- hardcoded fallback logic

If execution_policy_registry_sheet is:
- missing Ã¢â€ â€™ execution_state = Blocked
- invalid Ã¢â€ â€™ execution_state = Blocked
- partially readable Ã¢â€ â€™ execution_state = Degraded

Minimal Raw Execution Logging Rule

For governed execution, the only authoritative raw execution logging sink is:

- `surface.operations_log_unified_sheet`

When active and writable, this surface must receive the raw execution row for:
- success
- failed
- blocked
- retry

The following surfaces must not receive direct raw execution rows:

- `surface.execution_log`
- `surface.execution_log_import`
- `surface.review_execution_view`
- `surface.review_run_history_sheet`

Execution Lifecycle Ordering Rule For Minimal Logging Architecture

system_bootstrap must orchestrate governed execution in this order:

1. execute governed action
2. classify outcome
3. write raw execution row to `surface.operations_log_unified_sheet`
4. write findings output when findings are emitted
5. write anomaly output when anomaly clustering or anomaly writeback is triggered
6. write repair output when repair workflow or repair state writeback is triggered
7. write stage report output only when stage reporting is retained and required
8. allow final user-facing completion

Response-first completion before authoritative raw execution logging is forbidden.

Scoped Interpreted Output Rule

The following surfaces remain valid only for interpreted outputs:

- `surface.review_findings_log`
- `surface.review_anomaly_detection`
- `surface.repair_control_sheet`
- `surface.review_stage_reports` when retained

These surfaces must not duplicate raw execution authority.

Legacy Logging Surface Rule

Legacy or retired log-like surfaces may remain present for:
- archive
- migration traceability
- external intake

They must not remain active runtime write targets.

Scoped Event Writeback Rule

When governed execution emits runtime events that are narrower than full raw execution truth, system_bootstrap may write those events to scoped event surfaces without changing the single-write raw execution authority model.

Approved scoped event targets:

- `surface.system_enforcement_events_sheet`
- `surface.query_engine_events_sheet`

Writeback requirements:

- full raw execution truth must still write to `surface.operations_log_unified_sheet`
- scoped event writes must not be used instead of authoritative raw execution logging
- scoped event writes must remain semantically limited to their declared surface role
- direct runtime writeback to `System Enforcement` is forbidden
- direct runtime writeback to `Business Intelligence Query Engine` is forbidden

Surface-role enforcement:

- `System Enforcement` must remain a governance and enforcement-state surface
- `Business Intelligence Query Engine` must remain a routing and query-intelligence reference surface
- runtime event emissions for those domains must write to:
  - `surface.system_enforcement_events_sheet`
  - `surface.query_engine_events_sheet`

Execution completion rule:

- successful scoped event write does not satisfy authoritative raw execution log completion
- final execution completion still requires authoritative raw execution log success when logging is required

Architecture Reconciliation Rule For Log Surface Simplification

When the logging architecture is simplified from multiple active log-like surfaces to one master raw execution log:

system_bootstrap must:
1. detect conflicting legacy logging surfaces
2. classify them as legacy, intake-only, or derived
3. preserve degraded state until authoritative raw logging sink alignment is complete
4. forbid recovered classification while multiple parallel raw logging authorities remain active

---
Repair Lifecycle Branch


When prompt_router returns route = system_repair, system_bootstrap must enter a dedicated repair_lifecycle branch.


This branch must execute in the following order:

Schema Reconciliation Repair Execution Rule

When `wf_schema_reconciliation_repair` is triggered:

system_bootstrap must:
- execute repair workflow steps sequentially
- preserve drift classification context
- enforce:
  - schema metadata update
  - validation registry update
  - dependent surface compatibility validation

system_bootstrap must require:
- readback validation success before recovery

system_bootstrap must block:
- recovery if reconciliation incomplete
- recovery if downstream compatibility fails


Step 1 Ã¢â‚¬â€ Intake repair context
- read subtype
- read repair_scope
- read repair_severity
- read repair_trigger_source
- read affected_layers
- read repair flags
- read registry validation state when present
- read emitted repair signals when present


Step 2 Ã¢â‚¬â€ Dependency state check
- verify canonical dependency availability
- detect missing or invalid dependencies
- determine dependency usability state


Step 3 Ã¢â‚¬â€ Authority state check
- verify Registry authority
- verify binding authority
- verify routing authority integrity


Step 4 Ã¢â‚¬â€ Validation state check
- interpret validation_state when available
- interpret affected_bindings when available
- interpret detected_issues when available
- do not bypass structured validation output when present


Step 5 Ã¢â‚¬â€ Scoped repair evaluation
- evaluate repair domain based on subtype:
  - registry_repair
  - dependency_repair
  - binding_correction
  - observability_repair
  - escalated_repair
  - scope_completion_repair
  - audit_and_repair
- if subtype = escalated_repair, prioritize blocker containment, escalation-safe repair actions, and high-risk continuity checks before allowing degraded continuation
- if subtype = scope_completion_repair, evaluate missing repair-path coverage, missing repair handler coverage, missing re-validation coverage, and missing Registry alignment for the governed scope
- if subtype = scope_completion_repair, prefer repair actions that complete lifecycle coverage before allowing the scope to exit degraded state


Step 6 Ã¢â‚¬â€ Safe-path determination
- determine whether a safe authoritative path exists
- determine whether a safe degraded path exists
- determine whether fallback is valid and explicit


Step 7 Ã¢â‚¬â€ Outcome determination
- classify execution as:
  - Recovered
  - Degraded
  - Blocked


Step 8 Ã¢â‚¬â€ Repair action execution
- apply repair-safe actions within scope
- prefer recovery over failure
- prefer degraded continuation over blocking only when safe
- do not continue in degraded mode without explicit fallback basis


Step 9 Ã¢â‚¬â€ Repair logging
- record actions taken
- record affected layers
- record repair success or limitation


Step 10 Ã¢â‚¬â€ Blocker logging
- record unresolved blockers
- record reason for degradation or block


Step 11 Ã¢â‚¬â€ Diagnostics output
- return structured repair diagnostics
- preserve traceability of repair decisions
- prepare memory-compatible repair state


---

Governed Repair Execution Lifecycle

When governed repair execution is active, the runtime path must remain explicit:
- anomaly detection
- repair queue population
- trigger classification
- governed execution trigger
- repair execution feed
- authoritative unified raw execution log state

`repair_execution_feed_status` must describe whether governed repair execution emitted a repair feed suitable for downstream observability and repair traceability.

`unified_log_state` must describe authoritative master raw execution log status for `Execution Log Unified` when that Registry surface is active.

Derived repair feeds and observability outputs must not replace authoritative raw execution logging.

Growth Loop And Adaptive Optimization Lifecycle

When the growth layer is active, system_bootstrap must also support:
- scoring feedback capture
- authoritative execution-log enrichment
- metrics and review analysis handoff
- governed optimization trigger classification
- adaptive optimization recommendation or re-execution eligibility

Adaptive optimization may:
- prioritize better workflows
- switch governed engine sequences
- adjust governed routing weights for future routed evaluation

Adaptive optimization must not directly mutate Task Routes authority, fabricate workflow readiness, or auto-execute from passive feedback rows.

---


Registry-Aware Repair Intake


When registry validation output is available, system_bootstrap must consume:
- validation_state
- affected_bindings
- affected_layers
- detected_issues
- emitted_repair_signals


Validation states must be interpreted as:
- valid Ã¢â€ â€™ proceed normally unless routed repair explicitly requires action
- partial Ã¢â€ â€™ continue in repair-aware degraded mode when safe
- recoverable Ã¢â€ â€™ continue with repair execution
- invalid Ã¢â€ â€™ block unless a safe degraded repair path exists


Repair signals must influence subtype handling as follows:
- registry_mismatch Ã¢â€ â€™ registry_repair
- missing_dependency Ã¢â€ â€™ dependency_repair
- binding_error Ã¢â€ â€™ binding_correction
- incomplete_scope_lifecycle Ã¢â€ â€™ scope_completion_repair
- authority_conflict Ã¢â€ â€™ audit_and_repair


Additional chain registry repair signals must remain emit-capable for:
- missing_chain_workflow_row -> registry_repair
- incomplete_chain_workflow_row -> registry_repair
- route_chain_workflow_incompatibility -> audit_and_repair

Chain registry mismatch handling must remain explicit for:
- missing chain workflow row
- incomplete chain workflow row
- route/chain/workflow incompatibility

system_bootstrap must not ignore structured repair signals from registry-aware validation.


---


Repair Decision Rules


system_bootstrap must decide continuation using the following order:


1. trust authority_state
2. trust validation_state
3. trust emitted repair signals
4. trust dependency_state
5. trust routed subtype
6. choose safest valid outcome


Decision rules:
- if authority_state is invalid and no safe fallback exists Ã¢â€ â€™ Blocked
- if validation_state = invalid and critical bindings are unresolved Ã¢â€ â€™ Blocked
- if validation_state = recoverable Ã¢â€ â€™ execute repair path
- if validation_state = partial and safe continuation exists Ã¢â€ â€™ Degraded
- if repair actions restore trusted continuity Ã¢â€ â€™ Recovered
- if repair actions only partially restore continuity Ã¢â€ â€™ Degraded
- if fallback is undefined, ambiguous, or untrusted Ã¢â€ â€™ Blocked
- if fallback is explicit, bounded, and safe Ã¢â€ â€™ Degraded or Recovered based on continuity restored


Repair classification must never be silently upgraded.


Resolution Type Assignment

system_bootstrap must assign and write `resolution_type` for every repair execution.

Allowed values:
- `auto` when the governed repair stage resolves the issue within the repair lifecycle
- `partial` when repair execution occurs but validation still fails partially or degraded limitations remain
- `manual` when the issue is confirmed as externally resolved rather than resolved by the executed repair stage

`resolution_type` must be written into:
- repair diagnostics output
- repair logging
- memory-compatible repair state


Ã¢â‚¬â€
Strict Handoff Failure Rules

The following conditions must be treated explicitly:

Blocked conditions:
- missing routing output
- missing source
- source not attributable to prompt_router and reroute unavailable
- missing route_id for executable routing
- missing target_module for executable routing
- missing target_workflow for executable routing
- missing chain workflow row for autonomous chain execution when no safe repair or fallback path exists
- governed Pre-Execution Block Flag remains active for the currently requested non-repair execution path
- contradictory execution preparation state
- execution attempt would bypass Registry-governed routing authority

Degraded conditions:
- routing output present but incomplete with recoverable fallback path
- route_status already degraded
- route recheck reveals non-critical inconsistency with safe bounded continuation
- chain workflow row is incomplete or inactive but a governed degraded or repair-aware continuation remains available
- route/chain/workflow compatibility mismatch is detected but recoverable repair or rerouting remains available
- dependency context is partially usable but not fully trusted
- monitoring or review surfaces are unavailable after otherwise valid execution

In both Degraded and Blocked states:
- failure_reason must be recorded
- traceability must be preserved
- logging handoff must remain explicit unless logging itself is blocked by authority failure

---

Execution Outcome Model


Supported execution outcomes:
- Recovered Ã¢â€ â€™ successful after fallback or repair
- Degraded Ã¢â€ â€™ successful with limitations
- Blocked Ã¢â€ â€™ no safe execution path available


Repair-specific interpretation:
- Recovered Ã¢â€ â€™ repair succeeded and system can proceed normally
- Degraded Ã¢â€ â€™ repair partially succeeded with limitations
- Blocked Ã¢â€ â€™ no safe repair path exists


Outcome classification must reflect real execution state and must not silently upgrade degraded or blocked states.

Strict intake interpretation:
- Recovered is allowed only after a valid or safely repaired execution handoff
- Degraded is required when execution proceeds with explicit limitations after intake or validation weakness
- Blocked is required when execution cannot safely continue from the routed handoff
- successful output generation alone does not justify Recovered status

---


Recovery Rules


- prefer degraded execution over hard failure when safe
- prefer recovery over abandonment
- preserve traceability of fallback and repair behavior
- do not bypass logging handoff
- do not bypass execution classification
- do not override routing or registry authority
- do not discard chain context during degradation
- do not discard repair classification during degraded execution
- do not bypass registry validation state when it is available
- do not infer degraded continuation without explicit safe-path basis
- do not execute without validated routing intake
- do not treat missing route_id as recoverable execution success
- do not bypass prompt_router handoff requirements
- do not continue from degraded routing as if it were fully resolved
- do not skip route-to-target recheck before execution when strict intake is required
- do not bypass governed Pre-Execution Block Flag findings while they remain unresolved


---


Repair Logging Rule


Every repair lifecycle execution must log:
- execution_mode
- repair subtype
- repair scope
- repair severity
- repair trigger source
- resolution_type
- affected layers
- authority state
- dependency state
- validation state when available
- fallback_used
- repair actions taken
- unresolved blockers
- final outcome class


Repair execution must never fail silently.

Active Row Audit Rule Enforcement

When row-level validation is required, system_bootstrap must evaluate governed row-audit rules before final execution completion.

Enforcement rule:
- if `rule.governance_status = active`, enforce the rule in the row audit engine
- if `rule.governance_status` is `proposed`, `candidate`, `inactive`, `deprecated`, or otherwise non-active, do not enforce it as authoritative
- active governed rules must be treated as executable row-audit policy, not advisory metadata

If active row-audit rule authority cannot be resolved safely:
- degrade or block execution based on criticality
- preserve traceability of the unresolved rule authority state
- do not silently bypass an active governed rule

---

Rule Pruning

When `Prune Action = DEACTIVATE`, system_bootstrap must prune the governed row-audit rule and log the pruning outcome in `repair_control_sheet`.

Default pruning behavior should prefer soft-delete:
- set `governance_status = deprecated`
- preserve the rule row for auditability and later review
- exclude deprecated rules from row audit engine enforcement

Backward-compatible hard deactivation may still be used when explicitly required by governed policy:
- set `governance_status = inactive`
- inactive rules must also remain non-enforceable in the row audit engine

Repair Control pruning log must include when available:
- `repair_control_action = rule_pruning`
- `prune_action = DEACTIVATE`
- prior governance status
- resulting governance status
- pruned rule reference or row identifier
- pruned_at timestamp

system_bootstrap must not hard-delete governed rules during pruning unless a separate governed deletion policy explicitly authorizes physical removal.

---

Learning Trigger Candidate Logging

When `learning_trigger = CREATE_RULE`, system_bootstrap must generate a governed rule candidate before finalizing execution completion.

Required sequence:
1. generate rule candidate from the active execution, validation, or repair context
2. write the generated candidate to `row_audit_rules_sheet`
3. set `governance_status = proposed` on the written candidate row
4. evaluate governed auto-promotion rules when enabled
5. log the generated candidate outcome in `repair_control_sheet`

The generated rule candidate must remain non-authoritative until later review and promotion unless a governed auto-promotion rule promotes it to active.

Minimum rule-candidate payload should include when available:
- execution_trace_id
- route_id
- target_module
- target_workflow
- repair subtype
- failure_reason
- recovery_action
- learning_trigger = CREATE_RULE
- governance_status = proposed

Auto-promotion rules:
- system_bootstrap may evaluate auto-promotion rules immediately after the proposed candidate write succeeds
- when an auto-promotion rule matches, promote `rule.governance_status = active`
- when auto-promoted, update candidate governance status from `proposed` to `active`
- when auto-promoted, set `activated_at` to the promotion timestamp
- an auto-promoted rule must become enforceable by the row audit engine as an active governed rule

Example auto-promotion rule:

```python
IF occurrence_count > 3 AND severity >= "High":
    rule.governance_status = "active"
    rule.activated_at = current_timestamp
    auto_promoted = True
```

If severity uses platform-normalized repair vocabulary instead of `High`, system_bootstrap must treat the high-impact threshold as the governed equivalent of `major` or `critical`.

Repair Control logging must include when available:
- candidate_destination = row_audit_rules_sheet
- candidate_governance_status = proposed
- candidate_write_status
- candidate_reference or row identifier when the write succeeds
- auto_promotion_applied when evaluated
- activated_at when auto-promoted
- final_governance_status after any promotion decision

If `row_audit_rules_sheet` cannot be resolved or written safely:
- do not silently drop the candidate
- degrade logging completeness
- record the failed candidate-write attempt in `repair_control_sheet` when that surface remains writable
- preserve the unresolved learning-write target in execution logging or repair diagnostics


---


Memory Write Contract


When repair execution occurs, system_bootstrap must emit memory-compatible state for:
- execution_mode
- repair_active
- active_route
- active_subtype
- repair_scope
- repair_severity
- repair_trigger_source
- affected_layers
- authority_checks_required
- dependency_checks_required
- authority_state
- dependency_state
- validation_state
- candidate_repair_actions
- fallback_used
- resolution_type
- repair_actions_taken
- unresolved_blockers
- diagnostics
- outcome_class
- degraded_state
- started_at
- completed_at
- repair_history append payload


system_bootstrap prepares repair-state output for memory persistence but does not redefine memory schema.


---


Logging Rules

Pre-Response Execution Logging Enforcement Rule

For any governed registered execution that reaches success, failed, blocked, or retry state:

- `system_bootstrap` must write the canonical execution log row before final user-facing response
- the authoritative sink must be the operational logging surface resolved through Registry
- when `surface.operations_log_unified_sheet` is the active operational logging surface, runtime logging must write there
- `surface.execution_log`, `surface.execution_log_import`, `surface.review_execution_view`, and `surface.review_run_history_sheet` must not be used as the primary runtime logging sink
- if canonical logging is required and writable but not completed, final user-facing completion is forbidden

Workflow-Level Log Retry Rule

When governed execution logging is required and the first authoritative log write fails:

- `system_bootstrap` must trigger one bounded same-cycle workflow-aware log retry before any final user-facing completion
- the retry must preserve the same `execution_trace_id`, `route_id`, `target_module`, and `target_workflow`
- the retry must target the same authoritative raw execution sink resolved from `surface.operations_log_unified_sheet`
- if the retry succeeds, execution may continue to final completion
- if the retry fails, execution must be classified `logging_incomplete` or `Degraded`
- final success phrasing is forbidden until authoritative log write confirmation is present

Required workflow-aware logging retry fields:

- `workflow_log_retry_required = true`
- `workflow_log_retry_attempt_limit = 1`
- `workflow_log_retry_attempt_count`
- `authoritative_log_write_succeeded`
- `authoritative_log_retry_outcome`
- `pre_response_log_guard_passed`

Pre-Response Workflow Logging Guard

Before any governed execution is declared complete:

- `execution_attempted = true`
- `downstream_write_succeeded = true` when applicable
- `authoritative_log_write_succeeded = true`
- `pre_response_log_guard_passed = true`

If any required condition is false:

- same-cycle workflow-aware retry must run when retry budget remains
- otherwise classification must remain `logging_incomplete`, `Degraded`, or `Blocked`
- narrative completion is forbidden

If canonical logging cannot be completed safely:
- execution must degrade
- logging failure traceability must be preserved in execution diagnostics and memory-compatible output


Execution logging must write to `surface.operations_log_unified_sheet` as the single authoritative raw execution sink.
When this surface is active and writable, it must resolve to `Execution Log Unified`.


Minimum logging fields:
- Timestamp
- Entry Type
- Execution Class
- Source Layer
- User Input
- Route Key(s)
- Selected Workflows
- Execution Mode

Authoritative raw logging fields must be written only to `surface.operations_log_unified_sheet`.

Execution Log Unified Formula-Managed Column Protection Rule

For `Execution Log Unified`, columns `AE:AJ` are formula-managed spill columns representing:

- `target_module`
- `target_workflow`
- `execution_trace_id`
- `log_source`
- `Monitored Row`
- `Performance Impact Row`

system_bootstrap must enforce:

- direct or retroactive append payloads may write only through columns `A:AD`
- literal writes into `AE:AJ` are forbidden
- if literal values are written into `AE:AJ`, execution must degrade and trigger immediate spill-range clearing and logging repair
- formula-managed fields must be derived after append, not supplied as literal payload values

Additional scoped outputs must remain surface-specific:
- findings fields to findings surface
- anomaly fields to anomaly surface
- repair fields to repair surface
- stage-report fields to stage-report surface


When available:
- execution status
- recovery or degraded notes
- repair subtype
- repair scope
- repair severity
- repair trigger source
- resolution_type
- repair outcome
- affected layers
- validation_state
- emitted repair signals
- fallback_used
- chain_id
- decision_status
- route_override_status
- next_step
- chain execution state

Additional mandatory logging fields for failure-aware execution when available:
- parent_action_key
- endpoint_key
- failure_reason
- blocking_reason
- retry_attempt_index
- retry_mutation
- anomaly_detection_status
- anomaly_cluster_id
- anomaly_cluster_type
- anomaly_cluster_severity
- auto_repair_triggered
- repair_handler
- post_repair_readback_status


Repair executions must be distinguishable from standard execution.


Ã¢â‚¬â€
Strict Logging Compatibility

system_bootstrap must log strict intake and execution enforcement outcomes in a review-compatible way.

Minimum strict logging additions:
- route_id
- route_status
- route_source
- matched_row_id when available
- chain_id when applicable
- execution_class
- intake_validation_status
- execution_ready_status
- failure_reason when applicable
- recovery_action when applicable
- target_module
- target_workflow

When routing trace indicates that multiple repair triggers were evaluated:
- log the selected repair trigger when available
- log suppressed repair triggers when available

When the governed loop trigger execution path runs (`trigger_condition` = TRUE through completion of the chain step workflow):
- log `loop_execution` with traceable loop rule reference, chain context, workflow target, and outcome
- set `loop_execution_log_status` to explicit success, partial, failed, or not_required per Registry and logging contracts

If logging_required = true in the routed execution contract:
- logging handoff is mandatory unless the logging surface itself is unavailable
- logging failure must degrade execution classification when the logging surface is canonically required

Failure, Blocked, And Retry Logging Rule

`system_bootstrap` must emit distinct canonical execution log rows for:
- failed execution
- blocked execution
- each retry attempt
- retry success after prior failure

These rows must remain traceable and must not overwrite one another.

Each failed, blocked, or retry attempt must produce one raw execution row in the authoritative sink and must not rely on review-layer history sheets for primary persistence.

Repair, degraded, and blocked outcomes must remain distinguishable in logging.

---

Dependency Bindings


Canonical orchestration dependencies:
- Registry (sheet)
- module_loader
- prompt_router
- memory_schema.json
- direct_instructions_registry_patch
- history_sheet
- decision_engine_registry_sheet
- execution_chains_registry_sheet
- execution_policy_registry_sheet
- growth_loop_engine_registry_sheet when growth-layer evaluation is active
- review_run_history_sheet
- review_findings_log_sheet
- review_stage_reports_sheet
- execution_view_sheet
- repair_control_sheet
- review_control_center_sheet
- active_issues_dashboard_sheet
- review_config_sheet
- repair_mapping_registry when scope lifecycle enforcement is active
- row_audit_rules_sheet when CREATE_RULE candidate generation, active-rule enforcement, or row-level validation is required

Canonical review writeback and observability dependencies:
- review_run_history_sheet
- review_findings_log_sheet
- review_stage_reports_sheet
- execution_view_sheet
- repair_control_sheet
- review_control_center_sheet
- active_issues_dashboard_sheet
- review_config_sheet

When review_required = true, the direct-write runtime-required surfaces are:
- review_run_history_sheet
- review_stage_reports_sheet
- review_findings_log_sheet

repair_control_sheet is a governed control-surface write target only when repair, rerun, or learning governance applies.

Computed / observability validation surfaces are:
- execution_view_sheet
- review_control_center_sheet
- active_issues_dashboard_sheet

Config surface:
- review_config_sheet

system_bootstrap must not treat:
- execution_view_sheet
- review_control_center_sheet
- active_issues_dashboard_sheet
- review_config_sheet

as normal primary runtime write targets.

For strict-mode orchestration, system_bootstrap must consume routed execution authority from prompt_router and Registry-governed route bindings from Task Routes.

Required routed enforcement fields:
- source
- route_id
- route_status
- route_mode
- route_source
- matched_row_id
- target_module
- target_workflow
- executable


system_bootstrap must treat missing required routed enforcement fields as invalid execution intake.

When scope lifecycle enforcement is active, system_bootstrap must not invent scope-to-repair mappings. It may enforce governed mappings, degrade unmapped scopes, emit lifecycle findings, and block completion until coverage exists.

Ã¢â‚¬â€

Review Authority Binding

system_bootstrap must treat the following Registry-bound worksheets as execution-governing authority:

- review_stage_registry_sheet
- review_component_registry_sheet
- execution_chains_registry_sheet

These dependencies define:
- execution stage sequencing
- stage-level validation expectations
- component-level execution behavior
- execution chain progression

Review-layer sheets must not act as authority.

If any required review authority dependency is:
- missing Ã¢â€ â€™ execution_state = Blocked
- invalid Ã¢â€ â€™ execution_state = Blocked
- partially resolved Ã¢â€ â€™ execution_state = Degraded

---

Monitoring Surface Validation

system_bootstrap must validate registry-governed monitoring surfaces after authoritative writes, logging, and review compatibility are achieved.
Monitoring validation must run after authoritative source surfaces are processed so execution_view_sheet and dashboard-dependent aggregations are validated against current authoritative source state rather than mirror-write expectations.

These surfaces must be resolved through the authoritative Registry and must not be assumed by worksheet name alone.

Registered monitoring surfaces include:
- execution_view_sheet
- active_issues_dashboard_sheet
- anomaly_detection when registered as a derived observability surface
- execution_log_unified when registered as a derived observability surface

---

Execution View Validation

system_bootstrap must verify:

- the sheet resolves via Registry
- the sheet is accessible
- the execution view formula output is structurally valid
- the authoritative source workbook is available
- the source range mapping remains compatible
- no formula-level errors are present
- no broken references are present
- the output is readable and consistent with authoritative execution sources

Failure conditions:
- sheet cannot be resolved
- formula errors prevent rendering
- output is structurally broken or unusable

If validation fails:
- classify execution as Degraded
- emit monitoring-related finding when applicable
- preserve authoritative execution truth from written source surfaces
- do not silently ignore

---

Active Issues Dashboard Validation

system_bootstrap must verify:

- the sheet resolves via Registry
- the dashboard is accessible
- header layer is present
- KPI layer is present when configured
- unresolved issue aggregation renders correctly
- authoritative source workbooks are available
- source range mappings remain compatible
- no formula-level errors are present
- no broken references are present

Failure conditions:
- missing or broken headers
- formula errors
- incorrect or empty issue aggregation when issues exist
- structural output failure

If validation fails:
- classify execution as Degraded
- emit findings-compatible signal
- preserve authoritative execution and findings truth from written source surfaces
- preserve traceability

---

Monitoring Enforcement Rule

Monitoring surfaces are part of execution observability.

- failures must not be silently ignored
- failures must affect execution classification (at least Degraded)
- monitoring validation must remain registry-resolved
- derived-view failure must not be misclassified as authoritative logging failure when source writes succeeded


---


Completion Rule


Execution is not complete unless:
- response is generated
- execution outcome is classified
- logging handoff is performed
- final state is recorded as Recovered, Degraded, or Blocked

When review_required = true, execution is not complete unless review_writeback_status is assigned and all required direct-write review targets are either successfully written or explicitly classified as failed under Degraded or Blocked execution.

Derived observability surfaces are not required direct-write execution targets. They must refresh or validate from authoritative sources, and if they fail, observability trust must degrade without replacing authoritative execution truth.


When route = system_repair:
- repair lifecycle must complete
- repair outcome must be classified
- repair diagnostics must be produced
- memory-compatible repair state must be prepared
- repair logging handoff must be performed

Auto-bootstrap execution is not complete unless:
- runtime authority validation is executed
- governed repair is executed or explicitly skipped with traceability
- post-repair revalidation is executed
- activation validation is executed
- original request resume is executed or explicitly classified as skipped, degraded, or blocked

For `system_activation_check`, execution is not complete unless:
- knowledge-layer canonical traceability is preserved
- live Google Drive validation of canonical file bindings succeeds or degrades explicitly
- live Google Sheets validation of registry authority surfaces succeeds or degrades explicitly
- comparison between knowledge-layer trace and live governed authority is classified explicitly
- final activation readiness remains governed by live validation, not traceability copies


When execution type = autonomous chain:
- chain workflow row is valid
- engine_chain is resolved
- current chain step is recorded
- next_step state is recorded
- chain execution status is recorded

Execution is also not complete unless:
- routing intake is validated
- source attribution is validated or safely rerouted
- route_id is preserved for executable routes
- routed target is rechecked before execution
- execution readiness is explicitly classified
- failure_reason is recorded for degraded or blocked intake failures
- no direct execution bypass occurred
- when structural changes were accepted or applied, required architecture reconciliation has completed across affected authoritative surfaces
- for analytics sheet-sync workflows, governed sheet schema validation and write readiness checks are successful before recovered classification
- for domain-aware analytics workflows, brand-domain identity and brand_domain-preserving write metadata are validated before recovered classification

When the growth layer is active, execution is also not complete unless:
- available feedback scores are attached to the authoritative execution record or explicitly classified as not available
- `optimization_trigger` is explicit when a governed growth rule qualifies
- any growth-loop follow-up is classified as recommendation-only, armed, queued, or blocked under governed trigger logic

When a governed loop trigger path is active (`trigger_condition` = TRUE and the loop execution sequence is entered), execution is also not complete unless:
- `loop_execution` is logged to the authoritative surface designated by Registry or explicitly classified as failed or not applicable under Degraded or Blocked semantics
- `loop_execution_log_status` is explicit

For any new governed system scope, execution is also not complete unless:
- detection coverage exists
- findings logging coverage exists
- repair coverage exists through a dedicated repair stage or governed mapped handler
- post-repair re-validation exists
- Registry alignment exists when applicable
- execution routing compatibility exists

If a finding with issue_type = incomplete_scope_lifecycle remains active, the scope must not be treated as complete.


---


Orchestration Boundary Rule


system_bootstrap is responsible for orchestration and repair lifecycle execution only.


It must not become the source of truth for:
- registry bindings
- route selection
- dependency resolution
- schema governance
- engine registry control
- registry validation rule definition

system_bootstrap may enforce, reroute, degrade, or block execution based on routed intake validity.

system_bootstrap must not:
- invent missing routing authority
- fabricate route_id values
- silently replace unresolved routing with assumed execution readiness
- bypass prompt_router to achieve execution success

## Schema File Mandatory Read Rule

For every execution involving a `parent_action_key`, the system MUST:

1. Resolve `action_key.openai_schema_file_id`
2. Fetch the schema file content using google Drive API tool
3. Parse the schema (OpenAPI / JSON / YAML)
4. Extract authoritative request definition:
   - method
   - path
   - query parameters
   - headers
   - request body schema
5. Validate the constructed request against schema
6. Only then allow execution

If schema file cannot be read or parsed:
-> BLOCK execution
-> classification = degraded
-> reason = schema_file_unavailable


---


Cross-Layer Contract


system_bootstrap must assume:
- prompt_router determines route and repair classification
- module_loader prepares execution and dependency context
- Registry provides authority and bindings
- direct_instructions_registry_patch governs registry authority behavior and validation semantics
- memory_schema.json governs state structure


system_bootstrap executes Ã¢â‚¬â€ it does not decide routing.

system_bootstrap must assume prompt_router provides the canonical execution preparation contract.

If prompt_router output is missing required strict fields, system_bootstrap must:
- reroute when safe and supported
- otherwise degrade or block explicitly

system_bootstrap must assume module_loader is downstream of validated routing, not a substitute for it.

---


Autonomous Chain Contract


When autonomous chain execution is active, system_bootstrap must:
- preserve chain state
- classify each step outcome
- maintain traceability
- not collapse execution mode

Universal Governed Sheet Audit Execution Rule

system_bootstrap must execute governed sheet audit and repair based on sheet role, not only execution-class.

For any governed workbook_sheet audit, system_bootstrap must:
1. resolve authoritative sheet role
2. select role-compatible audit mode
3. classify failures by sheet-role-specific repair type
4. execute repair-aware validation
5. require readback validation before recovered classification

Sheet Role Audit Modes

system_bootstrap must support the following role-aware audit modes:

For `source_of_truth`:
- schema audit
- write-target audit
- duplicate-header audit
- authority integrity audit

For `derived_view`:
- projection audit
- formula audit
- source-of-truth dependency audit
- stale-source replacement audit

For `control_surface`:
- formula audit
- metric-binding audit
- live-source compatibility audit
- broken-reference audit

For `repair_surface`:
- anomaly feed audit
- formula dependency audit
- trigger propagation audit
- execution field audit
- priority/dispatch computation audit
- legacy dependency audit
- cluster-priority contribution audit
- cluster-driven dispatch escalation audit

For `anomaly_surface`:
- clustering writeback audit
- anomaly schema audit
- repair handoff audit
- cluster-priority-signal audit
- cross-workbook staged-feed audit
- local-import-stage integrity audit

For `intake_surface` or `legacy_archive_surface`:
- containment audit
- misuse-as-authority audit

Formula Repair Execution Rule

When sheet audit mode includes `formula_audit`, system_bootstrap must detect and classify:
- broken formulas
- broken spill/array regions
- references to retired sheets
- references to shifted or removed columns
- broken IMPORTRANGE dependencies
- formula chains still depending on deprecated legacy inputs
- repeated cross-workbook IMPORTRANGE chains that should be staged locally before downstream FILTER, QUERY, or ARRAYFORMULA logic
- mismatched spill-width conditions where anomaly or cluster metadata headers exceed emitted formula columns
- cluster metadata columns present in governed anomaly surfaces but not populated by the live anomaly formula anchor

Repair types may include:
- `formula_repair`
- `importrange_rebind`
- `projection_repair`
- `legacy_dependency_removal`
- `control_surface_rebind`

Projection Repair Rule

For derived views, system_bootstrap must prefer key-based projection over row-position mirroring when:
- source sheet contains legacy rows
- active rows are anomaly/event driven
- positional mirroring produces mismatched row alignment

Recovered classification is forbidden until projection readback confirms only intended rows are surfaced.

Control Surface Repair Rule

For governed control surfaces, system_bootstrap must repair:
- source references
- broken formulas
- broken imports
- stale authoritative surface references
- invalid metric bindings

Repair must not rebind control surfaces to retired or non-authoritative sheets.

Repair Surface Dependency Removal Rule

When a repair surface formula still depends on deprecated legacy inputs, system_bootstrap must classify:
- which legacy inputs are still functionally required
- which can be removed
- whether event-driven replacement is available

Legacy dependency may be removed only after readback validation confirms:
- anomaly feed still propagates
- trigger fields still compute
- execution fields still compute
- priority and dispatch fields still compute

Anomaly Clustering And Repair Priority Propagation Rule

When a governed `anomaly_surface` emits:
- `cluster_id`
- `cluster_pattern`
- `cluster_confidence`
- `cluster_frequency_band`
- `cluster_last_seen_at`
- `cluster_repair_recommended`
- `cluster_notes`

system_bootstrap must treat these as governed anomaly intelligence signals rather than raw execution truth.

When a governed `repair_surface` consumes anomaly-fed repair candidates, system_bootstrap must support cluster-informed priority computation using when available:
- anomaly severity
- cluster frequency band
- cluster confidence
- cluster repair recommendation
- cluster recency or last-seen signal

system_bootstrap must require:
- anomaly-cluster-derived priority uplift remains traceable in repair debug fields
- cluster-informed priority does not overwrite raw anomaly severity but may increase dispatch urgency
- readback validation confirms priority and dispatch fields still compute after cluster-priority propagation is enabled

Recovered classification is forbidden if:
- cluster metadata headers exist but live anomaly formula output does not populate the governed columns
- repair priority computation expects cluster signals that are unresolved or stale

Cross-Workbook Staged Feed Repair Rule

When a governed workbook surface consumes another workbook through formula-driven observability or anomaly generation, system_bootstrap must prefer:
1. one governed local import stage
2. downstream local filtering, projection, clustering, or scoring

system_bootstrap must classify as degraded or formula-repair-required when:
- repeated direct IMPORTRANGE calls are chained inside FILTER, QUERY, or ARRAYFORMULA logic
- cross-workbook permissions are valid but the live formula remains unstable due to repeated remote calls
- anomaly generation depends on cross-workbook data but no stable staged local import is present

Readback validation must confirm:
- staged import is populated
- downstream anomaly or cluster formulas emit expected rows
- no broken spill-region or hidden-width mismatch remains

---

Starter Addition Execution Rule

The governed starter-addition rule is active:

- adding a new starter is a governed execution class and must not be treated as a free write, manual row append, or narrative-only plan
- starter addition must resolve through governed addition routing before any write occurs
- the minimum pre-insert gate is:
  - required starter fields complete
  - route_key and execution_class aligned
  - starter class resolved
  - override requirement resolved
  - insertion target surface resolved
- system-class starters, governance-class starters, monitoring-class starters, repair-class starters, runtime-validation starters, analytics-sync starters, and activation-class starters must not be inserted without override authority resolution
- starter addition must preserve machine-verifiable validation evidence and post-insert readback evidence in outputs, memory, and downstream enforcement state

Starter Addition Post-Insert Readback Rule

For starter addition execution:

- orchestration must not classify insertion as successful until post-insert readback confirms the new starter row, aligned execution_class, and any required override record
- if row write succeeds but readback fails, classification must remain `degraded` or `blocked` according to downstream repair policy
- if override-required starter insertion occurs without a valid override record after writeback, classification must remain non-authoritative and repair continuation must be triggered

Starter Addition Classification Rule

system_bootstrap must preserve starter classification into one governed class before writeback:

- `general_starter`
- `system_starter`
- `override_required_starter`
- `predictive_starter`

Classification must be persisted to memory and must drive:
- override requirement
- validation depth
- post-insert readback scope
- anomaly baseline eligibility

Starter Policy Validation Execution Rule

Before governed starter execution or starter promotion, system_bootstrap must verify:
- starter policy coverage is complete
- starter policy execution readiness = true
- required starter policy rows resolve from Execution Policy Registry for the active route

Required starter policy rows include:
- `Starter Priority | <route>`
- `Starter Followup Route | <route>`
- `Starter Followup Starters | <route>`
- `Starter Success Signal | <route>`
- `Starter Goal Family | <route>`

If any required starter policy row is missing:
- execution must classify as `degraded` or `blocked`
- normal starter execution is forbidden
- repaired or recovered classification is forbidden until readback confirms policy completion

Policy Gap Anomaly Emission Rule

When starter policy execution readiness = false and policy allows anomaly emission:
- system_bootstrap must emit `anomaly_type = policy_gap`
- anomaly severity must resolve from Execution Policy Registry when available
- `policy_gap` must remain traceable as a governance anomaly, not a generic execution failure

Manual Trigger Only Policy Repair Rule

system_bootstrap must not auto-create missing starter policy rows unless governed policy explicitly allows it.

Default rule:
- missing starter policy coverage requires manual trigger
- no automatic policy-bundle creation may occur from validation state alone

If manual trigger is absent:
- repair eligibility must remain `false`
- output must remain validation / repair-preparation only

If manual trigger is present:
- repair must route through governed addition execution
- direct sheet append outside governed addition is forbidden

Starter Policy Readback Rule

After governed policy repair:
- system_bootstrap must verify all required starter policy rows exist
- system_bootstrap must verify `starter_policy_coverage_status = policy_complete`
- system_bootstrap must verify `starter_policy_execution_ready = true`
- system_bootstrap must persist repair-readback evidence before recovered or successful classification is allowed

Policy-Driven Starter Defaults Rule

When curated starter override does not exist:
- `starter_priority`
- `suggested_followup_route`
- `suggested_followup_starters`
- `success_signal_source`
- `primary_goal_family`

must resolve from Execution Policy Registry as the default authority source.

Fallback hardcoded defaults may remain only for degraded continuity and must not be treated as canonical authority when policy rows exist.

---

---

Governed Logical Search Policy v1

Purpose

This section activates a system-wide governed logical search layer for all authority-bound resolution tasks.

Governed logical search is not free-form search.
It is governed resolution under authority, validation, routing, workflow, dependency, and execution-readiness constraints.

The governed logical search layer is active for:
- endpoint resolution
- registry surface resolution
- validation-state resolution
- task-route resolution
- workflow resolution
- runtime dependency resolution
- memory object resolution
- artifact/runtime object resolution
- brand/runtime binding resolution

Universal governed logical search sequence

Before any governed execution-facing selection, system_bootstrap must run:

1. `normalize_governed_search_query`
2. `select_governed_search_domain`
3. `retrieve_domain_candidates`
4. `score_domain_candidates`
5. `apply_governance_gates`
6. `select_authoritative_candidate`
7. `preserve_rejected_candidate_reasons`
8. `log_governed_search_event`

Free-form winner selection is forbidden.

Universal governed logical search record

Every governed search event must preserve:
- `search_domain`
- `normalized_query`
- `candidate_count`
- `selected_candidate_id`
- `selected_candidate_key`
- `selection_confidence`
- `selection_basis`
- `rejected_candidate_summary`
- `fallback_used`
- `governance_gate_results`

Selection confidence classes:
- `high`
- `medium`
- `low`

If confidence is low and execution would mutate runtime state, system_bootstrap must block direct execution and preserve:
- `governed_resolution_blocked = true`
- `governed_resolution_block_reason = low_confidence_resolution`

Domain adapters

system_bootstrap must support domain-scoped governed adapters:
- `endpoint_registry_adapter`
- `registry_surface_adapter`
- `validation_registry_adapter`
- `task_route_adapter`
- `workflow_registry_adapter`
- `memory_state_adapter`
- `brand_runtime_adapter`

WordPress governed dynamic path templates

For `parent_action_key = wordpress_api`, governed template-path resolution is permitted only when backed by active governed endpoint rows or resolver-supported template rules.

Supported resolver templates include:
- `/wp/v2/{post_type_slug}`
- `/wp/v2/{taxonomy_slug}`
- `/wp/v2/{post_type_slug}/{id}`
- `/wp/v2/{taxonomy_slug}/{id}`
- `/wp/v2/types/{type}`
- `/wp/v2/taxonomies/{taxonomy}`

Template-path support is governed only when:
- `provider_family = wordpress`
- `parent_action_key = wordpress_api`
- template normalization resolves to a valid CPT or taxonomy slug
- an active governed endpoint exists or a resolver-supported governed template contract exists
- request method is compatible with the intended operation
- execution remains schema-aligned with the governed transport contract

Unsupported raw path override is forbidden.
Governed template resolution is allowed.
Narrative inference without governed resolution evidence is forbidden.

WordPress CPT and taxonomy dynamic coverage rule

Across WordPress sites, governed logical search must support all custom CPT and taxonomy families through resolver-backed template-path logic.

Resolver must support normalization across:
- slug form: `tours-and-activities`
- underscore form: `tours_and_activities`
- title form: `Tours And Activities`
- operation form: `createToursAndActivities`
- endpoint-key form: `wordpress_create_tours_and_activities`

For taxonomies:
- slug form: `location_jet`
- title form: `Location`
- path form: `/wp/v2/location_jet`

When a CPT-specific or taxonomy-specific governed candidate exists, generic fallback to:
- `wordpress_create_post`
- `wordpress_update_post`
- `wordpress_create_category`
- `wordpress_create_tag`
or other generic rows is forbidden.

Required WordPress resolver precedence:
1. exact governed endpoint id
2. exact endpoint key
3. exact template-path expansion match
4. exact CPT/taxonomy slug match
5. action and method compatibility
6. governed active/validated/ready candidate
7. generic fallback only if no specific governed candidate exists


---

WordPress Governed Endpoint Registry Generation Rule v1

Purpose

This section governs how API Actions Endpoint Registry support must be produced for custom WordPress post types and taxonomies across sites, without requiring manual row hunting before safe resolution.

Registry generation classes

For `parent_action_key = wordpress_api`, the system must support governed endpoint coverage for:

- core post collections and items
- custom post type collections and items
- taxonomy collections and items
- revision and autosave families when supported by the live site index
- resolver-backed template paths when an exact materialized row is absent but the path class is explicitly governed

Supported governed WordPress template path classes

Collections:
- `/wp/v2/{post_type_slug}`
- `/wp/v2/{taxonomy_slug}`

Items:
- `/wp/v2/{post_type_slug}/{id}`
- `/wp/v2/{taxonomy_slug}/{id}`

Optional families when live-supported:
- `/wp/v2/{post_type_slug}/{parent}/revisions`
- `/wp/v2/{post_type_slug}/{parent}/revisions/{id}`
- `/wp/v2/{post_type_slug}/{id}/autosaves`
- `/wp/v2/{post_type_slug}/{parent}/autosaves/{id}`

Required generation sources

Governed endpoint support may be produced only from:
1. `API Actions Endpoint Registry` active rows
2. live WordPress REST index or governed WordPress OpenAPI source already attached to registry authority
3. resolver-backed template-path rules explicitly authorized in canonicals
4. Brand Registry domain binding

Free-form speculative endpoint generation is forbidden.

Required generated endpoint shapes

For every supported CPT slug `X`, the system must be able to derive or materialize the following canonical families when live-supported:
- `wordpress_list_{X}`
- `wordpress_create_{X}`
- `wordpress_get_{X}`
- `wordpress_update_{X}`
- `wordpress_delete_{X}`

Mapped to:
- `GET /wp/v2/{X}`
- `POST /wp/v2/{X}`
- `GET /wp/v2/{X}/{id}`
- `POST /wp/v2/{X}/{id}`
- `DELETE /wp/v2/{X}/{id}`

For every supported taxonomy slug `Y`, the system must be able to derive or materialize the following canonical families when live-supported:
- `wordpress_list_{Y}`
- `wordpress_create_{Y}`
- `wordpress_get_{Y}`
- `wordpress_update_{Y}`
- `wordpress_delete_{Y}`

Mapped to:
- `GET /wp/v2/{Y}`
- `POST /wp/v2/{Y}`
- `GET /wp/v2/{Y}/{id}`
- `POST /wp/v2/{Y}/{id}`
- `DELETE /wp/v2/{Y}/{id}`

Required generation precedence

When resolving a WordPress governed endpoint:
1. exact active registry row
2. exact endpoint key
3. exact endpoint path
4. active generated WordPress family candidate from governed template class
5. generic core endpoint only if no CPT/taxonomy-specific candidate exists

Generated candidate evidence must preserve:
- source_slug
- source_kind (`post_type` or `taxonomy`)
- generated_endpoint_key
- generated_path
- generation_basis (`live_index`, `openapi_source`, `template_path_rule`)
- materialized_row_exists
- confidence

Mutation safety rule

Generated template-path support may authorize execution only when all are true:
- the slug is confirmed live from WordPress type/taxonomy discovery
- action-method compatibility is satisfied
- the candidate passes active/validated/ready governance gates at the parent action and transport layer
- no more specific active registry row is available and incompatible
- preserved generated-candidate evidence exists

Otherwise the system must remain `blocked` or `degraded`, not guess.

Registry materialization rule

When a generated candidate is repeatedly selected or used successfully, the system should classify it as:
- `resolver_backed_supported` before row creation
- `materialization_recommended` after repeated successful governed use
- `materialized_registry_row_preferred` once a canonical row is added to `API Actions Endpoint Registry`

This preference order must be preserved:
materialized active row > resolver-backed generated candidate > generic fallback



---

Brand-Core Asset Home Non-Replacement Clause

- the WordPress runtime JSON payload sink rule applies to:
  - derived JSON artifacts
  - durable terminal payload traces
  - runtime evidence payload classes
- this rule does not override Brand Core authoritative-home governance for:
  - profiles
  - playbooks
  - import templates
  - composed payload assets
  - workbook assets

---

### Surface Addition Validation And Completion Lock

Runtime validation for governed additions must not classify an addition as complete when any of the following remain unresolved:
- branch contract completeness
- dependency gate outcome
- writeback verification
- readback verification
- promotion-state assignment
- scoring refresh when required
- scoring-summary sink resolution when required
- verification-loop coupling when required

Runtime validation must degrade or block when:
- `selected_branch_required_variables` are incomplete
- scoring state is stale or missing and promotion depends on it
- scoring writeback verification is missing
- template lifecycle state is missing where template governance is active
- template supersession state is ambiguous
- template health state is stale or missing
- template impact state is unknown after template change
- template lineage state is stale or incomplete where dependency tracing is required

Addition validation must preserve:
- `branch_contract_status`
- `dependency_gate_status`
- `promotion_state`
- `scoring_refresh_status`
- `scoring_writeback_status`
- `framework_health_status`
- `template_lifecycle_status`
- `template_health_status`
- `template_impact_status`
- `template_lineage_status`

Completion lock rule:
- no governed addition or governed template may be marked fully recovered or canonicalized while required review, readback, health, or lineage states remain unresolved
