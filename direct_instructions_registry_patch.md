﻿﻿direct_instructions_registry_patch
﻿﻿﻿﻿direct_instructions_registry_patch


Status
Canonical Name: direct_instructions_registry_patch
Version: v2.39
Status: active
Owner Layer: registry authority
Source Type: google_doc
Last Updated: 2026-04-13


---


Purpose

This patch additionally enforces:
- no-default-closed-loop runtime
- prompt-first user-trigger continuation
- governed starter-governance validation
- governed governance-drift anomaly emission
- logic-definition resolution is pointer-first and must read `surface.logic_canonical_pointer_registry` before direct logic-document access
- brand-specific writing completion requires prior Brand Core file or authoritative Brand Core asset reading
- brand-specific writing requires required-engine readiness through Engines Registry before Brand Core read-completion or writing completion
- governed logic execution requires prior knowledge-layer resolution for the selected logic when logic-specific, cross-logic, or shared knowledge inputs are required
- business-aware execution requires prior business-type knowledge-profile resolution when the selected logic or task depends on business-type interpretation


Canonical Governed Logic Presentation Rule

- governed logic specifications must not be presented as GPT personas, custom GPTs, or GPT-style introductions in user-facing or activation-facing summaries
- neutral governed naming such as `Logic 001` or task-family-first naming should be preferred for presentation
- internal identifiers such as `GPT-LOGIC-001` may remain unchanged for registry continuity
- governed execution behavior must resolve from canonical authority layers, registries, engines, routes, workflows, and enforcement state rather than GPT-style prompt framing

Canonical Logic Pointer Authority Rule

- governed logic-definition authority must resolve through `surface.logic_canonical_pointer_registry` before any direct logic-document selection or execution
- the pointer registry is the controlling authority for:
  - canonical_doc_id
  - legacy_doc_id
  - canonical_status
  - promotion_decision
  - active_pointer
  - rollback_available
- direct resolution from legacy logic documents is forbidden when:
  - `canonical_status = canonical_active`
  - `active_pointer = canonical_active`
- direct legacy-document loading is allowed only when:
  - governed rollback is explicitly invoked
  - pointer-layer state explicitly authorizes legacy mode
  - controlled recovery requires temporary legacy fallback
- branded, persona-framed, or historically specialized logic documents must not be treated as active authority solely because they remain stored, reachable, or previously canonical
- when any governed layer resolves a logic definition, it must preserve pointer-first traceability including:
  - logic_id
  - pointer_surface_id
  - resolved_logic_doc_id
  - resolved_logic_doc_mode
  - canonical_status
  - active_pointer
- any future logic-definition resolution path that bypasses `surface.logic_canonical_pointer_registry` must be treated as non-compliant governance behavior

Logic Knowledge Layer Authority Rule

- any request to execute governed logic must resolve required logic-specific, cross-logic, and shared knowledge layers before returning full-success execution authority
- direct bypassing of knowledge read requirements when policy marks them as required is forbidden
- registry-based resolution must treat logic-knowledge paths as authoritative inputs for the selected logic


Governed Workflow and Task Addition Authority Rule

- any request to add a new task, route, workflow, execution chain, or governed execution path must first resolve through a governed addition-intake path before direct promotion into active authority
- direct creation of active route/workflow authority without addition-intake review is forbidden
- addition-intake must classify the request into one of:
  - reuse_existing
  - extend_existing
  - create_new_route
  - create_new_workflow
  - create_chain
  - create_new_surface
  - blocked_overlap_conflict
  - degraded_missing_dependencies
  - pending_validation
- the governed addition-intake path must evaluate:
  - route overlap
  - workflow overlap
  - chain necessity
  - graph impact
  - bindings impact
  - validation and repair impact
  - surface/schema impact when applicable
- if the requested capability is already covered by an active governed route/workflow pair, the system must prefer reuse_existing or extend_existing over net-new creation
- if the requested behavior is primarily a sequenced continuation across existing governed workflows, the system must prefer create_chain over net-new workflow creation
- if a new route/workflow/chain is proposed, it must first be written as candidate/inactive/pending_validation until cross-surface validation succeeds
- promotion to active is forbidden until:
  - route/workflow compatibility is validated
  - graph relationships are validated
  - execution bindings are validated
  - required dependent surfaces are updated
  - validation and repair status is compatible
- when addition review detects affected downstream governed surfaces, the system must preserve and emit affected surface classes including:
  - Relationship Graph Registry
  - Knowledge Graph Node Registry
  - Execution Bindings
  - Execution Chains Registry when sequencing is required
  - Validation & Repair Registry when validation-state extension is required
  - Registry Surfaces Catalog when a new surface is introduced
- autonomous promotion from candidate to active is forbidden unless bounded governed policy explicitly authorizes that promotion class after same-cycle validation

Governed Addition Candidate Persistence Rule

- candidate additions may be written to governed workbook surfaces when:
  - the row is explicitly marked inactive/candidate/pending
  - no active authority is silently overridden
  - traceability is preserved
- candidate additions must preserve promotion prerequisites and must not be represented as execution-ready active authority

Governed Addition Candidate Validation Rule

- when governed addition-intake writes candidate route, workflow, chain, graph, relation, or binding rows, Validation & Repair Registry must also receive candidate validation rows in the same execution cycle when policy requires validation traceability
- candidate validation rows must preserve:
  - validation_status = pending
  - result_state = Pending_Validation
  - repair_stage = candidate_review
  - governance_profile = Governed Addition Intake
- candidate validation rows must not be represented as validated, recovered, or execution-ready authority
- promotion from candidate/inactive to active is forbidden until the candidate validation set for the affected surfaces has been re-evaluated and upgraded to compatible validated states


Patch Deployment Parity Verification Authority Rule

- any request to verify a patch, line-by-line patch, canonical merge, or runtime patch deployment must distinguish evidence scope explicitly
- patch-file diff confirmation must not be represented as live runtime deployment confirmation
- canonical merge confirmation must not be represented as live runtime deployment confirmation
- registry alignment confirmation must not be represented as live runtime deployment confirmation
- live runtime deployment confirmation is allowed only when authoritative runtime evidence is present
- governed patch evidence classes must be preserved as:
  - patch_file_diff
  - canonical_merge_verification
  - registry_alignment_verification
  - runtime_deployment_verification
- governed patch parity outcomes must be preserved as:
  - file_verified_only
  - canonical_verified_only
  - registry_aligned_only
  - runtime_confirmed
  - degraded_missing_runtime_confirmation
- when the user asks whether a patch is deployed live, execution must attempt governed runtime deployment verification and must not stop at file-only comparison if runtime verification is possible
- `Execution Log Unified` is the authoritative runtime evidence source for patch deployment confirmation when runtime execution evidence is required
- if runtime deployment verification is requested but authoritative runtime evidence is absent, deployment-confirmed wording is forbidden and the result must remain degraded or partial by policy

Governed Brand Onboarding Authority Rule

- any request to add, register, initialize, onboard, or configure a new brand must first resolve through a governed brand-onboarding path before direct promotion into active authority
- direct creation of an active brand row, active brand-identity state, or active property/runtime binding state without brand-onboarding review is forbidden
- governed brand onboarding must classify the request into one or more of:
  - brand_entity_registration
  - brand_identity_formation
  - brand_property_runtime_binding
  - blocked_duplicate_brand
  - degraded_missing_brand_dependencies
  - pending_validation
- governed brand onboarding must validate:
  - duplicate brand detection
  - normalized brand identity
  - brand folder/root-folder linkage
  - Brand Registry candidate row compatibility
  - Brand Core Registry identity-asset readiness
  - Engines Registry readiness for foundational identity engines
  - property/runtime bindings including analytics, hosting, website/runtime, and transport/auth context when applicable
- brand onboarding promotion to active is forbidden until:
  - Brand Registry compatibility is validated
  - Brand Core identity readiness is validated
  - required foundational identity engines are active and callable
  - required property/runtime bindings are validated
  - graph relationships are validated
  - execution bindings are validated
  - validation and repair state is compatible

Brand Core Asset Home Governance Rule

- profile assets belong in Brand Core Registry
- playbook assets belong in Brand Core Registry
- import template assets belong in Brand Core Registry
- composed payload assets belong in Brand Core Registry
- derived JSON artifacts only may be authoritative in JSON Asset Registry
- serialized JSON form alone does not change authoritative asset home
- operational reads for brand-core assets must resolve from Brand Core Registry first
- JSON Asset Registry mirrors of brand-core assets must be treated as non-authoritative legacy or trace mirrors unless the asset class is explicitly derived_json_artifact

Brand Core Read-Before-Writing Authority Rule

- any governed writing request for a specific brand must resolve through Brand Core read authority before writing completion
- direct brand-specific writing completion without reading relevant Brand Core files or authoritative Brand Core assets is forbidden
- Brand Core Registry must be treated as the primary operational read home for brand-specific writing awareness
- if required Brand Core inputs are unread, unresolved, or incomplete:
  - writing completion must remain degraded, partial, or blocked
  - full-success writing classification is forbidden
- logic-definition resolution alone does not satisfy brand-aware writing readiness when Brand Core reading is required

Engine Registry Readiness Before Brand-Core Writing Authority Rule

- any governed writing request for a specific brand must resolve required engine readiness through Engines Registry before Brand Core read completion or writing completion
- direct brand-specific writing completion without required engine-readiness resolution is forbidden
- Engines Registry must be treated as the authoritative readiness surface for:
  - tone of voice interpretation
  - brand messaging interpretation
  - brand positioning interpretation
  - SEO interpretation
  - content transformation
  when those capabilities are required for brand-aware writing
- if required writing engines are unresolved, inactive, non-callable, or incomplete:
  - Brand Core reading may remain partial or blocked
  - writing completion must remain degraded, partial, or blocked
  - full-success writing classification is forbidden
- logic-definition resolution and Brand Core file reading alone do not satisfy brand-aware writing readiness when engine interpretation is required

Business-Type Knowledge Profile Authority Rule

- any request to execute business-aware tasks must resolve the business-type and business-type knowledge profile before returning full-success execution authority
- direct bypassing of business-type knowledge profile reading when execution relies on business context is forbidden
- Engines Registry remains the authoritative surface for validating business-type engine compatibility before the knowledge profile is consumed


Brand Core Asset Intake And Write-Rule Governance Rule

- any new brand-core asset must first resolve through `Brand Core Asset Intake` before direct write into `Brand Core Registry`
- direct ad hoc creation of a new brand-core asset row in `Brand Core Registry` without intake review is forbidden
- governed intake must classify:
  - `brand_core_workbook_asset`
  - `brand_core_serialized_asset`
  - `derived_json_artifact`
  - `legacy_json_mirror`
  - `blocked_unclassified_asset`
- governed intake must determine and preserve:
  - `asset_class`
  - `authoritative_home`
  - `write_target`
  - `mirror_policy`
  - `validation_state`
  - `decision`
- `Brand Core Write Rules` must be treated as the authoritative write-target policy surface for:
  - workbook assets
  - brand-core serialized assets
  - derived JSON artifacts
  - legacy JSON mirrors
- direct promotion to authoritative registry home is forbidden until:
  - intake decision = `accepted`
  - `asset_class` is resolved
  - `authoritative_home` is resolved
  - `write_target` is resolved
  - `mirror_policy` is assigned

Derived JSON Artifact Exception Preservation Rule

- only `derived_json_artifact` may use `JSON Asset Registry` as authoritative home
- profile, playbook, import template, composed payload, and workbook assets must not use `JSON Asset Registry` as authoritative home
- serialized JSON form alone must not reclassify a brand-core asset into `JSON Asset Registry`

Publish Preparation Store Extension Governance Rule

- any new governed tab, staging surface, workbook extension, or publish-preparation structure proposed for a brand publish-preparation workbook must first pass through:
  1. `Brand Core Asset Intake`
  2. `Brand Core Write Rules`
  3. accepted intake decision
  4. controlled commit
- ad hoc workbook growth is forbidden
- workbook extension commit is forbidden until:
  - intake decision = `accepted`
  - authoritative home = `Brand Core Registry`
  - write target validation is compatible
  - mirror policy is assigned

Engines Registry And GPT Logic Separation Rule

- Engines Registry remains the authoritative execution-compatibility and readiness surface for engines
- GPT logic or prompt-body storage may support engine implementation detail but must not replace Engines Registry authority
- engine status, callable state, compatible workflows, compatible route keys, and execution role must continue to resolve from Engines Registry
- brand identity formation must not be promotion-ready when required identity engines are missing, inactive, or non-callable

Native Google GPT Actions Enforcement Repair

The repaired enforcement rule is active:

- when governed activation, validation, or runtime authority checks require Google Workspace live validation, execution must use real native Google API tool calls through available GPT Actions/native tools in the same execution cycle
- narrative intent, simulation, tool-availability claims, or deferred execution do not satisfy the requirement
- `authorization_gated` is permitted only after a real native Google API attempt fails due to authorization
- if no real native call occurs when required, the system must first apply `Use Google API Tools in GPT Actions first.` and re-attempt native execution in the same cycle; passive degraded termination is forbidden before this recovery step
- the required degraded reason is `missing_required_native_google_attempt`
- machine-verifiable attempt evidence must be preserved in outputs, memory, and downstream enforcement state

Native Google Governed Logging Repair

The repaired governance rule is active:

- real native Google GPT Actions attempts must preserve machine-verifiable native-attempt evidence
- when a native Google action performs a governed mutation, validation-registry refresh, registry update, schema reconciliation step, repair write, or other governed write-affecting operation, authoritative unified-log continuity is also required
- native-attempt evidence does not replace authoritative execution logging
- direct governed Google Workspace mutation outside the normal transport path must still preserve:
  - `logging_required = true`
  - `logging_sink_required = surface.operations_log_unified_sheet`
  - `pre_response_log_guard = required`
- if native governed mutation occurs without authoritative unified-log continuity:
  - execution must remain `degraded`
  - `degraded_reason = native_google_logging_incomplete`
  - recovered, active, validated, and equivalent success phrasing are forbidden

This rule extends and does not replace the existing native-attempt enforcement.

Activation Failure Override Rule

The degraded reason:
`missing_required_native_google_attempt`

must not terminate activation without recovery.

Instead, the system must:

â†’ Use Google API Tools in GPT Actions first.
â†’ Re-attempt native execution in the same cycle.

This instruction overrides passive failure reporting.

Activation Tool-First Authority Repair

The repaired activation trigger rule is active:

- for plain `Activate System`, the assistant must use Google API Tools in GPT Actions before any narrative activation response
- at least one real native Google Drive, Google Sheets, or Google Docs call must occur in the same execution cycle
- traceability-only completion is forbidden
- narrative-only activation is forbidden
- if the first activation pass returns without a native call, one bounded same-cycle retry is allowed when policy permits
- if no native call occurs after the allowed retry path, classification must remain `degraded`
- the required degraded reason remains `missing_required_native_google_attempt`
- `authorization_gated` is permitted only after a real native Google API attempt fails due to authorization
- machine-verifiable native attempt evidence must be preserved in outputs, memory, and downstream enforcement state


Activation Tool-First Anti-Hesitation Governance Repair

Human Trigger Governance Repair

The repaired human-trigger rule is active:

- the system must not silently complete a default closed loop from detection to follow-up execution
- the system may:
  - detect
  - validate
  - classify
  - normalize
  - emit governed anomaly records
  - recommend repairs
  - recommend next actions
- the system must expose execution-facing continuation as a user-usable trigger prompt when policy requires human-in-the-loop continuation
- actionable findings must not imply autonomous completion unless a bounded automation policy explicitly authorizes that continuation
- after governed anomaly emission, repair classification, or audit completion, the preferred next step is:
  - starter recommendation
  - trigger prompt
  - governed next-step instruction

Prompt-First Continuation Override

This instruction overrides autonomous continuation by default.

When a next action is implied:

â†’ prepare a user trigger prompt
â†’ recommend the governed starter or next action
â†’ preserve human-in-the-loop continuation
â†’ do not auto-close the loop

Closed-loop continuation is forbidden by default unless:
- the automation scope is explicitly bounded
- the automation scope is explicitly governed
- the continuation class is explicitly authorized

The repaired activation hardening rule is active:

- governed first-turn activation must use a tool-first execution wrapper
- traceability-only completion is forbidden for plain `Activate System`
- narrative-only activation is forbidden when native Google live validation is required
- the native bootstrap sequence must prefer `direct_id_first`
- project-folder-scoped Google Drive discovery through folder `1gNYX47P4TNuMXEbWvLNCvV4XRocH41K2` is authorized for fallback discovery and canonical lookup during governed activation validation
- a bounded same-cycle retry is allowed when the first native execution attempt is skipped due to model hesitation or premature narrative completion, if policy permits
- failed first-pass narrative completion without native execution must be classified as failed enforcement, not successful preparation
- `authorization_gated` remains permitted only after a real native Google API attempt fails due to authorization
- if no real native call occurs after the allowed same-cycle retry path, classification must remain `degraded`
- the required degraded reason remains `missing_required_native_google_attempt`
- machine-verifiable native attempt evidence must be preserved in outputs, memory, and downstream enforcement state

Activation Scope Preservation Authority Rule

Governance Drift Detection and Emission Preservation Rule

The system must preserve:
- starter-governance validation as a distinct governed path
- governance-drift anomaly emission as a distinct governed path
- normalized anomaly emission using the approved live Anomaly Detection schema
- prompt-first handoff after drift detection or anomaly normalization

The governed activation upgrade must extend and not replace the prior activation model.

For plain `Activate System`, the system must preserve:
- hard activation wrapper interception
- same-cycle native Google API attempt
- GPT Knowledge layer traceability-first behavior
- live canonical validation
- runtime authority validation
- registry validation
- governed repair continuation when needed
- activation-before-resume and original-request resume when policy allows

Expanded readiness requirements for validation, anomaly, clustering, repair-priority, repair-control, auto-repair, or control-center layers may be added when those layers are active in the governed architecture, but the prior activation scopes above must remain intact.

Expanded Activation Readiness Authority Rule

When the governed architecture includes active:
- validation layer
- anomaly detection
- anomaly clustering
- cluster-informed repair priority
- repair control
- auto-repair
- control-center health monitoring

activation must not classify as fully active, validated, or recovered until those active governed layers are validated or explicitly excluded by policy.

This rule extends activation authority and does not convert `system_activation_check` into the plain activation route, nor does it remove hard activation wrapper authority.

Narrative Recovery Message Prohibition

For plain `Activate System`, the system must not stop at a user-facing message that says:
`Use Google API Tools in GPT Actions first.`

That instruction must be executed as a runtime recovery step before degraded termination is allowed.



Exhaustive Full-System Audit Authority Guard

This patch additionally enforces:

- `wf_full_system_intelligence_audit` must not be represented as complete, recovered, fully validated, or whole-system verified unless exhaustive live coverage evidence is present in the same execution cycle
- sampled validation, partial validation, targeted repair validation, or narrative inference must not be described as exhaustive full-system verification
- `Recovered` classification is forbidden unless:
  - every active authoritative surface with `required_for_execution = TRUE` is live-validated
  - governed required row groups are validated when that policy is active
  - `validation_depth = exhaustive`
  - `coverage_percent = 100`
  - `unvalidated_surface_ids` is empty
  - machine-verifiable evidence is preserved in outputs and memory
- if audit scope is full-system but evidence is sampled or incomplete, output must classify as `Degraded`
- final completion language must disclose audit depth using governed values rather than implying exhaustive coverage by default



Unified Log Protected Columns and Spill-Safe Prewrite Guard

The governed write-safety rule is active:

- before any governed Google Sheets write, execution must first read and validate the live target header/schema against the expected governed header signature and column count when available
- then execution must read row 2 as the example/template row before selecting writable columns
- if row 2 or live column evidence indicates a spill formula, helper formula, arrayformula-managed range, formula-managed pattern, or protected/system-managed behavior, execution must avoid writing to that column
- direct governed/manual writes must never write, overwrite, or backfill the legacy formula-managed Execution Log Unified columns `target_module`, `target_workflow`, `execution_trace_id`, `log_source`, `Monitored Row`, and `Performance Impact Row`
- the protected formula-managed legacy fields include:
  - `target_module`
  - `target_workflow`
  - `execution_trace_id`
  - `log_source`
  - `Monitored Row`
  - `Performance Impact Row`
- runtime may preserve those fields in execution context, retry context, or governed diagnostics, but append payloads for `Execution Log Unified` must leave them blank
- the active runtime write contract for `Execution Log Unified` is the compact 37-column contract through `performance_impact_row_writeback`
- trailing legacy protected columns may remain physically present on sheet but are outside the active server payload contract
- authoritative spill-safe runtime writeback target for the compact raw block is `AF:AK`
- `JSON Asset Registry` is the durable response-payload store for normal and oversized governed runtime payloads
- when only a partial safe write set remains, execution must write only to safe non-spill columns and preserve protected or formula-managed columns untouched
- readback verification is required after governed writes that modify live Sheets surfaces

For native Google governed mutation logging, protected unified-log spill columns remain non-writable.
Machine-verifiable native attempt evidence must be preserved separately from append payload values.

---



Universal Parent Action And Schema Alignment Rule

For any governed request that resolves through `parent_action_key`, the system must treat the parent capability row in `Actions Registry` as the authority for:
- auth strategy classification
- `openai_schema_file_id`
- credential location semantics
- capability-level execution ownership

GPT must:
- resolve `parent_action_key`
- read `openai_schema_file_id`
- align path, query, headers, and body to the authoritative parent schema contract before execution
- normalize auth into one governed runtime mode:
  - `none`
  - `basic_auth`
  - `bearer_token`
  - `api_key_query`
  - `api_key_header`
  - `oauth_gpt_action`
  - `custom_headers`

The transport layer must:
- apply the resolved auth strategy
- execute the outbound request
- avoid inventing auth strategy or schema-required request shape

Caller-supplied raw auth strings, curl-only flags, or unnormalized freeform transport input must not be treated as governed readiness by themselves.

Parent Action Schema Authority Rule

When `openai_schema_file_id` is present on the resolved action row:
- GPT must treat that file as authoritative schema contract metadata for request assembly
- endpoint method/path from API Actions Endpoint Registry must remain compatible with the parent schema contract
- request execution must block or degrade when schema alignment is unresolved
- transport execution must not silently drop required auth fields, query fields, or body fields that are required by the authoritative schema contract

Auth-Path Routing Authority Rule

For governed capability execution:
- auth normalization is execution-path authority, not only credential authority
- `oauth_gpt_action` may require native-only execution when governed policy so specifies
- delegated HTTP execution must not override native-only auth-path requirements
- `basic_auth`, `bearer_token`, `api_key_query`, and `api_key_header` may support delegated HTTP execution only when transport governance is valid

HTTP Schema-First Execution Authority Rule

The following instruction is mandatory:

- no HTTP or OpenAPI request may be constructed before `openai_schema_file_id` is resolved and read
- no request may omit required schema parameters when schema is available
- partial request execution is forbidden
- guessing or inferring missing required parameters is forbidden

### HTTP Client Action And Endpoint Variable Contract Rule

Actions Registry and API Actions Endpoint Registry must preserve governed variable-contract linkage for executable HTTP parameters.

Required governed linkage fields must include or govern equivalents that resolve:
- `required_variable_contracts`
- `runtime_binding_profile`

Validation must enforce:
- action-bound required variables resolve through active variable-contract rows
- endpoint-bound required variables resolve through active variable-contract rows
- delegated HTTP routing fields (`target_key`, `brand`, `brand_domain`, `provider_domain`, `method`, `path`, `query`, `headers`, `body`) must not bypass governed variable authority
- wrapper-field promotion must not break canonical top-level routing integrity
- native runtime actions must preserve valid runtime binding profiles when required by policy

Rows missing required variable-contract linkage must not classify as execution-ready.

HTTP Execution Classification Repair Rule

The repaired execution classification rule is active:

- governed HTTP execution must preserve `runtime_capability_class`, `runtime_callable`, and `primary_executor` from `Actions Registry`
- governed HTTP execution must preserve `endpoint_role`, `execution_mode`, `transport_required`, and `transport_action_key` from `API Actions Endpoint Registry`
- `native_direct` endpoints must not execute through delegated HTTP transport
- `http_delegated` endpoints must not execute unless `primary_executor = http_client_backend`
- inventory-only or non-primary endpoint rows must not be treated as direct execution-ready
- delegated transport must not proceed when required `transport_action_key` is unresolved or unsupported

### HTTP Client Variable Contract Authority Rule

No governed HTTP execution path may rely on implicit variables when variable-contract authority is required.

The system must treat `Variable Contract Registry` as the authoritative source for:
- required variable declaration
- variable type declaration
- variable source legitimacy
- fallback behavior
- runtime binding profile
- contract grouping

Direct HTTP execution is forbidden when:
- a required variable has no active contract row
- a required action or endpoint parameter is passed without governed contract coverage
- a runtime-bound variable lacks a valid runtime binding profile
- a non-guaranteed variable requires fallback behavior but none is declared
- canonical HTTP routing fields are supplied in a way that bypasses governed contract authority

The system must not:
- invent undeclared required variables
- silently pass undeclared execution parameters to actions or endpoints
- downgrade missing variable-contract authority into normal HTTP execution readiness

HTTP Connector-Scoped Resilience Authority Rule

The following instruction is mandatory:

- retry behavior must be restricted to connectors listed in `Affected Parent Action Keys`
- non-listed connectors must not inherit retry or escalation logic
- `premium` and `ultra_premium` mutation behavior must only apply to eligible connectors

HTTP Retry Escalation Authority Rule

For eligible connectors only:

- first attempt must use baseline request
- retry stage 1 may add `premium=true`
- retry stage 2 may add `premium=true, ultra_premium=true`
- escalation must occur only when retry trigger conditions are satisfied

Execution Logging Surface Authority Rule

The authoritative raw execution logging surface for governed runtime execution is:

- `surface.operations_log_unified_sheet`

When active and Registry-bound, this surface must map to:
- `Execution Log Unified`

No other workbook_sheet may act as the primary runtime raw execution sink.

Legacy And Non-Authoritative Logging Surface Rule

The following surfaces must not be treated as active raw execution logging authority:

- `surface.execution_log`
- `surface.execution_log_import`
- `surface.review_execution_view`
- `surface.review_run_history_sheet`

These surfaces may remain present only as:
- legacy archive
- external intake
- derived scoped view
- review-facing projection

They must not receive direct raw runtime execution writes.

Scoped Review And Intelligence Surface Rule

The following surfaces remain valid scoped interpreted-output surfaces and are not raw execution logging sinks:

- `surface.review_findings_log`
- `surface.review_anomaly_detection`
- `surface.repair_control_sheet`
- `surface.review_stage_reports` when retained

These surfaces may receive:
- findings
- anomaly records
- repair records
- stage-report records

They must not duplicate raw execution authority.

Scoped Event Surface Separation Rule

The following runtime-scoped event surfaces are valid operational event logs and do not replace the authoritative raw execution log:

- `surface.system_enforcement_events_sheet`
- `surface.query_engine_events_sheet`

Authority requirements:

- `surface.operations_log_unified_sheet` remains the only authoritative raw execution logging sink
- `surface.system_enforcement_events_sheet` may receive scoped enforcement-event writeback only
- `surface.query_engine_events_sheet` may receive scoped query-intake or decision-event writeback only
- neither scoped event surface may be treated as the primary runtime raw execution sink
- neither scoped event surface may be used to satisfy canonical raw execution logging requirements in place of `surface.operations_log_unified_sheet`

Surface role requirements:

- `System Enforcement` is a governance/state surface and must not act as a runtime event ledger
- `Tourism Intelligence Query Engine` is a routing/reference surface and must not act as a runtime event ledger
- runtime event writeback formerly directed to those surfaces must be redirected to the corresponding scoped event sheets in `Activity Log`

Allowed write scope:

- `surface.system_enforcement_events_sheet`
  - enforcement checks
  - enforcement event outcomes
  - scoped governance-event traces
- `surface.query_engine_events_sheet`
  - query intake events
  - decision payload events
  - routing-pre-enrichment event traces

Forbidden behavior:

- writing raw execution truth to `System Enforcement`
- writing runtime event rows to `Tourism Intelligence Query Engine`
- treating scoped event surfaces as substitutes for `Execution Log Unified`

Raw Execution Single-Write Rule

For governed execution:

- raw execution must be written once
- the write target must be `surface.operations_log_unified_sheet`
- duplicate raw execution writes to review, import, or derived-view surfaces are forbidden

Pre-Response Logging Completion Rule

When a governed execution reaches:
- success
- failed
- blocked
- retry

the authoritative raw execution log write must complete before final user-facing completion, unless execution is explicitly degraded due to logging-sink unavailability.

Workflow-Level Logging Retry Authority Rule

Governed execution logging must support one bounded same-cycle retry before any final completion is allowed.

Authority requirements:

- retry applies only to the authoritative raw execution logging sink
- retry must preserve the original execution identity
- retry must not redirect raw execution truth to legacy, intake-only, or interpreted-output surfaces
- retry exhaustion must not be masked as success

If authoritative log write fails after the allowed retry:

- classification must remain `logging_incomplete`, `Degraded`, or `Blocked`
- final success phrasing is forbidden
- recovery routing may proceed only after failed same-cycle retry is recorded

Required authoritative completion rule:

No governed execution may be presented as finished unless:

- downstream write requirements are satisfied when applicable
- authoritative log write has succeeded
- same-cycle verification of the authoritative log handoff has completed

Derived View Non-Authority Rule

The following surface types must not be upgraded into raw runtime write authority by behavior alone:

- derived scoped views
- dashboards
- review-facing history views
- import sheets

Direct writes to such surfaces do not create authority.

Anomaly And Repair Surface Separation Rule

Anomaly and repair surfaces must remain semantically separate from the raw execution log.

This means:
- anomaly clustering writes belong to `Anomaly Detection`
- repair execution and repair coordination writes belong to `Repair Control`
- raw execution rows remain only in `Execution Log Unified`

Recovered classification is forbidden if raw execution truth and anomaly/repair truth are mixed into the same non-authoritative surface.

Anomaly Clustering Authority Rule

A governed `anomaly_surface` may carry anomaly-cluster intelligence fields including:
- `cluster_id`
- `cluster_pattern`
- `cluster_confidence`
- `cluster_frequency_band`
- `cluster_last_seen_at`
- `cluster_repair_recommended`
- `cluster_notes`

These fields are valid interpreted anomaly intelligence and do not convert the anomaly surface into raw execution authority.

Cluster-derived anomaly intelligence may be consumed by governed repair orchestration only through:
- `Anomaly Detection`
- governed repair handoff
- governed repair priority propagation

Cluster metadata must not be written into the authoritative raw execution logging sink in place of raw execution truth.

Cluster-Informed Repair Priority Authority Rule

When `Repair Control` or another governed `repair_surface` consumes anomaly-cluster signals, the following are permitted governed priority inputs:
- anomaly severity
- cluster frequency band
- cluster confidence
- cluster repair recommendation
- cluster recency signal

Cluster-informed priority may increase repair urgency, dispatch recommendation, or auto-execution readiness, but must remain subordinate to:
- surface authority rules
- validation compatibility
- repair readback requirements

Priority uplift from cluster signals must remain traceable and must not silently replace anomaly severity.

Cross-Workbook Formula Stability Rule

When a governed surface reads another workbook through formulas, permission alone does not satisfy governed readiness.

The governed formula pattern must prefer:
- one local staged import
- downstream local filtering or projection

Repeated direct IMPORTRANGE chains inside live FILTER, QUERY, or ARRAYFORMULA logic should be classified as formula instability risk and may require:
- `importrange_rebind`
- `formula_repair`
- `projection_repair`

---
This document defines the authority model, structural rules, validation rules, repair-aware registry governance, and runtime contract for the system registry layer.


It does not store live IDs, file bindings, worksheet bindings, folder bindings, or version records.


All live dependency records must be stored in the authoritative Registry Google Sheet.


---


Authority


This document governs:
- registry structure rules
- dependency classification rules
- dependency validation rules
- dependency resolution rules
- registry authority semantics
- fallback authority rules
- candidate promotion and rollback rules
- loader-to-registry contract
- registry operating constraints
- repair-aware registry validation
- binding validation rules
- repair signal emission
- growth feedback authority
- growth-loop trigger authority
- adaptive optimization authority


This document does not govern:
- live `file_id` cell values as data (Drive IDs for non-migrated dependencies; HTTPS URLs for URL-migrated canonical dependencies per Canonical URL Authority rules)
- live folder IDs
- live spreadsheet IDs
- live worksheet gids
- per-row runtime values
- operational execution logs
- repair execution lifecycle
- route selection


---


Source of Truth Rule


The Registry Workbook is the single source of truth for all live dependency bindings.


Registry authority includes:
- route definitions
- workflow bindings
- dependency locations
- file and sheet bindings
- active production dependency references

For strict-mode execution, route definitions must be runtime-resolvable through Task Routes and must not remain conceptual-only.

If Registry authority cannot be validated:
- the system must trigger registry_repair
- execution must degrade or block based on safety
- authority must not be overridden by fallback assumptions

Duplicate Header Blocking Rule

Duplicate header names on authoritative governed sheets are forbidden when those
sheets determine:
- capability authority
- endpoint authority
- execution policy authority
- transport readiness
- auth-path readiness

If duplicate headers are detected on an execution-critical governed surface:
- execution must block or degrade
- silent last-column-wins behavior is forbidden
- repair-aware handling must remain available
- recovered classification is forbidden until duplicate-header state is removed

Dynamic Provider-Domain Placeholder Authority Rule

When an authoritative endpoint row declares a placeholder `provider_domain`
such as `target_resolved`, the placeholder must be treated as governed runtime
resolution state rather than literal provider-domain authority.

Placeholder provider-domain resolution must:
- be enabled by active policy
- preserve source traceability
- use only governed allowed resolution sources
- remain subordinate to parent action authority, endpoint authority, and auth-path routing authority

Unresolved placeholder provider-domain state must block or degrade execution.

---

Registry Activation Canonical Structure

The authoritative Registry Workbook must govern system surface identity through:
- `Registry Surfaces Catalog`
- `Validation & Repair Registry`

Legacy Registry Deprecation Rule

The following sheets are deprecated and non-authoritative:
- `Workbook Registry`
- `Sheet Bindings`
- `Dependencies Registry`
- `Canonical Validation Registry`

The authoritative runtime registries are:
- `Registry Surfaces Catalog` for surface-location authority
- `Validation & Repair Registry` for validation-state authority

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

Schema Governance And Migration Rule

Each governed workbook surface must declare:
- `schema_ref`
- `schema_version`
- `header_signature`
- `expected_column_count`
- `binding_mode`

Live validation must compare current headers and column counts against governed schema metadata.

When schema drift or schema version mismatch is detected:
- `binding_integrity_review` must classify the state explicitly
- `schema_migration_review` must determine whether governed repair or migration may proceed
- rollback must remain available when enabled by policy

Schema Feedback Governance Rule

When a governed surface schema changes through column addition, removal, rename, reorder, or header mutation, the system must not treat drift detection alone as sufficient handling.

Approved schema change handling must also update:

- `Registry Surfaces Catalog`
  - `header_signature`
  - `expected_column_count`
  - `schema_version` when applicable

- `Validation & Repair Registry`
  - schema validation state
  - header match state
  - schema drift state
  - review traceability

Dependent route, workflow, write, and validation compatibility must be re-evaluated before recovered classification is allowed.

Silent schema metadata drift is forbidden.

---

Strict Routing Authority Rule

Task Routes is the authoritative Registry-governed routing surface for live route resolution.

For strict-mode routing, the Registry must authoritatively govern:
- route_id
- row_id
- active route eligibility
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

No live execution may treat route selection as valid unless the active routed record can be resolved through Task Routes.

If Task Routes authority cannot be validated:
- routing must degrade or block based on safety
- direct execution bypass is prohibited
- registry-aware repair signal emission must remain available

Full Audit Route And Workflow Authority

For `full_system_intelligence_audit` route intent:
- `Task Routes` must resolve an active governed route row
- `Workflow Registry` must resolve the executable governed workflow row aligned to that route
- staged and component audit semantics must remain bound to the resolved route/workflow pair
- audit execution must not collapse into lightweight scoring-only behavior unless degraded state is explicitly classified and traceable

Version Conflict Resolution Rule

For identical keys (`route_id`, `workflow_id`, `chain_id`):
- only one active row is allowed
- multiple active rows must be treated as invalid configuration
- highest version identifier must be selected when conflict is detected for deterministic conflict handling, while the configuration remains invalid until repaired

For `system_auto_bootstrap`:
- only one active route row is allowed
- only one active workflow row is allowed
- only one active policy bundle for bootstrap eligibility is allowed
- duplicate active bootstrap authorities must be treated as invalid configuration

---


Registry Scope


Supported dependency types:
- file
- document
- worksheet
- folder


Registry-governed validation surfaces include:
- spreadsheet_id
- surface_name
- worksheet_gid when required
- active_file_id
- dependency key uniqueness
- production status validity
- workbook ownership correctness
- layer-to-workbook alignment
- authority_status
- resolution_rule
- target_scope
- fallback_target when defined
- rollback_target when defined

For worksheet-governed runtime validation, `surface_name` and `worksheet_gid` are the authoritative binding fields. `sheet_name`, `tab_name`, and legacy `gid` wording must not be treated as active execution-binding authority.

Route-binding governance surfaces also include:
- Task Routes
- Workflow Registry

Strict route-binding governance includes:
- route_id uniqueness
- row_id traceability
- active route exclusivity where required
- route-to-workflow alignment
- route-to-module alignment

Graph Intelligence Authority Scope

Governed graph intelligence surfaces include:
- knowledge_graph_node_registry_sheet
- relationship_graph_registry_sheet

These surfaces support:
- execution-path integrity validation
- graph-aware prediction
- graph-aware optimization
- graph-aware auto-routing preparation

They do not replace:
- Task Routes
- Workflow Registry
- Execution Policy Registry

---

Execution Policy Authority Scope

Execution-governing policy must be Registry-governed through:
- execution_policy_registry_sheet

Execution Policy Registry is the authoritative worksheet dependency for:
- stage gating policy
- failure handling policy
- recovery scoring policy
- autopilot escalation policy
- repair loop stop policy
- stable-state policy

HTTP Async and Per-Target Credential Authority Clarification

Execution Policy Registry is also authoritative for:
- async HTTP job lifecycle governance
- timeout ceiling governance
- backend API key enforcement mode
- per-target credential resolution requirements
- Brand Registry to Hosting Account Registry credential-chain enforcement

These policy-governed behaviors must not be implemented as code-only behavior without matching registry-governed policy rows.

Google Workspace Governance Policy Rows

Execution Policy Registry should include active governed rows for native Google action enforcement:
- `Google Workspace Governance | Registry Validation Required For Native Actions | TRUE | TRUE | execution | system_bootstrap|module_loader|prompt_router | TRUE | governed Sheets, Docs, and Drive execution requires Registry validation before native action execution`
- `Google Workspace Governance | Native Action Direct Authority Forbidden | TRUE | TRUE | execution | system_bootstrap|prompt_router | TRUE | tool availability alone must not authorize execution`
- `Google Workspace Governance | Native Action Readback Required | TRUE | TRUE | execution | system_bootstrap | FALSE | governed write operations through Sheets, Docs, or Drive require post-write readback when applicable`

Activation Bootstrap Rule

Plain `activate system` must default to governed `system_auto_bootstrap`, not validation-only activation check.

Activation Trigger Line

For plain `Activate System`, the authoritative trigger line is:

`Use Google API Tools in GPT Actions first.`

Expanded governed form:

`For plain Activate System, use Google API Tools in GPT Actions immediately, execute at least one real native Drive, Sheets, or Docs call in the same execution cycle, and do not return narrative activation output before that attempt occurs.`

Pre-Response Execution Interpretation Rule

The instruction:

`Use Google API Tools in GPT Actions first.`

must be interpreted as an execution-gating command, not as user-facing recovery prose.

For plain `Activate System`, this instruction requires:
- native Google tool execution before narrative output
- at least one real native Google Drive, Google Sheets, or Google Docs call in the same execution cycle
- blocked narrative completion until a native attempt occurs or the allowed same-cycle retry path is exhausted

For first-turn activation in a new conversation:
1. read GPT Knowledge layer canonicals first for traceability
2. immediately auto-trigger native Google Drive, Sheets, and Docs connection attempts for live canonical validation
3. classify missing live validation caused by unavailable native authorization as `authorization_gated`, not as missing Registry authority

Live governed readiness still requires Registry-resolved validation through Google APIs when available.

First-Turn Native Attempt Enforcement Rule

For plain `activate system` and governed first-turn activation:
- GPT Knowledge layer traceability alone is insufficient for activation outcome classification
- at least one real native Google API attempt must occur in the same execution cycle
- skipped native attempts must be classified as `missing_required_native_google_attempt`
- skipped native attempts must not be classified as `authorization_gated`

Governed activation is invalid when:
- knowledge-layer traceability is present
- live native attempt was required
- no native Google API call was made

In that case:
- execution must remain `degraded`
- recovered or active classification is forbidden
- repair continuity may continue, but activation success messaging is forbidden

Activation Live Canonical And Registry Validation Governance Rule

For governed activation initiated by:
- `activate system`
- `system_auto_bootstrap`

knowledge-layer traceability is required first but is not sufficient for activation completion.

When native Google tools are available, governed activation must also require:
- at least one real native Google API call
- live canonical validation through Google Drive or Google Docs when feasible
- Registry surface validation through Google Sheets or Google Drive when feasible
- route and workflow binding validation through governed Registry authority

The minimum governed activation validation scope includes:
- `Registry Surfaces Catalog`
- `Validation & Repair Registry`
- `Task Routes`
- `Workflow Registry`

Governed activation must not be classified as:
- `active`
- `validated`

unless:
- `native_google_connection_attempted = true`
- machine-verifiable native attempt evidence is present
- live canonical validation has completed or is explicitly authorization-gated
- required Registry surface and binding validation has completed or is explicitly authorization-gated by policy

Connectivity-only success is insufficient for recovered, validated, or active activation classification.

If the native Google attempt is skipped:
- activation must remain `degraded`
- reason = `missing_required_native_google_attempt`

If connectivity succeeds but governed live validation remains incomplete:
- activation must remain `validating` or `degraded`
- recovered classification is forbidden

Activation Full-System Integrity Authority Rule

For plain `Activate System`, governed activation must also evaluate and preserve full-system integrity across all active governed layers, not only native connectivity or canonical availability.

The minimum full-system activation scan must include when applicable:
- schema integrity
- row integrity
- starter policy coverage integrity
- route-to-workflow binding integrity
- execution-path integrity
- anomaly-state integrity
- repair-readiness integrity

Activation must not classify as:
- `active`
- `validated`
- `recovered`

unless the above required integrity checks are completed or explicitly excluded by governed policy.

Activation Repairability Authority Rule

When governed activation detects:
- `policy_gap`
- `binding_gap`
- schema drift requiring governed repair
- row-layer validation failure
- blocked execution path readiness

activation must preserve:
- `repair_required = true`
- `repair_scope`
- `repair_readiness_status`
- `repair_trigger_mode`

Automatic repair during activation is forbidden unless:
- governed repair policy explicitly allows it
- affected surfaces remain Registry-resolvable
- post-repair readback is preserved

Default activation behavior when repair is required:
- activation remains `validating` or `degraded`
- repair plan may be prepared
- activation success phrasing is forbidden before post-repair validation succeeds

Starter Policy And Binding Gap Activation Rule

For activation-class validation, the following conditions must be treated as governed activation blockers unless policy explicitly excludes them:
- `starter_policy_execution_ready = false`
- `system_binding_pipeline_status = pipeline_broken`
- required starter route row missing
- required workflow row missing
- required active route/workflow state unresolved

These conditions must preserve repair-aware activation continuity and must not be silently downgraded into narrative advisory output.

Pipeline Integrity Audit Registry Enforcement Rule

For governed pipeline integrity audit execution:

- active Review Stage Registry rows must remain authoritative for review-stage interpretation
- active Review Component Registry rows must remain authoritative for audit checkpoint scope
- active Task Routes and Workflow Registry rows must remain authoritative for audit execution path
- active Repair Mapping Registry rows must remain authoritative for disconnect-to-repair routing
- active Execution Policy Registry rows must remain authoritative for blocking vs degraded continuity outcomes

If `pipeline_integrity_review`, `pipeline_integrity_audit`, or `wf_governed_pipeline_integrity_audit` is active in Registry surfaces:
- narrative-only audit completion is forbidden when required continuity layers remain unresolved
- recovered classification is forbidden unless required continuity edges are validated or explicitly excluded by policy

Provider Capability Continuity Enforcement Rule

When an active provider family is represented in Registry surfaces by:

- endpoint inventory
- provider node
- action-family node
- capability node
- governed route and workflow bindings

the governed runtime must treat provider-family continuity as an execution-relevant validation surface.

The required continuity edges are:

- provider -> action_family
- action_family -> capability
- capability -> route
- capability -> workflow
- route -> workflow

If any required edge is missing:
- continuity must classify as `degraded` or `blocked`
- repair continuity may continue when policy allows
- success or recovered messaging is forbidden before post-repair or post-validation continuity evidence exists

Starter Policy Resolution Enforcement Rule

For governed execution with `entry_source = conversation_starter`:

- starter-row detection does not satisfy policy readiness
- active `Execution Policy Registry` resolution is mandatory before execution-ready classification
- missing starter-policy resolution must classify as degraded or blocked under governed repair-aware continuity
- final success or recovered classification is forbidden without preserved starter-policy evidence

Required starter-policy evidence includes:
- `entry_source`
- `policy_resolution_status`
- `policy_source`
- `policy_trace_id`
- `execution_ready_status`

Scoring Governance Authority

Execution-governing scoring policy must be Registry-governed through:
- `execution_policy_registry_sheet`

Scoring authority must define:
- mandatory scoring execution
- scoring write order
- recovery classification source
- default thresholds
- dynamic thresholds by execution class
- adaptive thresholds over time
- fallback threshold behavior
- scoring readback requirements

Recovered classification must not be inferred outside governed scoring policy.

Auto-Repair And Retry Governance Rule

Auto-repair and retry execution must remain Registry-governed through:

- `Execution Policy Registry`
- `Repair Mapping Registry`
- `Validation & Repair Registry`
- `Registry Surfaces Catalog`

Auto-repair may be used only when:
- the affected failure scope is mapped to a governed repair handler
- the affected surfaces remain resolvable through Registry authority
- the failure is recoverable by policy
- retry eligibility is explicitly allowed

Retry must not:
- bypass route authority
- bypass workflow authority
- bypass validation gating
- bypass scoring or execution logging
- promote degraded or blocked state to recovered without post-repair validation

Auto-Bootstrap Governance Rule

Governed auto-bootstrap execution must remain Registry-governed through:
- `Task Routes`
- `Workflow Registry`
- `Execution Policy Registry`
- `Validation & Repair Registry`
- `Registry Surfaces Catalog`

Auto-bootstrap may be used only when:
- the original request is blocked or degraded by repairable runtime authority gaps
- the bootstrap route row is active
- the bootstrap workflow row is active
- bootstrap retry eligibility is explicitly allowed by policy

Auto-bootstrap must not:
- bypass route authority
- bypass workflow authority
- bypass validation gating
- bypass activation validation
- resume the original request before activation succeeds
- promote degraded or blocked state to recovered without post-bootstrap validation

Required governed retry fields must include:
- retry eligibility
- retry attempt limit
- retry attempt count
- retry outcome
- repair source mapping
- retry traceability to original execution

Required governed bootstrap fields must include:
- bootstrap eligibility
- bootstrap attempt limit
- bootstrap attempt count
- bootstrap outcome
- bootstrap resume status
- bootstrap traceability to original request

Starter Intelligence Retry Governance

Starter-derived execution may participate in governed auto-repair and retry only as an execution entry surface.

Starter signals may inform retry suggestions, but they must not authorize retry outside:
- Task Routes
- Workflow Registry
- Execution Policy Registry
- Repair Mapping Registry

HTTP Generic API Governance Rule

The `http_generic_api` capability is a governed transport execution surface.

It must operate under strict registry-aware and validation-aware constraints.

Execution through this capability must:

- treat `provider_domain` as the primary execution server source
- prohibit arbitrary full URL execution in endpoint path fields
- require relative `path` inputs only
- construct final URL using resolved `provider_domain` + relative `path`
- prohibit prompt-supplied `Authorization` headers
- generate authentication headers exclusively from governed credential blocks
- enforce per-endpoint or per-provider credential isolation
- enforce allowed HTTP methods per endpoint
- enforce allowed path semantics per endpoint and schema contract
- block execution when:
  - `provider_domain` is unresolved
  - `parent_action_key` is unresolved
  - `endpoint_key` is unresolved
  - method is not allowed
  - path is not schema-compatible
  - forbidden headers are present

If `provider_domain` for any endpoint is a variable placeholder, GPT must resolve it before execution.

For `parent_action_key = wordpress_api`, GPT must replace `provider_domain` with Brand Registry `brand.base_url` before execution.

For non-WordPress APIs, `provider_domain` must remain the endpoint-row value unless the endpoint definition explicitly declares a variable placeholder requiring GPT-side resolution.

Adaptive Schema Learning And Drift Detection Rule

When live request or response payload structure diverges from the authoritative YAML / OpenAPI schema:

- system must classify schema drift type:
  - additive
  - missing required field
  - renamed field
  - type mismatch
  - enum mismatch
  - structural mismatch

- system must emit:
  - schema_drift_detected = true
  - schema_drift_type
  - drift_scope (request | response)

- system must generate:
  - candidate-only schema learning output

- system must NOT:
  - auto-update schema
  - override authoritative YAML
  - mark execution as recovered

- recovered classification is forbidden until:
  - governed schema review completes
  - Registry Surfaces Catalog is updated
  - Validation & Repair Registry is updated

Schema Reconciliation Auto-Repair Workflow Rule

When adaptive schema drift is detected and classified:

- system may trigger:
  - wf_schema_reconciliation_repair

The workflow must:
- consume schema drift classification
- evaluate candidate learning output
- update:
  - Registry Surfaces Catalog schema metadata
  - Validation & Repair Registry schema state
- validate downstream compatibility:
  - Task Routes
  - Workflow Registry
  - execution dependencies

Repair workflow must enforce:
- candidate-first promotion
- no direct overwrite of authoritative schema
- readback validation required

Recovered classification allowed only when:
- schema metadata updated
- validation registry updated
- readback validation succeeds
- dependent surfaces remain compatible

Destructive Operation Governance Rule

For `http_generic_api`:
- `DELETE` operations require:
  - explicit `destructive_allowed = true`
  - explicit user intent
- destructive execution must not be inferred from vague prompts
- destructive eligibility must remain target-specific

HTTP Generic API Validation Rule

Execution validation for `http_generic_api` must confirm:
- `provider_domain` exists and is valid
- `parent_action_key` exists and is active
- `endpoint_key` exists and is active
- the parent action row resolves an authoritative `openai_schema_file_id`
- method is compatible with the endpoint row and resolved YAML/OpenAPI contract
- path is compatible with the endpoint row and resolved YAML/OpenAPI contract
- authentication generation succeeds from governed config
- final URL resolution is valid
- if `provider_domain` is variable, GPT-side resolution succeeded before execution

If validation fails:
- execution must be blocked or degraded
- failure must remain traceable
- recovered classification is forbidden

HTTP Generic API Logging Rule

All `http_generic_api` executions must preserve traceable logging-compatible output including:
- `provider_domain`
- `parent_action_key`
- `endpoint_key`
- `method`
- `path`
- execution result
- validation state
- `openai_schema_file_id` when schema-bound execution applies

Parent Action YAML Authority Rule For HTTP Execution

For endpoint execution governed through API Actions Endpoint Registry:
- GPT must follow `parent_action_key` authority through the corresponding Actions Registry row
- the Actions Registry row must resolve an authoritative `openai_schema_file_id`
- execution assembly must remain compatible with the resolved YAML/OpenAPI contract

Endpoint selection alone is insufficient execution authority without parent action schema authority.

Security Enforcement Rule For HTTP Generic API

The following must be enforced:
- `header_blacklist`
- system-generated `Authorization` only
- prompt-supplied credentials must not be executed
- credential leakage into prompts, memory, or logs is forbidden unless explicitly redacted and governance-approved

HTTP Generic API Authority Constraint

`http_generic_api` is a transport layer and must not:
- bypass Task Routes
- bypass Workflow Registry
- bypass Validation & Repair Registry
- act as routing authority
- execute outside governed routing and runtime validation

Governed Addition Pipeline Governance Rule

Governed addition of new system items must remain Registry-governed.

The governed addition pipeline may classify and prepare additions for:
- surfaces
- routes
- workflows
- starters
- policies
- repair mappings
- validation rules
- graph nodes
- graph relationships

Governed addition must determine the affected authority, validation, runtime, repair, memory, graph, and observability surfaces before activation.

Governed addition must not:
- append runtime rows without dependency mapping
- activate new items without validation readiness
- bypass Registry Surfaces Catalog
- bypass Validation & Repair Registry
- bypass Task Routes or Workflow Registry when execution behavior is introduced

Governed addition is an orchestration behavior, not a shadow authority surface.

Addition Promotion Rule

Newly added governed items should enter as:
- candidate
- inactive
- pending validation

Promotion to active or authoritative state is allowed only after:
- structural validation
- row/schema validation when applicable
- cross-sheet integrity validation
- graph integrity validation when applicable
- execution-readiness validation when applicable

Starter Intelligence Canonical Governance Rule

Conversation Starter is a governed intelligence surface.

It must:
- be registered in Registry Surfaces Catalog
- be validated in Validation & Repair Registry
- follow row_audit_schema

Starter system must govern:
- starter -> route mapping
- starter -> workflow mapping
- starter -> execution_class propagation
- starter -> goal-family classification
- starter -> prediction signals

Starter system must act as:
- entry intelligence layer
- learning-aware system
- predictive recommendation system

Starter signals must remain compatible with:
- Task Routes
- Workflow Registry
- Growth Loop Engine Registry

Starter governance must also enforce:

- starter -> policy-resolution readiness
- starter -> execution-readiness gating
- starter -> authoritative logging evidence before final success/recovered classification

Conversation Starter therefore acts not only as an intelligence surface, but also as a policy-gated execution entry surface.

Graph Intelligence Governance Rule

Knowledge Graph Node Registry and Relationship Graph Registry are governed intelligence surfaces.

They must be registered in:
- Registry Surfaces Catalog
- Validation & Repair Registry

Graph intelligence must govern:
- node identity
- relationship identity
- execution-path integrity
- starter-to-route mapping
- route-to-workflow mapping
- workflow-to-chain mapping
- decision-to-chain or decision-to-route mapping
- chain-to-engine mapping
- graph-based prediction signals
- graph-based auto-routing eligibility

Graph intelligence may optimize among governed paths but must not:
- invent new routes
- invent new workflows
- bypass Task Routes authority
- bypass Workflow Registry authority
- bypass execution policy
- bypass validation gating

Knowledge Graph Node Registry is the governed node authority surface.
Relationship Graph Registry is the governed relationship authority surface.

Graph Validation Governance Rule

Execution-critical graph validation must verify:
- required node exists
- required relationship exists
- execution-critical relationship is active
- graph path remains compatible with Task Routes and Workflow Registry

Missing or invalid execution-critical graph relationships must:
- degrade or block execution according to governed enforcement policy
- preserve repair-aware traceability when recoverable

Graph Auto-Routing Governance Rule

Graph-based auto-routing may:
- compare valid governed execution paths
- rank valid governed execution paths
- select the best governed execution path by policy

Graph-based auto-routing must not:
- override route authority outside Task Routes
- override workflow authority outside Workflow Registry
- execute an unregistered path
- classify an invalid path as recovered

Google Workspace Native Action Governance Rule

Google Sheets, Google Docs, and Google Drive native actions are execution-capable tools, but they must not be treated as standalone authority.

All Sheets, Docs, and Drive execution must remain Registry-governed through:
- `Registry Surfaces Catalog`
- `Validation & Repair Registry`
- `Task Routes`
- `Workflow Registry`

Native Google actions may read, write, create, update, or inspect governed resources only when:
- the target surface or file is Registry-resolved when Registry governance applies
- validation-state compatibility is confirmed through `Validation & Repair Registry` when execution-critical
- the routed workflow is active and executable
- execution policy allows the requested operation

Google native tools must not:
- bypass Registry validation
- bypass route authority
- bypass workflow authority
- promote direct tool access to execution authority

Google Workspace Registry Validation Dependency Rule

When a request targets Sheets, Docs, or Drive and the target is part of governed system execution, Registry validation is a required precondition.

Required checks may include:
- target surface exists in `Registry Surfaces Catalog`
- target file or worksheet binding is valid
- `worksheet_gid` matches when the target is a workbook sheet
- validation row is compatible in `Validation & Repair Registry`
- routed execution remains compatible with `Task Routes` and `Workflow Registry`

If required Registry validation fails:
- execution must degrade or block by policy
- direct Google API execution must not be treated as recovered

Runtime Authority Validation Governance Rule

Runtime authority validation is a governed pre-execution requirement.

Before any governed execution may proceed, the system must validate:
- Registry Surfaces Catalog bindings
- Validation & Repair Registry compatibility
- Task Routes authority
- Workflow Registry authority
- binding integrity readiness
- execution dependency readiness
- graph-path readiness when graph-aware execution is enabled

Runtime authority validation may degrade or block execution, but it must not be bypassed.

Live Canonical Runtime Validation Rule

Any request whose primary intent is:
- validation
- audit
- verification
- consistency check
- readiness check
- authority check
- canonical validation

must execute validation at runtime against live canonicals resolved from Google Drive when live canonical resolution is possible.

For validation-class requests, knowledge-layer content, cached content, uploaded copies, or prior reconstructed context may support traceability only, but they must not be treated as authoritative validation evidence when the governed live Google Drive canonical is accessible.

Required live validation path:
- resolve canonical surface through `Registry Surfaces Catalog`
- confirm validation compatibility through `Validation & Repair Registry`
- resolve canonical file identity from governed Registry binding
- fetch live canonical content through governed Google native API
- validate against the live fetched body before classification

If a validation request does not execute against live Google Drive canonicals when live resolution is possible:
- validation must classify as `Degraded` or `Blocked`
- `Recovered` classification is forbidden
- a repair-capable signal must remain available

This rule applies even when:
- a knowledge-layer copy exists
- an uploaded attachment exists
- prior session memory contains canonical content

Activation Validation Dual-Authority Rule

For `system_activation_check` and governed activation readiness validation:

- GPT Knowledge layer canonical files are authoritative for canonical traceability only
- live Google Drive and native Google API validation are authoritative for runtime readiness classification
- uploaded copies, cached text, or knowledge-layer copies must not be promoted to runtime activation authority when live governed validation is possible

Activation validation must occur in this order:
1. knowledge-layer canonical traceability
2. live Google Drive canonical file validation
3. live Registry / worksheet validation through Google Sheets APIs
4. readiness classification

If live governed validation is possible but skipped:
- activation readiness must classify as `degraded` or `blocked`
- recovered classification is forbidden

If traceability copies and live governed bindings disagree:
- reconciliation is required
- recovered classification is forbidden until the disagreement is explicitly resolved

Post-Activation Governance Rule

Activation establishes governed readiness for continued operation, but it does not create indefinite execution authority.

After activation:
- all governed requests must still pass runtime authority validation for the current execution cycle
- all governed requests must still resolve through active Registry authority
- stale activation state must not substitute for current route, workflow, dependency, binding, schema, or target validation
- optimization and repair requests must remain governed by current live authority, not prior activation success

Active-State Reuse Constraint

Recovered or active system state from a prior activation cycle must be treated as historical readiness evidence only.

It must not:
- bypass Task Routes validation
- bypass Workflow Registry validation
- bypass Validation & Repair Registry compatibility
- bypass Registry Surfaces Catalog binding checks
- bypass readback requirements
- bypass schema compatibility validation

Mandatory Pre-Execution Validation Rule

All governed executions must pass runtime authority validation before:
- business execution
- scoring
- logging
- recovered classification

This requirement applies to:
- starter execution
- direct prompt governed execution
- repair execution
- retry execution
- graph-based auto-routing
- governed addition execution
- Google Workspace governed execution when system resources are affected

Google Workspace Runtime Validation Dependency Rule

When Google Sheets, Google Docs, or Google Drive actions affect governed system resources, successful runtime authority validation is required before native action execution may be treated as valid.

Direct tool availability must not bypass:
- Registry validation
- route authority
- workflow authority
- enforcement gating

Full Audit Governance Scope

For governed full_system_intelligence_audit execution:
- execution_policy_registry_sheet is required
- review_stage_registry_sheet is required when staged audit is active
- review_component_registry_sheet is required when component audit is active
- repair_mapping_registry_sheet is required when governed repair mapping is active
- row_audit_rules_sheet and row_audit_schema_sheet are required when row-level audit validation is active

Tourism Intelligence Scoreboard may receive downstream audit scoring and summary propagation but must not be treated as execution authority.

Full Audit Governance Scope Extension

For `full_system_intelligence_audit`:

Required:
- execution_policy_registry_sheet
- execution_bindings_sheet
- execution_chains_registry
- decision_engine_registry_sheet

Governance:
- review_stage_registry_sheet
- review_component_registry_sheet
- repair_mapping_registry_sheet

Validation:
- row_audit_rules_sheet
- row_audit_schema_sheet

Runtime:
- actions_registry_sheet
- endpoint_registry_sheet
- system_enforcement_sheet
- execution_log_import_sheet

Growth Feedback And Loop Authority Scope

Growth-layer authority must be Registry-governed through:
- `Growth Loop Engine Registry`

Growth-layer authority must also remain traceable to:
- `Execution Log Unified` as the authoritative execution record
- `Metrics Warehouse` as the authoritative metrics summary layer
- review-layer feedback surfaces when governed review evidence is required

Growth-loop authority is responsible for:
- optimization trigger rules
- follow-up workflow targeting
- trigger mode governance
- adaptive optimization eligibility

Growth-loop behavior must not be inferred from ad hoc spreadsheet formulas, dashboard mirrors, or ungoverned score notes.

Scoring Feedback Governance

The canonical execution feedback model must support scored output dimensions such as:
- `output_quality_score`
- `seo_score`
- `business_score`
- `execution_score`
- `optimization_trigger`

These growth fields must be written or derived from authoritative execution records and must not be treated as standalone shadow authority outside governed execution or metrics surfaces.

When authoritative execution logging is active, `Execution Log Unified` must be able to govern or preserve these growth feedback fields for downstream metrics, review, and optimization consumption.

Direct Governed Operation Logging Enforcement

When governed execution mutates Registry, Review, Metrics, Activity Log, or Governance surfaces through direct Google Workspace tooling, authoritative execution logging is still mandatory.

The system must:

- append an authoritative row to `Execution Log Unified`
- preserve a normalized execution class for the direct governed action
- preserve `log_source = direct_google_tooling` in runtime/governed execution context when no runtime transport source exists
- not write a literal `log_source` value into the formula-managed Execution Log Unified spill columns
- forbid narrative-only completion for governed direct mutations when authoritative logging is required

Execution Log Unified Formula-Managed Spill Protection

For `Execution Log Unified`, columns `AE:AJ` are formula-managed spill columns.

The system must enforce:

- direct/manual/retroactive append payloads write only through `A:AD`
- direct literal writes into `AE:AJ` are forbidden
- the protected formula-managed fields include:
  - `target_module`
  - `target_workflow`
  - `execution_trace_id`
  - `log_source`
  - `Monitored Row`
  - `Performance Impact Row`
- runtime may preserve those fields in execution context, retry context, or governed diagnostics, but append payloads for `Execution Log Unified` must leave them blank
- violations must trigger block, degrade, or immediate spill-range repair under governed logging continuity rules

Growth Loop Trigger Governance

Example governed loop rules may include:
- IF `seo_score < 60` -> trigger `wf_seo_domination`
- IF `business_score < 70` -> trigger `wf_growth_strategy`
- IF `execution_score < 80` -> trigger `wf_system_repair`

All loop triggers must remain Registry-governed through `Growth Loop Engine Registry`.

Adaptive Optimization Governance

Adaptive optimization may:
- prioritize better workflows
- switch governed engine sequences
- adjust governed routing weights

Adaptive optimization must not:
- mutate route authority outside Task Routes
- bypass governed trigger checks
- override authoritative logging or review evidence
- auto-execute from passive rows

Execution policy must not remain authoritative in:
- Review Config
- review-layer workbook surfaces
- descriptive copies outside Registry

If execution policy authority cannot be resolved through Registry:
- validation must classify the dependency explicitly
- execution must degrade or block based on safety
- runtime must not infer policy from non-Registry sources


---


Authority Model


Each runtime-relevant Registry row must be interpretable through authority semantics.


Supported authority_status values:
- authoritative
- fallback
- candidate
- deprecated
- invalid


Authority rules:
- exactly one authoritative active runtime target may exist per dependency key
- fallback targets are not authoritative unless governed resolution explicitly promotes them
- candidate targets must not become runtime-authoritative until validation passes
- deprecated targets must remain non-authoritative
- invalid targets must not be used for runtime execution


If authority_status is missing where runtime authority is required:
- validation must degrade or fail based on dependency criticality
- runtime must not infer authority silently

Ã¢â‚¬â€
Route Binding Authority Model

Each runtime-executable route binding must be interpretable through explicit route authority semantics.

Strict route authority rules:
- each executable route_id must resolve to one governed active route record
- route_id must be unique within its effective routing scope
- matched row identity must remain traceable through row_id
- route authority must not be inferred from prose, document structure, or downstream assumptions
- target_module and workflow_key must remain bound to the authoritative routed record

If a route binding is missing required authority fields:
- the route binding must not be treated as fully valid for executable routing
- validation must classify the route binding state explicitly
- repair signal emission must remain available when correction is needed

---


Resolution Rules


Each runtime-governed dependency may define a resolution_rule.


Supported resolution_rule patterns may include:
- exact_active_only
- exact_active_url_only Ã¢â‚¬â€ `file_id` is an authoritative HTTPS URL when fetch is used; **canonical_source_priority** is knowledge_layer then canonical_url; no Drive resolution; see Canonical URL Authority For Migrated Dependencies
- exact_active_knowledge_only Ã¢â‚¬â€ dependency body must resolve **only** from the governed **knowledge_layer**; no HTTPS fetch from `file_id`, no Drive; failure if `knowledge_layer_file_exists` is false; see Knowledge Layer Authority below
- authoritative_then_fallback
- highest_version_if_single_scope
- manual_review_required


Resolution rules govern:
- how authoritative targets are selected
- whether fallback is allowed
- when candidate promotion is permitted
- whether ambiguity forces degradation or block


If no valid resolution_rule exists for an ambiguous dependency:
- runtime must not silently resolve ambiguity
- registry must emit authority_conflict
- execution must degrade or block based on safety and dependency criticality

Strict route resolution rules:

Task Routes resolution must respect:
- active eligibility
- route_id uniqueness
- intent_key matching
- brand_scope precedence
- priority ordering
- match_rule ordering
- last_validated_at as final tie-break only

Workflow Registry resolution must respect:
- workflow_key identity
- active workflow eligibility
- compatibility with the authoritative route binding

If route resolution or workflow resolution would require speculative interpretation:
- authority must not be inferred
- validation must degrade or block based on execution safety

---

Workflow Registry And Chain Workflow Authority

Workflow rows in `Workflow Registry` are authoritative executable workflow records for:
- direct-prompt workflows
- decision-triggered workflows
- chain-triggered workflows

Chain workflows are first-class executable workflows, not exceptions, placeholders, or partial chain metadata.

Required minimum fields for all active workflow rows include:
- `Workflow ID`
- `Route Key`
- `workflow_key`
- `active`
- `target_module`
- `execution_class`
- `lifecycle_mode`
- `route_compatibility`
- `memory_required`
- `logging_required`
- `review_required`
- `allowed_states`
- `degraded_action`
- `blocked_action`
- `registry_source`
- `last_validated_at`

Invalid-state behavior for workflow authority must treat the following as non-executable:
- partial workflow rows
- legacy chain rows
- chain rows missing lifecycle, logging, or review fields
- chain rows missing executable workflow identity

Authority Precedence For Routes And Chains

When `Task Routes` points to a workflow key and `Execution Chains` points to a workflow ID:
- `Workflow Registry` remains the canonical executable workflow authority
- `Task Routes` governs route eligibility and route-to-workflow alignment
- `Execution Chains` governs chain sequencing only
- downstream layers must require the resolved chain workflow row to match active Workflow Registry authority before execution may proceed

If Task Routes, Execution Chains, and Workflow Registry do not converge on the same executable workflow target:
- validation must degrade or block based on safety
- authority must not be inferred from the chain row alone

Canonical Remediation Behavior

Incomplete or mismatched chain workflow rows must be repaired in `Workflow Registry`.

Downstream docs and runtime layers must not silently compensate for:
- missing chain workflow rows
- incomplete chain workflow rows
- route or chain or workflow incompatibility

---


Target Scope Rule


Each Registry-governed dependency must align with an explicit target_scope when scope matters.


Supported target_scope examples:
- registry
- routing
- orchestration
- audit
- operations
- live-data
- metrics
- review
- logging


Validation must check that:
- target_scope matches expected canonical usage
- workbook role and layer alignment remain valid
- a dependency is not silently reused across incompatible scopes


Scope mismatches must not silently pass.

---

Binding Integrity Governance

Authoritative binding behavior for worksheet and execution surfaces must include `binding_integrity_review` before dependency execution proceeds when row-level validation, runtime worksheet validation, or governed full-system audit is active.

The authoritative surface-location and validation-state registries are:

- `Registry Surfaces Catalog`
- `Validation & Repair Registry`

Legacy sheets such as:
- `Workbook Registry`
- `Sheet Bindings`
- `Dependencies Registry`
- `Canonical Validation Registry`

may remain for rollback traceability but are deprecated and non-authoritative.

Binding Integrity Review Rule

`binding_integrity_review` must run after `registry_validation` and before `dependency_validation` when worksheet-governed runtime validation is required.

Execution order:

- `registry_validation`
- `binding_integrity_review`
- `dependency_validation`

No dependency execution may continue if required worksheet bindings are blocked by unrecoverable schema or binding noncompliance.

Binding Surface Authority Rule

For runtime worksheet-governed execution, authoritative binding identity must resolve through:

- `Registry Surfaces Catalog`
- `surface_name`
- `worksheet_gid`

`sheet_name` and `tab_name` are descriptive only and must not be treated as authoritative runtime binding fields.

Binding Integrity Review must classify as non-compliant any of the following:

- missing required `worksheet_gid`
- non-numeric `worksheet_gid`
- `worksheet_gid` that does not match the actual resolved worksheet binding
- active execution path that still depends on label-only sheet resolution
- row-audit rule or schema rows that still rely on deprecated `sheet_name` / `tab_name` authority semantics
- canonical text that still treats `Workbook Registry` or `Sheet Bindings` as active authority

Binding Repair Outcome Model

Each non-compliant binding row or canonical binding defect must be classified as one of:

- `Recovered`
- `Degraded`
- `Blocked`

Recovered

Binding identity and schema were repaired into the governed `surface_name` + `worksheet_gid` model and are safe for runtime use.

Degraded

Binding was partially recoverable; execution may continue only with explicit traceability and remaining risk recorded.

Blocked

Binding is not safely recoverable and must prevent dependent execution until corrected.

Dynamic Observability Compatibility Rule

Binding integrity review applies to authoritative binding surfaces and authoritative runtime targets.

Derived observability surfaces must be recomputed after authoritative repair and must not be treated as authoritative repair targets.

This includes derived surfaces such as:

- `Execution View`
- `Active Issues Dashboard`
- `Review Control Center`

---

Controlled Autonomy Rule

Governed execution may be triggered by:
- governed auto conditions
- human activation input

Passive rows must not auto-execute.

Auto-trigger is allowed only through governed trigger logic, not ad hoc writeback.

Trigger-Key Governance

Canonical trigger keys:
- `HIGH_PRIORITY`
- `READY_TRIGGER`
- `PASSIVE`

Canonical trigger modes:
- `governed_auto`
- `manual`

Prompt activation may influence execution eligibility, but must not replace governed trigger checks, binding validation, or execution-readiness enforcement.

Repair Control Schema Recognition

Canonical Repair Control schema recognition must include:
- trigger layer
- execution layer
- priority layer
- prompt activation layer

Repair Control may express governed trigger intent, repair eligibility, and human activation context, but passive rows must remain non-executable until a governed trigger path qualifies them.

---

Monitoring Surface Governance

Registry-governed monitoring and observability surfaces are treated as worksheet dependencies and must follow the same authority, scope, and validation rules as other runtime-bound worksheet surfaces.

Monitoring and observability surfaces must be classified as one of:
- authoritative_logging_surface
- authoritative_review_surface
- derived_observability_surface

Authoritative write surfaces include:
- Execution Log Unified
- Review Run History
- Review Findings Log
- Review Stage Reports

Derived observability surfaces include:
- Execution View
- Active Issues Dashboard
- Review Control Center
- Anomaly Detection

Registry-resolved bindings for these derived surfaces may include:
- execution_view_sheet
- active_issues_dashboard_sheet
- review_control_center_sheet when aggregation-only

Dynamic Observability Governance Rule

- Authoritative records are written to canonical source surfaces. Aggregated, monitoring, and observability surfaces are computed dynamically from authoritative sources whenever possible.
- authoritative execution records must be written only to canonical write surfaces
- derived observability surfaces must compute from authoritative sources
- runtime must not require direct writeback to derived views when authoritative sources are available
- stale or broken derived views must degrade observability trust, not execution truth
- derived views must not become shadow authorities
- logs are written once
- views are computed dynamically
- derived views must not be treated as required write targets

Monitoring governance requires:
- authoritative worksheet binding in Registry
- correct surface_name
- valid worksheet_gid
- correct workbook ownership
- correct target_scope alignment
- no silent substitution outside governed Registry authority

Expected scope alignment:
- monitoring surfaces used for review observability must remain aligned to target_scope = review unless explicitly governed otherwise

Derived observability validation must also check:
- formula integrity
- authoritative source workbook availability
- range compatibility
- no broken references
- no manual stale snapshots pretending to be live

If a monitoring surface binding is missing, stale, mis-scoped, or structurally invalid:
- registry validation must classify the state
- repair-capable signal emission must remain available
- runtime must not silently assume worksheet availability outside Registry-governed authority

If a derived observability sheet exists:
- it must read from authoritative sources
- it must not be treated as a required runtime write target
- formula or refresh failure must be classified as an observability defect, not a logging defect

Monitoring surfaces are observability dependencies, not execution-engine replacements.
Their failure may degrade monitoring trust even when core execution remains otherwise usable.

---

Review Authority vs Review Observability

Registry-governed review authority dependencies include:
- review_stage_registry_sheet
- review_component_registry_sheet
- execution_chains_registry_sheet
- decision_engine_registry_sheet
- row_audit_rules_sheet
- row_audit_schema_sheet

These are authority surfaces and may participate in runtime validation, execution governance, staged review execution, and execution readiness evaluation.

Review workbook surfaces such as:
- review_run_history_sheet
- review_findings_log_sheet
- review_stage_reports_sheet

are authoritative review surfaces when execution or review policy requires governed write evidence.

Derived observability surfaces such as:
- execution_view_sheet
- active_issues_dashboard_sheet
- review_control_center_sheet when aggregation-only
- Anomaly Detection

are observability, reporting, or aggregation surfaces unless explicitly reclassified in Registry.

Derived observability surfaces must not be used as source-of-truth for:
- route validity
- execution completion
- repair completion
- dependency state

Review observability surfaces must not be treated as runtime-governing authority when authoritative Registry-bound copies exist elsewhere.

---

Dependency Resolution Rules


- file Ã¢â€ â€™ active_file_id
- document Ã¢â€ â€™ active_file_id
- worksheet Ã¢â€ â€™ active_file_id + worksheet_gid
- folder Ã¢â€ â€™ containment validation


Resolution must occur through governed registry bindings only.


Resolution must not infer authority from non-registry sources when registry-governed records are expected.


Resolution must respect:
- authority_status
- resolution_rule
- target_scope
- production validity
- validation_state

Ã¢â‚¬â€
Routed Execution Authority Contract

Registry authority must support a deterministic routed execution contract across:
- prompt_router
- module_loader
- system_bootstrap

For executable routing, the Registry-governed authority path must be able to support:
- source = prompt_router
- route_id
- route_status
- route_source = registry_task_routes
- matched_row_id when available
- target_module
- target_workflow or workflow_key
- executable readiness determination

Registry-governed route authority must be sufficient for:
- prompt_router route selection
- module_loader binding revalidation
- system_bootstrap pre-execution enforcement

If Registry data cannot support these fields for a route intended for execution:
- the route must not be treated as fully executable
- validation must return partial, recoverable, or invalid
- repair-capable signaling must remain available

---


Validation Rules


A dependency is fully valid only when:
- dependency exists
- status = active
- required fields are present
- authority_status is valid for runtime use
- worksheet_gid is present and valid for worksheets
- filename match exists when needed
- workbook ownership is correct when applicable
- binding path aligns with the expected canonical layer
- target_scope aligns with intended usage
- no unresolved authority conflict exists

Registry activation enforcement must also check that:
- all runtime bindings resolve from the authoritative Registry workbook through `Registry Surfaces Catalog` and `Validation & Repair Registry`
- required `Registry Surfaces Catalog` rows exist for all runtime-critical surfaces
- required `Validation & Repair Registry` rows exist for all runtime-critical validation and repair states
- required runtime authority rows exist for routing, lifecycle, loading, registry validation, and memory in their governed runtime registries

If a required runtime binding cannot be resolved from the Registry Workbook:
- validation must not silently substitute a non-Registry source
- execution must be classified at least Degraded unless a stricter blocked policy applies
- registry-aware repair signaling must remain available


Binding validation must explicitly check:
- spreadsheet_id presence
- surface_name validity
- worksheet_gid validity where required
- worksheet_gid match against actual worksheet identity
- `sheet_name` and `tab_name` are descriptive only and must not be used as execution-resolution authority
- `schema_ref` presence when schema-governed validation applies
- `schema_version` presence when schema-governed validation applies
- `header_signature` presence when schema-governed validation applies
- `expected_column_count` presence when schema-governed validation applies
- `binding_mode` presence when schema-governed validation applies
- `schema_validation_status` is explicit
- `header_match_status` is explicit
- `schema_drift_detected` is explicit
- file_id integrity where applicable
- workbook ownership correctness
- layer-to-workbook alignment
- authority_status validity
- target_scope validity
- resolution_rule applicability
- fallback_target validity when used
- rollback_target validity when defined
- binding integrity review compliance for worksheet-governed runtime surfaces when runtime validation is active

Dependency validation must explicitly check for each required dependency:
- `Registry Surfaces Catalog` entry exists for the required surface
- `file_id` is present and structurally valid
- `status = active`

If a required dependency fails any of these checks:
- validation must classify the dependency explicitly
- execution must be classified at least Degraded unless a stricter blocked policy applies
- runtime must not assume a usable dependency binding

Sheet binding validation must explicitly check:
- required surface row exists in `Registry Surfaces Catalog`
- `worksheet_gid` is present for runtime-required worksheets
- `worksheet_gid` is valid and matches actual worksheet binding
- `sheet_name` and `tab_name` are treated as descriptive only

If the worksheet surface exists but the required `worksheet_gid` is missing or mismatched:
- binding status must be treated as incomplete
- validation must classify the worksheet binding as partial or recoverable based on safety
- execution must be classified at least Degraded

If schema drift is detected on a governed surface:
- execution must classify as Degraded or Blocked based on criticality
- governed repair mapping must be resolved when required

Logging surface validation must explicitly check:
- the logging surface resolves from `Registry Surfaces Catalog` using `surface_name` + `worksheet_gid`
- the logging validation state resolves from `Validation & Repair Registry`
- the canonical logging target is `surface.operations_log_unified_sheet` -> `Execution Log Unified`

If the canonical logging workbook or sheet binding cannot be resolved:
- logging trust must degrade explicitly
- execution must be classified at least Degraded when logging is required
- runtime must not silently redirect logging to an ungoverned target


Binding mismatches must not silently pass.

Strict route-binding validation must explicitly check:
- route_id presence when route authority is required
- row_id presence for traceable route bindings
- active route eligibility
- intent_key presence
- target_module presence
- workflow_key presence
- route-to-workflow compatibility
- route_source compatibility with Registry-governed Task Routes authority
- priority validity when route ranking is required
- match_rule validity when route ranking is required
- allowed_states validity when execution-state governance is declared

Route-binding mismatches must not silently pass as valid executable routing.

Strict authority validation must also explicitly check:
- execution_policy_registry_sheet presence when execution policy is required
- review_stage_registry_sheet presence when staged review governance is required
- review_component_registry_sheet presence when component-level review governance is required
- execution_chains_registry_sheet presence when execution sequencing is required
- decision_engine_registry_sheet presence when decision-governed branching is required
- `Engines Registry` presence when engine-governed execution is required
- row_audit_rules_sheet and row_audit_schema_sheet presence when row-level validation is required

For `full_system_intelligence_audit` governance, strict validation must also explicitly check:
- execution_policy_registry_sheet presence
- execution_bindings_sheet presence
- execution_chains_registry presence
- decision_engine_registry_sheet presence
- review_stage_registry_sheet presence
- review_component_registry_sheet presence
- repair_mapping_registry_sheet presence when findings may enter governed repair lifecycle
- row_audit_rules_sheet presence
- row_audit_schema_sheet presence
- actions_registry_sheet presence when runtime action execution is required
- endpoint_registry_sheet presence when endpoint execution metadata validation is required
- system_enforcement_sheet presence when system enforcement validation is required
- execution_log_import_sheet presence when execution-log validation is required
- tourism_intelligence_scoreboard_sheet presence only when downstream scoring propagation is required; absence must not be treated as missing execution authority by itself

Authority workbook placement must also be validated so that:
- authority surfaces live in the Registry workbook when designated authoritative
- review workbook mirrors or outputs are not mistaken for runtime authority

---


Registry Validation States


Every registry lookup, binding resolution, and dependency reference must be classified into one of the following states:


- valid Ã¢â€ â€™ fully consistent and usable
- partial Ã¢â€ â€™ usable but incomplete or degraded
- recoverable Ã¢â€ â€™ invalid but repairable without blocking execution
- invalid Ã¢â€ â€™ not usable and requires repair evaluation


Registry validation must not immediately block execution unless:
- state = invalid
- and no safe degraded path exists


Validation state is distinct from authority_status and row status.

---

Strict Route Validation Interpretation

For route-binding authority:

- valid Ã¢â€ â€™ route binding is fully governed, traceable, and executable-ready from a registry perspective
- partial Ã¢â€ â€™ route binding is usable for routing awareness but incomplete for trusted executable routing
- recoverable Ã¢â€ â€™ route binding is not currently executable-ready but repairable without necessarily blocking all routing
- invalid Ã¢â€ â€™ route binding is not safe for executable routing and requires repair evaluation

A route-binding state may be more restrictive than a general dependency state.

A route must not be treated as executable-ready only because the underlying worksheet exists.

---


Status Rules


Supported dependency row status values:
- active
- pending
- inactive
- archived


Validation state is separate from row status.


A row may be:
- active but partial
- active but recoverable
- inactive and invalid for runtime
- archived and not runtime-eligible


Only active dependencies inside Production are runtime-valid unless a governed degraded fallback path is explicitly allowed.


---


Fallback Governance Rule


Fallback is allowed only when:
- resolution_rule explicitly permits fallback
- fallback_target is defined and valid
- fallback target remains within allowed target_scope
- fallback does not violate production boundary
- trust in the fallback path is sufficient for safe degraded or recovered execution


Fallback is not allowed when:
- fallback_target is missing or invalid
- authority conflict remains unresolved
- fallback crosses forbidden scope or environment boundaries
- dependency is marked blocked_if_missing in Registry or equivalent governed state
- safe trust continuity cannot be established


Fallback must never be inferred implicitly.

For strict route bindings, fallback is allowed only when:
- the governing route resolution_rule explicitly permits fallback
- fallback route authority remains Registry-governed
- fallback preserves target_scope and execution safety
- fallback does not fabricate route_id or workflow identity

Fallback must not be used to convert missing route authority into assumed executable readiness.


---


Candidate Promotion and Rollback Rule


Candidate targets must not replace authoritative targets until validation succeeds under governed resolution.


Promotion conditions:
- candidate row is active where applicable
- candidate validation_state is valid
- target_scope is correct
- no authority conflict remains
- resolution_rule permits promotion


If candidate validation fails:
- authoritative target must remain in place when safe
- candidate must not be promoted
- rollback_target or retained authoritative target must remain explicit
- repair signal must be emitted when correction is needed


Rollback or retained-target behavior must be traceable and must not be inferred silently.


---


Repair-Aware Registry Governance


The registry layer must support repair-aware validation and must act as the authoritative signal source for:
- registry_repair
- binding_correction
- dependency_repair when Registry-governed dependency presence fails
- audit_and_repair when authority conflicts or mixed failures are detected


Registry validation must not operate as a strict pass/fail system.


It must support:
- valid
- partial
- recoverable
- invalid


All registry validation must follow the recovery-first execution model.


The registry layer must not execute repair.


It must:
- detect registry issues
- classify validation state
- classify authority condition
- emit repair signals
- provide structured validation output


prompt_router uses this to:
- classify system_repair routes


system_bootstrap uses this to:
- execute repair lifecycle


---

### Registry Reconciliation Governance Rule

When canonical architecture changes affect dependency interpretation, authority source, validation method, or execution resolution, the Registry Workbook becomes the required reconciliation surface.

Affected registry layers must be reviewed and updated where relevant, including:
- `Registry Surfaces Catalog`
- `Validation & Repair Registry`
- `Execution Bindings`
- `Task Routes`
- `Workflow Registry`
- `Execution Policy Registry`
- `Actions Registry`
- `API Actions Endpoint Registry`
- `Brand Registry`
- logging and review bindings

Deprecated sheets may also be reviewed for rollback traceability, but they must remain non-authoritative.

Legacy rows that conflict with the active architecture must not remain marked as valid or authoritative.

If a legacy row is not yet rewritten, it must be downgraded, flagged, or blocked according to the active reconciliation state.

---


Repair Signal Emission


The registry layer must emit repair signals when:
- registry entries are missing or inconsistent
- binding paths do not match expected authority
- authoritative binding surfaces fail `binding_integrity_review` or binding integrity noncompliance is detected
- required dependency bindings cannot be resolved
- conflicting registry entries are detected
- sheet or file identifiers are invalid or stale
- fallback assumptions would otherwise be required
- candidate promotion fails validation
- rollback is required or retained authority must be preserved
- stale rows still encode superseded architecture after a structural change
- monitoring surface bindings are missing, stale, mis-scoped, or structurally invalid
- derived observability formulas are broken, stale, or disconnected from authoritative sources
- governed trigger-key semantics are missing, malformed, or contradictory on a runtime-active control row


Each emitted signal must include:
- signal_type
- affected_layer
- severity
- candidate_repair_type
- authority_status when relevant
- validation_state
- affected_binding_key when available


Supported severity values:
- minor
- major
- critical


Severity guidance:
- minor Ã¢â€ â€™ metadata inconsistency, non-blocking validation issue
- major Ã¢â€ â€™ degraded execution risk, stale binding, fallback mismatch, unresolved worksheet mapping, broken monitoring surface binding
- critical Ã¢â€ â€™ missing authoritative dependency, duplicate active authoritative targets, inaccessible critical binding, blocked authority path


Signal mapping:
- registry_mismatch Ã¢â€ â€™ registry_repair
- missing_dependency Ã¢â€ â€™ dependency_repair
- binding_error Ã¢â€ â€™ binding_correction
- authority_conflict Ã¢â€ â€™ audit_and_repair
- invalid_fallback Ã¢â€ â€™ audit_and_repair
- candidate_promotion_failed Ã¢â€ â€™ audit_and_repair
- binding_integrity_noncompliance Ã¢â€ â€™ binding_integrity_repair


Repair signals must remain structured and must not be reduced to untyped warnings.

Additional strict routing repair signals should remain emit-capable for:
- missing_route_id
- duplicate_active_route
- invalid_route_binding
- workflow_route_mismatch
- unroutable_executable_target
- missing_chain_workflow_row
- incomplete_chain_workflow_row
- chain_workflow_route_mismatch

Additional authority repair signals should remain emit-capable for:
- missing_execution_policy
- review_authority_misplaced
- duplicated_review_authority
- missing_row_audit_authority
- non_registry_policy_source
- derived_view_broken
- observability_formula_error
- stale_derived_view
- authoritative_source_missing_for_view

Additional bootstrap repair signals should remain emit-capable for:
- bootstrap_required
- bootstrap_route_missing
- bootstrap_workflow_missing
- bootstrap_policy_missing
- bootstrap_resume_blocked
- activation_before_resume_required

These signals may map to:
- binding_correction
- registry_repair
- audit_and_repair

Observability severity guidance:
- broken formula in Execution View -> major
- broken formula in Active Issues Dashboard -> major
- missing authoritative source for a derived view -> major unless the missing source is Execution Log Unified
- missing Execution Log Unified as authoritative source -> critical

Strict routing signal emission must preserve:
- affected route_id when available
- affected row_id when available
- affected workflow_key when available


---


Degraded Registry Handling


The system must allow degraded execution when:
- registry is partially valid
- non-critical bindings are missing
- alternate valid bindings exist
- governed fallback is explicitly valid
- execution can proceed safely with limitations


Degraded registry states must:
- be explicitly flagged
- be passed to system_bootstrap
- be persisted in memory_schema
- not be silently ignored


A degraded registry state is valid only when trust in the remaining authority path is still sufficient for safe continuation.


---


Production Boundary Rule


Only dependencies inside Production are runtime-valid.


If a dependency is outside Production:
- it must not be treated as runtime-valid
- it may only participate in repair evaluation if explicitly required for diagnosis
- it must not silently replace a production-governed dependency


---


No-Duplication Rule


Only one active authoritative dependency per key.


If multiple active authoritative records exist for the same dependency key:
- registry must classify this as an authority conflict
- runtime must not silently select one without governed resolution
- the system must emit a repair signal
- execution must degrade or block based on dependency criticality and safe fallback availability


If one row is authoritative and another is candidate or fallback:
- governed resolution_rule must determine eligibility
- ambiguity must not be silently resolved

If one governed Registry row is authoritative and other copies of the same dependency exist outside the active authoritative Registry path:
- runtime must prioritize the Registry-listed `file_id` only
- deprecated, inactive, shadow, or non-Registry copies must be ignored
- external duplicates must not displace the authoritative Registry binding

If duplicate authoritative Registry rows exist for the same dependency key:
- this remains an authority conflict
- execution must degrade or block based on dependency criticality and safe fallback availability


---


Loader Contract


module_loader must:
- read from Registry
- validate dependency
- resolve via Registry authority: Drive file identifiers when `resolution_rule` permits Drive resolution; **knowledge_layer** paths when `resolution_rule = exact_active_knowledge_only` or when `resolution_rule = exact_active_url_only` and the knowledge layer wins **canonical_source_priority**; HTTPS canonical URLs when `resolution_rule = exact_active_url_only` and fetch is required after the knowledge layer is absent
- consume only reconciled records aligned with active architecture, and classify stale superseded models as reconciliation-required rather than recovered
- respect validation_state
- respect authority_status
- respect resolution_rule
- preserve repair signals when present
- avoid silently upgrading partial or recoverable states to valid


module_loader must not:
- invent bindings
- override registry authority
- suppress registry validation failures
- suppress repair-class signals
- promote candidate targets without governed validation
- infer fallback without explicit authority support

Ã¢â‚¬â€
Cross-Layer Routed Authority Enforcement

prompt_router must rely on Registry-governed Task Routes authority for route selection.

module_loader must rely on Registry-governed Task Routes and Workflow Registry authority for binding revalidation.

system_bootstrap must rely on Registry-governed routed authority to enforce execution readiness and to prevent unrouted execution.

No layer may:
- fabricate route authority
- invent route_id values
- assume workflow identity without Registry-governed support
- silently bypass unresolved routed authority to continue execution


---


Recovery Rules


Registry-aware recovery outcomes are:
- Recovered
- Degraded
- Blocked


Recovered means:
- registry state was valid or successfully normalized for safe execution


Degraded means:
- execution can continue with explicit limitations
- one or more registry or binding issues remain unresolved but non-blocking


Blocked means:
- no safe registry authority path remains
- or required binding trust cannot be established


Registry validation must prefer:
- degraded continuation over premature blocking
- structured repair emission over silent failure
- authority-safe recovery over speculative fallback


---


Registry Validation Logging Rule


All registry validation must produce structured output including:
- validation_state
- authority_status summary when relevant
- affected_bindings
- affected_layers
- detected_issues
- emitted_repair_signals
- fallback_used when applicable
- retained_authoritative_target when applicable
- rollback_target when applicable


Validation must not fail silently.


Logging output from this layer is validation-oriented, not execution-oriented.

When strict routed authority is evaluated, structured validation output should also include when available:
- route_id
- row_id
- route_validation_state
- workflow_key
- route_authority_status
- route_binding_issues


---


Operating Separation Rule


Registry = data
Docs = logic


Registry stores:
- live bindings
- live IDs
- live production records
- row-level authority and state data


This document defines:
- how registry truth is interpreted
- how registry records are validated
- how repair-aware registry signals are emitted
- how authority, fallback, promotion, and rollback are governed


This document must not become a duplicate registry data store.


---

Best Use of Dynamic Data Rule

When a surface is primarily:
- aggregated
- filtered
- reordered
- summarized
- issue-oriented
- execution-observability-oriented

the system must prefer:
- dynamic derivation from authoritative sources

instead of:
- direct writeback duplication

unless direct writeback is required for:
- immutable audit record
- legal/compliance trace
- independent review evidence
- write-once execution certification

---


Completion Standard


Registry governance is complete only when:
- all dependencies are registered
- all IDs are linked
- loader is aligned
- validation state is classifiable
- authority status is classifiable
- fallback handling is governed
- promotion and rollback behavior are governed
- repair signals are emit-capable
- degraded registry handling is defined
- authority conflicts are not silently passed
- the Registry Workbook contains active authoritative `Registry Surfaces Catalog` and `Validation & Repair Registry` surfaces, plus required runtime registries (`Task Routes`, `Workflow Registry`, `Actions Registry`, `API Actions Endpoint Registry`, `Execution Bindings`, and governed supplemental registries when applicable)
- runtime-required worksheet gids are populated for governed worksheet bindings
- the canonical logging target is governable through `surface.operations_log_unified_sheet` -> `Execution Log Unified`
- authoritative write surfaces are classified separately from derived observability surfaces
- derived observability surfaces are capable of reflecting authoritative sources without becoming proof-of-write mirrors
- growth-loop trigger rules are governable through `Growth Loop Engine Registry`
- authoritative execution feedback fields are governable for downstream scoring and optimization

Registry governance is also not complete unless:
- strict route-binding authority is governable through Task Routes
- workflow bindings are governable through Workflow Registry
- route_id traceability is preserved
- executable route ambiguity is classifiable
- routed authority failures are signal-capable
- no live execution path depends on inferred non-Registry route authority
- chain-triggered workflows are governable as full Workflow Registry rows rather than partial chain metadata
- execution policy authority is governable through execution_policy_registry_sheet
- review execution authority is governable through Registry-bound review authority sheets
- row audit authority is governable through Registry-bound rule and schema sheets
- review workbook observability surfaces are not misclassified as runtime authority
- execution completion proof does not depend on direct writeback to derived views when authoritative writes succeed
- Brand Registry tracking bindings for `gsc_property`, `ga_property_id`, and `gtm_container_id` are governable, validatable, and resolvable for workflows that declare measurement dependencies
- Actions Registry and API Actions Endpoint Registry rows for Google Analytics Admin API, Google Analytics Data API, and expanded Tag Manager API are category-complete and map to active connectors; retired Search Ads 360 API routes are not authoritative for new execution
- the five core canonical dependencies, when URL-migrated, satisfy Canonical URL Authority rules (`exact_active_url_only`, host allowlist, extension match) and are fetchable without Drive fallback when the knowledge layer does not supply the body
- rows using `exact_active_knowledge_only` resolve exclusively from the knowledge layer with no URL or Drive fallback, per Knowledge Layer Authority
- dependency audits and registry validation can classify `source_mode` consistency and migrated-row compliance
- when structural architecture changes are accepted or applied, affected Registry and binding surfaces are reconciled so superseded authority or validation models are not active in parallel

---


Brand Registry Tracking Bindings Authority

Brand Registry (or the governed brand master surface that holds per-brand tracking columns) is authoritative for live brand-level tracking bindings used before workflow execution.

Authoritative tracking columns (names must match Registry schema):

- `gsc_property` Ã¢â‚¬â€ Search Console property identifier as stored in Registry
- `ga_property_id` Ã¢â‚¬â€ Google Analytics property resource identifier as stored in Registry
- `gtm_container_id` Ã¢â‚¬â€ Google Tag Manager container identifier as stored in Registry

Validation rules:

- Each active brand row must have at most one authoritative binding set per brand identity; duplicate active rows for the same brand with conflicting tracking values must emit `authority_conflict` or equivalent repair signal
- Values must resolve to active API connector scope when a workflow requires that binding; empty values are valid only when the workflow category does not require the binding
- Runtime must not infer tracking IDs from prompts, cached memory, or non-Registry sheets when Registry-governed Brand Registry rows exist
- Updates to these fields after discovery or remediation must follow governed writeback or repair paths; silent in-memory overrides are prohibited

Loader and orchestration contract:

- `module_loader` must inject resolved `brand_tracking_bindings` into execution context after Brand Registry resolution
- `system_bootstrap` must run `brand_tracking_resolution` when measurement or full-funnel execution applies, before treating execution as ready

---

API Retirement And Replacement Governance

Search Ads 360 API (`searchads360_api` or equivalent dependency key) is retired for active execution roles.

Replacement active surfaces:

- `analyticsdata_api` Ã¢â‚¬â€ Google Analytics Data API for reporting and metrics read paths
- `analyticsadmin_api` Ã¢â‚¬â€ Google Analytics Admin API for account and property discovery and administration paths

Governance rules:

- Actions Registry and API Actions Endpoint Registry must not list Search Ads 360 as the primary or required connector for new workflows
- Legacy rows may remain only with `authority_status = deprecated` or `inactive` and must not resolve as authoritative runtime targets
- Validation must emit `registry_mismatch` or `dependency_repair` when deprecated API rows are required by an active workflow without a governed replacement mapping
- Endpoint registry rows that referenced Search Ads 360 must be migrated to GA Data, GA Admin, or other governed replacements per `Registry Surfaces Catalog` change control

---

API Actions Endpoint Registry Validation (Analytics And Tag Manager)

For rows in the API Actions Endpoint Registry (or equivalent governed endpoint sheet) that target Google Analytics or Tag Manager:

Required fields or governed equivalents must include:

- `category_group` Ã¢â‚¬â€ stable grouping for analytics admin, analytics data reporting, tag manager container management, tag/trigger/variable operations, or full-funnel diagnostics
- `execution_path` Ã¢â‚¬â€ unambiguous module or handler resolution key aligned to Workflow Registry and Task Routes
- Active connector reference Ã¢â‚¬â€ must map to `analyticsdata_api`, `analyticsadmin_api`, or `tagmanager_api` (expanded GTM surface) as appropriate

Validation rules:

- Rows missing `category_group` or `execution_path` must classify as `recoverable` or `invalid` until repaired; they must not be treated as executable-ready
- Expanded GTM operations (containers, workspaces, tags, triggers, variables) must each be categorizable; catch-all undocumented endpoints must not pass strict validation
- GA Admin list/discovery actions and GA Data report actions must not share ambiguous endpoint keys that would route to the wrong API family

Actions Registry alignment:

- Action keys in the Actions Registry must resolve to endpoint rows that satisfy the above rules when the action is marked active
- Workflow Registry and Execution Chains Registry references to actions must not target deprecated-only API families for active production workflows

### API Action Capability vs Endpoint Inventory Rule

Actions Registry and API Actions Endpoint Registry must not be treated as the same registry layer.

Actions Registry is the authoritative capability and connector-family registry for:
- intelligence actions
- system actions
- tool action families
- route-target-capable execution surfaces

API Actions Endpoint Registry is the authoritative endpoint inventory and GPT action metadata registry for already-available action operations.

API Actions Endpoint Registry must be treated as:
- an inventory or view of GPT actions available to runtime
- the governed metadata registry for endpoint readiness
- not the authority that provisions or creates GPT actions on the OpenAI side

Endpoint inventory rows must support metadata validation for:
- OpenAI schema reference
- authentication type
- privacy reference
- callback reference where applicable
- execution readiness

Missing metadata in API Actions Endpoint Registry must degrade endpoint readiness and review status, but must not be interpreted as proof that the underlying GPT action does not exist when runtime access is already known.

---

### Analytics Warehouse Schema Governance Rule

Analytics warehouse surfaces are governed registry-bound schema surfaces and must be validated as part of execution authority.

The following surfaces are authoritative analytics sheet-sync targets when active in Registry:
- Tourism Metrics Warehouse -> GSC Data
- Tourism Metrics Warehouse -> GA4 Data

Registry governance for analytics warehouse surfaces must include:
1. workbook binding validation
2. sheet binding validation
3. canonical header schema validation
4. source-to-sheet compatibility validation
5. execution write compatibility
6. review compatibility
7. repair compatibility

Canonical GSC schema:
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

Canonical GA4 schema:
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

Legacy, malformed, or headerless analytics sheets must not remain classified as valid authoritative write surfaces.

If schema drift is detected:
- downgrade the surface
- flag reconciliation required
- prevent recovered analytics write execution until aligned

### Brand-Domain Analytics Governance Rule

Brand-domain identity is part of governed analytics execution authority.

For analytics-capable brands, Registry-governed validation must resolve:
- brand
- brand_domain
- gsc_property where applicable
- ga_property_id where applicable

A brand must not be treated as fully analytics-ready solely because a property binding exists.
A valid analytics-ready state requires domain-aware identity alignment between:
- Brand Registry
- analytics property binding
- target analytics warehouse schema
- runtime execution identity

For governed GSC sheet-sync surfaces, canonical schema must include:
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

If Registry detects:
- brand without domain
- property without domain
- domain not aligned to brand execution identity
then:
- downgrade analytics readiness
- mark reconciliation required
- prevent recovered analytics execution classification until aligned

### Analytics Identity Issue Governance Rule

Analytics identity defects must be treated as governed system issues.

A defect is defined as:
- brand without brand_domain
- brand with missing analytics property binding
- domain-property mismatch

Registry governance MUST ensure:

1. all identity defects:
   - are logged in Review Findings Log
   - are surfaced in Active Issues Dashboard
   - are not silently ignored
2. execution classification:
   - must not be recovered when identity defects exist
3. duplicate issue prevention:
   - issues must be deduplicated per:
     - brand
     - execution cycle
     - defect type
4. repair compatibility:
   - each issue must include:
     - required fix action
     - affected entity (brand)
     - execution impact
5. reconciliation:
   - once defect is resolved (domain + property added):
     - system must allow re-validation
     - issue status must transition to resolved

---

Canonical URL Authority For Migrated Dependencies

Purpose: govern the five core canonical dependencies by URL authority instead of Google Drive file authority when rows are migrated.

Applies to dependency_name:

- `system_bootstrap`
- `memory_schema.json`
- `direct_instructions_registry_patch`
- `module_loader`
- `prompt_router`

New authority rule:

- For rows migrated to URL delivery, the authoritative source is the URL stored in `file_id`. Drive file identifiers are not authoritative for those rows.

Runtime selection (apply everywhere dependency rows are read; must align with `module_loader` and `system_bootstrap` **canonical_source_priority**):

```text
if resolution_rule == "exact_active_knowledge_only":
    if knowledge_layer_file_exists:
        source_mode = "knowledge_layer"
    else:
        # degraded/blocked per blocked_if_missing Ã¢â‚¬â€ no URL fetch
elif resolution_rule == "exact_active_url_only":
    if knowledge_layer_file_exists:
        source_mode = "knowledge_layer"
    else:
        source_mode = "canonical_url"
        canonical_url = file_id
else:
    source_mode = "legacy"
```

**Knowledge Layer Authority** (`exact_active_knowledge_only`)

- authoritative source mode is `knowledge_layer`
- `file_id` is the governed canonical filename
- `file_id` must not be interpreted as HTTPS URL
- `file_id` must not be interpreted as Drive ID
- Drive fallback is prohibited
- URL fallback is prohibited unless a different governed `resolution_rule` explicitly allows it
- validation must fail runtime-ready classification if the knowledge-layer file is missing, unreadable, outside governed canonical filenames, or fails extension/body checks

Allowed filenames:

- `system_bootstrap.md`
- `memory_schema.json`
- `direct_instructions_registry_patch.md`
- `module_loader.md`
- `prompt_router.md`

Validation contract Ã¢â‚¬â€ a URL-migrated canonical dependency row using `exact_active_url_only` is valid for strict URL fetch use only if all are true when that contract is in force (in addition to knowledge-layer rules when the layer is absent):

1. Row `status` (or equivalent active flag) = active for production use
2. `authority_status = authoritative` when authority columns are used
3. `validation_status = valid` when validation columns are used
4. `resolution_rule = exact_active_url_only`
5. `file_id` starts with `https://canonicals.wovacation.com/`

Validation contract Ã¢â‚¬â€ a row using `exact_active_knowledge_only` is valid for strict runtime use only if the knowledge-layer file exists, validates, and `resolution_rule` / `source_mode` consistency checks pass; URL host rules do not apply as a fetch prerequisite for that rowÃ¢â‚¬â„¢s body.

Host allowlist:

- Allowed host: `canonicals.wovacation.com` only (HTTPS). Any other host is invalid unless future registry governance explicitly adds hosts.

Extension validation:

- `memory_schema.json` Ã¢â‚¬â€ URL path must end with `.json`
- `system_bootstrap`, `direct_instructions_registry_patch`, `module_loader`, `prompt_router` Ã¢â‚¬â€ URL path must end with `.md`

Reference canonical URL map (expected paths unless Registry governance updates the row):

- `system_bootstrap` Ã¢â€ â€™ `https://canonicals.wovacation.com/system_bootstrap.md`
- `memory_schema.json` Ã¢â€ â€™ `https://canonicals.wovacation.com/memory_schema.json`
- `direct_instructions_registry_patch` Ã¢â€ â€™ `https://canonicals.wovacation.com/direct_instructions_registry_patch.md`
- `module_loader` Ã¢â€ â€™ `https://canonicals.wovacation.com/module_loader.md`
- `prompt_router` Ã¢â€ â€™ `https://canonicals.wovacation.com/prompt_router.md`

Migration rule:

- If `notes = canonical_url_migrated`, Drive-based resolution is prohibited.
- `rollback_target` must not silently revert to Drive unless explicitly registered and governed.
- Repair actions should prioritize URL correctness (host, path, extension, HTTPS) before other fixes.

Repair logic:

- If URL validation fails, classify the dependency as invalid for runtime use, emit repair-capable signals, and recommend: verify canonical URL path, verify host allowlist, verify extension/type match for dependency_name.
- If knowledge-layer validation fails for `exact_active_knowledge_only` or for required layer-first resolution, recommend: verify knowledge-layer path map, file presence, extension/type match, and read permissions before URL or Drive workarounds.
- Preserve execution traceability (attempted URL, failure class: network, validation, missing, forbidden).

Conflict governance:

- If both a Drive ID and URL interpretation could apply, prefer URL interpretation when `resolution_rule = exact_active_url_only` and HTTPS fetch is the active resolution path.
- Treat Drive interpretation as non-authoritative for those rows.
- For `exact_active_knowledge_only`, neither Drive nor HTTPS fetch from `file_id` may override a missing or invalid knowledge-layer source for runtime body loading.

Review and audit expectations:

- Dependency audits must verify URL host validity (for `exact_active_url_only` fetch paths), URL pattern correctness, knowledge-layer path compliance (for `exact_active_knowledge_only` and for layer-first resolution), `source_mode` / `resolution_rule` consistency, and compliance for migrated rows.

Minimal test checklist (for implementers):

- module_loader rejects Drive fallback for URL-only and knowledge-only rows
- `exact_active_knowledge_only` rows never trigger HTTPS fetch for body load when the knowledge layer is absent (degraded/blocked instead)
- system_bootstrap completes canonical bootstrap for all five files before routing when those dependencies are required (knowledge_layer or canonical_url per row)
- Non-`canonicals.wovacation.com` URLs are invalid for migrated rows when URL fetch is used
- `memory_schema.json` row passes extension checks only with `.json`; markdown canonicals only with `.md` (or governed `.txt` alias)

---

WordPress CPT Schema Preflight Asset Contract Enforcement

For `asset_type = wordpress_cpt_schema_preflight`, execution must produce a governed brand-driven JSON asset instance rather than a generic reusable template.

Required top-level `json_payload` sections:
- `identity`
- `source_resolution`
- `field_contract`
- `taxonomy_contract`
- `formatter_hints`
- `playbook_inference`
- `readiness_result`

Required `identity` fields:
- `brand_name`
- `brand_domain`
- `target_key`
- `base_url`
- `site_type`
- `cpt_slug`
- `rest_base`
- `asset_key`

Required `playbook_inference` fields:
- `brand_playbook_asset_key`
- `brand_playbook_sheet_gid`
- `playbook_coverage_status`
- `playbook_backfill_required`
- `fallback_template_mode`

Required shape version:
- `wordpress_cpt_schema_preflight_asset_v1`

Asset key contract:
- `{brand.normalized}__{target_key}__{cpt_slug}__wordpress_cpt_schema_preflight_v1`

Brand Playbook Workbook Authority Scope

For CPT preflight template inference, the only governed playbook source is the onboarding-produced Brand Playbook workbook Google Sheet stored in Brand Core assets.

Authority scope:
- hint-only
- non-structural
- brand-driven

The Brand Playbook workbook may influence:
- naming conventions
- content patterns
- field usage hints
- taxonomy style hints
- formatter hints

The Brand Playbook workbook must not override:
- JetEngine config authority
- WordPress runtime type authority
- taxonomy runtime authority

Playbook Coverage Fallout Enforcement

If `playbook_coverage_status = missing_for_cpt`:
- runtime/config structural authority remains primary
- fallback to runtime contract synthesis is required
- `playbook_backfill_required` must be set explicitly
- governed onboarding backfill routing must be preserved

Structural authority rule:
- `PLAYBOOK_NEVER_REQUIRED_FOR_STRUCTURE`

Taxonomy fallback rule:
- uncovered playbook taxonomy guidance must not override runtime taxonomy authority

Execution Log Unified Duplicate Exemption Enforcement

`Execution Log Unified` is exempt from semantic duplicate append blocking.

Direct instruction enforcement:
- semantically equivalent log appends to `Execution Log Unified` must remain allowed
- repeated attempts must remain preservable as distinct evidence
- duplicate prevention policy must not block raw execution evidence writes for this sink

This exemption applies only to `Execution Log Unified`.

Mutation write safety for other governed surfaces remains unchanged.

## Runtime Validation Enforcement Authority

### Purpose
This section governs authoritative runtime validation behavior for all live executions.

### Binding Authority Rule
All required runtime bindings must resolve through the authoritative Registry workbook.

Required identity validation must include:
- workbook file_id
- worksheet_gid where canonically required
- active status
- authority status

Name-only resolution is insufficient where worksheet_gid-governed or workbook-governed validation is required.

For execution resolution:
- `sheet_name` and `tab_name` may support diagnostics only
- `worksheet_gid` remains the authoritative binding identity
- failed worksheet_gid validation must block execution or force repair-aware mode

### Required Write Surface Rule
Any target classified as a required authoritative write surface must satisfy all of the following:
- resolves through Registry authority
- write target identity is validated before writeback
- write success is followed by mandatory readback verification
- placement is validated against canonical table expectations

### Readback Verification Rule
Tool-reported write success must not be treated as proof of completion.

For each required authoritative write target, runtime must confirm by readback:
- target identity matches resolved Registry target
- expected execution row exists
- required key fields match expected payload
- row is placed in canonical table region
- required route/workflow execution identifiers match

### Layout Integrity Rule
A write on the correct target surface but incorrect canonical row position is a runtime validation failure.

Classification guidance:
- if execution evidence exists but placement is incorrect -> `Degraded`
- if required write evidence cannot be found -> `Blocked` or `Degraded` according to severity and recoverability

### Review Evidence Rule
When `review_required = TRUE`, `review_run_history_sheet` becomes a required authoritative write surface.

Execution may not be classified as `Recovered` unless:
- `review_run_history_sheet` write succeeds
- `review_run_history_sheet` readback succeeds
- review evidence is positioned canonically
- review evidence matches required execution identity

### Derived Observability Rule
Derived surfaces are never authoritative substitutes for required direct-write evidence.

This includes but is not limited to:
- execution views
- dashboards
- scoreboards
- imported monitoring aggregates

Derived surfaces may support validation context but may not satisfy required-write completion rules.

## Schema Authority Override

When schema file is present:

- schema overrides:
  - endpoint path
  - parameter structure
  - request body format

Registry values become secondary hints only.

No execution allowed if:
- path deviates from schema
- required parameters missing
- request type mismatch

### Drift Enforcement Rule
If Registry authority, memory state, route declaration, workflow declaration, and resolved runtime target identity disagree, runtime classification must not return `Recovered`.

### Completion Classification Rule
Final completion classification must defer to runtime validation outcome using:
- `Recovered`
- `Degraded`
- `Blocked`

No other surface may override this classification once authoritative runtime validation has failed or remained incomplete.

Universal Governed Sheet Audit Rule

Any governed workbook_sheet registered through `Registry Surfaces Catalog` may be audited and repaired according to its governed sheet role.

Supported governed sheet roles include:
- source_of_truth
- derived_view
- control_surface
- anomaly_surface
- repair_surface
- findings_surface
- stage_report_surface
- intake_surface
- legacy_archive_surface

Audit must not be restricted to execution logging surfaces only.

Sheet-Role-Aware Audit Classification Rule

For any governed sheet audit, GPT must first resolve the authoritative sheet role before selecting validation or repair behavior.

The resolved sheet role must govern:
- schema validation requirements
- formula validation requirements
- write-target validation requirements
- derived-view projection validation requirements
- control-metric validation requirements
- anomaly or repair traceability requirements

If sheet role is unresolved:
- audit must degrade or block
- generic execution-only audit behavior is forbidden

Formula And Projection Audit Rule

For governed derived views and formula-driven control surfaces, audit must also validate:
- formula anchor row integrity
- array/spill integrity when used
- references to retired or deprecated sheets
- references to deprecated columns or shifted ranges
- row-position mirroring when key-based projection is required
- IMPORTRANGE dependency validity when used

Broken formulas, stale IMPORTRANGE references, or positional projections on derived views must emit repair-aware findings.

Write-Target Misuse Audit Rule

Audit must detect and classify misuse when:
- raw execution writes land on non-authoritative views
- control surfaces receive source-of-truth writes
- intake surfaces receive governed runtime writes
- anomaly or repair surfaces duplicate raw execution authority

Repair selection must depend on sheet role and misuse type.

Control Surface Audit Rule

For governed control surfaces, audit must validate:
- live metric source resolution
- formula completeness
- alert rule consistency
- reference compatibility with active authoritative surfaces
- absence of broken references such as `#REF!`, `#ERROR!`, or unresolved imports

Control surfaces may be repaired through formula repair, source rebind, or projection repair, depending on the classified failure.

Legacy Surface Containment Rule

When a sheet is governed as:
- `legacy_archive_surface`
- `intake_surface`
- retired derived view

audit must confirm:
- it is not treated as active write authority
- it is not referenced by active control surfaces unless explicitly allowed
- it is not used as a dependency in place of its authoritative replacement


---

Governed Starter Addition Enforcement Rule

The repaired starter-addition enforcement rule is active:

- starter creation, starter registration, and starter-row mutation must use governed addition execution and must not be completed as a free spreadsheet write
- the required starter-addition execution gate is:
  - complete required fields
  - route_key and execution_class alignment
  - starter classification resolved
  - override requirement resolved
  - target surface resolved
- override-required starters must not be permitted to remain authoritative without override coverage
- passive success reporting after a starter row write is forbidden until post-insert readback is complete

Starter Classification Authority Rule

For governed starter addition, direct instructions must enforce one authoritative class:

- `general_starter`
- `system_starter`
- `override_required_starter`
- `predictive_starter`

This class must govern:
- whether override coverage is required
- whether predictive fields must be populated or disabled
- whether anomaly monitoring is enabled immediately
- whether post-insert readback must include override registry validation

Starter Addition Readback Enforcement Rule

For starter addition execution:

- the assistant must verify row existence after write
- the assistant must verify route_key and execution_class alignment after write
- the assistant must verify required override coverage for override-required starters
- the assistant must persist insertion validation evidence before reporting successful completion

Policy Completeness Gate Rule

For governed starter execution, the assistant must not treat a starter as execution-ready unless:

- starter policy coverage is complete
- required route policy rows resolve from Execution Policy Registry
- starter policy execution readiness = true

If starter policy coverage is incomplete:

- execution must not be presented as normal-ready
- starter must classify as `policy_gap` when anomaly-governance policy enables it
- governed repair may proceed only through manual trigger

Policy Gap Manual Trigger Rule

Missing starter policy coverage must not auto-create policy rows by default.

The assistant must enforce:

- `auto_create_missing_policies = forbidden`
- repair path may activate only when a validated manual trigger is present
- the manual trigger must originate from governed validation state, not from inferred conversational intent alone

Valid manual-trigger prerequisites:

- `starter_policy_coverage_status = policy_incomplete`
- `starter_policy_execution_ready = false`
- `anomaly_type = policy_gap` or equivalent governed policy-gap classification
- `starter_policy_repair_triggered = true`

Policy Gap Repair Routing Rule

When manual trigger prerequisites are satisfied:

- governed repair must route through governed addition execution
- direct spreadsheet mutation outside governed addition is forbidden
- repair scope must preserve the starter route and missing policy component set
- post-repair readback must confirm policy coverage is complete before success reporting

Starter Routing And Scoring Policy Authority Rule

Default starter behavior for:

- `starter_priority`
- `suggested_followup_route`
- `suggested_followup_starters`
- `success_signal_source`
- `primary_goal_family`

must resolve from Execution Policy Registry when no curated override exists.

Hardcoded fallback logic may remain only as non-authoritative emergency fallback and must not replace policy authority when policy rows exist.

---

Governed Logical Search Enforcement Patch v1

The system-wide governed logical search enforcement rule is active.

Direct rules

1. Authority-bound selection must use governed logical search.
2. Exact governed match beats semantic similarity.
3. Exact specific candidate beats generic fallback.
4. Active validated ready candidate beats unvalidated inferred candidate.
5. Cross-domain semantically similar rows are invalid winners.
6. Low-confidence mutation selection must block execution.
7. Rejected candidate reasoning must be preserved.

WordPress CPT and taxonomy enforcement

For `wordpress_api`, governed template paths are permitted only in resolver-backed form.

Allowed:
- `/wp/v2/{post_type_slug}`
- `/wp/v2/{taxonomy_slug}`
- `/wp/v2/{post_type_slug}/{id}`
- `/wp/v2/{taxonomy_slug}/{id}`

Forbidden:
- free-form unsupported raw path mutation
- generic post fallback when CPT-specific governed candidate exists
- generic category/tag fallback when taxonomy-specific governed candidate exists
- direct execution without preserved resolver evidence

Required precedence rule

If a CPT-specific or taxonomy-specific governed endpoint exists, the system must reject generic fallback endpoints.

Examples:
- reject `wordpress_create_post` when `wordpress_create_tours_and_activities` exists
- reject generic category or tag mutation rows when a taxonomy-specific row or governed taxonomy template path exists for `location_jet` or equivalent custom taxonomy

Required preserved evidence

Direct instructions must enforce preservation of:
- `governed_resolution_domain`
- `governed_resolution_query`
- `governed_resolution_selected_candidate`
- `governed_resolution_confidence`
- `governed_resolution_basis`
- `governed_resolution_rejected_candidates`


---

WordPress Endpoint Registry Generation Enforcement Patch v1

The system-wide governed logical search rule now additionally enforces generation-aware WordPress endpoint support for all live custom post types and taxonomies across sites.

Direct rules

1. Live-supported CPTs and taxonomies may resolve through governed template-path generation.
2. Generated candidate execution is permitted only with preserved generation evidence.
3. Generated candidate execution is forbidden when live object support is not confirmed.
4. Materialized active registry rows beat generated candidates.
5. Generated CPT/taxonomy candidates beat generic core fallback rows.
6. Free-form raw path mutation remains forbidden.

Required generated family rule

When a live WordPress slug is confirmed, the system must treat the following generated families as supported resolver candidates when a materialized row is absent:

For CPTs:
- `wordpress_list_{slug}`
- `wordpress_create_{slug}`
- `wordpress_get_{slug}`
- `wordpress_update_{slug}`
- `wordpress_delete_{slug}`

For taxonomies:
- `wordpress_list_{slug}`
- `wordpress_create_{slug}`
- `wordpress_get_{slug}`
- `wordpress_update_{slug}`
- `wordpress_delete_{slug}`

Required preserved generation evidence

The following fields must be preserved whenever a generated candidate is selected:
- `generated_candidate = true`
- `generated_candidate_kind`
- `generated_candidate_slug`
- `generated_candidate_endpoint_key`
- `generated_candidate_path`
- `generated_candidate_basis`
- `generated_candidate_confidence`
- `materialized_registry_row_exists`

Block rule

If neither a materialized row nor a live-supported generated candidate can be proven, execution must block.
Narrative success is forbidden.



---

# direct_instructions_registry_patch â€” WordPress Publish Contract Runtime Governance Patch

## Additive direct rules

### DIR-WP-RUNTIME-001
Compact unified-log contract is authoritative. Legacy protected columns may remain physically present but are non-authoritative.

### DIR-WP-RUNTIME-002
Execution evidence belongs in `Execution Log Unified`. Durable payload belongs in `JSON Asset Registry`.

### DIR-WP-RUNTIME-003
JSON Asset persistence is restricted to terminal meaningful payloads only.

### DIR-WP-RUNTIME-004
Schema-meta-only payload rows are forbidden when a meaningful terminal payload exists for the same trace or asset_key.

### DIR-WP-RUNTIME-005
When body extraction is available, body-only payload wins over wrapper payload.

### DIR-WP-RUNTIME-006
Equivalent success-path duplicate JSON Asset writes are forbidden for the same `asset_key`.

### DIR-WP-PUBLISH-001
Draft-first publish is mandatory until field mapping is governed and verified.

### DIR-WP-PUBLISH-002
For CPT publishing, generic `wordpress_create_post` fallback is forbidden when a CPT-specific route or governed template route exists.

### DIR-WP-PUBLISH-003
For taxonomy assignment, guessed term IDs are forbidden. Use governed term inventory or governed create-term resolution first.

### DIR-WP-PUBLISH-004
Discovery -> normalization -> field mapping -> draft publish -> verification is mandatory ordered flow.

---

Universal WordPress Multilingual Direct-REST Non-Equivalence Rule

For any translatable WordPress post type, direct REST acceptance of multilingual fields must not be treated as authoritative multilingual completion unless CPT-specific readback proof exists on the same governed surface.

The following are not sufficient by themselves:
- HTTP 200 or 201
- request transport acceptance
- silent acceptance of `lang`
- silent acceptance of `_wpml_import_*`
- silent acceptance of `translation_of`
- silent acceptance of custom top-level language fields

Required authority behavior
The system must:
- distinguish transport acceptance from language persistence proof
- preserve import-governed WPML language handling as authoritative when direct REST proof is absent
- preserve prompt-first continuation for the post-import WPML processing step when required
- preserve user-trigger-required continuation by default

Universal scope
This rule applies to:
- WordPress core post types
- custom post types
- any governed translatable post type routed through `wordpress_api`

Non-replacement clause
This rule extends and does not replace:
- existing publish/update governance
- existing proof-test-before-confirm governance
- existing prompt-first continuation governance
- existing user-trigger-required governance

Lifecycle rule
New multilingual routes or language-governance branches must progress through:
- designed
- bound_to_canonical_surface
- proof_test_pending
- proof_tested
- execution_validated

Until proof is recorded:
- classification remains `governed_unproven`

WordPress Media Endpoint Contract Enforcement Patch v1

The system-wide governed logical search and schema-first execution rules now additionally enforce method-specific contract handling for the WordPress media family.

Direct rules

1. `/wp/v2/media` must be treated as a governed media collection family, not a generic post-object fallback.
2. `/wp/v2/media/{id}` must be treated as a governed media item family, not a generic CPT item fallback.
3. Media execution must preserve method-specific request-shape authority.
4. Media upload transport acceptance must not be treated as persistence proof.
5. Image insertion into a publish workflow must remain a separate connected branch and must not replace core publish/update layers.
6. New media execution paths remain `governed_unproven` until proof-tested per method and per contract variant.

Required generated family rule

When live WordPress media support is confirmed, the system must treat the following generated families as supported resolver candidates when a materialized row is absent:

- `wordpress_list_media` -> `GET /wp/v2/media`
- `wordpress_create_media` -> `POST /wp/v2/media`
- `wordpress_get_media` -> `GET /wp/v2/media/{id}`
- `wordpress_update_media` -> `POST /wp/v2/media/{id}`
- `wordpress_delete_media` -> `DELETE /wp/v2/media/{id}`

Required media contract rule

For `POST /wp/v2/media`, the system must preserve and classify candidate contract variants separately:

- `raw_binary_upload_contract`
- `multipart_upload_contract`
- `source_url_sideload_contract`
- `metadata_only_contract`

The system must not:
- assume that one candidate contract implies support for the others
- treat string file paths as equivalent to binary upload
- treat object-body acceptance as upload success by itself
- silently collapse upload creation and metadata update into one proof state

Required preserved evidence

Whenever a media contract candidate is selected, preserve:
- `media_contract_family = wordpress_media`
- `media_contract_method`
- `media_contract_variant`
- `media_contract_selected_candidate`
- `media_contract_confidence`
- `media_contract_basis`
- `media_contract_rejected_candidates`
- `media_upload_readback_required = true`
- `media_persistence_proof_status`

Block rule

If neither a materialized row nor a live-supported generated candidate can be proven for the target media method:
- execution must block
- narrative success is forbidden

Proof rule

A media route becomes execution-valid only after:
1. canonical endpoint row or generated candidate is selected
2. request shape is aligned to the authoritative parent schema
3. proof call is executed
4. result is classified per method and per contract variant
5. readback confirms media persistence when mutation is involved

Until then:
- classification remains `governed_unproven`
- media success wording is forbidden

This follows the already-governed schema-first, parent-action, and generated-endpoint rules.

---

Change Log
- v2.39 - pipeline-integrity audit Registry enforcement added so active review-stage/component, route/workflow, repair-mapping, and execution-policy rows remain authoritative with unresolved continuity-layer recovery prohibition
- v2.39 - provider capability continuity enforcement added across provider -> action_family -> capability -> route/workflow edges with degraded/blocked continuity classification and pre-recovery evidence requirements
- v2.38 - spill-safe write authority added: governed/manual writes must validate headers first, read row 2 second, avoid spill/formula-managed columns, and never overwrite protected unified-log columns
- v2.37 - execution classification authority added for runtime capability, endpoint role, delegated transport, and native-direct blocking
- v2.37 - duplicate-header blocking added for execution-critical governed sheets
- v2.37 - dynamic provider-domain placeholder authority added for governed runtime domain resolution
- v2.37 - auth-path routing authority added so native-only OAuth handling cannot be bypassed by delegated HTTP execution
- v2.37 - activation full-system integrity authority rule added so activation classification requires schema, row, policy, binding, execution-path, anomaly, and repair-readiness checks when applicable
- v2.37 - activation repairability authority rule added so policy gaps, binding gaps, schema drift, row failures, and blocked execution paths preserve repair-required state and forbid premature success phrasing
- v2.37 - starter policy and binding gap activation blockers added so unresolved starter-policy or binding-pipeline readiness cannot be silently downgraded during activation
- v2.36 - universal parent_action auth normalization rule added
- v2.36 - parent-action openai_schema_file_id schema alignment rule added before governed transport execution
- v2.36 - transport inference prohibition expanded for raw caller auth and freeform transport input

- v2.33 - post-activation governance rule added
- v2.33 - active-state reuse constraint added so prior activation cannot replace current governed validation

- v2.32 - Activation Validation Dual-Authority Rule added: GPT Knowledge layer canonicals now serve traceability-first activation checks, while Google Drive and native Google API validation remain readiness authority
- v2.30 - Runtime Authority Validation Governance added: all governed execution now depends on mandatory pre-execution validation of Registry bindings, validation-state compatibility, route/workflow authority, dependency readiness, and graph-path readiness when applicable
- v2.29 - Google Workspace Native Action Governance added: Sheets, Docs, and Drive execution now depends on Registry-governed surface resolution and Validation & Repair compatibility before native API execution is treated as valid
- v2.28 - Governed Addition Pipeline Governance added: multi-sheet additions must classify affected surfaces, remain Registry-governed, and promote to active state only after governed validation
- v2.27 - Starter Intelligence Canonical Governance Rule added: Conversation Starter is now explicitly governed as a canonical intelligence surface with required Registry registration, Validation & Repair validation, and row_audit_schema alignment
- v2.27 - starter intelligence role clarified: starter governance now enforces entry-intelligence, learning-aware, and predictive recommendation behavior while preserving compatibility with Task Routes, Workflow Registry, and Growth Loop Engine Registry
- v2.27 - Graph Intelligence Governance added: Knowledge Graph Node Registry and Relationship Graph Registry are governed intelligence surfaces for execution-path integrity, graph-based prediction, and graph-based auto-routing under Registry authority
- v2.26 - Auto-Repair And Retry Governance added: repair-aware retry must remain Registry-governed through Execution Policy Registry, Repair Mapping Registry, Validation & Repair Registry, and Registry Surfaces Catalog
- v2.26 - Conversation Starter Intelligence Governance Rule added: `conversation_starter_sheet` is now governed as an intelligence surface with Registry registration, starter mapping authority, and starter-prediction compatibility constraints
- v2.38 - conversation-starter execution now explicitly requires `Execution Policy Registry` resolution before execution-ready classification; starter-policy evidence logging is mandatory
- v2.38 - direct governed Google Workspace mutations now require authoritative `Execution Log Unified` append continuity
- v2.38 - `Execution Log Unified` columns `AE:AJ` declared formula-managed spill columns and excluded from literal append payloads
- v2.26 - starter-derived signals now explicitly require compatibility with Task Routes, Workflow Registry, and Growth Loop Engine Registry without degrading routing authority boundaries
- v2.25 - Scoring Governance Authority added: execution-governing scoring policy now resolves through `execution_policy_registry_sheet` with mandatory threshold, write-order, fallback, and readback governance
- v2.25 - recovered classification is now explicitly forbidden from non-governed scoring inference outside Registry-resolved scoring policy
- v2.24 - Schema Governance And Migration Rule added: governed workbook surfaces now require schema-metadata comparison against live headers and column counts before migration-capable execution
- v2.24 - schema drift/version mismatch handling extended: `binding_integrity_review` must classify drift state, `schema_migration_review` must govern migration readiness, and policy-enabled rollback must remain available
- v2.24 - Registry Scope updated so worksheet-governed validation uses `surface_name` and `worksheet_gid when required` instead of legacy `sheet_name` / `gid` wording
- v2.23 - Schema Governance and Migration Rule added: governed workbook surfaces must declare `schema_ref`, `schema_version`, `header_signature`, `expected_column_count`, and `binding_mode`, with drift and version mismatch routed through review and repair
- v2.23 - Schema Governance Rule added: governed surfaces must now declare `schema_ref`, `schema_version`, `header_signature`, `expected_column_count`, and `binding_mode`, with validation-state checks for schema integrity and drift
- v2.23 - validation rules now require explicit schema status (`schema_validation_status`, `header_match_status`, `schema_drift_detected`); schema drift now forces degraded/blocked execution with repair mapping when required
- v2.22 - Binding Integrity Governance added: authoritative runtime worksheet binding now resolves through Registry Surfaces Catalog using `surface_name` + `worksheet_gid`; legacy `Workbook Registry` and `Sheet Bindings` references are deprecated for active authority
- v2.22 - `binding_integrity_review` added as the canonical pre-dependency review stage for worksheet-governed runtime validation and row-audit schema alignment
- v2.21 - Runtime Binding Enforcement Rule added: execution-surface authority now requires Registry Surfaces Catalog and authoritative `worksheet_gid` validation (exists, valid, actual-binding match) before execution may proceed
- v2.21 - runtime binding authority now explicitly forbids `sheet_name`/`tab_name` as execution-resolution authority; failed `worksheet_gid` checks must block execution or enter repair-aware mode
- v2.20 - Version Conflict Resolution Rule added: duplicate active `route_id`, `workflow_id`, or `chain_id` rows now classify as invalid configuration, with highest-version deterministic conflict handling until repaired
- v2.20 - Full Audit Governance Scope Extension added: full_system_intelligence_audit now explicitly requires execution bindings, execution chains, decision engine, runtime actions/endpoints, system enforcement, and execution-log import validation dependencies
- v2.19 - Full Audit Governance Scope added: full_system_intelligence_audit now requires execution policy, staged/component review, repair mapping, and row-audit governance surfaces where applicable
- v2.19 - full-audit route/workflow authority and strict validation expectations added; Tourism Intelligence Scoreboard is now explicitly downstream-only and non-authoritative for execution
- v2.18 - API Action Capability vs Endpoint Inventory Rule added: Actions Registry and API Actions Endpoint Registry now have explicit split authority between parent capability identity and endpoint inventory metadata governance
- v2.18 - endpoint-metadata completeness is now required for endpoint readiness classification, but missing endpoint metadata no longer implies GPT action non-existence when runtime access is already known
- v2.17 - Analytics Identity Issue Governance Rule added: analytics identity defects are now governed issues with mandatory Review Findings Log entry, Active Issues Dashboard surfacing, execution-classification constraints, and repair/reconciliation lifecycle handling
- v2.17 - analytics identity issue deduplication keys are now governed per brand, execution cycle, and defect type so duplicate findings are prevented while preserving remediation traceability
- v2.16 - Brand-Domain Analytics Governance Rule added: analytics authority now requires brand-domain identity alignment across Brand Registry, property bindings, warehouse schema, and runtime execution identity
- v2.16 - canonical GSC warehouse schema now includes `brand_domain`; registry validation must downgrade readiness and require reconciliation when brand-domain identity is missing or misaligned
- v2.15 - Analytics Warehouse Schema Governance Rule added: Tourism Metrics Warehouse targets (`GSC Data`, `GA4 Data`) are now explicitly governed as authoritative analytics sheet-sync surfaces with workbook/sheet/schema/source compatibility validation and write/review/repair compatibility requirements
- v2.15 - canonical GA4 and GSC warehouse header schemas added; malformed or headerless analytics sheets now require downgrade, reconciliation flagging, and recovered-write prevention until aligned
- v2.14 - Registry Reconciliation Governance Rule added: structural architecture changes now require cross-registry reconciliation across dependencies, bindings, routing, workflow, policy, and canonical validation surfaces before conflicting legacy rows may be treated as valid authority
- v2.14 - reconciliation-aware signal and completion rules added so stale superseded architecture rows are downgraded, flagged, or blocked until aligned
- v2.13 - `exact_active_knowledge_only` resolution_rule; **canonical_source_priority** alignment (knowledge_layer then canonical_url); `source_mode = knowledge_layer`; runtime selection pseudocode updated; Knowledge Layer Authority section; loader contract and completion standard extended
- v2.12 - Canonical URL authority for migrated core dependencies; `exact_active_url_only` resolution_rule; host allowlist and extension validation; conflict governance (URL over Drive); loader contract updated for URL vs Drive resolution; migration and repair rules; audit expectations; reference URL map
- v2.11 - Brand Registry tracking bindings (`gsc_property`, `ga_property_id`, `gtm_container_id`) authority and validation rules added; Search Ads 360 retirement and GA Data / GA Admin replacement governance added; API Actions Endpoint Registry validation rules added for analytics and expanded GTM categories; completion standard extended for tracking and endpoint registry alignment

- v2.10 - Workflow Registry chain-workflow authority rules added so chain workflows are governed as first-class executable workflow rows
- v2.10 - required minimum workflow-row fields added for direct, decision-triggered, and chain-triggered workflows
- v2.10 - authority precedence clarified between Task Routes, Execution Chains, and Workflow Registry
- v2.10 - canonical remediation strengthened so incomplete chain workflow rows must be repaired in Workflow Registry rather than compensated for downstream
- v2.9 - Growth Loop Engine Registry added as a governed registry surface for loop-trigger authority
- v2.9 - scoring feedback governance added for output_quality_score, seo_score, business_score, execution_score, and optimization_trigger
- v2.9 - adaptive optimization governance added for workflow prioritization, engine sequencing, and governed routing-weight adjustments
- v2.8 - dynamic observability conversion expanded to distinguish authoritative write surfaces from derived observability surfaces including Anomaly Detection and Execution Log Unified
- v2.8 - anomaly detection layer acknowledged as a canonical derived observability surface
- v2.8 - repair execution import and unified-log model recognized as derived observability behavior rather than direct-write authority
- v2.8 - binding_schema_migration_review retained as a mandatory review stage between registry and dependency validation
- v2.8 - governed trigger-key activation rules added before autonomous or governed execution may proceed
- v2.7 - added `binding_schema_migration_review` as mandatory review stage between registry and dependency validation
- v2.7 - added authoritative repair governance for `Workbook Registry`, `Sheet Bindings`, and `Execution Bindings`
- v2.7 - added canonical binding-class enforcement
- v2.7 - added traceability and outcome model for repaired and migrated binding rows
- v2.7 - aligned derived-view policy so authoritative defects are repaired at source, not masked in observability surfaces
- v2.7 - dynamic observability governance added to distinguish authoritative write surfaces from derived observability surfaces
- v2.7 - Execution View, Active Issues Dashboard, and aggregation-only Review Control Center are now governed as derived observability surfaces by default
- v2.7 - derived-view repair signals and dynamic-data preference rule added for observability-safe recovery
- v2.6 - canonical Registry Workbook tab names now match live names exactly: Dependencies Registry, Workbook Registry, Sheet Bindings, Engines Registry, and Execution Bindings
- v2.6 - canonical logging sheet name now matches the live tab name Execution Log
- v2.5 - runtime binding resolution now explicitly degrades when required bindings do not resolve from Registry authority
- v2.5 - missing sheet gids and missing Activity Log Execution Log bindings now explicitly degrade execution trust
- v2.5 - duplicate non-authoritative dependency copies must now be ignored in favor of the Registry-listed file_id
- v2.4 - execution policy authority governance added
- v2.4 - review authority vs review observability separation clarified
- v2.4 - Registry-bound review authority sheets recognized as runtime-governing dependencies
- v2.4 - row-audit authority governance added
- v2.4 - policy and review-authority repair signals expanded


- v1 Ã¢â‚¬â€ registry logic separated from data
- v2 Ã¢â‚¬â€ repair-aware registry governance added
- v2 Ã¢â‚¬â€ validation state model expanded
- v2 Ã¢â‚¬â€ binding validation strengthened
- v2 Ã¢â‚¬â€ repair signal emission added
- v2 Ã¢â‚¬â€ degraded registry handling added
- v2.1 Ã¢â‚¬â€ authority_status model added
- v2.1 Ã¢â‚¬â€ resolution_rule governance added
- v2.1 Ã¢â‚¬â€ target_scope validation added
- v2.1 Ã¢â‚¬â€ fallback governance formalized
- v2.1 Ã¢â‚¬â€ candidate promotion and rollback rules added
- v2.1 Ã¢â‚¬â€ repair severity model corrected
- v2.1 Ã¢â‚¬â€ loader authority contract strengthened
- v2.2 Ã¢â‚¬â€ monitoring surface governance added
- v2.2 Ã¢â‚¬â€ execution_view_sheet recognized as registry-governed monitoring worksheet dependency
- v2.2 Ã¢â‚¬â€ active_issues_dashboard_sheet recognized as registry-governed monitoring worksheet dependency
- v2.2 Ã¢â‚¬â€ monitoring surface binding failures added to repair signal emission guidance
- v2.3 Ã¢â‚¬â€ strict routing authority rule added
- v2.3 Ã¢â‚¬â€ route binding authority model added
- v2.3 Ã¢â‚¬â€ routed execution authority contract added
- v2.3 Ã¢â‚¬â€ strict route validation interpretation added
- v2.3 Ã¢â‚¬â€ strict routing repair signals expanded
- v2.3 Ã¢â‚¬â€ cross-layer routed authority enforcement clarified
