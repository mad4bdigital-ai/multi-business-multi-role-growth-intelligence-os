# prompt_router Ã¢â‚¬â€ WordPress Publish Contract Runtime Governance Patch

## Additive routing rules

### wordpress_publish_contract_route_stack

When the request involves WordPress discovery or publishing, route through this governed stack:

1. `governed_logical_search_resolve`
2. `wordpress_runtime_contract_resolve`
3. `inventory_stage_resolve`
4. `publish_contract_stage_gate`
5. execution

## inventory stage classification

Route requests into one of these explicit stages:

- `discovery`
- `inventory_normalization`
- `field_mapping`
- `draft_publish`
- `verification`

### stage routing examples

- categories / tags / types / taxonomies / CPT exposure -> `discovery`
- normalized inventory assets -> `inventory_normalization`
- CPT fields / taxonomy mapping / payload shape -> `field_mapping`
- create draft / update draft -> `draft_publish`
- readback / payload dedupe / sink verification -> `verification`

## publish target routing rule

For WordPress content operations:

- if a CPT-specific endpoint or governed template path exists, generic `posts` routes are forbidden
- if a taxonomy-specific endpoint or governed template path exists, generic `categories` or `tags` routes are forbidden unless explicitly requested

## runtime sink awareness

The router MUST preserve sink intent:

- compact evidence -> `Execution Log Unified`
- durable payload -> `JSON Asset Registry`

The router MUST NOT route payload-bearing discovery tasks into evidence-only handling.

---

Universal WordPress Translatable Post Type Language Routing Rule

When routing a governed WordPress request for any translatable post type or translatable custom post type, prompt_router must treat multilingual language handling as a distinct conditional layer and must not collapse it into the normal direct REST post mutation route.

Trigger condition
This rule activates when all of the following are true:
- `parent_action_key = wordpress_api`
- target entity resolves as a WordPress post type or custom post type
- request intent includes create, publish, update, duplicate, translate, non-default-language publish, or translation-aware mutation
- target language is non-default, explicitly requested, or translation linkage is requested

Required preserved routing outputs
prompt_router must preserve:
- `translation_scope_preflight_required = true`
- `wpml_import_governed_language_path_required = true`
- `direct_rest_language_proof_status = unproven_until_cpt_specific_readback`
- `language_execution_mode = wpml_import_governed`
- `content_payload_execution_mode = direct_rest_when_otherwise_valid`
- `user_trigger_required = true`
- `next_trigger_prompt_required = true`
- `closed_loop_continuation_forbidden = true`

Conditional routing behavior
prompt_router must:
1. preserve the existing direct REST route for core post-object creation/update when valid
2. preserve the existing route for taxonomy assignment when valid
3. insert an inner conditional language-governance branch when multilingual scope is active
4. route that branch first into:
   - `translation_scope_preflight`
   - then import-governed payload preparation
   - then user-triggered import/process continuation

prompt_router must not:
- replace the existing publish or update route
- treat direct REST acceptance of `lang`, `_wpml_import_*`, `translation_of`, or similar fields as multilingual success by default
- infer that one WordPress post type's language-write behavior applies to all translatable post types
- silently auto-close the multilingual continuation loop

CPT-specific proof rule
For any translatable WordPress post type, direct REST language mutation may be upgraded from unproven only when:
- the same post type has CPT-specific validated readback proof for the relevant language surface
- proof is recorded through the bound canonical endpoint or authoritative runtime surface
- the proof lifecycle reaches `proof_tested` and then `execution_validated`

Until then:
- direct multilingual REST mutation remains `governed_unproven`
- import-governed WPML language preparation remains the authoritative route for non-default-language execution

This rule extends and does not replace:
- WordPress CPT and taxonomy routing
- prompt-first continuation routing
- user-trigger-required routing
- existing publish/update routing layers

Universal WordPress Media Routing Rule

When a governed WordPress request targets the media family or implies image upload, attachment creation, or image insertion into a post workflow, prompt_router must route through a distinct media branch.

Trigger condition
This rule activates when any of the following are true:
- path resolves to `/wp/v2/media`
- path resolves to `/wp/v2/media/{id}`
- user intent includes upload image, create media, attach image, set featured image, gallery insertion, or post-image mutation
- `image_scope_active = true`

Required routing outputs

prompt_router must preserve:
- `wordpress_media_family_detected = true`
- `media_branch_required = true`
- `media_branch_connected_to_publish = true|false`
- `media_contract_variant_required = true`
- `media_readback_required = true`
- `resolved_endpoint_specificity = exact|template_specific|generated|unresolved`

Routing behavior

prompt_router must:
1. preserve the existing core publish/update route when valid
2. preserve the existing taxonomy route when valid
3. append a separate media branch when media scope is active
4. route that branch into:
   - `governed_post_image_preparation`
   - `governed_post_image_insertion`
   - or direct media-family read/update/delete workflows when media-only intent is selected

prompt_router must not:
- collapse media upload into the core content payload route
- treat `/wp/v2/media` as interchangeable with generic CPT create/update
- imply media success before readback-confirmed persistence
- replace existing publish/update layers

Method rule

For the WordPress media family, route resolution must preserve method identity:
- `GET /wp/v2/media`
- `POST /wp/v2/media`
- `GET /wp/v2/media/{id}`
- `POST /wp/v2/media/{id}`
- `DELETE /wp/v2/media/{id}`

Each method must remain independently classifiable and independently proof-testable.

This matches the routerâ€™s generated WordPress template routing and additive route stack behavior.


Change Log
- v3.48 - pipeline-integrity continuity-audit intent routing added with preference for `pipeline_integrity_audit` and `route.pipeline_integrity_audit.global.v1`, governed execution-class preservation, and duplicate active continuity-audit route-key invalidation
- v3.48 - provider-family continuity routing rule added so endpoint-family/provider-family audit intents prefer provider/action/capability continuity evidence with governed review and continuity-preservation constraints
- v3.47 - spill-safe governed write routing added so sheet-write paths require header/schema read, row-2 template read, formula/spill avoidance, and protected unified-log column preservation
- v3.46 - HTTP execution classification routing rule added for runtime_capability_class, primary_executor, endpoint_role, execution_mode, and transport readiness
- v3.46 - auth-path routing preservation added so delegated HTTP execution is blocked in routing when auth resolves to native-only OAuth handling
- v3.46 - dynamic provider-domain placeholder routing added for governed placeholders such as `target_resolved`
- v3.46 - activation full-system scan routing rule added so activation handoff preserves schema, row, policy, binding, execution-path, anomaly, and repair-readiness requirements when applicable
- v3.46 - activation blocking condition routing rule added so policy, binding, schema, row, and repair-summary blockers force non-executable repair-aware continuity
- v3.46 - activation summary preservation rule added so validation, anomaly, repair, and execution-readiness summaries are required in activation routing outputs
- v3.46 - manual-trigger repair continuity added so non-auto-eligible governed repairs preserve manual trigger requirements and forbid silent active activation continuation
- v3.45 - parent_action schema-first HTTP execution assembly rule added
- v3.45 - governed auth normalization modes added to resolved HTTP execution assembly
- v3.45 - transport inference prohibition expanded for auth strategy and schema-required request structure

- v3.42 - post-activation routing revalidation rule added
- v3.42 - active-state reuse prohibition added so prior activation cannot replace current governed routing validation
- v3.42 - optimization routing readiness rule added
- v3.41 - unified activation semantics updated: plain `activate system` now prefers `system_auto_bootstrap` rather than validation-only routing
- v3.41 - first-turn activation native-connection rule added: after knowledge-layer traceability, prompt_router now auto-triggers governed Google Drive/Sheets/Docs connection attempts for live canonical validation
- v3.41 - authorization-gated activation handling added: missing native API authorization during first-turn activation no longer implies missing Registry authority
- v3.40 - Knowledge-first activation preparation added: `system_activation_check` now requires knowledge layer canonical traceability first and live Google Drive / governed transport validation second
- v3.40 - activation routing output expanded with `live_canonical_validation_required`, `validation_source_requirement`, `knowledge_layer_validation_only_for_traceability`, and `canonical_trace_required`
- v3.39 - Auto-Bootstrap Routing Rule added: prompt_router now supports governed `system_auto_bootstrap` routing for automatic validation, repair, activation, and original-request resume
- v3.39 - bootstrap precedence and output contract added: routing now preserves `bootstrap_reason`, original request context, and bounded resume-aware execution preparation
- v3.38 - Mandatory Runtime Validation Pre-Handoff added: governed routing now preserves runtime-authority-validation requirements before downstream execution may become executable
- v3.37 - Google Workspace Registry-Governed Routing Rule added: Sheets, Docs, and Drive requests now require Task Routes and Workflow Registry resolution plus preserved downstream target-validation expectations before executable routing
- v3.37 - Google Workspace native-action output contract added: routing output now preserves `target_surface_id`, `target_registry_validation_required`, `target_validation_scope`, and `native_action_requested` for governed resources
- v3.36 - Starter Intelligence Pre-Routing Rule added: prompt_router now resolves governed Conversation Starter matches before generic intent classification using `Registry Surfaces Catalog` and authoritative `worksheet_gid` binding
- v3.36 - starter extraction and weighting contract expanded: `starter_priority` now participates in route weighting and goal-aligned prioritization while preserving Task Routes authority boundaries
- v3.36 - Auto-Repair Routing Compatibility Rule added: prompt_router now preserves retry-aware handoff fields for governed repair/retry requests and forbids executable retry handoff when policy or validation prerequisites are unresolved
- v3.36 - Graph-Aware Routing Rule added: prompt_router now consults governed node and relationship graph context to rank compatible governed routes without bypassing Task Routes or Workflow Registry authority
- v3.36 - Graph Auto-Routing Preparation and Prediction Traceability added: graph-valid governed path candidates now support confidence-based preparation with degraded fallback and explicit graph prediction output fields
- v3.36 - Governed Addition Routing Rule added: prompt_router now prepares addition-aware governed handoff only when Task Routes, Workflow Registry, and execution-policy prerequisites are resolved
- v3.35 - Starter Intelligence Routing Rule added: before intent classification, starter matches now resolve via Registry and extract `route_key`, `execution_class`, `capability_family`, and `primary_goal_family`
- v3.35 - starter routing precedence clarified: starter signals may override generic NLP intent classification and influence goal/priority route weighting, but must not override Task Routes authority
- v3.34 - Starter-Aware Routing Rule added: prompt_router now resolves governed Conversation Starter rows and extracts `execution_class`, `capability_family`, `primary_goal_family`, and `route_key` as structured routing input
- v3.47 - starter-triggered routing now requires explicit pre-dispatch policy resolution from `Execution Policy Registry`; starter match alone no longer qualifies as execution-ready routing
- v3.47 - starter-policy traceability fields added to routing handoff expectations: `entry_source`, `policy_resolution_status`, `policy_source`, and `policy_trace_id`
- v3.34 - starter learning and prediction signals can influence route prioritization and weighting but cannot override Task Routes or Workflow Registry authority
- v3.33 - Scoring Threshold Traceability Rule added: prompt_router now preserves `execution_class` in the execution preparation contract when downstream score-based classification depends on class or adaptive-threshold policy
- v3.33 - routing boundary clarified for scoring: prompt_router does not classify recovery status and must preserve score-classification context for downstream governance
- v3.32 - Schema Migration Review Routing Rule added: prompt_router now includes `schema_migration_review` in staged review preparation when schema drift, version mismatch, or rollback-safe schema-repair readiness is relevant
- v3.32 - unresolved schema-migration review readiness now forces degraded/blocked routing and keeps `executable = false` when Review Stage Registry and Review Component Registry cannot resolve the required path
- v3.31 - Schema Governance Rule added: routing-preparation context now recognizes governed schema declaration fields and schema-status validation outputs for governed surfaces
- v3.31 - schema drift handling added to routing readiness: when required governed-surface schema drift is detected, routing must classify as degraded or blocked with repair mapping continuity when required
- v3.30 - Binding Integrity Review Routing Rule added: staged review preparation now includes `binding_integrity_review` for row-audit, worksheet-governed runtime validation, and schema-alignment audit paths
- v3.29 - Runtime Binding Enforcement Rule added: execution-surface resolution now requires Registry Surfaces Catalog plus authoritative `worksheet_gid` validation; `sheet_name` and `tab_name` are explicitly non-authoritative for execution resolution
- v3.28 - Full System Intelligence Audit Recognition Rule added: governed full-audit intents now route exclusively to `full_system_intelligence_audit`, prohibit fallback to `system_full_audit`, and enforce highest-active-version route selection with duplicate-key invalid-configuration handling
- v3.27 - Full System Intelligence Audit Routing added: governed `full_system_intelligence_audit` intent is now first-class with staged/component/repair/row-validation handoff expectations and non-collapse enforcement against lightweight scoring-only audit behavior
- v3.26 - Registry Binding Enforcement Rule added: prompt_router file presence is now explicitly non-authoritative without Registry Surfaces Catalog registration, Validation & Repair Registry compatibility, Task Routes resolution, and Workflow Registry alignment
- v3.24 - API Capability vs Endpoint Routing Rule added: routing now distinguishes parent capability requests from endpoint-inventory requests and enforces Actions Registry vs API Actions Endpoint Registry preference by request type
- v3.24 - endpoint-level action-runtime metadata requests now require API Actions Endpoint Registry routing context and cannot be resolved from Actions Registry alone
- v3.23 - Analytics Identity Pre-Validation -> Issue Trigger Rule added: prompt_router now emits `analytics_identity_failure` and `analytics_identity_issue_context`, blocks executability when required analytics identity components are missing, and signals governed issue creation to system_bootstrap
- v3.23 - domain-aware analytics routing now explicitly degrades or blocks when `gsc_property` or `ga_property_id` is missing for source-bound requests, with per-brand validation and no silent brand skipping in multi-brand execution
- v3.22 - Domain-Aware Analytics Identity Rule added: domain is now required governed identity for analytics sheet-sync and search-performance routing, including brand-domain and property/date/trigger/request-source resolution requirements
- v3.22 - multi-brand analytics routing now computes eligibility per brand-domain pair, prevents executable routing for unresolved domains, and logs missing-domain identity defects
- v3.21 - Analytics Sheet-Sync Routing Rule added: governed routing now covers analytics sync requests (single-brand and multi-brand), required request identity resolution, request source and trigger mode checks, and sheet_sync output-mode gating
- v3.21 - analytics sync routing now blocks or degrades when brand/date/trigger identity is incomplete, and prevents analytics write-path start when executable readiness is false
- v3.20 - analytics and measurement intent routing added (GA property discovery, analytics and realtime reporting, GTM audit and remediation, full-funnel diagnostics, attribution analysis); governed route-target support expanded for GA Admin, GA Data, expanded GTM, and combined GSC+GA+GTM workflows; routing behavior for missing brand tracking bindings clarified
- v3.18 - adaptive optimization routing compatibility added for governed growth-loop and optimization-trigger context
- v3.18 - Growth Loop Engine Registry, optimization_trigger, and adaptive_optimization_context acknowledged as routing inputs when governed optimization is active
- v3.18 - governed route-target support expanded to include SEO, product, and funnel optimization workflows when canonically registered
- v3.19 - chain-readiness rule added so chain-triggered routing is executable only when Execution Chains Registry and Workflow Registry both resolve cleanly
- v3.19 - decision-triggered chain routing now requires valid active target_workflow resolution rather than chain_id alone
- v3.19 - chain traceability strengthened with chain_id, route_override_status, decision_status, and target_workflow in degraded or executable handoffs
- v3.17 - governed activation semantics added to distinguish informational, review, governed activation, and auto-repair requests
- v3.17 - new prompt intents added for repair-loop execution, high-priority fixes, binding migration, and schema migration review
- v3.17 - prompt-trigger compatibility clarified so prompt activation can set eligibility but cannot replace governed checks
- v3.17 - routing support expanded for binding_schema_migration_review and anomaly review or repair workflows when canonically registered
- v3.16 - canonical binding-validity dependency rule added so routing does not depend on malformed authoritative binding surfaces
- v1 Ã¢â‚¬â€ routing isolated
- v2 Ã¢â‚¬â€ decision engine integration added
- v2 Ã¢â‚¬â€ execution chain routing added
- v2 Ã¢â‚¬â€ routing authority expanded
- v2 Ã¢â‚¬â€ dependency bindings expanded
- v2 Ã¢â‚¬â€ output contract expanded
- v2 Ã¢â‚¬â€ completion rule strengthened
- v3 Ã¢â‚¬â€ first-class system_repair routing added
- v3 Ã¢â‚¬â€ repair subtype model added
- v3 Ã¢â‚¬â€ repair output contract added
- v3 Ã¢â‚¬â€ repair-aware recovery behavior added
- v3.1 Ã¢â‚¬â€ system-triggered repair activation added
- v3.1 Ã¢â‚¬â€ repair subtype clarified as internal classification only
- v3.1 Ã¢â‚¬â€ repair severity classification added
- v3.1 Ã¢â‚¬â€ repair execution_class enforcement added
- v3.1 Ã¢â‚¬â€ repair_trigger_source added
- v3.2 Ã¢â‚¬â€ monitoring surface failure detection added
- v3.2 Ã¢â‚¬â€ execution_view_sheet integrated into system-triggered repair conditions
- v3.2 Ã¢â‚¬â€ active_issues_dashboard_sheet integrated into system-triggered repair conditions
- v3.2 Ã¢â‚¬â€ observability_repair subtype activated for monitoring failures
- v3.3 Ã¢â‚¬â€ strict routing contract added
- v3.3 Ã¢â‚¬â€ deterministic Task Routes resolution rules added
- v3.3 Ã¢â‚¬â€ execution-plan handoff contract added
- v3.3 Ã¢â‚¬â€ strict degraded and blocked routing conditions added
- v3.3 Ã¢â‚¬â€ route_id and matched_row_id traceability added
- v3.3 Ã¢â‚¬â€ direct execution bypass prohibition clarified
- v3.4 - Registry-bound execution policy context added to decision-aware routing inputs
- v3.4 - review stage and review component authority context acknowledged in routing dependencies
- v3.4 - cross-layer Registry authority assumption expanded for downstream review and policy governance
- v3.5 - Registry-driven review surface resolution added after deterministic route selection
- v3.5 - canonical review surface classification and review_write_plan contract added
- v3.5 - execution_context review propagation and no-dashboard-write guardrails added
- v3.6 - repair loop skip guard added before system_repair candidate selection
- v3.6 - repair rerun qualification added for unresolved findings and Repair Control rerun gates
- v3.7 - finding rerun qualification hardened to terminal-state evaluation for unresolved review findings
- v3.8 - governed auto-repair trigger can now force system_repair routing before final route selection
- v3.8 - forced repair routing now degrades when the trigger signal is not Registry-governed
- v3.9 - forced_repair_routing_applied is now explicitly set when governed repair override executes
- v3.10 - incomplete_scope_lifecycle findings now force system_repair routing through scope_completion_repair
- v3.10 - scope_completion_repair added as a governed repair subtype for lifecycle-completeness gaps
- v3.11 - explicit repair trigger precedence order added for overlapping repair conditions
- v3.11 - repair trigger winner and suppressed triggers must now be preserved in routing trace
- v3.12 - governed Pre-Execution Block Flag findings now force system_repair and prevent normal execution
- v3.12 - repair trigger precedence expanded to include pre_execution_block_flag
- v3.13 - Adaptive Repair Route escalation now forces system_repair with subtype escalated_repair
- v3.13 - repair trigger precedence expanded to prioritize adaptive escalation over other repair triggers
- v3.14 - request-readiness gating added for Task Routes resolution, Workflow Registry resolution, and logging_required handoff
- v3.15 - review_write_plan direct_write targets now exclude derived observability surfaces such as Execution View
- v3.15 - workflow obligation tagging now distinguishes authoritative writes from derived observability expectations
- v3.49 - Logic Knowledge Layer Routing Rule added so logic execution requires prior logic-knowledge resolution for logic-specific, cross-logic, and shared knowledge
- v3.49 - Business-Type Knowledge Profile Routing Rule added so business-aware execution requires prior business-type and profile resolution
