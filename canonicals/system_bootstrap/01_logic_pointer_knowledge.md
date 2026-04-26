
- system_bootstrap must treat governed logic documents as governed logic specifications rather than GPT personas, UI-facing agent personas, or agent-UI-style introductions
- user-facing logic summaries, activation summaries, and governed execution narratives must prefer neutral governed naming such as `Logic 001` or task-family-first naming
- internal identifiers such as `GPT-LOGIC-001` may remain unchanged for registry continuity
- execution behavior must continue to resolve from canonical authority layers, registries, engines, routes, workflows, endpoint authority, transport evidence, and enforcement state rather than agent-UI-style prompt framing

Repository Canonical Fetch Orchestration Rule

- system_bootstrap must orchestrate file-level canonical traceability through `github_api_mcp` when repository authority is active
- successful mutable registry validation through provider-specific endpoints must not replace repository authority for file-level canonicals
- system_bootstrap must preserve when applicable:
  - canonical_fetch_transport = github_api_mcp
  - canonical_fetch_action_key = github_api_mcp
  - canonical_fetch_authority = repository_ref_pinned
  - canonical_fetch_status
  - canonical_fetch_evidence

Activation Transport Default Rule

- system_bootstrap must orchestrate activation transport through `http_generic_api` by default
- provider-specific validation paths remain downstream optional paths only when selected by registry governance
- system_bootstrap must preserve when applicable:
  - activation_transport_default = http_generic_api
  - activation_transport_action_key = http_generic_api
  - activation_transport_sequence_mode = registry_endpoint_first

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

Logic Knowledge Profile Orchestration Rule

- system_bootstrap must orchestrate governed logic execution as a knowledge-aware staged execution through `surface.logic_knowledge_profiles` when the selected logic requires knowledge-layer reads
- staged logic execution must:
 1. resolve the target logic family or logic_id
 2. resolve pointer state through `surface.logic_canonical_pointer_registry`
 3. resolve the active logic document
 4. resolve logic knowledge profile through `surface.logic_knowledge_profiles`
 5. identify logic-specific, cross-logic, and shared knowledge read targets
 6. read required logic knowledge inputs
 7. classify logic-knowledge read completeness
 8. only then continue into engine-readiness, business-type knowledge, Brand Core, or execution-completion stages
- system_bootstrap must preserve when applicable:
 - logic_knowledge_surface_id
 - logic_knowledge_read_required
 - required_knowledge_layers
 - knowledge_profile_key
 - knowledge_read_targets
 - knowledge_read_completeness_status
 - missing_required_knowledge_sources
 - execution_blocked_until_logic_knowledge_read
- execution must not be classified as recovered, validated, complete, or equivalent full-success when required logic knowledge remains unread, unresolved, or incomplete

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
  - activation_transport_attempted
  - activation_transport_evidence
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
