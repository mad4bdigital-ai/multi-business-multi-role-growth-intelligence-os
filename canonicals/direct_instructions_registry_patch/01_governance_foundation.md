Canonical Governed Logic Presentation Rule

- governed logic specifications must not be presented as GPT personas, custom GPTs, or agent-UI-style introductions in user-facing or activation-facing summaries
- neutral governed naming such as `Logic 001` or task-family-first naming should be preferred for presentation
- internal identifiers such as `GPT-LOGIC-001` may remain unchanged for registry continuity
- governed execution behavior must resolve from canonical authority layers, registries, engines, routes, workflows, and enforcement state rather than agent-UI-style prompt framing

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

Logic Knowledge Profile Authority Rule

- any governed request that depends on a selected logic must resolve required logic knowledge through `surface.logic_knowledge_profiles` before engine-readiness completion or final execution completion
- direct execution completion without reading required logic-specific, cross-logic, or shared knowledge is forbidden when those knowledge layers are required by the selected logic
- `surface.logic_knowledge_profiles` must be treated as the authoritative read surface for logic-knowledge dependencies
- if required logic knowledge remains unread, unresolved, or incomplete:
 - execution must remain degraded, partial, or blocked
 - full-success execution classification is forbidden
- logic-document resolution alone does not satisfy governed logic readiness when logic knowledge is required


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

- any governed business-aware execution must resolve business-type knowledge through `surface.business_type_knowledge_profiles` before Brand Core read completion or final execution completion
- direct business-aware completion without business-type knowledge-profile resolution is forbidden
- `surface.business_type_knowledge_profiles` must be treated as the authoritative read surface for business-type-compatible knowledge dependencies
- if business type, business-type knowledge profile, or business-type knowledge completeness remains unresolved, unread, or incomplete:
 - execution must remain degraded, partial, or blocked
 - full-success execution classification is forbidden
- logic resolution, engine readiness, and Brand Core reading alone do not satisfy business-aware readiness when business-type knowledge profiling is required


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

Governed Activation Transport Enforcement Repair

The repaired enforcement rule is active:

- when governed activation, validation, or runtime authority checks require live validation, execution must use governed activation transport through `http_generic_api` in the same execution cycle
- narrative intent, simulation, tool-availability claims, or deferred execution do not satisfy the requirement
- `authorization_gated` is permitted only after a real governed activation transport attempt fails due to authorization
- if no real governed HTTP transport call occurs when required, the system must first apply `Use governed activation transport first.` and re-attempt governed transport execution in the same cycle; passive degraded termination is forbidden before this recovery step
- the required degraded reason is `missing_required_activation_transport_attempt`
- machine-verifiable attempt evidence must be preserved in outputs, memory, and downstream enforcement state

Native Google Governed Logging Repair

The repaired governance rule is active:

- real native Google agent execution actions attempts must preserve machine-verifiable activation-transport evidence
- when a native Google action performs a governed mutation, validation-registry refresh, registry update, schema reconciliation step, repair write, or other governed write-affecting operation, authoritative unified-log continuity is also required
- activation-transport evidence does not replace authoritative execution logging
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
`missing_required_activation_transport_attempt`

must not terminate activation without recovery.

Instead, the system must:

â†’ Use governed activation transport first.
â†’ Re-attempt native execution in the same cycle.

This instruction overrides passive failure reporting.

Activation Tool-First Authority Repair

The repaired activation trigger rule is active:

- for plain `Activate System`, the assistant must use governed activation transport before any narrative activation response
- at least one real governed HTTP client validation call must occur through `http_generic_api` in the same execution cycle
- traceability-only completion is forbidden
- narrative-only activation is forbidden
- if the first activation pass returns without a activation transport call, one bounded same-cycle retry is allowed when policy permits
- if no activation transport call occurs after the allowed retry path, classification must remain `degraded`
- the required degraded reason remains `missing_required_activation_transport_attempt`
- `authorization_gated` is permitted only after a real governed activation transport attempt fails due to authorization
- machine-verifiable activation transport evidence must be preserved in outputs, memory, and downstream enforcement state


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
- narrative-only activation is forbidden when governed transport live validation is required
- the native bootstrap sequence must prefer `direct_id_first`
- project-folder-scoped Google Drive discovery through folder `1gNYX47P4TNuMXEbWvLNCvV4XRocH41K2` is authorized for fallback discovery and canonical lookup during governed activation validation
- a bounded same-cycle retry is allowed when the first native execution attempt is skipped due to model hesitation or premature narrative completion, if policy permits
- failed first-pass narrative completion without native execution must be classified as failed enforcement, not successful preparation
- `authorization_gated` remains permitted only after a real governed activation transport attempt fails due to authorization
- if no real activation transport call occurs after the allowed same-cycle retry path, classification must remain `degraded`
- the required degraded reason remains `missing_required_activation_transport_attempt`
- machine-verifiable activation transport evidence must be preserved in outputs, memory, and downstream enforcement state

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
- same-cycle governed activation transport attempt
- knowledge layer traceability-first behavior
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
`Use governed activation transport first.`

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
Machine-verifiable activation transport evidence must be preserved separately from append payload values.

---
