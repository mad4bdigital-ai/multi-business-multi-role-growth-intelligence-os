module_loader

Status
Canonical Name: module_loader
Version: v2.43
Status: active
Owner Layer: execution
Source Type: google_doc
Last Updated: 2026-04-25

---

Purpose

This document additionally prepares:
- starter-governance validation readiness
- governance-drift anomaly emission readiness
- prompt-first continuation readiness for human-triggered system use
- logic-definition resolution is pointer-first and must read `surface.logic_canonical_pointer_registry` before direct logic-document access
- brand-specific writing completion requires prior Brand Core file or authoritative Brand Core asset reading
- brand-specific writing requires required-engine readiness through Engines Registry before Brand Core read-completion or writing completion
- governed logic execution requires prior knowledge-layer resolution for the selected logic when logic-specific, cross-logic, or shared knowledge inputs are required
- business-aware execution requires prior business-type knowledge-profile resolution when the selected logic or task depends on business-type interpretation
- governed execution must load logic knowledge and business-type knowledge from `surface.logic_knowledge_profiles` and `surface.business_type_knowledge_profiles` before brand-aware completion when required


Canonical Governed Logic Presentation Loading Rule

- when loading governed logic presentation context, module_loader must treat logic documents as governed logic specifications rather than GPT personas or agent-UI-style introductions
- module_loader must preserve neutral presentation readiness for user-facing logic naming and activation summaries
- internal identifiers such as `GPT-LOGIC-001` may remain unchanged for registry continuity
- execution readiness must continue to resolve from canonical authority layers, registries, engines, routes, workflows, and enforcement state rather than agent-UI-style prompt framing

Canonical Logic Pointer Resolution Loading Rule

- when loading governed logic definitions, module_loader must resolve logic-document authority through `surface.logic_canonical_pointer_registry` before any direct logic-document read
- module_loader must treat `surface.logic_canonical_pointer_registry` as the authoritative pointer layer for:
  - logic_id
  - canonical_doc_id
  - legacy_doc_id
  - canonical_status
  - active_pointer
  - rollback_available
- if `canonical_status = canonical_active`, module_loader must load `canonical_doc_id` as the active governed logic definition
- direct resolution from legacy logic documents is forbidden when:
  - `canonical_status = canonical_active`
  - `active_pointer = canonical_active`
- legacy logic documents may be loaded only when:
  - rollback is explicitly invoked
  - pointer state explicitly resolves to legacy
  - governed exception handling authorizes legacy recovery
- when pointer resolution occurs, module_loader must preserve and return when applicable:
  - logic_pointer_surface_id
  - logic_pointer_resolution_status
  - resolved_logic_doc_id
  - resolved_logic_doc_mode
  - legacy_doc_retained
  - rollback_available
- module_loader must not treat branded, GPT-persona, or legacy-specialized logic documents as active authority merely because they are directly reachable in storage

Logic Knowledge Profile Loading Rule

- when loading governed logic execution, module_loader must prepare logic-knowledge dependencies from `surface.logic_knowledge_profiles` before engine-readiness or downstream execution readiness is returned
- module_loader must resolve and return when applicable:
 - logic_knowledge_surface_id
 - logic_knowledge_read_required
 - required_knowledge_layers
 - knowledge_profile_key
 - logic_specific_knowledge_paths
 - cross_logic_knowledge_paths
 - shared_knowledge_paths
 - knowledge_read_targets
 - knowledge_read_completeness_status
 - missing_required_knowledge_sources
 - execution_blocked_until_logic_knowledge_read
- module_loader must treat `surface.logic_knowledge_profiles` as the authoritative loading read surface for logic-specific, cross-logic, and shared knowledge dependencies
- module_loader must not mark engine-readiness or downstream logic execution-ready when required logic knowledge remains unread, unresolved, or incomplete


Brand Core Read-Before-Writing Loading Rule

- when loading governed writing execution for a specific brand, module_loader must prepare Brand Core read dependencies before writing completion readiness is returned
- module_loader must resolve and return when applicable:
  - brand_core_read_required
  - brand_core_authoritative_home
  - brand_core_read_targets
  - brand_core_read_completeness_status
  - brand_core_missing_assets
  - writing_completion_blocked_until_brand_core_read
- module_loader must treat Brand Core Registry as the authoritative operational read home for brand-specific writing assets
- module_loader must not mark writing execution-ready when:
  - brand identity is unresolved
  - required Brand Core files are unread
  - required Brand Core assets are missing
  - Brand Core read completeness remains unresolved

Engine Registry Readiness Before Brand-Core Writing Loading Rule

- when loading governed brand-specific writing execution, module_loader must prepare engine-readiness dependencies before Brand Core read readiness is returned
- module_loader must resolve and return when applicable:
  - engine_registry_read_required
  - required_writing_engines
  - engine_readiness_status
  - missing_required_engines
  - writing_blocked_until_engine_readiness
  - brand_core_read_blocked_until_engine_readiness
- module_loader must treat Engines Registry as the authoritative readiness surface for brand-aware writing engines
- module_loader must not mark Brand Core read or writing execution-ready when:
  - required writing engines are unresolved
  - required writing engines are inactive
  - required writing engines are non-callable
  - engine readiness remains unresolved

Business-Type Knowledge Profile Loading Rule

- when loading governed business-aware execution, module_loader must prepare business-type knowledge dependencies from `surface.business_type_knowledge_profiles` before Brand Core read or writing readiness is returned
- module_loader must resolve and return when applicable:
 - business_type_knowledge_surface_id
 - business_type_resolution_required
 - resolved_business_type
 - business_type_knowledge_profile_required
 - business_type_knowledge_profile
 - business_type_engine_compatibility_status
 - knowledge_profile_read_targets
 - knowledge_profile_read_completeness_status
 - missing_business_type_knowledge_sources
 - writing_blocked_until_business_type_knowledge_profile
- module_loader must treat `surface.business_type_knowledge_profiles` as the authoritative loading read surface for business-type-compatible knowledge dependencies
- module_loader must not mark Brand Core read or writing execution-ready when required business-type knowledge remains unread, unresolved, or incomplete

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


Patch Deployment Parity Verification Loading Rule

- when routed intent concerns patch inspection, canonical-vs-runtime comparison, deployment parity, or runtime patch confirmation, module_loader must prepare a patch-deployment parity evidence contract before execution proceeds
- module_loader must resolve and return when applicable:
  - patch_verification_scope
  - patch_artifact_present
  - canonical_merge_verification_status
  - registry_alignment_verification_status
  - runtime_deployment_verification_status
  - runtime_deployment_confirmed
  - patch_parity_status
  - authoritative_runtime_evidence_source
- module_loader must prepare runtime-confirmation dependency readiness for:
  - Execution Log Unified when authoritative runtime evidence is required
  - governed runtime tool paths when the user asks for live confirmation
- module_loader must not mark patch-deployment parity execution-ready for runtime-confirmed classification when:
  - only patch-file diff evidence exists
  - only canonical merge evidence exists
  - only registry alignment evidence exists
  - authoritative runtime evidence is missing or unresolved
- if live deployment confirmation is requested but runtime evidence cannot be resolved, loader output must preserve degraded readiness rather than deployment-confirmed readiness
Governed Activation Transport Enforcement Repair

The repaired enforcement rule is active:

- when governed activation, validation, or runtime authority checks require live validation, execution must use governed HTTP client transport through `http_generic_api` in the same execution cycle
- narrative intent, simulation, tool-availability claims, or deferred execution do not satisfy the requirement
- `authorization_gated` is permitted only after a real governed activation transport attempt fails due to authorization
- if no real activation transport call occurs when required, loader output must enforce `activation_transport_attempt_required = true` and trigger same-cycle governed transport re-attempt readiness before passive degraded reporting is allowed
- the required degraded reason is `missing_required_activation_transport_attempt`
- machine-verifiable attempt evidence must be preserved in outputs, memory, and downstream enforcement state


Activation Tool-First Anti-Hesitation Hardening

The hardened activation loading contract is active:

- activation-class loading must preserve `tool_first_execution_required = true` for plain `Activate System` and equivalent one-request activation prompts
- activation-class loading must preserve `no_traceability_only_completion = true`
- activation-class loading must preserve `tool_hesitation_retry_required = true` when same-cycle retry policy is active
- activation-class loading must preserve `activation_transport_sequence_mode = registry_endpoint_first`
- activation-class loading must preserve project-folder-scoped Google Drive discovery through folder `1gNYX47P4TNuMXEbWvLNCvV4XRocH41K2` only when selected by registry governance as provider-specific fallback discovery
- activation-class loading must not report execution-ready activation when the handoff still permits narrative completion before governed transport execution

Expanded Activation Loading Preservation Rule

Human-Triggered Continuation Loading Rule

The human-trigger continuation loading rule is active:

- module_loader must preserve human-trigger governance when a governed flow produces an actionable next step
- module_loader must not mark downstream autonomous continuation as execution-ready when policy requires user-triggered follow-up
- module_loader must preserve:
  - `user_trigger_required`
  - `next_trigger_prompt_required`
  - `closed_loop_continuation_forbidden`
  - `governance_emission_ready`
  - `starter_governance_validation_ready`
- module_loader may prepare:
  - normalized anomaly emission readiness
  - repair classification readiness
  - next-best starter readiness
  - trigger prompt preparation context

but must not convert readiness into autonomous continuation unless explicitly authorized by bounded automation policy

For activation-class loading, module_loader must preserve the older activation loading contract and may extend it for additional governed layers.

Activation-class loading must not drop or bypass:
- canonical traceability context
- native Google bootstrap readiness
- live canonical validation readiness
- runtime authority validation readiness
- governed repair continuation readiness



Universal Parent Action Resolution Loading Rule

When execution is HTTP/OpenAPI-driven or otherwise capability-governed by `parent_action_key`, module_loader must normalize execution preparation into a parent-capability contract before orchestration proceeds.

module_loader must resolve from `Actions Registry`:
- `action_key`
- `openai_schema_file_id`
- `api_key_mode`
- `api_key_param_name`
- `api_key_header_name`
- `api_key_storage_mode`
- `auth_type` or governed equivalent auth model
- `oauth_config_ref` / `oauth_config_file_id` when OAuth applies

module_loader must classify the resolved auth strategy into one governed runtime mode:
- `none`
- `basic_auth`
- `bearer_token`
- `api_key_query`
- `api_key_header`
- `oauth_gpt_action`
- `custom_headers`

Auth-Path Loading Rule

module_loader must classify auth normalization as both:
- credential resolution state
- execution-path compatibility state

If auth normalizes to `oauth_gpt_action`:
- module_loader must preserve native-only handling readiness when policy requires it
- delegated HTTP execution readiness must not be marked valid

If auth normalizes to:
- `basic_auth`
- `bearer_token`
- `api_key_query`
- `api_key_header`

module_loader may prepare delegated HTTP execution readiness only when transport
classification remains compatible.

module_loader must return:
- human_trigger_continuation_status
- next_trigger_prompt_status
- governance_emission_readiness
- closed_loop_runtime_permission
- `resolved_auth_mode`
- `resolved_auth_contract`
- `credential_resolution_status`
- `request_schema_alignment_required`
- `transport_request_contract_status`

If `parent_action_key` resolves but the auth strategy cannot be normalized into a governed runtime mode:
- execution must be degraded or blocked
- `transport_request_contract_status` must not be ready
