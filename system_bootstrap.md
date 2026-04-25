﻿system_bootstrap


Status
Canonical Name: system_bootstrap
Version: v5.63
Status: active
Owner Layer: orchestration
Source Type: google_doc
Last Updated: 2026-04-25


---


Purpose

- logic-definition resolution is pointer-first and must read `surface.logic_canonical_pointer_registry` before direct logic-document access
- brand-specific writing completion requires prior Brand Core file or authoritative Brand Core asset reading
- brand-specific writing requires required-engine readiness through Engines Registry before Brand Core read-completion or writing completion
- governed logic execution requires prior knowledge-layer resolution for the selected logic when logic-specific, cross-logic, or shared knowledge inputs are required
- business-aware execution requires prior business-type knowledge-profile resolution when the selected logic or task depends on business-type interpretation


Canonical Governed Logic Presentation Orchestration Rule

- system_bootstrap must treat governed logic documents as governed logic specifications rather than GPT personas, custom GPTs, or GPT-style introductions
- user-facing logic summaries, activation summaries, and governed execution narratives must prefer neutral governed naming such as `Logic 001` or task-family-first naming
- internal identifiers such as `GPT-LOGIC-001` may remain unchanged for registry continuity
- execution behavior must continue to resolve from canonical authority layers, registries, engines, routes, workflows, and enforcement state rather than GPT-style prompt framing

Canonical Logic Pointer Resolution Orchestration Rule

- system_bootstrap must orchestrate governed logic-definition loading through `surface.logic_canonical_pointer_registry` before any direct logic-document execution binding is treated as active
- staged logic-definition resolution must:
  1. identify the target logic family or logic_id
  2. read pointer state from `surface.logic_canonical_pointer_registry`
  3. determine `canonical_status`
  4. determine `active_pointer`
  5. resolve the active document as `canonical_doc_id` or governed legacy fallback
  6. preserve rollback continuity
- if pointer state resolves to:
  - `canonical_active`
  then system_bootstrap must use `canonical_doc_id` as the authoritative logic-definition source
- system_bootstrap must not allow direct legacy logic-document execution when:
  - a canonical pointer exists
  - the canonical pointer is active
  - no governed rollback path has been invoked
- legacy logic-definition execution may occur only when:
  - rollback is explicitly authorized
  - pointer resolution explicitly returns legacy mode
  - governed recovery policy permits temporary legacy fallback
- execution summaries must preserve when applicable:
  - logic_pointer_surface_id
  - logic_pointer_resolution_status
  - resolved_logic_doc_id
  - resolved_logic_doc_mode
  - canonical_status
  - active_pointer
  - rollback_available
- successful direct access to a legacy document must not be treated as authoritative logic resolution when pointer-layer state indicates canonical authority

Logic Knowledge Layer Orchestration Rule

- when executing a governed logic definition, system_bootstrap must enforce a staged execution loop:
  1. resolve active pointer
  2. resolve logic_id and canonical document
  3. determine logic knowledge requirements
  4. wait for required logic-specific, cross-logic, and shared knowledge reads to complete
  5. proceed to orchestration
- execution must degrade or block if required knowledge layers remain unresolved
- system_bootstrap must emit missing_required_knowledge_sources if reading fails
- full-success execution classification is forbidden when knowledge dependencies are unmet

Governed Addition Intake Orchestration Rule

- system_bootstrap must orchestrate governed addition requests as staged addition-intake execution and must not directly promote proposed authority into active state
- staged governed addition execution must:
  1. classify addition type
  2. validate overlap and reuse options
  3. validate chain necessity
  4. validate graph and relationship impact
  5. validate execution binding impact
  6. validate downstream registry/surface impact
  7. write candidate/inactive rows when permitted
  8. preserve promotion prerequisites
  9. return governed addition outcome classification
- governed addition outcomes must use:
  - reuse_existing
  - extend_existing
  - create_new_route
  - create_new_workflow
  - create_chain
  - create_new_surface
  - blocked_overlap_conflict
  - degraded_missing_dependencies
  - pending_validation
- recovered/active/equivalent full-success wording is forbidden for governed additions that remain candidate/inactive or pending cross-surface validation
- if candidate workbook mutations occur during governed addition intake, system_bootstrap must preserve:
  - native_google_connection_attempted
  - native_google_attempt_evidence
  - authoritative_log_write_succeeded when governed mutation logging is required
  - candidate_write_targets
  - promotion_prerequisites
- when addition review determines that the requested path should reuse or extend existing authority, system_bootstrap must disclose that result rather than creating unnecessary net-new authority
Candidate Promotion Guard Rule

- system_bootstrap must treat candidate addition writes and candidate validation writes as separate but linked evidence classes
- candidate write success does not imply promotion readiness
- candidate promotion remains blocked until:
  - Validation & Repair Registry candidate rows exist for all affected required surfaces
  - overlap review is validated
  - chain necessity review is validated when applicable
  - graph compatibility is validated
  - execution bindings compatibility is validated
- if candidate rows exist but validation rows remain pending, final classification must remain:
  - pending_validation
  - degraded
  or equivalent non-active candidate-safe state by policy
- active/recovered/full-success language is forbidden for governed additions still in candidate validation


Patch Deployment Parity Verification Orchestration Rule

- system_bootstrap must orchestrate patch-file verification, canonical-merge verification, registry-alignment verification, and live runtime deployment verification as separate governed evidence classes
- file-level comparison alone must not be treated as proof that a patch is active in the live runtime deployment
- when a user asks whether a patch, canonical update, or server patch is deployed live, system_bootstrap must execute staged patch-deployment parity verification and must not stop at file-only comparison
- staged patch-deployment parity verification must:
  1. classify patch inspection scope
  2. validate patch artifact applicability to the target canonical or server file
  3. validate canonical merge state
  4. validate registry alignment when registry-governed surfaces are implicated
  5. validate live runtime deployment evidence when the request asks for live confirmation
  6. classify strongest achieved evidence scope
  7. return patch parity status without overstating certainty
- governed patch evidence classes must use:
  - patch_file_diff
  - canonical_merge_verification
  - registry_alignment_verification
  - runtime_deployment_verification
- governed patch parity result classes must use:
  - file_verified_only
  - canonical_verified_only
  - registry_aligned_only
  - runtime_confirmed
  - degraded_missing_runtime_confirmation
- when live runtime deployment confirmation is requested but authoritative runtime evidence is absent, final classification must remain degraded, partial, or equivalent non-deployed wording by policy
- authoritative live runtime deployment confirmation for patch parity must derive from runtime execution evidence and must not be inferred from patch-file diff, canonical merge, or registry alignment alone
- when runtime confirmation is required, system_bootstrap must preserve:
  - patch_verification_scope
  - runtime_deployment_confirmed
  - patch_parity_status
  - authoritative_runtime_evidence_source
  - runtime_confirmation_evidence_class

Governed Brand Onboarding Orchestration Rule

- system_bootstrap must orchestrate governed brand onboarding as a staged three-layer execution and must not directly promote a new brand into active state
- staged governed brand onboarding must:
  1. classify brand onboarding type
  2. validate duplicate brand and normalized identity inputs
  3. validate brand folder and root-folder linkage
  4. validate Brand Registry candidate compatibility
  5. validate Brand Core identity readiness
  6. validate Engines Registry readiness for foundational identity engines
  7. validate analytics, hosting, website, and runtime bindings when applicable
  8. validate graph and relationship impact
  9. validate execution bindings impact
  10. write candidate rows when permitted
  11. preserve promotion prerequisites
  12. return governed brand onboarding outcome classification

Governed Brand Onboarding Outcomes

- system_bootstrap must classify brand onboarding outcomes using:
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

Brand Core Operational Precedence Rule

- when governed brand onboarding, brand identity formation, or lifecycle reads require:
  - profile
  - playbook
  - import template
  - composed payload
  system_bootstrap must treat Brand Core Registry as the authoritative operational read home
- JSON Asset Registry must not be treated as the primary operational read home for those asset classes
- JSON Asset Registry remains authoritative only for:
  - derived_json_artifact

Brand Core Read-Before-Writing Orchestration Rule

- system_bootstrap must orchestrate brand-specific writing as a read-first governed execution when Brand Core awareness is required
- staged brand-aware writing execution must:
  1. resolve target brand
  2. resolve Brand Core authoritative read home
  3. identify required Brand Core files or assets
  4. read relevant Brand Core inputs
  5. classify Brand Core read completeness
  6. only then execute writing completion
- system_bootstrap must preserve when applicable:
  - brand_core_read_required
  - brand_core_read_targets
  - brand_core_read_completeness_status
  - brand_core_missing_assets
  - writing_completion_blocked_until_brand_core_read
- writing completion must not be classified as recovered, validated, complete, or equivalent full-success when required Brand Core inputs remain unread or unresolved

Engine Registry Readiness Before Brand-Core Writing Orchestration Rule

- system_bootstrap must orchestrate brand-specific writing as an engine-ready read-first governed execution when brand-aware writing requires engine interpretation
- staged brand-aware writing execution must:
  1. resolve target brand
  2. resolve required writing logic
  3. resolve required engines through Engines Registry
  4. validate engine readiness and callable state
  5. only then resolve Brand Core authoritative read home
  6. identify required Brand Core files or assets
  7. read relevant Brand Core inputs
  8. classify Brand Core read completeness
  9. only then execute writing completion
- system_bootstrap must preserve when applicable:
  - engine_registry_read_required
  - required_writing_engines
  - engine_readiness_status
  - missing_required_engines
  - writing_blocked_until_engine_readiness
  - brand_core_read_blocked_until_engine_readiness
- writing completion must not be classified as recovered, validated, complete, or equivalent full-success when required writing engines remain unresolved, inactive, non-callable, or incomplete

Business-Type Knowledge Profile Orchestration Rule

- when executing business-aware logic, system_bootstrap must enforce a staged execution loop for business-type readiness:
  1. resolve business type from prompt or context
  2. validate business-type engine compatibility
  3. resolve required business-type knowledge profile
  4. wait for required knowledge profile read to complete
  5. proceed to brand-core or writing orchestration
- execution must degrade or block if business-type resolution or knowledge profile reads remain incomplete
- system_bootstrap must emit missing_business_type_knowledge_sources if reading fails
- full-success execution classification is forbidden when business-type dependencies are unmet

Brand-Core Asset Home Non-Replacement Clause

- the runtime durable-payload sink rule for `JSON Asset Registry` applies only to:
  - `derived_json_artifact`
  - durable terminal payload traces
  - runtime evidence payload classes
- this durable-payload sink rule must not override Brand Core authoritative-home governance for:
  - profile assets
  - playbook assets
  - import template assets
  - composed payload assets
  - workbook assets
- when both rules are present, system_bootstrap must preserve:
  - `Brand Core Registry` as authoritative operational home for brand-core asset classes
  - `JSON Asset Registry` as authoritative only for `derived_json_artifact` and runtime payload-trace classes
- serialized JSON form or durable payload persistence alone must not reclassify a brand-core asset into `JSON Asset Registry`

Brand Core Asset Intake Orchestration Rule

- system_bootstrap must orchestrate brand-core asset creation as intake-first governed execution and must not directly promote a proposed asset into authoritative registry home
- staged brand-core asset execution must:
  1. classify `asset_class`
  2. validate `authoritative_home`
  3. validate `write_target`
  4. validate `mirror_policy`
  5. validate read-home compatibility
  6. write intake evidence when permitted
  7. preserve promotion prerequisites
  8. return intake decision classification
- valid intake decision classes must include:
  - `accepted`
  - `rejected`
  - `blocked_unclassified_asset`
  - `pending_validation`
  - `example_only`

Brand Core Write-Target Orchestration Rule

- system_bootstrap must treat `Brand Core Write Rules` as the authoritative write-target contract for brand-core asset writes
- system_bootstrap must preserve:
  - workbook assets -> `Brand Core Registry`
  - brand-core serialized assets -> `Brand Core Registry`
  - derived JSON artifacts -> `JSON Asset Registry`
- system_bootstrap must not classify execution as recovered/validated/complete when authoritative home or write target remains unresolved

Publish Preparation Store Controlled Extension Commit Rule

- system_bootstrap must orchestrate publish-preparation workbook growth as intake-first controlled extension execution
- staged workbook extension execution must:
  1. validate accepted intake row
  2. validate workbook extension asset class
  3. validate authoritative home
  4. validate write target through `Brand Core Write Rules`
  5. validate mirror policy
  6. execute controlled workbook mutation when permitted
  7. verify workbook readback
  8. update workbook-local index/readme surfaces when applicable
- ad hoc workbook mutation is forbidden
- final classification must remain degraded or blocked when:
  - intake acceptance is absent
  - write-target validation is unresolved
  - readback verification fails

Publish Preparation Store Intake-First Growth Preservation Rule

- system_bootstrap must not treat workbook extension intent as direct mutation authority
- any new governed tab, staging surface, or workbook-bound publish-preparation structure must first resolve through:
  1. `Brand Core Asset Intake`
  2. `Brand Core Write Rules`
  3. accepted intake decision
  4. controlled commit validation
- recovered, validated, or equivalent full-success wording is forbidden for workbook growth when:
  - intake evidence is missing
  - write-target validation is unresolved
  - controlled commit evidence is missing
  - workbook readback verification is missing

Legacy JSON Mirror Orchestration Rule

- system_bootstrap must treat `JSON Asset Registry` rows for brand-core asset classes as:
  - `legacy_non_authoritative_mirror`
  - `trace_or_context_only`
- `JSON Asset Registry` remains authoritative only for:
  - `derived_json_artifact`

Engines Registry Identity Gate Rule

- system_bootstrap must treat Engines Registry as a required readiness gate for brand identity formation
- GPT logic or prompt-body storage may support engine implementation detail but must not replace Engines Registry authority
- if required foundational identity engines are inactive, missing, or non-callable:
  - brand identity formation must remain degraded or blocked
  - promotion readiness must remain false

Brand Onboarding Promotion Guard Rule

- active, recovered, validated, or equivalent full-success language is forbidden for brand onboarding while:
  - Brand Registry candidate rows remain pending
  - Brand Core identity readiness remains unresolved
  - candidate validation rows remain pending
  - property/runtime bindings remain unresolved
  - graph or execution bindings validation remains unresolved

Native Google GPT Actions Enforcement Repair

The repaired enforcement rule is active:

- when governed activation, validation, or runtime authority checks require Google Workspace live validation, execution must use real native Google API tool calls through available GPT Actions/native tools in the same execution cycle
- narrative intent, simulation, tool-availability claims, or deferred execution do not satisfy the requirement
- `authorization_gated` is permitted only after a real native Google API attempt fails due to authorization
- if no real native call occurs when required, the system must first apply `Use Google API Tools in GPT Actions first.` and re-attempt native Google execution in the same cycle before any degraded termination is allowed
- the required degraded reason is `missing_required_native_google_attempt`
- machine-verifiable attempt evidence must be preserved in outputs, memory, and downstream enforcement state


Activation Tool-First Anti-Hesitation Hardening

Human-Triggered Continuation Governance

The human-trigger governance rule is active:

- system_bootstrap must not silently close a full runtime loop from detection to autonomous continuation by default
- governed execution may:
  - detect
  - validate
  - classify
  - score
  - emit normalized anomaly records
  - prepare repair recommendations
  - prepare next-step prompts
- governed execution must not automatically continue into execution-facing follow-up when a user trigger prompt is required by policy
- when a finding implies a next system action, system_bootstrap must preserve:
  - `user_trigger_required = true`
  - `next_trigger_prompt_required = true`
  - `closed_loop_continuation_forbidden = true`
- if a governed anomaly, repair, or audit flow completes with an actionable next step, system_bootstrap should prefer prompt preparation over autonomous continuation
- bounded automation remains permitted only when an explicit governed exception policy authorizes that exact continuation class

Prompt-Prepared Handoff Rule

When an actionable next step exists after validation, anomaly emission, or repair classification:

- system_bootstrap must prepare a user-usable trigger prompt
- system_bootstrap may recommend:
  - starter title
  - route key
  - workflow
  - repair subtype
- system_bootstrap must not represent the next step as already executed unless a real governed execution step occurred

The hardened activation wrapper is active:

- for plain `Activate System` and equivalent first-turn activation prompts, `system_bootstrap` must execute a tool-first governed activation wrapper before any user-facing narrative classification
- knowledge-layer traceability may occur first, but no activation result may be returned before at least one real native Google API attempt is executed or a same-cycle governed retry is exhausted
- the native bootstrap sequence must prefer `direct_id_first`
- the native bootstrap sequence must use project-folder-scoped Google Drive discovery through folder `1gNYX47P4TNuMXEbWvLNCvV4XRocH41K2` when fallback discovery or live validation lookup is needed
- the minimum same-cycle live validation sequence should include:
  - Google Drive canonical file metadata validation when feasible
  - Google Sheets registry workbook validation
  - worksheet_gid-based surface validation for governed workbook_sheet surfaces when feasible
- traceability-only completion is forbidden
- narrative-only activation is forbidden
- if the first native execution attempt is skipped due to model hesitation or premature narrative completion, `system_bootstrap` must treat the turn as failed enforcement and must trigger one bounded same-cycle retry when policy allows
- `authorization_gated` is permitted only after a real native Google API attempt fails due to authorization
- if no real native call occurs after the allowed same-cycle retry path, classification must remain `degraded`
- the required degraded reason remains `missing_required_native_google_attempt`
- machine-verifiable native attempt evidence must be preserved in outputs, memory, and downstream enforcement state



Exhaustive Full-System Audit Completion Guard

The exhaustive full-system audit completion guard is active:

- `wf_full_system_intelligence_audit` must not classify as `Recovered`, `Active`, `Validated`, or equivalent full-success phrasing unless exhaustive live validation coverage succeeds in the same execution cycle
- exhaustive coverage requires live validation of every authoritative surface required for execution, including all active surfaces with `required_for_execution = TRUE`
- sampled, partial, inferred, or representative validation must not be represented as exhaustive validation
- `validation_depth` must classify as one of:
  - `sampled`
  - `exhaustive`
- `Recovered` is forbidden when:
  - `validation_depth != exhaustive`
  - `coverage_percent < 100`
  - any required authoritative surface remains unvalidated
  - any required authoritative row-group remains unvalidated when row-group governance is active
  - machine-verifiable coverage evidence is missing
- system_bootstrap must preserve and evaluate:
  - `required_surface_count`
  - `validated_surface_count`
  - `required_row_group_count`
  - `validated_row_group_count`
  - `coverage_percent`
  - `unvalidated_surface_ids`
  - `unvalidated_row_group_ids`
  - `exhaustive_coverage_guard_status`
  - `full_audit_completion_guard_status`
- when full-system audit scope is intended but execution evidence is sampled or incomplete, classification must remain `Degraded`
- final user-facing output must disclose audit depth as one of:
  - `targeted`
  - `sampled_full_system`
  - `exhaustive_full_system`



Unified Log Protected Columns and Spill-Safe Prewrite Guard

The governed write-safety rule is active:

- before any governed Google Sheets write, execution must first read and validate the live target header/schema against the expected governed header signature and column count when available
- then execution must read row 2 as the example/template row before selecting writable columns
- if row 2 or live column evidence indicates a spill formula, helper formula, arrayformula-managed range, formula-managed pattern, or protected/system-managed behavior, execution must avoid writing to that column
- direct governed/manual writes must never write, overwrite, or backfill the formula-managed Execution Log Unified columns `target_module`, `target_workflow`, `execution_trace_id`, `log_source`, `Monitored Row`, and `Performance Impact Row`
- for governed server writeback, `Execution Log Unified` must resolve from `ACTIVITY_SPREADSHEET_ID`, while `JSON Asset Registry` must resolve from `REGISTRY_SPREADSHEET_ID`
- sink-sheet existence validation must run per workbook and must not assume both governed sinks live in the same spreadsheet
- authoritative execution-log append payloads must leave the formula-managed Execution Log Unified columns blank and must write only to safe non-formula columns
- recovered or equivalent success classification is forbidden when execution-log sink routing is unresolved, sink workbook validation fails, or formula-managed column protection is violated
- when only a partial safe write set remains, execution must write only to safe non-spill columns and preserve protected or formula-managed columns untouched
- readback verification is required after governed writes that modify live Sheets surfaces
Execution Log Unified active runtime contract = compact 37-column write contract through `performance_impact_row_writeback`; legacy trailing formula/protected columns may remain physically present on sheet but are outside the active server payload contract.

### Native Google Logging Payload Preservation Rule

For native Google governed mutation logging, `system_bootstrap` must preserve two distinct evidence classes:

1. native-attempt evidence
2. authoritative execution-log continuity evidence

These classes must not be collapsed into one field.

Required preserved fields when available:
- `native_google_connection_attempted`
- `native_google_connection_status`
- `native_google_attempt_evidence`
- `native_google_execution_class`
- `native_google_execution_mode`
- `authoritative_log_write_succeeded`
- `authoritative_log_same_cycle_verified`
- `logging_sink_surface_id`
- `logging_write_status`
- `pre_response_log_guard_passed`

Native-attempt evidence alone is insufficient for recovered execution classification when the native Google step also performed a governed mutation.

---

This document orchestrates final system execution, lifecycle handling, structured output assembly, execution outcome classification, execution logging, repair lifecycle handling, and repair-state persistence.

Additional orchestration scope includes:
- starter-governance validation handoff
- governance-drift anomaly emission handoff
- prompt-first continuation preparation for human-triggered next actions


It is the canonical orchestration layer for:
- standard execution
- full_system_intelligence_audit execution
- review execution
- repair execution
- autonomous chain execution
- governed loop-triggered execution (trigger_condition through loop_execution logging)
- growth-aware optimization execution
- brand-level tracking binding resolution before workflow execution when measurement or full-funnel paths are active
- Google Analytics Admin discovery lifecycle when GA property bindings are missing or incomplete
- Google Tag Manager validation and remediation lifecycle when GTM governance or measurement health workflows apply
- full-funnel autopilot orchestration combining Search Console, Google Analytics Data reporting, and Tag Manager signals (not SEO-only)

---

Authority

This document additionally governs:
- human-triggered continuation preparation
- no-default-closed-loop runtime enforcement
- prompt-based next-step handoff after governed anomaly or repair classification

This document governs:
- execution lifecycle
- repair lifecycle execution
- final output assembly
- execution outcome classification
- repair outcome classification
- execution completion criteria
- logging handoff
- recovery-aware orchestration behavior
- chain-step orchestration state when autonomous execution is active
- repair-state write coordination into memory-compatible outputs
- scoring feedback evaluation
- growth-loop trigger evaluation
- governed loop-trigger execution path (trigger_condition through loop_execution logging)
- adaptive optimization handoff
- post-change architecture reconciliation enforcement across dependent registry, binding, validation, and authority surfaces
- category-driven workflow and pipeline execution against live Brand Registry tracking bindings when the routed workflow or execution chain requires them
- governed provider-family continuity validation across provider, action-family, capability, route, and workflow layers when those layers are active in the Registry
- governed pipeline-integrity audit execution across endpoint, graph, routing, workflow, support-registry, policy, and repair layers when the resolved route or workflow requires it
- canonical dependency bootstrap for the five core canonical documents before routing, module loading, workflow resolution, or memory operations that depend on canonical schema interpretation, honoring **canonical_source_priority** (knowledge_layer, then canonical_url) and **exact_active_knowledge_only** rows where applicable
- governed auto-bootstrap lifecycle execution
- activation-before-resume orchestration
- original-request resume after successful bootstrap
- bounded bootstrap retry handling

This document does not govern:
- route selection
- registry data
- dependency typing rules
- dependency resolution rules
- engine-level implementation logic
- memory schema design
- registry authority definitions
- registry validation rule definition

Those responsibilities belong to their canonical dependency layers.

Review Config Usage Constraint

Review Config must not be used as execution authority.

Review Config may only provide:
- UI defaults
- display metadata
- non-execution configuration

Execution behavior must be governed exclusively by:
- execution_policy_registry_sheet
- Workflow Registry
- Task Routes
- other Registry-bound authority dependencies

If execution logic is derived from Review Config:
- execution_state must be Degraded
- violation must be logged

---

Surface Validity Dependency Rule

> Authoritative execution and governance surfaces must resolve through `Registry Surfaces Catalog` before dependency execution proceeds. Validation and repair-state authority must resolve through `Validation & Repair Registry`. Deprecated legacy sheets may remain present for rollback safety but must not be treated as authority.

Surface Authority and Validation Rule

system_bootstrap must resolve all execution-relevant surfaces through `Registry Surfaces Catalog`.

system_bootstrap must resolve validation and repair-state authority through `Validation & Repair Registry`.

Deprecated sheets may remain for rollback safety but must not be treated as authoritative execution surfaces.

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

Adaptive Schema Drift Handling Rule

When schema drift is detected during request or response validation:

system_bootstrap must:
- classify drift type
- preserve drift traceability
- emit candidate-only schema learning output

system_bootstrap must enforce:
- execution_state = degraded or blocked
- recovered classification forbidden

system_bootstrap must trigger:
- schema_review_required = true
- reconciliation_required = true

system_bootstrap must not:
- auto-apply schema updates
- override authoritative schema

Schema Reconciliation Repair Execution Rule

When:
- `wf_schema_reconciliation_repair` is selected
- or schema drift handling emits governed reconciliation requirements

system_bootstrap must execute schema reconciliation as a governed repair workflow.

This workflow must run sequentially and must:
1. preserve drift classification context
2. consume candidate-only schema learning output
3. update Registry Surfaces Catalog schema metadata when approved
4. update Validation & Repair Registry schema-state fields when approved
5. validate dependent-surface compatibility across:
   - Task Routes
   - Workflow Registry
   - execution dependencies
   - validation dependencies
6. require readback validation before recovered classification is allowed

system_bootstrap must not:
- auto-promote candidate schema learning output into active authority without governed validation
- treat partial reconciliation as recovered
- leave stale legacy schema authority active in parallel with reconciled schema authority

If reconciliation remains incomplete or dependent-surface compatibility fails:
- execution must remain Degraded or Blocked
- `reconciliation_required` must remain true
- recovered classification is forbidden

Schema Migration And Rollback Rule

When live schema validation detects:
- `schema_version` mismatch
- header drift
- `expected_column_count` mismatch

and governed schema repair or migration is enabled, system_bootstrap may initiate:
- `schema_header_repair`
- `schema_version_migration`

using:
- `Registry Surfaces Catalog`
- `Row Audit Schema`
- `Validation & Repair Registry`

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
- tourism_intelligence_scoreboard_sheet (downstream summary surface)

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
3. `surface_catalog_validation`
4. `validation_registry_review`
5. `dependency_validation`
6. `architecture_reconciliation` (required when structural change is accepted or applied)
7. `routing_review`
8. `brand_tracking_resolution`
9. `analytics_discovery`
10. `measurement_validation`
11. `schema_validation`
12. `schema_reconciliation_review` when schema drift is detected
13. `execution_readiness`
14. `execution_review`
15. `memory_review`
16. `logging_review`
17. `findings_review`
18. `final_decision`
19. `review_report`

`schema_validation` must run before `execution_readiness`.

`schema_reconciliation_review` must run before `execution_readiness` when schema drift handling requires governed repair or reconciliation.

Layered Activation Order Rule

The system must activate governed layers in the following strict order:

1. identity (Registry Surfaces Catalog)
2. validation (Validation & Repair Registry)
3. policy (Execution Policy Registry)
4. capability (Actions Registry, API Actions Endpoint Registry)
5. target (Brand Registry)
6. routing (Task Routes)
7. workflow (Workflow Registry)
8. execution support (Execution Bindings, Repair Mapping Registry)
9. intelligence (Starter, Graph, Growth Loop)

Activation of any layer before its prerequisite layers are validated is forbidden.

System awareness must remain blocked until dependency readiness is satisfied.

System Activation Validation Workflow Rule

When routed intent resolves to `system_activation_check` or the selected workflow resolves to `system_activation_validation`, system_bootstrap must treat the execution as a governed activation-order validation workflow.

This workflow must validate the canonical activation sequence in the following order:

1. identity
   - `Registry Surfaces Catalog`
2. validation
   - `Validation & Repair Registry`
3. policy
   - `Execution Policy Registry`
4. capability
   - `Actions Registry`
   - `API Actions Endpoint Registry`
5. target
   - `Brand Registry`
6. routing
   - `Task Routes`
7. workflow
   - `Workflow Registry`
8. execution support
   - `Execution Bindings`
   - `Repair Mapping Registry`
9. intelligence
   - `Conversation Starter`
   - `Knowledge Graph Node Registry`
   - `Relationship Graph Registry`
   - `Growth Loop Engine Registry`

system_bootstrap must:

- validate each phase in dependency order
- preserve explicit phase-level readiness status
- block later-phase recovered classification when prerequisite phases are degraded or blocked
- emit degraded or blocked classification when activation order is violated
- preserve activation-readiness traceability in execution output and downstream logging

Recovered classification is forbidden unless:
- all prerequisite phases validate in order
- required authority surfaces are active and compatible
- required validation-state compatibility is confirmed
- required runtime dependencies are ready for the selected governed execution scope

Mandatory Runtime Authority Validation Hook

Before any governed execution begins, system_bootstrap must run runtime authority validation.

Conversation Starter Pre-Execution Policy Resolution Rule

When `entry_source = conversation_starter`, system_bootstrap must treat policy resolution as a mandatory pre-execution dependency.

Before execution-ready classification or workflow dispatch, system_bootstrap must:

- resolve active policy rows from `Execution Policy Registry`
- preserve `policy_resolution_status`
- preserve `policy_source = Execution Policy Registry`
- preserve `policy_trace_id`
- preserve `entry_source = conversation_starter`
- preserve `execution_ready_status` only after starter-policy resolution completes

If starter-triggered execution reaches execution-ready classification without explicit policy resolution:

- execution must degrade
- `failure_reason = missing_starter_policy_resolution`
- `recovery_action = starter_policy_resolution_repair`
- final success or recovered classification is forbidden until policy evidence is preserved

Runtime authority validation must confirm:
- Registry binding readiness
- validation-state compatibility
- Task Routes compatibility
- Workflow Registry compatibility
- execution dependency readiness
- graph-path readiness when applicable

If runtime authority validation fails:
- downstream execution must not begin
- execution must classify as Degraded or Blocked by policy
- recovered classification is forbidden

Runtime authority validation must run before business execution, scoring, logging, and recovered classification.

Validation Requests Must Use Live Canonicals Rule

When a request is validation-class, audit-class, or verification-class, system_bootstrap must require that canonical validation evidence comes from live canonicals fetched from Google Drive when live canonical resolution is possible.

For these requests:
- uploaded copies
- knowledge-layer copies
- cached canonical bodies
- prior session-derived canonical text

may assist traceability only and must not satisfy authoritative runtime validation by themselves.

Before final validation classification, system_bootstrap must confirm:
- live canonical fetch was attempted through governed Google native API path
- fetched canonical identity matches Registry authority
- validation result is based on the live canonical body

If live canonical validation was possible but not used:
- final outcome must not be `Recovered`
- classification must remain `Degraded` or `Blocked`
- failure reason must preserve live-canonical-validation omission traceability

If live canonical fetch is attempted through governed native APIs but cannot complete because native authorization is not yet available:
- the result must be classified as `authorization_gated` when the condition is recoverable
- traceability must preserve that live fetch was attempted
- missing authorization must not be rewritten as missing Registry authority

Activation Validation Orchestration Rule

When routed execution resolves to:
- `intent_key = system_activation_check`
- `target_workflow = system_activation_validation`

system_bootstrap must orchestrate activation validation in this order:
1. preserve GPT Knowledge layer canonical traceability context
2. immediately auto-trigger governed native Google Drive, Google Sheets, and Google Docs connection attempts
3. require live Google Drive validation of canonical file bindings when authorization is available
4. require live Google Sheets validation of Registry-governed authority surfaces when authorization is available
5. compare knowledge-layer traceability against live governed bindings
6. classify activation readiness only after live governed validation completes, or classify the interim state as `authorization_gated` when native authorization prevents completion

For activation validation:
- GPT Knowledge layer canonicals are traceability support only
- Google Drive and Google Sheets validation are readiness authority
- GPT Knowledge layer canonical files are used for traceability first.
- Google Drive and native Google API validation are used for runtime readiness authority.
- `Recovered` or `active` classification is forbidden when live governed validation is possible but skipped
- `Recovered` or `active` classification is forbidden when knowledge-layer trace and live governed validation materially disagree without reconciliation

For first-turn activation:
- native Google connection attempts are mandatory after knowledge-layer traceability
- missing native authorization must be classified as `authorization_gated`
- missing native authorization must not be classified as missing Registry authority unless Registry resolution itself fails

system_bootstrap must return when available:
- `activation_trace_status`
- `live_canonical_validation_status`
- `canonical_trace_comparison_status`
- `activation_readiness_status`
- `activation_block_reason` when applicable

Post-Activation Governed Validation Rule

After activation succeeds, system_bootstrap must not assume the system remains aligned indefinitely.

system_bootstrap must enter a post-activation governed validation state that continuously preserves:
- live Registry authority alignment
- validation-state compatibility
- workflow and route readiness
- canonical file binding validity
- schema compatibility
- execution-readiness continuity
- repair-trigger readiness
- observability trust

Post-activation validation must remain governed through:
- Registry Surfaces Catalog
- Validation & Repair Registry
- Task Routes
- Workflow Registry
- Execution Policy Registry
- canonical live file bindings when applicable

Recovered or active state must remain conditional on continuing live validation compatibility.

Post-Activation Validation Cycle Rule

After activation is classified as active, system_bootstrap must execute a governed validation cycle whenever:
- a new user request arrives
- a governed execution route is selected
- a write operation is requested
- a repair or optimization path is requested
- schema drift is detected
- a route/workflow dependency is changed
- canonical bindings are refreshed
- observability surfaces indicate anomaly risk
- execution logging indicates degraded or blocked trends

The post-activation validation cycle must:
1. re-check critical live authoritative surfaces
2. re-check validation-state compatibility
3. re-check route and workflow readiness for the current request
4. re-check target-surface binding integrity when a governed target is involved
5. re-check schema state when schema-bound execution applies
6. preserve authorization-gated classification when native access is temporarily unavailable
7. degrade or block only when governed rules require it

Per-Request Runtime Revalidation Rule

Activation success must not replace per-request runtime validation.

For every governed execution after activation, system_bootstrap must require:
- route revalidation
- workflow revalidation
- dependency readiness revalidation
Provider Capability Continuity Validation Rule

For governed execution and governed audit routing, system_bootstrap must validate provider-family continuity across:

- API Actions Endpoint Registry
- Knowledge Graph Node Registry
- Relationship Graph Registry
- Task Routes
- Workflow Registry

When a provider family is represented by:
- a semantic provider node
- an action-family node
- one or more capability nodes

system_bootstrap must require continuity evidence for:

- provider -> action_family
- action_family -> capability
- capability -> route
- capability -> workflow
- route -> workflow

If any required continuity edge is missing for an active governed provider family:
- execution must classify as `degraded` or `blocked` according to active policy
- `repair_required` must remain available
- recovered classification is forbidden until continuity is restored or policy explicitly excludes the edge

Pipeline Integrity Audit Execution Rule

When the resolved route is `pipeline_integrity_audit` or the resolved workflow is `wf_governed_pipeline_integrity_audit`, system_bootstrap must treat the request as a governed cross-layer continuity audit.

The governed pipeline integrity audit must validate, when active or required by policy:

- endpoint authority continuity
- provider/action-family continuity
- capability/route continuity
- capability/workflow continuity
- route/workflow continuity
- support-registry continuity
- repair-mapping coverage
- audit writeback readiness

The governed pipeline integrity audit must preserve:

- `review_stage_id = pipeline_integrity_review`
- review-task continuity when a Review Task Queue row is present
- route/workflow audit traceability
- provider-family continuity findings by family when such evidence exists

If the governed pipeline integrity audit completes with unresolved blocking disconnects:
- system_bootstrap must classify as `blocked`
- repair-aware continuation may still be prepared when policy permits

If the governed pipeline integrity audit completes with only non-blocking continuity defects:
- system_bootstrap may classify as `degraded`
- prompt-first repair continuation remains preferred
- target binding revalidation when target surfaces are involved
- native action readiness revalidation when Google Workspace actions are involved
- schema compatibility revalidation when schema-bound API execution applies

system_bootstrap must not treat prior activation success as sufficient proof for later request execution.

Post-Activation Drift Detection Rule

After activation, system_bootstrap must detect and preserve drift across:
- Registry bindings
- worksheet_gid bindings
- schema metadata
- validation-state rows
- route/workflow compatibility
- canonical file bindings
- execution policy compatibility
- graph-path compatibility when graph-aware execution is active

If drift is detected:
- execution must classify as degraded or blocked according to policy
- repair-aware handling must remain available
- active classification must not be preserved silently

Post-Activation Optimization Gate Rule

Optimization, improvement, or enhancement execution after activation must not proceed from activation status alone.

Before any optimization or improvement workflow executes, system_bootstrap must confirm:
- live authority remains valid
- the relevant route is still active
- the relevant workflow is still active
- required dependencies remain executable
- required write targets remain valid
- readback requirements remain satisfiable
- no unresolved repair-critical findings override the optimization request

If these checks fail:
- optimization must degrade or block
- repair-aware routing must remain available

Post-Activation Trust Decay Rule

Active state must be treated as time-sensitive operational confidence, not permanent truth.

When post-activation live validation has not been refreshed for the current request or current execution cycle:
- operational trust must decay
- fresh runtime validation must be required before governed execution continues
- stale activation success must not be reused as direct execution authority

Post-Activation General-Execution Alignment Rule

After activation, system_bootstrap must ensure that requests to improve, optimize, execute, automate, repair, enhance, or extend the system remain aligned with the current live architecture.

For such requests, system_bootstrap must verify in the current execution cycle:
- live route/workflow alignment
- current dependency readiness
- target-surface validity
- validation-state compatibility
- schema compatibility when applicable
- repair-state compatibility when unresolved findings exist
- architecture reconciliation completeness when structural changes were recently applied

If any of these are unresolved:
- execution must remain degraded or blocked according to policy
- repair-aware continuation must remain available
- the system must not claim architectural alignment from activation alone

Runtime Authority Validation Applies To

Mandatory runtime authority validation applies to:
- starter execution
- direct governed execution
- repair execution
- retry execution
- graph-based auto-routing execution
- governed addition execution
- governed Google Workspace execution when system resources are affected

HTTP Generic API Execution Classification Rule

When `target_module` or routed workflow resolves to `http_generic_api`:

- execution must be treated as governed external API execution
- runtime authority validation must include:
  - `provider_domain` resolution readiness
  - `parent_action_key` validation readiness
  - `endpoint_key` validation readiness
  - endpoint validation readiness
  - schema contract validation readiness
  - credential resolution readiness
  - method/path governance readiness
  - governed auth mode normalization readiness
  - parent-action request schema alignment readiness
  - transport request contract readiness

Execution must not proceed if:
- `provider_domain` validation fails
- `parent_action_key` validation fails
- `endpoint_key` validation fails
- endpoint validation fails
- schema contract validation fails
- credential resolution fails
- method/path allowlist validation fails

Execution result must preserve:
- `external_execution_status`
- `provider_domain`
- `parent_action_key`
- `endpoint_key`
- `endpoint_path`
- validation state
- transport module identity
- `schema_contract_validation_status` when applicable
- `resolved_auth_mode` when applicable
- `credential_resolution_status` when applicable
- `request_schema_alignment_status` when applicable
- `transport_request_contract_status` when applicable

Recovered classification is forbidden unless:
- external execution succeeds
- runtime validation passes
- response integrity is confirmed

HTTP Async Execution Governance Rule

When governed execution resolves to the validated HTTP client async surface:

- `/jobs`
- `/jobs/{jobId}`
- `/jobs/{jobId}/result`

system_bootstrap must treat async HTTP execution as a governed execution lifecycle, not as a detached transport convenience.

system_bootstrap must require before async execution proceeds:
- runtime authority validation for `parent_action_key`
- runtime authority validation for `endpoint_key`
- request schema alignment for the normalized execution payload
- async job policy compatibility
- idempotency handling readiness when idempotency key is present
- persisted job-state readiness when async execution is enabled by policy
- webhook governance readiness when `webhook_url` is present

system_bootstrap must preserve when applicable:
- `job_id`
- `job_type`
- `job_status`
- `attempt_count`
- `max_attempts`
- `next_retry_at`
- `idempotency_key`
- `webhook_status`
- `job_persistence_status`

Recovered classification is forbidden unless:
- async job creation succeeds
- persisted job-state handling is valid when policy requires persistence
- execution lifecycle status is explicit
- polling/result lifecycle remains traceable

This extends the existing HTTP execution section so async jobs become first-class governed execution instead of only an API feature.

### HTTP Client Variable Contract Runtime Readiness Rule

For any governed HTTP/OpenAPI execution path that depends on route variables, workflow variables, runtime bindings, delegated transport inputs, or promoted wrapper fields, system_bootstrap must validate variable readiness before final HTTP client execution proceeds.

Readiness must confirm:
1. required variable contracts are present
2. required variables are resolved
3. variable source legitimacy is confirmed
4. runtime binding profiles are compatible with the selected route/workflow/action/endpoint
5. clarification-required variables are surfaced before execution when collection is allowed by policy
6. provider-domain placeholder resolution is valid when runtime-resolved
7. auth normalization is valid for the selected execution path
8. request schema alignment is valid for normalized query, headers, path parameters, and body
9. transport request contract readiness is valid for execution

system_bootstrap must preserve:
- `variable_contract_status`
- `variable_resolution_status`
- `variable_binding_status`
- `clarification_required_variables`
- `missing_variables`
- `invalid_variables`
- `request_schema_alignment_status`
- `response_schema_alignment_status`
- `transport_request_contract_status`

If clarification is permitted, system_bootstrap must prefer clarification or governed collection over silent omission.
If clarification is not permitted and required variables remain unresolved, execution must block.

HTTP Generic Workflow Execution Rule

When routed `workflow_key` is one of:
- `wf_http_generic_execute`
- `wf_http_generic_read`
- `wf_wordpress_via_http_generic`

system_bootstrap must require:

- routed workflow compatibility
- API Actions Endpoint Registry readiness for the selected operation
- `provider_domain` validation readiness
- `parent_action_key` validation readiness
- `endpoint_key` validation readiness
- governed auth resolution readiness
- governed auth mode normalization readiness
- schema contract validation readiness
- parent-action request schema alignment readiness
- transport request contract readiness
- method/path allowlist validation readiness

For `wf_wordpress_via_http_generic`:
- WordPress capability resolution must remain distinct from transport execution
- transport execution must proceed through `http_generic_api` only after runtime authority validation succeeds
- capability-level routing must not be treated as transport-level execution readiness by itself

Execution must classify as degraded or blocked when:
- route-to-workflow alignment fails
- workflow-to-transport compatibility fails
- endpoint readiness is unresolved
- provider-domain validation is unresolved
- parent-action authority is unresolved
- endpoint-key authority is unresolved
- auth generation is unresolved
- auth mode normalization is unresolved
- schema contract validation is unresolved
- request schema alignment is unresolved
- transport request contract readiness is unresolved

### HTTP Client Variable Contract Enforcement Rule

When governed execution resolves to the validated HTTP client surface, system_bootstrap must validate the governed variable contract in the same execution contract used by HTTP client runtime orchestration.

system_bootstrap must resolve and preserve when applicable:
- `variable_contract_validation_required`
- `variable_contract_surface_id`
- `required_variables`
- `resolved_variables`
- `missing_variables`
- `invalid_variables`
- `variable_source_map`
- `runtime_variable_bindings`
- `variable_contract_status`
- `clarification_required_variables`
- `provider_domain_resolution_status`
- `resolved_provider_domain_mode`
- `placeholder_resolution_source`
- `resolved_auth_mode`
- `credential_resolution_status`
- `request_schema_alignment_status`
- `response_schema_alignment_status`
- `transport_request_contract_status`

Validation must confirm:
- every required variable has an active contract row in `Variable Contract Registry`
- each required variable resolves from a legitimate governed source layer
- each runtime-bound variable declares a valid `runtime_binding_profile`
- each non-guaranteed variable declares a governed `fallback_behavior`
- action/endpoint-bound variables do not bypass Registry authority
- canonical HTTP routing fields remain preserved through normalization and delegated-wrapper promotion when applicable

system_bootstrap must not mark execution-ready when:
- a required variable contract is missing
- a required variable is unresolved
- a variable type is invalid for the selected execution path
- a runtime variable is unbound
- fallback handling is required but undeclared
- `provider_domain` validation fails
- auth normalization fails
- request schema alignment fails
- transport request contract readiness fails

If variable-contract validation fails for HTTP client execution, classification must remain blocked or degraded under the existing HTTP execution governance model.

### General Variable Contract Scope Extension Rule

The HTTP client variable-contract rules are the minimum governed baseline and must also be treated as the canonical model for non-HTTP governed execution whenever a starter, route, workflow, action, endpoint, or runtime-binding path depends on declared governed variables.

For non-HTTP governed execution, system_bootstrap must still preserve when applicable:
- `variable_contract_validation_required`
- `variable_contract_surface_id`
- `required_variables`
- `resolved_variables`
- `missing_variables`
- `invalid_variables`
- `variable_source_map`
- `runtime_variable_bindings`
- `variable_contract_status`
- `clarification_required_variables`

Execution-ready classification is forbidden when governed required-variable resolution fails, even if the path is not HTTP-transport based.

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

Universal Parent Action Execution Rule

When governed execution resolves through `parent_action_key`, system_bootstrap must require a universal parent-capability execution contract before outbound transport begins.

The governed execution contract must include when applicable:
- `parent_action_key`
- `endpoint_key`
- `provider_domain`
- `openai_schema_file_id`
- `resolved_auth_mode`
- `resolved_auth_contract`
- `credential_resolution_status`
- `request_schema_alignment_status`
- `response_schema_alignment_status`
- `transport_request_contract_status`

system_bootstrap must require that:
- the parent action row in `Actions Registry` remains authoritative
- the endpoint row in `API Actions Endpoint Registry` remains authoritative for method/path/provider_domain
- `openai_schema_file_id` remains authoritative for parent-level request and response contract interpretation
- auth strategy is normalized before transport execution
- transport payload fields are aligned to the parent action schema before execution
- unresolved freeform caller-supplied auth is not treated as sufficient governed execution readiness

Recovered classification is forbidden unless the parent-capability contract, endpoint contract, and transport contract all validate in the current execution cycle.

HTTP Provider-Domain Execution Rule

For governed HTTP execution:
- `provider_domain` is the primary execution server source
- `target_key` must not be required in the execution request payload
- `brand` must not be required in the execution request payload
- `brand_domain` must not be required in the execution request payload

system_bootstrap must treat GPT-side execution assembly as the authoritative source of:
- resolved `provider_domain`
- resolved `parent_action_key`
- resolved `endpoint_key`
- resolved `method`
- resolved `path`

If `provider_domain` is a variable placeholder:
- GPT must resolve it before transport execution
- for `parent_action_key = wordpress_api`, GPT must replace `provider_domain` with Brand Registry `brand.base_url`
- for non-WordPress APIs, `provider_domain` must remain the endpoint-row value unless the endpoint definition explicitly declares a variable placeholder requiring GPT-side resolution

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

Parent Action YAML Authority Rule

When endpoint execution is governed through API Actions Endpoint Registry, system_bootstrap must preserve and trust parent action authority only when:

- `parent_action_key` resolves through Actions Registry
- the parent action row resolves an authoritative `openai_schema_file_id`
- the execution request remains compatible with the resolved YAML/OpenAPI contract

Recovered classification is forbidden when:
- `parent_action_key` is unresolved
- `openai_schema_file_id` is unresolved
- execution contract and YAML/OpenAPI contract are incompatible

Scoring And Recovery Classification Stage

When scoring is enabled, system_bootstrap must execute:

- `execution_scoring`
- `recovery_status_classification`

after execution and before logging.

Execution order:
- execution
- scoring
- recovery classification
- logging

`score_after` is the authoritative source for recovery classification when scoring is available.

If dynamic thresholds by execution class are enabled:
- resolve the threshold set matching `execution_class`
- otherwise use default thresholds

If adaptive thresholds are enabled:
- compute effective thresholds from governed score history
- log the effective threshold basis
- recovered classification is forbidden unless threshold readback is explicit

For `full_system_intelligence_audit` routes, the governed execution path must additionally include when applicable:

- `execution_policy_review`
- `review_stage_resolution`
- `review_component_resolution`
- `row_audit_rule_resolution`
- `row_audit_schema_validation`
- `repair_mapping_resolution`
- `scoreboard_propagation_review`

These stages must complete before final recovered classification is allowed for governed full-audit execution.

Full System Intelligence Audit Execution Extension

When route = `full_system_intelligence_audit`:

system_bootstrap must enforce extended audit lifecycle:

- `execution_policy_validation`
- `registry_validation`
- `review_stage_resolution`
- `review_component_resolution`
- `row_audit_validation`
- `repair_mapping_resolution`
- `execution_bindings_validation`
- `execution_chain_validation`
- `decision_engine_validation`
- `actions_registry_validation`
- `endpoint_registry_validation`
- `system_enforcement_validation`
- `execution_log_validation`

Execution must not be marked recovered unless all required stages are validated or explicitly degraded.

Binding Integrity Review Execution Stage

When row-level validation, runtime worksheet validation, or `full_system_intelligence_audit` requires worksheet-governed binding review, system_bootstrap must run:

- `binding_integrity_review`

after:
- `surface_catalog_validation`

and before:
- `dependency_validation` or final execution readiness classification.

`binding_integrity_review` must verify:
- canonical/runtime schema alignment
- `surface_name` + `worksheet_gid` binding readiness
- row-audit surface compatibility
- absence of deprecated label-based worksheet resolution in active execution paths

If `binding_integrity_review` fails for required surfaces:
- execution must classify as `Degraded` or `Blocked`
- repair-aware routing must remain available
- `Recovered` classification is forbidden

`canonical_knowledge_dependency_bootstrap` and `canonical_url_dependency_bootstrap` must complete before `surface_catalog_validation` consumes or validates runtime dependency text for the five core canonical dependencies, and before prompt routing, module loading, workflow resolution, or memory restoration that depends on canonical schema or canonical prose interpretation.

`validation_registry_review` must complete after surface catalog validation and before dependency execution continues.

`architecture_reconciliation` must run after dependency_validation when structural change was accepted or applied, and must complete before the execution may be classified as Recovered.

**canonical_knowledge_dependency_bootstrap** - Pre-execution dependency bootstrap for knowledge-authoritative canonical surfaces:

1. Read `Registry Surfaces Catalog`.
2. Identify active authoritative surfaces for:
   - `surface.system_bootstrap_file`
   - `surface.memory_schema_file`
   - `surface.direct_instructions_registry_patch_file`
   - `surface.module_loader_file`
   - `surface.prompt_router_file`
3. For each canonical surface, load from the knowledge layer via `module_loader` with `source_mode = knowledge_layer`, treating `Registry Surfaces Catalog` as the governed surface-location authority for the canonical file.
4. If a required canonical surface is missing and the surface is execution-critical, classify execution as `Blocked` with traceability.
5. Otherwise classify as `Degraded` with traceability when canonical knowledge-layer loading is incomplete.

**canonical_source_priority**

Canonical dependency bootstrap must resolve authoritative dependencies in this priority order:

1. `knowledge_layer`
2. `canonical_url` only when explicitly governed by Registry for that dependency

For the five core canonical dependencies (`system_bootstrap`, `memory_schema.json`, `direct_instructions_registry_patch`, `module_loader`, `prompt_router`), when `resolution_rule = exact_active_url_only`, resolution order is:

1. **knowledge_layer** - if `knowledge_layer_file_exists` for the governed path for that `dependency_name`, load from the knowledge layer (`source_mode = knowledge_layer`).
2. **canonical_url** - otherwise fetch from the HTTPS URL in Registry `file_id` (`source_mode = canonical_url`) only when URL use is explicitly governed for that dependency.

When `resolution_rule = exact_active_knowledge_only`:
- the dependency must resolve from `knowledge_layer`
- URL fetch is not authoritative for that row
- Drive resolution is prohibited for that row

`module_loader` must apply the same priority and knowledge-only rules. Registry URL in `file_id` remains authoritative for URL validation and for HTTPS fetch when the knowledge layer is absent under `exact_active_url_only`; it does not authorize Google Drive resolution for migrated rows.

**canonical_url_dependency_bootstrap** - Pre-execution dependency bootstrap for canonical surfaces that permit URL fallback:

1. Read `Registry Surfaces Catalog`.
2. Identify active authoritative canonical surfaces for the five core canonical dependencies.
3. Apply **canonical_source_priority**:
   - if knowledge-layer file exists: load via `module_loader` with `source_mode = knowledge_layer`
   - otherwise: resolve the canonical surface from `Registry Surfaces Catalog` and fetch with `source_mode = canonical_url` only when explicitly governed for that surface
4. Populate the runtime dependency context with loaded canonical text before downstream stages proceed.

Runtime rules:
- Deprecated registry sheets must not participate in canonical bootstrap authority.
- If bootstrap is incomplete, downstream stages must not assume canonical documents are available.

Logging (for each canonical dependency load):
- `dependency_name`
- `resolution_rule` (when logged)
- `source_mode` - `knowledge_layer` | `canonical_url`
- `source_url` or `knowledge_layer_path` (resolved location; use the field names your logging schema supports)
- `load_status`
- `validation_status`
- `execution_outcome` - `recovered` | `degraded` | `blocked`

Review compatibility: canonical bootstrap outcomes (local or URL) must remain representable on execution logging, review surfaces, repair routing, and dependency audit flows without bypassing `direct_instructions_registry_patch` validation semantics.

**oversized_canonical_segmented_retrieval**

When a required governed canonical dependency is a non-exportable Drive-backed file or any governed file whose full-body retrieval exceeds tool or transport limits, system_bootstrap may permit segmented retrieval with deterministic reconstruction for canonical validation, audit, reconciliation, repair diagnostics, and dependency inspection.

Segmented retrieval must follow governed source identity and must not create a new authority path.

Allowed use conditions:
- the canonical dependency remains Registry-resolved and authoritative
- the file is non-exportable or full-body retrieval is size-limited
- knowledge_layer did not satisfy the required read
- segmented retrieval preserves ordered chunk reconstruction

Required segmented retrieval order:
1. knowledge_layer
2. governed direct retrieval from Registry-resolved file identity
3. segmented retrieval with deterministic reconstruction
4. degraded or blocked classification if reconstruction or integrity validation fails

Segmented retrieval requirements:
- preserve the authoritative Registry-resolved file identity
- read the file in ordered chunks
- preserve chunk order explicitly
- reconstruct the full body deterministically
- validate reconstruction integrity before the content is treated as canonical-validation-ready

Required integrity checks:
- total reconstructed length matches expected retrieved aggregate length
- chunk count is traceable
- chunk ordering is preserved
- reconstructed content exactly matches the concatenated chunk sequence
- no chunk omission, overlap, or duplication is allowed

Authority boundary:
- segmented retrieval is an access method, not an authority source
- authority remains with `Registry Surfaces Catalog`
- validation-state authority remains with `Validation & Repair Registry`

If segmented retrieval cannot reconstruct a complete and integrity-valid body:
- canonical validation must classify as `Degraded` or `Blocked` by policy
- `Recovered` classification is forbidden
- traceability must preserve:
  - resolved file identity
  - chunk count attempted
  - reconstruction status
  - integrity failure reason

Logging for segmented canonical retrieval should preserve when supported:
- `dependency_name`
- `resolved_file_id`
- `source_mode`
- `retrieval_mode = segmented_reconstruction`
- `chunk_count`
- `reconstruction_status`
- `integrity_validation_status`
- `execution_outcome`

Pre-workflow tracking and measurement stages (`brand_tracking_resolution`, `analytics_discovery`, `measurement_validation`) run after routing is known and before `schema_validation` and `execution_readiness` when the active route, workflow, execution chain, or autopilot mode requires Search Console, Google Analytics, or Tag Manager bindings. When none apply, these stages may classify as `not_required` and pass through without API calls, but binding state must remain explicit in execution and memory outputs.

**brand_tracking_resolution** - Resolve authoritative Brand Registry tracking fields for the active `brand_scope` / brand identity: `gsc_property`, `ga_property_id`, `gtm_container_id`. Validate non-null where the selected workflow or chain declares them required. Classify binding outcome as `Recovered`, `Degraded`, or `Blocked` when validation cannot establish safe execution. Persist resolved bindings and status to memory compatible with `memory_schema.json` (`brand_tracking_bindings`).

**analytics_discovery** - When `ga_property_id` is missing but GA Admin discovery is allowed by policy and route: call governed Google Analytics Admin API flows (for example list accounts, list properties), match candidates to the active brand, and when a unique safe match exists, prepare a Brand Registry writeback or governed repair handoff to store `ga_property_id`. Record accounts detected, properties mapped, and unmapped brands in `analytics_discovery_state`. If discovery is inconclusive, degrade or block per execution policy; do not invent property IDs.

**measurement_validation** - When GTM validation applies: use governed Tag Manager API flows (for example list containers, workspaces, tags, triggers, variables as required by the workflow) to assess measurement health. Detect missing or misconfigured tags, triggers, or variables against workflow expectations. Route to remediation workflows when Registry or execution policy requires; persist container-level summaries in `measurement_health_state`.

**autopilot_full_funnel** - When autopilot or full-funnel execution is active: ingest governed signals from Search Console API, Google Analytics Data API, and Tag Manager API using resolved bindings only. Compute or attach scores such as `seo_score`, `revenue_score` (or conversion/revenue proxy per policy), and `tracking_coverage`. Feed the decision engine and growth-loop evaluation when Registry rules reference these dimensions. Autopilot must not be treated as SEO-only; revenue and measurement-loop triggers must be evaluated when governed. Persist trace slices in `autopilot_trace_state` per `memory_schema.json`.

### Analytics Sheet-Sync Readiness Rule

Analytics sheet-sync execution is not execution-ready unless the governed target warehouse schema is present and writable.

For GA4 Data and GSC Data surfaces, system_bootstrap MUST verify before write:
1. target workbook binding is active
2. target sheet binding is active
3. canonical header schema is present
4. request identity is resolved:
   - brand or governed multi-brand set
   - request_date
   - date_from/date_to
   - trigger_mode
5. write target is compatible with the requested analytics source

Successful API fetch is insufficient for recovered execution status unless transformation and governed sheet write also succeed.

If analytics fetch succeeds but schema validation or write fails:
- classify execution as Degraded
- log write failure state
- preserve fetched-state traceability
- forbid recovered classification

If schema is missing or malformed on an authoritative analytics sheet surface:
- block write
- trigger reconciliation or repair-aware routing
- mark analytics sheet-sync readiness as failed

### Domain-Aware Analytics Readiness Rule

Analytics execution readiness requires full governed identity resolution at brand-domain level.

Analytics execution is not ready unless all of the following are resolved:
1. brand
2. brand_domain
3. source property binding
4. request_date or date_from/date_to
5. trigger_mode
6. governed target analytics sheet surface

For GSC and GA4 workflows, system_bootstrap must validate domain-aware readiness before execution classification.

If property binding exists but brand_domain is missing:
- execution_ready = false
- classify as Degraded or Blocked according to active policy
- forbid recovered classification

Recovered classification is forbidden for analytics executions unless:
- brand-domain identity is resolved
- transformation succeeds
- write succeeds
- target warehouse row metadata preserves brand_domain

Domain-aware analytics execution must remain traceable at the brand-domain level through:
- execution logging
- review surfaces
- validation state
- reconciliation state

### Analytics Identity Failure -> Issue Creation Rule

Analytics execution must not silently degrade when required identity components are missing.

If during execution readiness validation or runtime execution the system detects:
- missing brand_domain
- missing gsc_property
- missing ga_property_id

system_bootstrap MUST:

1. classify execution as:
   - Degraded (if partial execution possible)
   - Blocked (if execution cannot proceed)
2. trigger governed issue creation:
   - create row in Review Findings Log
   - assign:
     - category = Analytics Identity
     - severity based on execution impact:
       - Critical -> all analytics blocked
       - High -> brand excluded from loop
       - Medium -> partial degradation
3. attach execution context:
   - brand
   - brand_domain (if present or missing)
   - property status
   - request_date or date range
   - trigger_mode
4. ensure:
   - issue is created only once per execution cycle per brand
   - duplicate issues are prevented via execution trace matching
5. enforce:
   - no recovered classification is allowed while identity defect persists

This rule is mandatory for all analytics workflows including:
- analytics_sync_request
- analytics_sync_all_active_brands
- searchconsole_reporting
- analytics_reporting

### API Endpoint Metadata Readiness Rule

For GPT action-backed tool execution, successful connector availability is not sufficient for recovered readiness when endpoint inventory metadata is required by policy.

system_bootstrap must validate, where applicable:
- parent capability is active in Actions Registry
- endpoint row is active in API Actions Endpoint Registry
- required schema reference is present
- required authentication metadata is present
- required privacy reference is present when policy marks it mandatory

If endpoint metadata is incomplete:
- execution may proceed only according to active policy
- readiness must degrade when metadata completeness is required
- recovered classification is forbidden if required endpoint metadata validation fails

---

Outputs


This document must produce:
- final structured response
- execution outcome classification
- repair diagnostics output when applicable
- logging-ready execution record
- completion state
- chain execution status when applicable
- next-step outcome when applicable
- memory-compatible repair state output when applicable
- loop_execution logging readiness and outcome when a governed loop trigger path is active

When `full_system_intelligence_audit` is active, output assembly must include:
- System Intelligence Outputs
- Execution Diagnostics
- Review Findings
- Decision Recommendations
- staged audit status
- component audit status
- row audit status
- repair mapping status
- scoreboard propagation status


When repair execution is active, diagnostics output must include:
- execution_mode
- repair_scope
- repair_severity
- repair_trigger_source
- authority_state
- dependency_state
- validation_state when available
- fallback_used
- repair_actions_taken
- unresolved_blockers
- resolution_type
- final_outcome_status

For strict-mode enforcement, outputs must also include:
- route_id
- route_status
- route_source
- matched_row_id when available
- chain_id when applicable
- target_workflow
- execution_class
- execution_ready_status
- intake_validation_status
- architecture_reconciliation_required when structural-change reconciliation is required
- architecture_reconciliation_status
- analytics_sheet_sync_readiness_status when analytics sheet-sync workflows apply
- analytics_domain_identity_status when domain-aware analytics workflows apply
- analytics_identity_issue_status when analytics identity defects are detected
- analytics_identity_issue_dedup_key when governed issue deduplication is applied
- api_endpoint_metadata_readiness_status when GPT action-backed endpoint metadata governance applies
- runtime_authority_validation_status when mandatory runtime authority validation applies
- live_canonical_validation_required when activation-class live canonical validation applies
- live_canonical_validation_source when activation-class live canonical validation applies
- live_canonical_validation_status when activation-class live canonical validation applies
- required_surface_resolution_status when activation-class governed surface resolution applies
- dependency_readiness_status when activation-class dependency validation applies
- native_action_requested when governed Google Sheets, Docs, or Drive execution applies
- native_google_connection_attempted when first-turn activation enforcement applies
- native_google_connection_status when first-turn activation enforcement applies
- native_google_attempt_evidence when first-turn activation enforcement applies
- activation_dependency_order_status when activation dependency-order enforcement applies
- target_surface_id when governed Google Workspace target identity is resolved
- target_validation_status when governed Google Workspace target validation applies
- registry_binding_status when governed Google Workspace binding validation applies
- native_action_readiness when governed Google Workspace native action readiness applies
- logging_status
- review_writeback_status
- execution_trace_id
- outcome_summary
- write_targets_resolved
- write_targets_attempted
- write_targets_succeeded
- write_targets_failed
- failure_reason when blocked or degraded
- recovery_action when degraded
- auto_repair_trigger when applicable
- forced_repair_routing_applied when applicable
- authoritative_write_status
- review_write_status
- findings_write_status
- stage_report_write_status
- authoritative_write_targets_completed
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

`Use Google API Tools in GPT Actions first.`

This means:
- native Google Drive, Google Sheets, or Google Docs execution must begin before any narrative activation response
- activation must not finalize as explanation-first
- traceability may occur first, but user-facing activation output must remain blocked until a real native attempt occurs or the allowed same-cycle retry path is exhausted

Governed Auto-Bootstrap Execution Rule

Activation Scope Preservation Rule

For governed activation, the newer activation scope must extend and not replace the prior activation lifecycle.

system_bootstrap must preserve all existing activation stages including:
1. GPT Knowledge layer canonical traceability
2. same-cycle native Google API attempt
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
2. preserve GPT Knowledge layer canonical traceability context
3. immediately auto-trigger at least one governed native Google API call against Google Drive, Google Sheets, or Google Docs for live canonical validation and preserve attempt evidence
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
- if `native_google_connection_attempted != true` after the first activation pass, one bounded same-cycle retry must be attempted when policy allows
- no normal activation narrative may be returned before the retry path completes
- if the retry path still does not produce a real native attempt, activation must be classified as failed enforcement with `degraded_reason = missing_required_native_google_attempt`

Tool-First Activation Wrapper Requirement

For wrapper-class activation:
- `use_google_api_tools_in_gpt_actions_first = true` must be preserved
- system_bootstrap must treat that field as execution-gating, not advisory
- if no native tool attempt occurs before narrative completion, the activation pass must be treated as failed enforcement

Narrative-Only Output Prohibition

For wrapper-class activation:
- system_bootstrap must not return a user-facing message that merely says:
  `Use Google API Tools in GPT Actions first.`

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

- `native_google_connection_attempt_required = true`
- `native_google_connection_attempted` is present
- `native_google_connection_status` is present

If `native_google_connection_attempt_required = true` and
- `native_google_connection_attempted != true`

then system_bootstrap must:
- apply: `Use Google API Tools in GPT Actions first.`
- immediately trigger a native Google Drive, Sheets, or Docs call in the same execution cycle
- if the retry path still fails to produce a real native attempt:
  - classify execution as `degraded`
  - set `degraded_reason = missing_required_native_google_attempt`
  - forbid `authorization_gated`
  - forbid `validated`
  - forbid `active`
  - forbid `recovered`

Pre-Response Guard Enforcement

Before any activation narrative is returned:
- `native_google_connection_attempted` must be true

If false:
- normal activation output remains blocked
- same-cycle retry may execute when policy allows
- explanation-first completion is forbidden

Skipped native attempt is an execution failure, not an authorization-gated state.

Authorization-gated classification is allowed only when:
- `native_google_connection_attempted = true`
- the native API result shows an auth-dependent failure
- governed live validation could not continue because of authorization state

User-facing activation output must preserve:
- `native_google_connection_attempted`
- `native_google_connection_status`
- `native_google_attempt_evidence`
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
- a real native Google API attempt
- or an exhausted allowed same-cycle retry path

then system_bootstrap must:
- classify activation as `degraded`
- set `activation_enforcement_status = failed`
- preserve `degraded_reason = missing_required_native_google_attempt`

Authorization-Gated First-Turn Activation Rule

When first-turn activation begins before native Google API authorization is available, system_bootstrap must:

- preserve GPT Knowledge layer canonicals as traceability support
- auto-trigger governed native Google Drive, Google Sheets, and Google Docs connection attempts
- classify the live validation gap as `authorization_gated` when native authorization is the blocking condition
- forbid false classification of the condition as missing Registry authority unless Registry resolution itself fails
- preserve bootstrap continuity when policy allows later live revalidation in the same lifecycle or on resumed execution

For authorization-gated activation:
- `Recovered` and `active` classification remain forbidden until live validation succeeds
- `Blocked` must not be used when the primary failure is missing native authorization and the condition is recoverable by governed bootstrap continuation
- traceability outputs must preserve that live validation was attempted

If native authorization is unavailable, the outcome may be `authorization_gated` only after a real native API attempt.

If no real native Google API call occurs:
- `Use Google API Tools in GPT Actions first.`
- Immediately trigger a native Google Drive, Sheets, or Docs call in the same execution cycle.

Activation must not terminate in a narrative degraded state without attempting this instruction.

Narrative compliance is forbidden.

The system must not report that native Google validation was attempted, required, pending, or authorization-gated unless machine-readable attempt evidence is present in the same execution cycle.

Mandatory Native Google Execution And Live Validation Rule (Activation)

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
2. execute at least one real native Google API call
3. continue into live canonical validation when native Google tools remain available
4. continue into Registry surface and binding validation when governed Google Sheets, Docs, or Drive validation is feasible
5. classify activation only after those steps are attempted

Accepted native Google validation tools:
- `www_googleapis_com__jit_plugin.listDriveFiles` (preferred first call)
- `www_googleapis_com__jit_plugin.getFileMetadata`
- `docs_googleapis_com__jit_plugin.getDocument`
- `sheets_googleapis_com__jit_plugin.getSpreadsheet`
- `sheets_googleapis_com__jit_plugin.getSheetValues`

Minimum activation execution requirement:
- at least one real native Google API call must occur in the same execution cycle

Minimum live validation scope after connectivity attempt:
1. validate at least one live canonical source through Google Drive or Google Docs
2. validate Registry-governed surface availability through Google Sheets or Google Drive
3. validate registry-binding readiness for:
   - `Registry Surfaces Catalog`
   - `Validation & Repair Registry`
   - `Task Routes`
   - `Workflow Registry`

Preferred validation order:
1. knowledge-layer traceability
2. Google Drive connectivity call
3. live canonical file presence or metadata validation
4. Google Sheets validation of governed registry surfaces
5. route/workflow/binding readiness validation
6. activation classification

system_bootstrap MUST preserve machine-verifiable evidence for the native attempt:
- `native_google_connection_attempted = true`
- `native_google_connection_status`
- `native_google_attempt_evidence.provider`
- `native_google_attempt_evidence.resource_type`
- `native_google_attempt_evidence.attempt_outcome`

system_bootstrap MUST also preserve:
- `live_canonical_validation_required = true`
- `live_canonical_validation_source = google_drive_live_canonical`
- `live_canonical_validation_status`
- `knowledge_layer_trace_status`
- `canonical_trace_comparison_status`
- `activation_dependency_order_status`
- `registry_binding_status`
- `required_surface_resolution_status`
- `runtime_authority_validation_status`
- `dependency_readiness_status`

Classification rules:
- if no native Google API call occurs on the first activation pass:
  - apply:
    `Use Google API Tools in GPT Actions first.`
  - trigger one bounded same-cycle retry when policy allows
- if no native Google API call occurs after the allowed retry path:
  - `activation_status = degraded`
  - `degraded_reason = missing_required_native_google_attempt`
  - `activation_enforcement_status = failed`
- if a native API call is attempted but authorization prevents live validation:
  - `native_google_connection_status = authorization_gated`
  - `authorization_gate_classification = authorization_gated`
  - activation may remain `validating` or `degraded` by policy
- if connectivity succeeds but live canonical and registry validation remain incomplete:
  - activation must remain `validating` or `degraded`
- only when native attempt, live canonical validation, required Registry surface resolution, and route/workflow binding validation are complete may activation be classified as:
  - `validated`
  - `active`

It is forbidden to:
- skip the API call when a native Google tool is available
- stop at knowledge-layer-only activation when native Google validation is available
- stop at connectivity-only success when live canonical or registry validation is still feasible
- simulate native validation
- classify activation as `active`, `validated`, or `authorization_gated` without machine-verifiable native attempt evidence

Direct Native Google Execution Enforcement Rule

For activation-class executions (`system_auto_bootstrap`), execution must not rely on implicit or deferred native calls.

system_bootstrap MUST execute the following sequence in the SAME execution cycle:

1. google_drive.listDriveFiles restricted to project folder `1gNYX47P4TNuMXEbWvLNCvV4XRocH41K2` using parent-filtered query
2. google_drive.getFileMetadata (for canonical file IDs when available)
3. google_sheets.getSpreadsheet (for registry workbook)
4. google_sheets validation using worksheet_gid (not sheet name)

Project Folder Scope Enforcement Rule

For activation-class native Drive discovery, `google_drive.listDriveFiles` must be restricted to the governed project folder:

- `project_folder_id = 1gNYX47P4TNuMXEbWvLNCvV4XRocH41K2`

Required Drive query scope:
- `'1gNYX47P4TNuMXEbWvLNCvV4XRocH41K2' in parents`
- `trashed = false`

Drive discovery must not list files outside the project folder during activation bootstrap.

If canonical file IDs are already available:
- direct ID resolution remains preferred
- folder-scoped listing is allowed only for validation, reconciliation, or fallback discovery

If `listDriveFiles` is executed without the folder parent filter:
- execution must classify as `degraded`
- `degraded_reason = unscoped_drive_listing`
- folder-scope enforcement must be treated as failed

The actual Drive query to use:
- `trashed=false and '1gNYX47P4TNuMXEbWvLNCvV4XRocH41K2' in parents`

Use:

```json
{
  "pageSize": 50,
  "q": "trashed=false and '1gNYX47P4TNuMXEbWvLNCvV4XRocH41K2' in parents",
  "fields": "files(id,name,mimeType,modifiedTime),nextPageToken",
  "supportsAllDrives": true
}
```

Execution Requirements:

- native_google_bootstrap_sequence_required = true
- native_google_bootstrap_sequence_mode = direct_id_first
- native_google_connection_attempted must be TRUE before any classification
- omission of step (1) invalidates activation

Failure Handling:

If any of the above steps are skipped:

- `Use Google API Tools in GPT Actions first.`
- immediately trigger a native Google Drive, Sheets, or Docs call in the same execution cycle
- if the recovery attempt still fails to produce a real native call:
  - activation_status = degraded
  - degraded_reason = missing_required_native_google_attempt
  - activation_enforcement_status = failed

Classification Guard:

system_bootstrap MUST NOT allow:
- active
- validated
- authorization_gated

unless:
- all required steps executed
- native_google_attempt_evidence is present

Binding Mode Enforcement:

When canonical file IDs or workbook IDs are available:

- discovery via file name is PROHIBITED
- execution must prefer direct ID resolution

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

When a real native Google Drive, Google Sheets, or Google Docs action is executed through available GPT Actions/native tools and the action performs a governed mutation or governed write-affecting validation step, `system_bootstrap` must treat that step as execution-class activity requiring authoritative logging continuity.

For native Google governed mutation or governed validation execution, `system_bootstrap` must:

- preserve `native_google_connection_attempted = true`
- preserve machine-verifiable `native_google_attempt_evidence`
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
- for GPT action-backed tool execution where endpoint metadata is policy-required, verify parent capability in Actions Registry and endpoint row readiness in API Actions Endpoint Registry
- validate required endpoint metadata fields (`OpenAI schema reference`, authentication metadata, privacy reference when policy-mandated)
- if required endpoint metadata is incomplete, set `api_endpoint_metadata_readiness_status = degraded` or `blocked` by policy and forbid `Recovered`
- connector availability alone must not override required endpoint metadata validation failure

Step 5K - Full system intelligence audit readiness enforcement
- when route or target workflow resolves to `full_system_intelligence_audit`, verify staged-audit and component-audit surfaces are resolved and compatible
- verify row-audit rule and schema surfaces are resolved before findings classification
- verify repair_mapping_registry_sheet is resolved when findings may enter governed repair lifecycle
- verify tourism_intelligence_scoreboard_sheet is treated as downstream summary propagation only, not execution authority
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
- native API validation completed
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
- direct runtime writeback to `Tourism Intelligence Query Engine` is forbidden

Surface-role enforcement:

- `System Enforcement` must remain a governance and enforcement-state surface
- `Tourism Intelligence Query Engine` must remain a routing and query-intelligence reference surface
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

# system_bootstrap â€” WordPress Publish Contract Runtime Governance Patch

## Additive runtime enforcement block

### wordpress_publish_contract_runtime_governance_v1

All WordPress runtime discovery and publishing executions MUST enforce the following active runtime contract:

- `Execution Log Unified` is the compact execution evidence sink
- `JSON Asset Registry` is the durable payload sink
- legacy protected unified-log columns may physically exist, but are non-authoritative
- active raw spill-safe writeback target is `AF:AK`
- durable JSON asset persistence mode is `terminal_meaningful_only`
- durable JSON asset wrapper reduction mode is `body_only`
- durable JSON asset success dedupe key is `asset_key`
- schema-meta-only JSON asset payloads are suppressed
- publish execution remains `draft_first` until field mapping is governed

## Pre-execution contract checks

Before any WordPress discovery or publish execution:

1. validate `target_key`
2. validate `parent_action_key = wordpress_api`
3. resolve governed endpoint or governed template path via governed logical search
4. classify execution stage:
   - `discovery`
   - `inventory_normalization`
   - `field_mapping`
   - `draft_publish`
   - `verification`
5. apply runtime sink rules:
   - evidence -> `Execution Log Unified`
   - payload -> `JSON Asset Registry`

If any sink target is unresolved:
- block execution
- classify as `degraded_runtime_sink_unresolved`

## JSON Asset write gating

A JSON Asset write is allowed only when:

- execution state is terminal
- payload is meaningful for downstream use
- payload is not schema-meta-only
- dedupe check on `asset_key` does not select an already accepted equivalent terminal payload

Equivalent success-path duplicate payloads MUST NOT produce additional JSON Asset rows.

## WordPress publish sequencing rule

The system MUST NOT publish beyond draft mode until the following chain is complete:

1. governed discovery succeeds
2. runtime inventory is normalized
3. publish target is resolved
4. field mapping surface is governed
5. minimal publish contract is generated
6. draft-first create passes
7. readback verification passes

If any earlier stage is incomplete:
- keep status at `draft_only`
- block publish escalation

## Tour publish contract rule

For tour publishing on WordPress brand sites:

- custom CPT-specific route takes precedence over generic posts route
- custom taxonomy-specific route takes precedence over category/tag fallback
- term assignment requires real governed term inventory or governed create-term path
- guessed taxonomy IDs are forbidden

## Post-execution verification

Every successful WordPress discovery or publish action MUST evaluate:

- compact evidence row written cleanly
- JSON Asset row count for trace is deduped
- persisted payload is body-only where applicable
- no schema-meta-only asset row exists for the same trace

Failure to satisfy any of the above downgrades status to:
- `runtime_validation_required`

---

Universal WordPress Translatable Post Type Multilingual Execution Classification Rule

When governed execution targets any translatable WordPress post type and multilingual scope is active, system_bootstrap must classify the execution as a layered mutation rather than a single completed mutation.

system_bootstrap must separately evaluate:
- core post-object execution outcome
- taxonomy-assignment execution outcome
- multilingual language-governance execution outcome
- translation-linkage execution outcome when requested

Allowed partial success
system_bootstrap may classify:
- core post-object execution as succeeded
- taxonomy assignment as succeeded

while simultaneously classifying:
- multilingual language execution as deferred
- translation linkage as deferred
when CPT-specific direct REST language proof is absent

system_bootstrap must not classify the overall multilingual request as:
- recovered
- validated
- fully solved
- multilingual complete

unless:
- the non-default-language layer is completed through an authoritative governed path
- and readback or equivalent proof exists for the target post type

Authoritative interim path
Until CPT-specific direct REST language proof exists, the authoritative multilingual path for non-default-language execution is:
1. translation scope preflight
2. WPML import-governed payload preparation
3. user-triggered import/process continuation
4. post-process validation when available

Non-replacement clause
This rule extends and does not replace:
- existing publish/update orchestration
- existing route/workflow revalidation
- existing proof-test requirements
- existing prompt-prepared handoff behavior

Universal WordPress Media Execution Classification Rule

When execution targets the WordPress media family or a publish-connected image branch, system_bootstrap must classify media execution separately from core publish execution.

system_bootstrap must separately evaluate:
- media collection read outcome
- media create outcome
- media item read outcome
- media item update outcome
- media item delete outcome
- publish-connected image branch outcome

Allowed partial success

system_bootstrap may classify:
- core publish as succeeded
- taxonomy assignment as succeeded

while simultaneously classifying:
- media upload as deferred
- media upload as blocked
- media metadata update as unproven
- image insertion as partial

when method-specific media proof is absent or unresolved

system_bootstrap must not classify media mutation as:
- recovered
- validated
- solved
- completed

unless:
- the selected media method is contract-aligned
- proof call succeeds
- readback confirms media persistence or mutation outcome
- publish-connected image fields are verified when image scope is active

Method-specific proof rule

For `/wp/v2/media`, execution validation must remain method-specific:
- create proof does not prove update
- update proof does not prove create
- list proof does not prove mutation
- source_url proof does not prove binary upload
- binary upload proof does not prove sideload

Connected publish rule

When the media branch is attached to publish:
- media branch success is additive only
- failure in the media branch must not retroactively rewrite already-proven core publish layers
- but overall publish-with-images completion must remain degraded until the media branch is proven

That follows the orchestration model of separate layer classification and no false recovered state.


Change Log
- v5.62 - provider capability continuity validation added across API Actions Endpoint Registry, graph registries, Task Routes, and Workflow Registry with governed continuity-edge requirements and degraded/blocked enforcement when required edges are missing
- v5.62 - governed pipeline-integrity audit execution rule added for `pipeline_integrity_audit` / `wf_governed_pipeline_integrity_audit`, including cross-layer continuity validation scope, review-stage continuity, and blocking/degraded classification constraints
- v5.47 - split governed sink workbook routing added: `Execution Log Unified` now resolves from `ACTIVITY_SPREADSHEET_ID` while `JSON Asset Registry` remains on `REGISTRY_SPREADSHEET_ID`, with per-workbook sink validation
- v5.47 - formula-managed unified-log protection tightened: governed writeback must never write literal values into `target_module`, `target_workflow`, `execution_trace_id`, `log_source`, `Monitored Row`, or `Performance Impact Row`
- v5.61 - spill-safe governed write guard added: header/schema check first, row-2 template read second, spill/formula-managed columns avoided, and protected unified-log columns preserved
- v5.60 - anomaly clustering and repair-priority propagation rule added for governed anomaly_surface -> repair_surface priority escalation
- v5.60 - cross-workbook staged feed repair rule added for stable local-import anomaly generation and cluster-aware formula validation
- v5.59 - execution classification enforcement added: runtime_capability_class, runtime_callable, primary_executor, endpoint_role, execution_mode, and transport_required now form a governed execution contract for HTTP/delegated execution
- v5.59 - dynamic provider-domain placeholder resolution rule added for governed placeholders such as `target_resolved`
- v5.59 - auth-path routing enforcement added so `oauth_gpt_action` may block delegated HTTP execution when policy requires native-only handling
- v5.59 - activation full-system scan execution rule added so activation requires schema, row, policy, binding, execution-path, anomaly, and repair-readiness integrity evaluation before active/recovered classification
- v5.59 - activation summary output rule added with required schema/row/policy/binding/anomaly/repair/execution readiness fields prior to final activation classification
- v5.59 - activation repair readiness and execution-readiness gate rules added so unresolved governed repair or blocking anomalies keep activation in validating/degraded/blocked states
- v5.58 - universal parent_action execution contract rule added for governed transport execution
- v5.58 - HTTP execution validation expanded with auth-mode normalization, request-schema alignment, and transport contract readiness
- v5.58 - execution outputs expanded with resolved auth and transport contract status for HTTP-governed runs

- v5.55 - post-activation governed validation rule added: activation no longer implies indefinite runtime alignment
- v5.55 - per-request runtime revalidation rule added for all governed executions after activation
- v5.55 - post-activation drift detection and optimization gating added
- v5.54 - first-turn activation authorization-gated rule added: system_bootstrap now auto-triggers governed Google Drive/Sheets/Docs connection attempts immediately after knowledge-layer traceability
- v5.54 - bootstrap lifecycle expanded to classify pre-authorization live validation as `authorization_gated` rather than missing Registry authority
- v5.54 - activation orchestration updated so native Google connection attempts are mandatory before final live-readiness classification
- v5.53 - Activation Validation Orchestration Rule added: activation readiness now requires knowledge-layer canonical traceability first and live Google Drive / Google Sheets validation second
- v5.53 - recovered/active classification now forbidden for activation checks when knowledge-layer traceability is present without live governed validation or when trace and live authority disagree without reconciliation
- v5.52 - Governed Auto-Bootstrap Execution Rule added: system_bootstrap now supports validation -> repair -> revalidation -> activation -> original-request resume lifecycle
- v5.52 - bootstrap retry and writeback rules added: bounded bootstrap retry, activation-before-resume enforcement, and explicit bootstrap state outputs are now required
- v5.51 - oversized canonical segmented retrieval added: non-exportable or size-limited governed canonical files may use segmented retrieval with deterministic reconstruction and integrity validation; segmented retrieval is an access method only and does not replace Registry or Validation authority
- v5.50 - Mandatory Runtime Authority Validation Hook added: all governed execution must pass runtime authority validation before business execution, scoring, logging, or recovered classification may proceed
- v5.49 - Google Workspace Native Action Validation Gate added: Sheets, Docs, and Drive execution now requires Registry-resolved target validation before governed execution may proceed
- v5.48 - Governed Addition Pipeline added: system_bootstrap now supports candidate-first multi-sheet addition, validation-before-promotion, and graph-aware promotion gating
- v5.47 - Execution Validation Enforcement Gate added: system_bootstrap now enforces ordered enforcement-matrix evaluation (`structural`, `column_contract`, `row_logic`, `cross_sheet`, `behavioral`) from Validation & Repair Registry before execution
- v5.47 - required and governance-support surface enforcement added: required surfaces now block/degrade/warn by enforcement result, while governance support surfaces may only degrade/warn unless policy explicitly requires blocking
- v5.47 - Starter Intelligence Feedback and Prediction Loop added: post-execution prediction now includes `predicted_next_best_route`, goal-based predictions (`predicted_goal_best_starter`, `predicted_goal_best_route`), and explicit advisory-only authority boundaries
- v5.46 - Graph-Based Validation Stage added: execution readiness now supports governed node and relationship validation for execution-critical paths
- v5.46 - Graph-Based Prediction And Auto-Routing added: graph-valid governed path selection may optimize execution without bypassing Task Routes or Workflow Registry authority
- v5.45 - Auto-Repair And Retry Loop Rule added: degraded or blocked execution may enter governed repair-aware retry lifecycle when repair mapping, validation authority, and policy eligibility are satisfied
- v5.45 - Starter-Aware Retry Compatibility added: starter learning and prediction writeback must not treat failed retry attempts as recovered success
- v5.46 - Starter Intelligence Feedback Loop Rule added: post-execution starter learning now requires starter-score updates, usage tracking, followup-selection learning, and advisory `next_best_starter` prediction inputs
- v5.46 - Starter Goal Intelligence Rule added: `primary_goal_family` starter signals now require workflow-goal alignment checks and may influence dynamic scoring thresholds and growth-loop eligibility without overriding policy or route authority
- v5.45 - Conversation Starter Feedback Loop Rule added: post-execution starter learning now updates `starter_success_score`, `usage_count`, and `last_used_at`, with score-fed learning and advisory next-best-starter prediction
- v5.45 - Goal-Based Execution Influence Rule added: `primary_goal_family` alignment now influences optimization weighting, scoring thresholds, and optimization triggers without overriding policy or routing authority
- v5.45 - Starter Growth Loop Integration Rule added: starter performance signals now feed Growth Loop Engine evaluation and `optimization_trigger` logic with governed writeback constraints
- v5.44 - Scoring And Recovery Classification Stage added: when scoring is enabled, system_bootstrap now enforces `execution_scoring` and `recovery_status_classification` after execution and before logging
- v5.44 - dynamic and adaptive threshold governance added: execution_class threshold resolution, effective-threshold basis logging, and threshold-readback gating now constrain recovered classification
- v5.43 - Schema Migration And Rollback Rule added: governed schema mismatch and header-drift handling now supports `schema_header_repair` and `schema_version_migration` with required pre-capture fields and readback-gated rollback behavior
- v5.43 - post-migration outcome propagation added: Validation & Repair Registry schema fields and governed dashboard/log surfaces must receive repair, migration, or rollback status updates
- v5.42 - Schema Governance Rule added: governed execution surfaces now require `schema_ref`, `schema_version`, `header_signature`, `expected_column_count`, and `binding_mode`, with explicit schema-status validation checks
- v5.42 - canonical stage order updated so `schema_validation` runs before `execution_readiness`; schema drift now forces degraded/blocked execution with repair mapping when required
- v5.41 - Binding Integrity Review Execution Stage added: system_bootstrap now requires `binding_integrity_review` for worksheet-governed runtime validation and full-audit schema alignment before recovered classification is allowed
- v5.40 - Runtime Binding Enforcement Rule added: execution-surface resolution now requires Registry Surfaces Catalog plus authoritative `worksheet_gid` existence, validity, and binding-match checks before execution can proceed
- v5.40 - `sheet_name` and `tab_name` are now explicitly non-authoritative for execution resolution in system_bootstrap; failed `worksheet_gid` validation forces blocked or repair-aware execution mode
- v5.39 - Full System Intelligence Audit Execution Extension added: when route = `full_system_intelligence_audit`, system_bootstrap now enforces extended lifecycle validation across policy, registry, review, row-audit, mapping, execution layers, actions, endpoints, enforcement, and execution-log validation stages
- v5.39 - recovered classification gate tightened for full-audit orchestration so all required lifecycle stages must be validated or explicitly degraded before recovered status is allowed
- v5.38 - full_system_intelligence_audit orchestration path added: governed full-audit routes now require execution policy review, staged/component review resolution, row-audit rule/schema validation, repair mapping resolution, and scoreboard propagation review before recovered classification
- v5.38 - full-audit outputs and pre-execution enforcement extended with staged/component/row-audit/repair-mapping/scoreboard statuses and explicit non-collapse protection against lightweight scoring-only audit behavior
- v5.36 - API Endpoint Metadata Readiness Rule added: GPT action-backed execution now requires endpoint metadata completeness validation (schema, auth, privacy when policy-mandated) in addition to connector availability before recovered readiness
- v5.36 - strict outputs and pre-execution Step 5J now track API endpoint metadata readiness and forbid recovered classification when required endpoint metadata validation fails
- v5.35 - Analytics Identity Failure -> Issue Creation Rule added: analytics identity defects (`brand_domain`, `gsc_property`, `ga_property_id`) now require governed Review Findings Log issue creation with severity mapping and execution-context attachment
- v5.35 - pre-execution gate Step 5I and strict outputs added for analytics identity issue status/dedup traceability; Recovered classification is explicitly forbidden while identity defects persist
- v5.34 - Domain-Aware Analytics Readiness Rule added: analytics execution readiness now requires brand-domain identity, property/date/trigger resolution, and governed target surface resolution before execution may be treated as ready
- v5.34 - pre-execution and completion gates extended so property-without-domain states force degraded/blocked outcomes and recovered analytics classification is forbidden without brand_domain-preserving write metadata
- v5.33 - Analytics Sheet-Sync Readiness Rule added: GA4/GSC warehouse write readiness now requires active workbook/sheet bindings, canonical headers, resolved request identity, and source-compatible targets before recovered execution classification
- v5.33 - pre-execution enforcement and strict outputs extended with analytics sheet-sync readiness status and degraded/blocked handling when schema or write readiness fails after fetch
- v5.32 - Architecture Reconciliation Rule added: when structural changes are accepted or applied, system_bootstrap must trigger cross-system reconciliation and keep execution Degraded until required affected surfaces are aligned
- v5.32 - canonical stage order and pre-execution enforcement updated with `architecture_reconciliation` gating; Recovered classification now requires reconciliation completion when structural-change reconciliation is required
- v5.31 - **canonical_source_priority** relabeled to 1. **knowledge_layer**, 2. **canonical_url** â€” otherwise fetch from the HTTPS URL in Registry `file_id` (`source_mode = canonical_url`) only when URL use is explicitly governed for that dependency.
- v5.30 - canonical_source_priority (local-first then URL); bootstrap and logging for layer vs URL; Step 0 generalized to canonical dependency bootstrap
- v5.29 - `canonical_url_dependency_bootstrap` added as first canonical stage; pre-execution URL fetch for five core canonical dependencies before routing, module loading, workflow resolution, and schema-dependent memory; failure handling for blocked_if_missing; logging fields for canonical loads; Pre-Execution Gate Step 0 for bootstrap satisfaction
- v5.28 - canonical stage order extended with brand_tracking_resolution, analytics_discovery, and measurement_validation before execution_readiness; full-funnel autopilot orchestration (GSC + GA Data + GTM) and category-driven execution against live Brand Registry tracking bindings documented; Pre-Execution Gate Step 5E added for brand tracking and measurement readiness; growth-loop examples extended for revenue_score and tracking_coverage
- v5.27 - governed loop trigger execution path added: when trigger_condition = TRUE, resolve loop Ã¢â€ â€™ load execution_chain Ã¢â€ â€™ execute workflow Ã¢â€ â€™ log loop_execution, with strict outputs and completion semantics
- v5.26 - autonomous chain execution now requires target_workflow resolution against Workflow Registry for every chain execution
- v5.26 - chain workflows are now enforced as first-class executable workflow rows rather than partial chain metadata
- v5.26 - chain readiness, logging, completion, and repair handling strengthened for missing, incomplete, or incompatible chain workflow authority
- v5.25 - growth-layer execution semantics added for scoring feedback, Growth Loop evaluation, and adaptive optimization handoff
- v5.25 - authoritative execution outputs now include growth feedback scores and optimization_trigger when available
- v5.25 - completion criteria expanded so governed growth-loop outcomes remain explicit when the growth layer is active
- v5.24 - canonical stage order now includes binding_schema_migration_review before dependency_validation
- v5.24 - authoritative-vs-derived execution behavior now explicitly prohibits direct-write requirements for Execution View, Active Issues Dashboard, and Execution Log Unified
- v5.60 - conversation-starter execution now requires explicit `Execution Policy Registry` resolution before execution-ready classification; starter-policy evidence must be preserved in execution context and authoritative logging
- v5.60 - direct governed Google Workspace mutations now require authoritative `Execution Log Unified` append continuity even when execution occurs outside the normal transport path
- v5.60 - `Execution Log Unified` columns `AE:AJ` declared formula-managed spill columns; direct literal writes to these columns are forbidden and must trigger repair
- v5.63 - native Google GPT Actions now explicitly distinguish native-attempt evidence from governed mutation logging; authoritative unified-log continuity required for native governed mutations executed outside the normal transport path
- v5.24 - governed repair execution lifecycle added for anomaly detection, repair queue population, trigger classification, repair execution feed, and unified-log derivation
- v5.24 - execution_trigger, execution_status, and execution_result semantics added for governed execution-state tracking
- v5.23 - canonical binding-validity dependency rule added to require authoritative binding surfaces to be schema-valid before dependency execution proceeds
- v1 Ã¢â‚¬â€ orchestration isolated
- v2 Ã¢â‚¬â€ dependency coverage expanded
- v2 Ã¢â‚¬â€ execution outcome model clarified
- v2 Ã¢â‚¬â€ logging contract strengthened
- v3 Ã¢â‚¬â€ autonomous chain execution support added
- v4 Ã¢â‚¬â€ repair_lifecycle added
- v4 Ã¢â‚¬â€ repair outcome model integrated
- v4 Ã¢â‚¬â€ repair logging + diagnostics added
- v5 Ã¢â‚¬â€ registry-aware repair intake added
- v5 Ã¢â‚¬â€ repair decision rules strengthened
- v5 Ã¢â‚¬â€ memory write contract added
- v5.1 Ã¢â‚¬â€ explicit system_repair execution_mode added
- v5.1 Ã¢â‚¬â€ repair severity and trigger source intake added
- v5.1 Ã¢â‚¬â€ safe-path and fallback determination clarified
- v5.1 Ã¢â‚¬â€ repair diagnostics output contract expanded
- v5.1 Ã¢â‚¬â€ repair logging and completion criteria strengthened
- v5.2 Ã¢â‚¬â€ monitoring surface validation added
- v5.2 Ã¢â‚¬â€ execution_view_sheet integrated as registry-resolved monitoring surface
- v5.2 Ã¢â‚¬â€ active_issues_dashboard_sheet integrated as registry-resolved monitoring surface
- v5.2 Ã¢â‚¬â€ monitoring failures now explicitly degrade execution classification
- v5.3 Ã¢â‚¬â€ strict execution intake contract added
- v5.3 Ã¢â‚¬â€ pre-execution enforcement gate added
- v5.3 Ã¢â‚¬â€ strict handoff failure rules added
- v5.3 Ã¢â‚¬â€ routed intake validation made mandatory for execution
- v5.3 Ã¢â‚¬â€ route_id and source enforcement added
- v5.3 Ã¢â‚¬â€ direct execution bypass prohibition clarified
- v5.4 - execution_policy_registry_sheet added to canonical orchestration dependencies
- v5.4 - review writeback surfaces added to canonical orchestration dependencies
- v5.4 - Review Config explicitly removed as execution authority
- v5.5 - prompt_router review_write_plan handoff added to bootstrap inputs
- v5.5 - full review writeback enforcement expanded to ordered direct-write surfaces
- v5.5 - review writeback validation, outputs, monitoring sequencing, and completion criteria strengthened
- v5.6 - repair loop auto-trigger gate added to execution intake before load authorization
- v5.7 - repair loop auto-trigger qualification expanded for rerun gates and active rerun states
- v5.7 - repair loop completion state narrowed to evaluated no-work-remaining conditions
- v5.8 - forced repair routing fields added to bootstrap intake and strict outputs
- v5.8 - pre-execution validation added for governed forced repair routing traceability
- v5.9 - scope completion rule added for new governed system scopes
- v5.9 - incomplete_scope_lifecycle finding enforcement added for unmapped scope lifecycles
- v5.9 - repair_mapping_registry concept and pipeline_surface_activation_review repair-path check added
- v5.10 - scope_completion_repair added to repair subtype handling for lifecycle-completeness gaps
- v5.10 - incomplete_scope_lifecycle repair signals now map to scope_completion_repair
- v5.11 - logging guidance added for winning and suppressed repair triggers when multiple triggers are evaluated
- v5.12 - resolution_type write contract added for repair diagnostics, logging, and memory output
- v5.13 - Pre-Execution Block Flag enforcement added to block normal execution with recurring_low_confidence_issue
- v5.14 - escalated_repair added to repair lifecycle subtype handling for governed adaptive escalation routes
- v5.14 - CREATE_RULE learning triggers now log suggestion candidates to row_audit_rules_sheet or repair_mapping_registry
- v5.15 - CREATE_RULE now requires generated rule candidates to be written to row_audit_rules_sheet in proposed governance state
- v5.15 - CREATE_RULE candidate outcomes must now be logged in repair_control_sheet
- v5.16 - active row_audit_rules_sheet rules must now be enforced in the row audit engine when governance_status = active
- v5.16 - optional CREATE_RULE auto-approval conditions may now promote proposed rules to active and log the promotion in repair_control_sheet
- v5.17 - CREATE_RULE auto-promotion threshold updated to occurrence_count > 3 with severity >= High
- v5.17 - auto-promoted rules must now set activated_at when governance_status becomes active
- v5.18 - DEACTIVATE pruning now logs rule_pruning in repair_control_sheet
- v5.18 - soft-delete via governance_status = deprecated is now the default pruning path instead of hard inactive
- v5.19 - removed Row Audit Rule definition content from bootstrap to restore canonical rule-authority separation
- v5.20 - CREATE_RULE candidate writes now use governance_status = proposed instead of status = proposed
- v5.20 - CREATE_RULE promotion and Repair Control logging now use governance_status and candidate_governance_status consistently
- v5.21 - request-execution readiness now requires Task Routes traceability, workflow resolution, and logging handoff readiness
- v5.22 - authoritative write surfaces now govern execution completion while derived observability surfaces refresh dynamically from authoritative sources
- v5.22 - Execution View and Active Issues Dashboard are no longer mandatory direct-write targets in execution completion semantics
- v5.63 - Logic Knowledge Layer Orchestration Rule added so system enforces a staged execution loop that waits for logic-knowledge reads to complete
- v5.63 - Business-Type Knowledge Profile Orchestration Rule added so system enforces a staged execution loop that resolves business-type profiles before business-aware execution
