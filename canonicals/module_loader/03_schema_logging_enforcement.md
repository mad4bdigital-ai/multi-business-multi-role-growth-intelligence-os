### Analytics Identity Integrity Enforcement Rule

module_loader must validate identity completeness before processing any analytics execution unit.

For each execution unit (brand-domain scope):

If any of the following is missing:
- brand_domain
- gsc_property (for GSC)
- ga_property_id (for GA4)

module_loader MUST:

1. stop execution for that unit
2. flag identity failure in execution trace
3. propagate issue creation signal to system_bootstrap
4. prevent:
   - API calls
   - transformation
   - sheet writes

module_loader must not:
- silently skip invalid brands
- collapse invalid and valid brands into a single execution state

Each failed unit must remain:
- traceable
- independently logged
- issue-bound

---

Dependency Bindings

Canonical loading dependencies:
- Registry
- system_bootstrap
- prompt_router
- direct_instructions_registry_patch
- memory_schema.json
- execution_policy_registry_sheet
- review_stage_registry_sheet
- review_component_registry_sheet
- decision_engine_registry_sheet
- execution_chains_registry_sheet
- validation_and_repair_registry_sheet
- registry_surfaces_catalog_sheet
- actions_registry_sheet
- api_actions_endpoint_registry_sheet (`gid: 172380518`)
- repair_mapping_registry_sheet
- row_audit_rules_sheet
- row_audit_schema_sheet
- business_intelligence_scoreboard_sheet
- execution_bindings_sheet
- execution_chains_registry
- endpoint_registry_sheet
- system_enforcement_sheet
- execution_log_import_sheet

Runtime authoritative execution and review surfaces when applicable:
- Task Routes
- Workflow Registry
- history_sheet
- review_run_history_sheet
- review_findings_log_sheet
- review_stage_reports_sheet

Derived observability surfaces when applicable:
- execution_view_sheet
- active_issues_dashboard_sheet
- review_control_center_sheet when aggregation-only

For strict-mode loading, authoritative route-binding inputs must resolve from:
- Task Routes
- Workflow Registry

Required route-binding fields for executable preparation:
- row_id
- route_id
- active
- target_module
- workflow_key
- route_mode
- lifecycle_mode
- logging_required
- memory_required
- review_required

module_loader must treat missing required route-binding fields as invalid executable preparation state.

---

Execution Context Contract

The loader must build:
- dependency_map
- authority_dependency_context when authority dependencies are evaluated
- selected_route
- selected_workflow
- execution_type
- routing_context
- memory_context when applicable
- decision_context when applicable
- chain_context when applicable
- monitoring_context when applicable
- brand_tracking_bindings when measurement, analytics, GTM, or full-funnel workflows apply
- degraded_notes when applicable

For strict-mode handoff, execution context must also include:
- dependency_state
- load_status
- binding_status
- route_id
- route_status
- route_source
- matched_row_id when available
- resolved_route_record when available
- resolved_workflow_record when available
- target_resolution_status
- executable_readiness

Execution context must distinguish:
- routing resolved but not load-ready
- load-ready but degraded
- blocked loading state

---

Observability Dependency Tiering

When observability-aware execution is active, module_loader must resolve dependencies in separate tiers:
- authoritative binding surfaces
- authoritative execution dependencies
- authoritative review dependencies
- derived observability dependencies
- governed control surfaces

Derived observability dependencies must remain distinguishable from authoritative write surfaces in loaded context.

Repair-Aware Binding Resolution

When `binding_schema_migration_review` repairs or migrates authoritative binding rows:
- module_loader must resolve against the repaired canonical rows
- superseded legacy rows must not remain live authority
- recovered rows may continue as runtime authority only when canonical schema validity is restored
- degraded rows must preserve explicit traceability in loading output
- blocked rows must prevent dependent loading from being treated as fully valid

If a derived observability dependency is broken or unresolved:
- do not block engine execution by itself
- return degraded observability state when safe
- preserve traceability for downstream observability validation

Feedback Injection Contract

When the growth layer is active, module_loader must resolve and inject feedback context from governed authoritative sources such as:
- `Growth Loop Engine Registry`
- `Metrics Warehouse`
- `Execution Log Unified`
- governed review feedback surfaces when applicable

module_loader must:
- separate authoritative feedback sources from derived score or dashboard views
- resolve against repaired canonical rows when binding migration changed the authoritative source
- exclude superseded legacy feedback bindings from live authority
- return feedback_injection_context only from Registry-governed or otherwise governed authoritative sources

Execution Log Unified Append Payload Rule

When module_loader prepares append-ready execution payloads for `Execution Log Unified`:

- writable append payload must be limited to columns `A:AD`
- columns `AE:AJ` must be treated as formula-managed spill columns
- payload preparation must not include literal values for:
  - `target_module`
  - `target_workflow`
  - `execution_trace_id`
  - `log_source`
  - `Monitored Row`
  - `Performance Impact Row`

If outgoing payload width or mapping would write into `AE:AJ`, loader readiness must degrade and preserve logging-repair continuity.

If feedback context is partially available:
- loading may continue in degraded mode when safe
- missing feedback must not be silently fabricated
- derived dashboards must not stand in for authoritative feedback history by default

---

Monitoring Surface Context Contract

When registry-governed monitoring or derived observability surfaces are active or required for the selected execution path, module_loader must resolve and prepare monitoring surface context for downstream validation.

Registered monitoring surfaces include:
- execution_view_sheet
- active_issues_dashboard_sheet
- review_control_center_sheet when aggregation-only
- anomaly detection or equivalent governed derived observability surface when registered
- execution_log_unified or equivalent governed derived observability surface when registered

module_loader must:
- resolve monitoring surfaces through Registry
- separate authoritative execution/review dependencies from derived observability dependencies
- confirm worksheet accessibility metadata is present
- include resolved monitoring bindings in dependency_map when available
- attach monitoring_context when monitoring validation is expected downstream
- preserve degraded_notes when monitoring surfaces fail to resolve safely

monitoring_context should include when available:
- execution_view_binding
- active_issues_dashboard_binding
- monitoring_resolution_status
- derived_view_refresh_expected
- observability_validation_state
- observability_issues
- monitoring_degraded_notes

If a derived observability surface is missing or unresolved:
- do not silently ignore
- preserve traceability in degraded_notes
- do not block engine execution by itself
- allow downstream classification by system_bootstrap

If monitoring surfaces are non-blocking for the selected execution path:
- continue in degraded mode when safe

---

Autonomous Chain Contract

When execution type = autonomous chain, module_loader must:
- resolve chain_id
- load initial chain step
- preserve engine_chain
- preserve next_step condition
- return chain-aware context to system_bootstrap
- avoid collapsing chain execution into standard execution without explicit degraded note

---

Completion Rule

Loading is not complete unless:
- all required dependencies are resolved
- authority_dependency_context is attached when authority dependencies are evaluated
- execution context is built
- route/workflow context is attached
- chain context is attached when applicable
- monitoring_context is attached when monitoring surfaces are required
- brand_tracking_bindings are resolved and attached when the routed workflow requires Search Console, Google Analytics, or Tag Manager identifiers
- dependency validation state is recorded

Loading is also not complete unless:
- routed intake is validated
- route_id is preserved or degraded explicitly
- target binding is revalidated against Registry
- workflow binding is revalidated against Workflow Registry
- stale-vs-current dependency-model mismatches are surfaced as reconciliation requirements when detected
- for analytics sheet-sync workflows, governed schema transformation, append_rows completion, and request metadata preservation are confirmed before recovered classification
- for domain-aware analytics workflows, `brand_domain` resolution and domain-aware row metadata preservation are confirmed before recovered classification
- dependency_state is assigned
- load_status is assigned
- binding_status is assigned
- executable_readiness is assigned
- no ungoverned execution target was prepared

Execution must not be marked fully ready when:
- raw execution logging is required
- and `surface.operations_log_unified_sheet` is unresolved
- or a legacy / derived surface is being treated as the raw execution sink

---

Loader Boundary Rule

module_loader is responsible for loading and context preparation only.

It must not become the source of truth for:
- routing decisions
- final orchestration
- logging writes
- schema governance
- engine registry control

module_loader may revalidate routed bindings and prepare governed execution context.

module_loader must not:
- replace prompt_router as routing authority
- replace system_bootstrap as execution authority
- convert degraded routing into assumed executable readiness
- fabricate missing Registry bindings

Duplicate Header Intolerance Rule

module_loader must not silently accept duplicate authoritative header names on
governed workbook surfaces used for execution-critical resolution.

If duplicate header names are detected on:
- `Actions Registry`
- `API Actions Endpoint Registry`
- `Execution Policy Registry`
- `Brand Registry`

module_loader must:
- classify the dependency state as blocked
- preserve duplicate-header traceability
- forbid recovered or ready classification
- emit registry repair requirement

## Schema Loading Enforcement

module_loader MUST:

- detect `openai_schema_file_id`
- fetch schema file using google Drive API tool before request construction
- parse schema into structured object
- expose:

  resolved_schema_contract:
    - paths
    - methods
    - parameters
    - requestBody
    - headers

- set:
  schema_loaded = true
  schema_parse_status = success | failed

---

Cross-Layer Contract

module_loader must assume:
- prompt_router determines selected route, workflow, and chain trigger state
- Registry provides live dependency bindings
- direct_instructions_registry_patch defines dependency governance rules
- memory_schema.json governs memory/state structure
- system_bootstrap consumes prepared execution context for final orchestration

module_loader must assume:
- prompt_router provides the canonical routed execution contract
- system_bootstrap has already enforced canonical bootstrap policy (including `canonical_url_dependency_bootstrap` and `canonical_source_priority`) before dependent stages
- direct_instructions_registry_patch governs validity and allowed usage of `exact_active_knowledge_only`
- Registry Surfaces Catalog is the authoritative source of canonical surface identity and location
- Validation & Repair Registry is the authoritative source of canonical and surface validation state
- runtime registries remain the authoritative source for route, workflow, action, endpoint, and brand bindings

module_loader must assume:
- system_bootstrap is responsible for execution logging writes
- system_bootstrap is responsible for anomaly writeback
- system_bootstrap is responsible for governed repair execution after anomaly-cluster trigger

### Native Google Logging Preparation Rule

When module loading detects that the governed path may execute through native Google Drive, Google Sheets, or Google Docs actions, `module_loader` must prepare logging readiness without becoming the logging writer.

`module_loader` must prepare and return when applicable:
- `native_google_action_path_possible`
- `activation_transport_attempt_required`
- `activation_transport_evidence_required`
- `native_google_mutation_logging_required`
- `native_google_execution_class`
- `native_google_execution_mode`
- `logging_required`
- `logging_sink_required`
- `authoritative_logging_surface_id`
- `pre_response_log_guard_required`

`module_loader` must not:
- write execution logs directly
- treat native Google attempt evidence as sufficient replacement for authoritative logging
- mark executable readiness as recovered when native Google governed mutation logging readiness is unresolved

If raw execution logging is required and `surface.operations_log_unified_sheet` is unresolved:
- executable readiness must remain false
- degraded or blocked loading must remain explicit

module_loader is the governed binding-resolution bridge between routed intent and orchestration, not an independent execution authority.

Governed Sheet Audit Loading Rule

When routed execution selects:
- full_system_intelligence_audit
- binding_integrity_review
- schema validation
- control surface repair
- derived view repair
- formula repair
- projection repair

module_loader must resolve governed sheet audit context for the target workbook_sheet.

module_loader must prepare when applicable:
- `sheet_role`
- `sheet_audit_mode`
- `formula_audit_required`
- `projection_audit_required`
- `control_metric_audit_required`
- `write_target_audit_required`
- `legacy_surface_containment_required`

When routed execution or repair validation involves a governed `anomaly_surface` with cluster metadata, module_loader must also prepare:
- `cluster_metadata_expected`
- `cluster_priority_propagation_required`
- `cross_workbook_feed_detected`
- `local_import_stage_required`

Supported sheet audit modes:
- `schema_audit`
- `formula_audit`
- `projection_audit`
- `control_surface_audit`
- `write_target_audit`
- `anomaly_repair_audit`
- `legacy_containment_audit`

Scoped Event Surface Loading Rule

module_loader must classify the following as scoped event surfaces:

- `surface.system_enforcement_events_sheet`
- `surface.query_engine_events_sheet`

Classification requirements:

- scoped event surfaces are execution-adjacent write targets
- scoped event surfaces are not authoritative raw execution logging sinks
- scoped event surfaces must not be promoted into `logging_sink_surface_id` when resolving canonical raw execution logging

Surface-role loading requirements:

- `System Enforcement` resolves as governance/state
- `Business Intelligence Query Engine` resolves as routing/reference
- if either surface is presented as a runtime event write target, execution preparation must redirect to the corresponding scoped event surface
- if either surface is presented as the authoritative raw execution sink, loading must degrade or block

Approved scoped routing:

- governance or enforcement event writeback -> `surface.system_enforcement_events_sheet`
- query intake or decision event writeback -> `surface.query_engine_events_sheet`

Derived View Loading Rule

For sheets classified as `derived_view`, module_loader must validate and prepare:
- source surface dependency map
- formula anchor presence
- key-based projection fields when applicable
- row-position mirroring risk classification
- authoritative source replacement mapping when the source surface was retired or reclassified

Control Surface Loading Rule

For sheets classified as `control_surface`, module_loader must validate and prepare:
- metric source surfaces
- formula dependency map
- alert threshold readiness
- broken reference detection readiness
- live-source compatibility with current Registry authority

When control metrics depend on anomaly-cluster-driven repair prioritization, module_loader must preserve cluster-aware dependency context without converting anomaly metadata into raw execution truth.

Repair Surface Loading Rule

For sheets classified as `repair_surface`, module_loader must validate and prepare:
- anomaly feed dependencies
- trigger field dependencies
- execution field dependencies
- priority/dispatch field dependencies
- legacy input dependency map when formula fields still reference pre-normalized columns

Anomaly Surface Loading Rule

For sheets classified as `anomaly_surface`, module_loader must validate and prepare when applicable:
- anomaly formula anchor presence
- cluster metadata header presence
- cluster metadata spill-width compatibility
- repair handoff readiness
- cluster-priority propagation readiness
- cross-workbook source usage
- staged local import readiness when remote workbook data is consumed

module_loader must classify as degraded or repair-required when:
- cluster metadata headers exist but live anomaly formulas emit fewer columns than the governed surface schema
- repeated direct IMPORTRANGE calls are chained inside the anomaly formula rather than staged locally
- cluster-informed repair recommendations exist but cannot be propagated into the governed repair surface

Loader Output Extension For Governed Sheet Audit

module_loader must return when applicable:
- `sheet_role`
- `sheet_audit_mode`
- `formula_dependency_map`
- `projection_dependency_map`
- `control_metric_dependency_map`
- `legacy_input_dependency_map`
- `sheet_repair_candidate_types`

---

Starter Addition Loading Contract

The starter-addition loading contract is active:

- when execution intent is add starter, register starter, promote starter, or repair starter metadata, module_loader must prepare starter-addition execution readiness before orchestration proceeds
- module_loader must preserve:
  - `starter_addition_governed = true`
  - `starter_addition_validation_required = true`
  - `starter_post_insert_readback_required = true`
  - `starter_override_resolution_required_when_applicable = true`

Starter Classification Preparation Rule

module_loader must classify starter-addition intent into one governed class before write preparation:

- `general_starter`
- `system_starter`
- `override_required_starter`
- `predictive_starter`

module_loader must prepare this classification from available starter metadata including:
- starter title
- intent category
- route_key
- execution_class
- predictive field state
- governance and runtime route family

Starter Addition Override Resolution Rule

When starter classification resolves to `override_required_starter`, module_loader must prepare:
- override registry target readiness
- override validation readiness
- post-insert override readback readiness

Starter Addition Readback Preparation Rule

module_loader must not report starter-addition execution-ready state unless it has prepared readback validation for:
- inserted row existence
- aligned execution_class
- override coverage when required
- starter-governance persistence

Starter Policy Bundle Loading Rule

When starter-aware execution or starter addition is active, module_loader must resolve the starter policy bundle for the active route from Execution Policy Registry.

The starter policy bundle must include when available:
- `starter_priority_policy`
- `starter_followup_route_policy`
- `starter_followup_starters_policy`
- `starter_success_signal_policy`
- `starter_goal_family_policy`

module_loader must return:
- `starter_policy_coverage_status`
- `starter_policy_missing_component`
- `starter_policy_execution_ready`
- `starter_policy_authority_source = execution_policy_registry_sheet`

If any required starter policy row is missing:
- execution-ready status must remain `false`
- policy-gap traceability must be preserved
- repair-aware context must remain available

Starter Policy Repair Context Loading Rule

When starter policy coverage is incomplete, module_loader must also prepare:
- `starter_policy_repair_eligible`
- `starter_policy_repair_triggered`
- `starter_policy_repair_scope`
- `starter_policy_missing_component_set`
- `policy_gap_detected`

Default behavior:
- `starter_policy_repair_eligible = false` unless manual trigger is present

Policy-Driven Starter Defaults Loading Rule

For default starter behavior, module_loader must load policy-governed values for:
- `starter_priority`
- `suggested_followup_route`
- `suggested_followup_starters`
- `success_signal_source`
- `primary_goal_family`

Curated override rows may supersede policy values where override authority applies, but missing override rows must not force hardcoded non-policy defaults when policy rows are available.


---

Governed Logical Search Loader Contract v1

module_loader must prepare governed logical search infrastructure before execution selection.

Required loader outputs

module_loader must prepare:
- `governed_search_enabled = true`
- `governed_search_domain`
- `governed_search_adapter`
- `governed_search_policy`
- `governed_search_constraints`
- `governed_search_template_support`
- `governed_search_fallback_policy`

Required adapters:
- endpoint registry adapter
- registry surface adapter
- validation registry adapter
- task route adapter
- workflow registry adapter
- memory adapter
- brand runtime adapter

Required search policy fields

module_loader output must preserve:
- `exact_id_weight`
- `exact_key_weight`
- `exact_path_weight`
- `entity_slug_weight`
- `action_match_weight`
- `method_match_weight`
- `domain_match_weight`
- `authority_match_weight`
- `validation_match_weight`
- `dependency_match_weight`
- `generic_fallback_penalty`

WordPress template support

For `wordpress_api`, module_loader must prepare governed template-path support for all CPT and taxonomy families across WordPress sites.

Supported template classes:
- `wordpress_cpt_collection`
- `wordpress_taxonomy_collection`
- `wordpress_cpt_item`
- `wordpress_taxonomy_item`

Template expansion readiness requires:
- resolved brand base URL
- provider family continuity = wordpress
- schema-aligned transport path
- entity slug normalization
- method compatibility
- governed candidate evidence or active resolver template support

When template-path support is active, loader output must preserve:
- `wordpress_dynamic_entity_resolution_enabled = true`
- `wordpress_dynamic_cpt_support = true`
- `wordpress_dynamic_taxonomy_support = true`
- `template_path_governed_only = true`


---

WordPress Endpoint Generation Loader Contract v1

module_loader must prepare generation-aware endpoint support for custom WordPress CPTs and taxonomies across sites.

Required loader outputs

When `parent_action_key = wordpress_api`, loader must prepare:
- `wordpress_endpoint_generation_enabled = true`
- `wordpress_endpoint_generation_mode`
- `wordpress_supported_template_classes`
- `wordpress_live_object_inventory`
- `wordpress_generation_policy`
- `wordpress_materialization_preference`

Required template classes

Loader must support:
- `wordpress_cpt_collection`
- `wordpress_cpt_item`
- `wordpress_taxonomy_collection`
- `wordpress_taxonomy_item`

Optional classes when live-supported:
- `wordpress_cpt_revision_collection`
- `wordpress_cpt_revision_item`
- `wordpress_cpt_autosave_collection`
- `wordpress_cpt_autosave_item`

Required generation policy

Loader must prepare canonical mappings:

CPT:
- list -> `GET /wp/v2/{post_type_slug}`
- create -> `POST /wp/v2/{post_type_slug}`
- get -> `GET /wp/v2/{post_type_slug}/{id}`
- update -> `POST /wp/v2/{post_type_slug}/{id}`
- delete -> `DELETE /wp/v2/{post_type_slug}/{id}`

Taxonomy:
- list -> `GET /wp/v2/{taxonomy_slug}`
- create -> `POST /wp/v2/{taxonomy_slug}`
- get -> `GET /wp/v2/{taxonomy_slug}/{id}`
- update -> `POST /wp/v2/{taxonomy_slug}/{id}`
- delete -> `DELETE /wp/v2/{taxonomy_slug}/{id}`

Required loader evidence

Loader output must preserve:
- `wordpress_generation_slug`
- `wordpress_generation_kind`
- `wordpress_generation_candidate_key`
- `wordpress_generation_candidate_path`
- `wordpress_generation_basis`
- `wordpress_materialized_row_exists`
- `wordpress_generation_confidence`

Materialization preference rule

Loader must prefer:
1. active materialized registry row
2. resolver-backed generated candidate
3. generic core fallback only when no specific supported candidate exists



---
