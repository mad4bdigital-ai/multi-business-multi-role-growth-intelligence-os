`binding_integrity_review` must verify:
- canonical/runtime schema alignment
- `surface_name` + `worksheet_gid` binding readiness
- row-audit surface compatibility
- absence of deprecated label-based worksheet resolution in active execution paths

If `binding_integrity_review` fails for required surfaces:
- execution must classify as `Degraded` or `Blocked`
- repair-aware routing must remain available
- `Recovered` classification is forbidden

Promotion-sensitive execution must distinguish registration, activation, readiness, and promotion:
- `registered` does not imply `promoted`
- `active` does not imply `promoted`
- promotion-sensitive execution requires explicit `promotion_status = promoted` from the governed authority surface or policy set
- records without promoted state may be used for validation, review, or repair context only, not promoted execution authority

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

For agent-action-backed tool execution, successful connector availability is not sufficient for recovered readiness when endpoint inventory metadata is required by policy.

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
- api_endpoint_metadata_readiness_status when agent-action-backed endpoint metadata governance applies
- runtime_authority_validation_status when mandatory runtime authority validation applies
- live_canonical_validation_required when activation-class live canonical validation applies
- live_canonical_validation_source when activation-class live canonical validation applies
- live_canonical_validation_status when activation-class live canonical validation applies
- required_surface_resolution_status when activation-class governed surface resolution applies
- dependency_readiness_status when activation-class dependency validation applies
- native_action_requested when governed Google Sheets, Docs, or Drive execution applies
- activation_transport_attempted when first-turn activation enforcement applies
- activation_transport_status when first-turn activation enforcement applies
- activation_transport_evidence when first-turn activation enforcement applies
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

### Addition Promotion, Scoring, And Health Authority

Governed additions must preserve explicit promotion-state authority.

Supported governed addition promotion states:
- `proposed`
- `candidate`
- `validated_candidate`
- `governed_active`
- `proof_tested`
- `promotion_ready`
- `canonicalized`

Governed addition scoring authority:
- `route.surface_addition_scoring_refresh.global.v1`
- `wf_surface_addition_scoring_refresh`
- `CH-030 Surface Addition Scoring Refresh Chain`

Scoring-refresh authority must preserve:
- `addition_promotion_score`
- `proof_confidence`
- score freshness state
- scoring writeback verification state

Scoring-summary writeback authority:
- `wf_surface_addition_scoring_summary_writeback`
- `CH-035 Surface Addition Scoring Summary Writeback Chain`

Scoring writeback review authority:
- `route.surface_addition_scoring_writeback_review.global.v1`
- `wf_surface_addition_scoring_writeback_review`
- `CH-032 Surface Addition Scoring Writeback Review Chain`

Closed-loop verification authority:
- `route.surface_addition_verification_loop_review.global.v1`
- `wf_surface_addition_verification_loop_review`
- `CH-033 Surface Addition Verification Loop Review Chain`

Framework-health authority:
- `route.surface_addition_framework_health_review.global.v1`
- `wf_surface_addition_framework_health_review`
- `CH-034 Surface Addition Framework Health Review Chain`

Framework-health reasoning must cover:
- template conformance
- score freshness
- scoring writeback verification
- promotion confidence support
- verification-loop coupling completeness
