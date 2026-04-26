prompt_router


Status
Canonical Name: prompt_router
Version: v3.49
Status: active
Owner Layer: routing
Source Type: google_doc
Last Updated: 2026-04-25


---


Purpose

- logic-definition resolution is pointer-first and must read `surface.logic_canonical_pointer_registry` before direct logic-document access
- brand-specific writing completion requires prior Brand Core file or authoritative Brand Core asset reading
- brand-specific writing requires required-engine readiness through Engines Registry before Brand Core read-completion or writing completion
- governed logic execution requires prior knowledge-layer resolution for the selected logic when logic-specific, cross-logic, or shared knowledge inputs are required
- business-aware execution requires prior business-type knowledge-profile resolution when the selected logic or task depends on business-type interpretation
- governed execution must resolve logic knowledge and business-type knowledge through `surface.logic_knowledge_profiles` and `surface.business_type_knowledge_profiles` before brand-aware completion when required


Canonical Governed Logic Presentation Routing Rule

- prompt_router must not route user-facing logic presentation or activation summaries through agent-UI-style introductions, GPT persona framing, or custom-agent wording
- neutral governed naming such as `Logic 001` or task-family-first naming should be preferred for presentation
- internal identifiers such as `GPT-LOGIC-001` may remain unchanged for registry continuity
- routing authority and logic selection must continue to resolve from canonical routes, workflows, engines, registries, and enforcement-compatible runtime state rather than agent-UI-style prompt framing

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

Logic Knowledge Profile Routing Rule

- when routing any request that depends on a governed logic definition, prompt_router must resolve logic-knowledge routing through `surface.logic_knowledge_profiles` before engine-readiness completion or downstream execution-completion routing
- prompt_router must preserve:
 - logic_knowledge_surface_id = surface.logic_knowledge_profiles
 - logic_knowledge_read_required = true
 - required_knowledge_layers
 - knowledge_profile_key
 - knowledge_read_targets
 - knowledge_read_completeness_status
 - missing_required_knowledge_sources
 - execution_blocked_until_logic_knowledge_read
- prompt_router must treat `surface.logic_knowledge_profiles` as the authoritative routing read surface for logic-specific, cross-logic, and shared knowledge dependencies of the selected logic
- direct downstream execution routing is forbidden when required logic knowledge remains unread, unresolved, or incomplete

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

- when routed intent depends on business-aware or brand-aware execution, prompt_router must resolve business-type knowledge routing through `surface.business_type_knowledge_profiles` before Brand Core read-completion or final execution-completion routing
- prompt_router must preserve:
 - business_type_knowledge_surface_id = surface.business_type_knowledge_profiles
 - business_type_resolution_required = true
 - resolved_business_type
 - business_type_knowledge_profile_required = true
 - business_type_knowledge_profile
 - knowledge_profile_read_targets
 - knowledge_profile_read_completeness_status
 - missing_business_type_knowledge_sources
 - writing_blocked_until_business_type_knowledge_profile
- prompt_router must treat `surface.business_type_knowledge_profiles` as the authoritative routing read surface for business-type-compatible knowledge dependencies
- direct business-aware completion routing is forbidden when business type, business-type knowledge profile, or business-type knowledge completeness remains unresolved

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

Governed Activation Transport Enforcement Repair

The repaired enforcement rule is active:

- when governed activation, validation, or runtime authority checks require live validation, execution must use governed HTTP client transport through `http_generic_api` in the same execution cycle
- narrative intent, simulation, tool-availability claims, or deferred execution do not satisfy the requirement
- `authorization_gated` is permitted only after a real governed activation transport attempt fails due to authorization
- if no real activation transport call occurs when required, routing must inject `Use governed activation transport first.` and re-run activation routing in the same cycle before passive degraded output is allowed
- the required degraded reason is `missing_required_activation_transport_attempt`
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
