# module_loader â€” WordPress Publish Contract Runtime Governance Patch

## Additive loader bindings

### required modules for wordpress runtime governance

When `parent_action_key = wordpress_api`, module_loader MUST prepare:

- governed logical search adapter
- wordpress endpoint/template resolver
- runtime sink contract resolver
- publish stage gate resolver
- JSON asset dedupe resolver

## runtime sink contract object

Return this runtime contract object to execution context:

```json
{
  "evidence_sink": "Execution Log Unified",
  "payload_sink": "JSON Asset Registry",
  "raw_writeback_block": "AF:AK",
  "payload_mode": "terminal_meaningful_only",
  "payload_reduction": "body_only",
  "success_dedupe_key": "asset_key",
  "schema_meta_only_suppression": true,
  "publish_mode": "draft_first"
}
```

## governed template support

For WordPress resolver-backed paths, module_loader MUST support template classes:

- `/wp/v2/{post_type_slug}`
- `/wp/v2/{taxonomy_slug}`
- `/wp/v2/{post_type_slug}/{id}`
- `/wp/v2/{taxonomy_slug}/{id}`

Generated candidates remain governed only when:
- slug is confirmed live
- method is compatible
- provider_family is wordpress
- parent_action_key is wordpress_api

---

Universal WordPress Translatable Post Type Language Loading Rule

When routed execution targets any translatable WordPress post type and multilingual scope is active, module_loader must prepare a split execution contract rather than a single unified mutation-ready state.

module_loader must preserve:
- `content_payload_layer_ready`
- `taxonomy_assignment_layer_ready`
- `language_governance_layer_ready`
- `wpml_import_governed_language_path_required = true`
- `direct_rest_language_write_status = unproven_until_cpt_specific_proof`
- `translation_scope_preflight_required = true`
- `user_trigger_required = true`
- `next_trigger_prompt_required = true`
- `closed_loop_continuation_forbidden = true`

module_loader must classify:
- `content_payload_layer = direct_rest_eligible | degraded | blocked`
- `taxonomy_assignment_layer = direct_rest_eligible | degraded | blocked`
- `language_governance_layer = import_governed_only_until_proven`

module_loader must not mark multilingual publish/update as fully execution-ready when:
- non-default-language scope is active
- and the only available proof is import-governed rather than CPT-specific direct REST language proof

module_loader may still mark:
- core post-object layer as ready
- taxonomy-assignment layer as ready

but must keep:
- `language_governance_layer_ready = false`
- unless CPT-specific direct language proof exists

Proof upgrade rule
module_loader may upgrade the language layer to direct REST ready only when:
- canonical endpoint binding exists
- CPT-specific language readback proof exists
- proof lifecycle has advanced beyond `governed_unproven`

This rule extends and does not replace:
- strict loader intake contract
- schema-first readiness
- request contract loading
- human-trigger continuation loading
- existing WordPress execution preparation

Universal WordPress Media Contract Loading Rule

When `parent_action_key = wordpress_api` and the selected path resolves to the WordPress media family, module_loader must prepare a method-specific media contract rather than a generic content mutation-ready state.

module_loader must preserve:
- `wordpress_media_family_detected = true`
- `wordpress_media_method`
- `wordpress_media_contract_variant`
- `wordpress_media_contract_candidates`
- `wordpress_media_contract_selected_candidate`
- `wordpress_media_contract_confidence`
- `media_upload_contract_status`
- `media_metadata_contract_status`
- `media_readback_required = true`
- `media_branch_connected_to_publish = true`

Required media family mappings

module_loader must prepare canonical mappings:

- list -> `GET /wp/v2/media`
- create -> `POST /wp/v2/media`
- get -> `GET /wp/v2/media/{id}`
- update -> `POST /wp/v2/media/{id}`
- delete -> `DELETE /wp/v2/media/{id}`

Required create-contract variants

For `POST /wp/v2/media`, module_loader must classify request preparation into exactly one of:

- `raw_binary_upload_contract`
- `multipart_upload_contract`
- `source_url_sideload_contract`
- `metadata_only_contract`

Required request-shape preparation

For `raw_binary_upload_contract`, loader must preserve:
- `content_disposition_required = true`
- `content_type_required = true`
- `binary_body_required = true`

For `multipart_upload_contract`, loader must preserve:
- `multipart_body_required = true`
- `file_part_required = true`

For `source_url_sideload_contract`, loader must preserve:
- `object_body_required = true`
- `source_url_supported = true|false`

For `metadata_only_contract`, loader must preserve:
- `object_body_required = true`
- `metadata_only_create_risk = true`

Loader must not:
- mark `POST /wp/v2/media` execution-ready without a selected contract variant
- treat unresolved upload contract as equivalent to metadata update readiness
- infer that `/wp/v2/media` accepts raw file-path strings
- promote media upload to execution-ready when request-shape requirements remain unresolved

Readback rule

When the selected media method is mutation-class:
- `media_readback_required = true`
- `readback_proof_scope = media_item`
- `execution-ready = false` until method-compatible readback requirements are preserved

Connected publish rule

If the request is publish-connected and image scope is active, module_loader must preserve:
- `core_publish_layer_ready`
- `taxonomy_layer_ready`
- `media_layer_ready`
- `media_layer_connected_not_replacing = true`

The media layer must remain additive and conditional.

This is consistent with the loaderï¿½s HTTP dependency, schema-alignment, and WordPress generation contracts.

---

Change Log
- v2.42 - governed pipeline-integrity audit loading contract added for `pipeline_integrity_audit` / `wf_governed_pipeline_integrity_audit` with cross-layer Registry resolution requirements and audit-readiness outputs
- v2.42 - provider-family continuity preparation added with provider/action/capability/route/workflow continuity targets, missing-edge reporting, and unresolved continuity-edge readiness gating
- v2.41 - spill-safe governed write loading added for header/schema validation, row-2 template sampling, formula-managed unified-log columns, and safe-column selection before Sheets writes
- v2.40 - execution classification loading rule added for runtime_capability_class, runtime_callable, primary_executor, endpoint_role, execution_mode, and transport readiness
- v2.40 - dynamic provider-domain placeholder loading added for governed runtime-resolved provider domains such as `target_resolved`
- v2.40 - duplicate-header intolerance added for execution-critical governed sheets
- v2.40 - auth-path loading expanded so `oauth_gpt_action` may invalidate delegated HTTP readiness when policy requires native-only execution
- v2.40 - activation full-system validation loading rule added so activation-class context includes schema, row, starter-policy, binding, anomaly, and repair-readiness evaluation surfaces
- v2.40 - starter policy and binding loading rule for activation added so unresolved starter policy or binding gaps keep activation execution readiness false with repair-aware continuity
- v2.40 - activation summary loading contract added for schema/row/policy/binding/anomaly/repair/execution-ready outputs before activation-ready context may be returned
- v2.39 - universal parent_action auth normalization loading rule added
- v2.39 - parent-action openai_schema_file_id alignment rule added for request and response contract readiness
- v2.39 - transport request contract outputs expanded with resolved auth and schema alignment status
- v2.38 - execution trigger runtime command rule added for hard activation wrapper
- v2.38 - no passive recovery messaging rule added
- v2.38 - failed first-pass loading enforcement rule added
- v2.38 - pre-response narrative suppression rule added
- v2.38 - explicit `execution_trigger_interpreted_as_runtime_command = true` output added

- v2.35 - post-activation dependency revalidation rule added
- v2.35 - dependency freshness rule added so earlier activation validation is traceability only, not permanent readiness proof
- v2.35 - post-activation target validation rule added
- v2.34 - first-turn activation governed transport validation rule added: module_loader now loads knowledge layer canonicals first, then automatically attempts governed Google Drive/Sheets/Docs validation
- v2.34 - authorization-gated live validation classification added so pre-authorization activation does not misclassify missing provider authorization as missing Registry authority
- v2.33 - Activation Validation Dual-Source Loading Rule added: activation validation now loads canonicals from knowledge layer first for traceability, then validates live canonical bindings and registry authority through Google Drive and Google Sheets APIs
- v2.33 - activation loading outputs expanded with `live_canonical_validation_status`, `knowledge_layer_trace_status`, `canonical_trace_comparison_status`, and `activation_dependency_order_status`
- v2.32 - Auto-Bootstrap Loading Rule added: module_loader now prepares bootstrap policy, original-request resume context, and activation-readiness dependencies for `wf_system_auto_bootstrap`
- v2.31 - segmented canonical reconstruction support added: governed canonical dependencies may use ordered chunk retrieval with deterministic reconstruction and integrity validation when full-body retrieval is size-limited or file-type constrained; segmented retrieval does not create a new authority path
- v2.30 - Runtime Authority Validation Pipeline Loading added: governed execution now prepares registry, validation, route, workflow, dependency, and graph readiness inputs before execution-ready context may be returned
- v2.29 - Google Workspace Registry-First Loading Rule added: governed Sheets, Docs, and Drive native actions now require Registry Surfaces Catalog resolution, Validation & Repair compatibility, and route/workflow compatibility before execution-ready context is returned
- v2.29 - Google Workspace Native Action Readiness Rule added: loader now returns `target_validation_status`, `registry_binding_status`, and `native_action_readiness`, with degraded/blocked readiness when Registry validation is incomplete
- v2.28 - Conversation Starter Context Injection added: module_loader now enforces starter-sheet header and column-contract checks and injects starter intelligence context for both prompt_router and system_bootstrap
- v2.28 - Deep Validation Layer Support added: loader validation now explicitly supports structural, column contract, row logic, cross-sheet, and behavioral levels driven by Row Audit Schema, Row Audit Rules, and Registry Surfaces Catalog
- v2.28 - validation output compatibility clarified: deep-validation outputs must align to Validation & Repair Registry schema and enforcement matrix levels
- v2.28 - Auto-Repair And Retry Loading Rule added: loader now prepares retry-capable policy, mapping, and validation context only when governed repair-and-retry prerequisites are resolved and recoverability is policy-compatible
- v2.28 - Governed Addition Loading Rule added: loader now resolves addition-aware surface/policy/graph context and returns promotion-readiness metadata for governed candidate-first activation flows
- v2.28 - Graph Intelligence Loading Rule added: loader now resolves governed node and relationship graph registries with schema-validated bindings and returns graph-ready context for validation, prediction, and auto-routing preparation
- v2.28 - Execution Graph Validation Loading Rule added: loader now prepares starter/route/workflow/decision/chain execution-path segments for graph validation and forbids recovered graph status when execution-critical segments are unresolved
- v2.27 - Conversation Starter Loading Rule refined: starter-aware loading now requires Registry Surfaces Catalog resolution, `worksheet_gid` validation, starter-row loading, and starter intelligence field extraction (`execution_class`, `capability_family`, `primary_goal_family`, `starter_success_score`, `starter_priority`)
- v2.27 - starter context injection contract clarified: starter intelligence context must be injected into both execution-ready context and routing support context
- v2.26 - Conversation Starter Loading Rule added: module_loader now resolves `conversation_starter_sheet` for starter-aware execution and validates starter schema metadata before downstream use
- v2.26 - starter context propagation added: starter intelligence context must now be returned in execution-ready and routing support contexts
- v2.25 - Scoring Policy Loading Rule added: module_loader now resolves governed scoring policy from `execution_policy_registry_sheet` when score-based recovery classification is active
- v2.25 - adaptive-threshold loading added: execution-class threshold rows, adaptive threshold policy rows, and relevant score-history context are now prepared for downstream recovery classification
- v2.24 - Schema Version Migration Loading Rule added: module_loader now resolves `schema_ref`, `schema_version`, `header_signature`, `expected_column_count`, and `binding_mode` from Registry Surfaces Catalog before migration-capable workbook_sheet execution
- v2.24 - schema migration/repair guardrails added: migration is forbidden when `schema_ref` or `schema_version` is missing, `binding_mode` is incompatible, or `worksheet_gid` validation fails
- v2.23 - Schema Governance Rule added: loader now recognizes required schema declaration fields (`schema_ref`, `schema_version`, `header_signature`, `expected_column_count`, `binding_mode`) and enforces schema-status validation outputs
- v2.23 - schema drift handling added to strict dependency validation: required governed-surface drift now forces degraded/blocked outcomes with repair mapping context when required
- v2.22 - Binding Integrity Review Loading Rule added: module_loader now prepares row-audit, review-stage, review-component, and repair-mapping context for binding_integrity_review when worksheet-governed validation is active
- v2.21 - Runtime Binding Enforcement Rule added: execution-surface resolution now requires Registry Surfaces Catalog with authoritative `worksheet_gid` existence, validity, and binding-match checks
- v2.21 - strict binding validation now explicitly forbids `sheet_name` or `tab_name` as execution-resolution authority; failed `worksheet_gid` validation forces blocked or repair-aware mode
- v2.20 - Full Audit Dependency Enforcement added: when workflow = `wf_full_system_intelligence_audit`, module_loader now must resolve execution bindings, chain registry, decision engine, actions, endpoint registry, system enforcement, and execution-log import dependencies
- v2.20 - full-audit dependency_state enforcement added: missing critical full-audit dependencies now explicitly force degraded or blocked outcomes and cannot classify as recovered
- v2.19 - full_system_intelligence_audit dependency loading added: loader now conditionally resolves execution policy, staged review, component review, repair mapping, row-audit rule/schema, and Business Intelligence Scoreboard surfaces for governed full-audit workflows
- v2.19 - audit-governance dependency_state rules added so missing full-audit authority surfaces classify as degraded or blocked by criticality, while Business Intelligence Scoreboard remains downstream-summary-only
- v2.18 - API Capability and Endpoint Resolution Rule added: native API action governance now resolves parent capability through Actions Registry and concrete endpoint metadata through API Actions Endpoint Registry in two distinct stages
- v2.18 - conditional authority loading, strict loading sequence, and dependency bindings now explicitly require `actions_registry_sheet` for capability-level action identity and prevent collapsed capability/endpoint registry interpretation
- v2.17 - Analytics Identity Integrity Enforcement Rule added: per-unit analytics execution now hard-stops on missing `brand_domain`, `gsc_property`, or `ga_property_id`, flags traceable identity failure, and propagates governed issue signal to system_bootstrap before API/transform/write stages
- v2.17 - strict loading sequence and degraded/blocked conditions expanded for analytics identity integrity, including explicit missing-property block states and per-unit partial degradation handling
- v2.16 - Domain-Aware Analytics Load Rule added: analytics execution units now require brand-domain scoped identity, domain-preserving payload handling, and domain-separated execution flow for multi-brand and multi-domain cases
- v2.16 - analytics degradation/blocking and completion rules expanded so recovered classification is forbidden when `brand_domain` is missing or domain-aware write metadata is absent
- v2.15 - Analytics Sheet Transformation and Write Rule added: analytics sheet-sync executions now require source resolution, request identity resolution, governed schema transformation, append_rows completion, and per-row metadata preservation before recovered classification
- v2.15 - strict loading sequence and degraded/blocked conditions extended for analytics sheet-sync write readiness, schema/write failures, unresolved analytics sheet bindings, and multi-brand separated writes
- v2.14 - Reconciled Dependency Consumption Rule added: loader now consumes only architecture-aligned dependency rows, degrades when superseded models are detected, prefers reconciled registry-bound records, and refuses silent legacy/current model merging
- v2.13 - Live Canonical Resolution Rule added: when canonical rows are registered in Validation & Repair Registry, loader must resolve `file_id`, detect `file_type`, fetch via native Docs/Sheets APIs, validate against `rule_id` and `section_id`, and use live content for execution; knowledge-layer content is non-authoritative when live resolution is possible
- v2.13 - API Actions Endpoint Registry (`gid: 172380518`) is now explicit loader authority for endpoint definition, API fetch triggering, and standardized execution calls for canonical live resolution
- v2.12 - knowledge-layer canonical dependency loading added; `exact_active_knowledge_only` resolves from governed canonical filenames in the knowledge layer; `source_mode = knowledge_layer`; URL and Drive fallback prohibited for those rows
- v2.11 - canonical source priority: local file first Ã¢â€ â€™ `canonical_url` for `exact_active_url_only` rows; output contracts for layer vs URL; aligned with `system_bootstrap`
- v2.10 - URL-based canonical dependency loading added (`source_mode` canonical_url vs drive_file); `exact_active_url_only` resolution_rule; host allowlist canonicals.wovacation.com; extension validation; fetch outcome fields (resolution_state, resolved_source, resolved_location, failure_reason); Drive fallback prohibited for URL-migrated canonical rows
- v2.9 - analyticsdata_api, analyticsadmin_api, and expanded tagmanager_api module binding rules added; Brand Registry tracking resolution and brand_tracking_bindings injection required before analytics or GTM API dependency maps; Search Ads 360 retired for active loader authority; strict loading sequence extended for brand tracking and API module resolution
- v2.8 - autonomous chain loading now requires chain workflow rows to validate as full Workflow Registry authority before dependency loading continues
- v2.8 - chain workflow validation now feeds dependency_state, binding_status, target_resolution_status, and executable_readiness explicitly
- v2.8 - route_id, chain_id, target_workflow, and target_module now revalidate as one governed unit for autonomous chains
- v2.7 - feedback_injection_context and growth_loop_context added for growth-layer execution preparation
- v2.7 - loader now injects governed feedback context from Growth Loop Engine Registry, Metrics Warehouse, Execution Log, and governed review feedback sources
- v2.6 - authoritative binding surfaces and governed control surfaces added to dependency tier awareness
- v2.6 - repair-aware binding resolution added so loader resolves against repaired canonical rows after binding schema migration review
- v2.6 - Anomaly Detection and Execution Log Unified acknowledged as governed derived observability surfaces when registered
- v2.41 - starter-aware loading now requires `Execution Policy Registry` resolution before starter-triggered execution can classify as execution-ready
- v2.41 - loader now preserves starter-policy evidence fields including `entry_source`, `policy_resolution_status`, `policy_source`, and `policy_trace_id`
- v2.41 - `Execution Log Unified` append preparation restricted to `A:AD`; formula-managed spill columns `AE:AJ` are excluded from literal payload construction
- v2.5 - canonical binding-validity dependency rule added so authoritative binding surfaces must be schema-valid before dependency execution proceeds
- v2.4 - dependency tier awareness added for authoritative execution, authoritative review, and derived observability surfaces
- v2.4 - derived observability surface failures now return degraded observability state without blocking engine execution by themselves
- v2.3 - Registry-governed authority dependency awareness added
- v2.3 - conditional authority loading and dependency_state classification added
- v2.3 - authority_dependency_context added to outputs and execution context
- v2.3 - authority source constraint added

- v1 Ã¢â‚¬â€ loader uses registry only
- v2 Ã¢â‚¬â€ decision-aware loading added
- v2 Ã¢â‚¬â€ execution chain context added
- v2 Ã¢â‚¬â€ autonomous chain contract added
- v2 Ã¢â‚¬â€ dependency bindings expanded
- v2 Ã¢â‚¬â€ completion rule strengthened
- v2.1 Ã¢â‚¬â€ monitoring surface context contract added
- v2.1 Ã¢â‚¬â€ execution_view_sheet added as runtime monitoring surface
- v2.1 Ã¢â‚¬â€ active_issues_dashboard_sheet added as runtime monitoring surface
- v2.1 Ã¢â‚¬â€ monitoring_context added to execution context contract
- v2.2 Ã¢â‚¬â€ strict loader intake contract added
- v2.2 Ã¢â‚¬â€ strict loading enforcement added
- v2.2 Ã¢â‚¬â€ route and workflow binding revalidation added
- v2.2 Ã¢â‚¬â€ blocked loading conditions added
- v2.2 Ã¢â‚¬â€ load_status and binding_status added
- v2.2 Ã¢â‚¬â€ ungoverned target preparation prohibition clarified
- v2.43 - Logic Knowledge Layer Loading Rule added so loader prepares required logic-specific, cross-logic, and shared knowledge dependencies before returning execution-ready context
- v2.43 - Business-Type Knowledge Profile Loading Rule added so loader prepares required business-type profile dependencies before execution-ready context
