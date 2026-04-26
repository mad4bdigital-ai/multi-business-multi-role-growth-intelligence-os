## Runtime Validation Declaration

Before handoff to `system_bootstrap`, `prompt_router` must declare:
- `required_route_id`
- `required_workflow_key`
- `review_required`
- `required_write_targets`
- `required_authoritative_surfaces`

This declaration is advisory to lifecycle execution but binding for runtime validation expectations.

prompt_router must return execution preparation only.
prompt_router must not execute the selected target.

Request Readiness Rule

When a live request is received, prompt_router must not prepare an execution-eligible handoff unless it can:
- resolve the route from `Task Routes`
- resolve the workflow from `Workflow Registry`
- preserve execution logging readiness through governed `logging_required` output for downstream enforcement

If any of these are missing or unresolved:
- `route_status` must be at least `degraded` unless a stricter blocked-routing rule already applies
- `executable` must be set to `false`
- `degraded_reason` must identify the missing readiness element when available
- routing traceability must preserve which requirement was unresolved

Validation Request Live Canonical Declaration Rule

When a request is classified as validation, audit, verification, readiness check, or canonical check, prompt_router must preserve in the execution preparation contract:

- `live_canonical_validation_required = true`
- `validation_source_requirement = http_generic_api_live_canonical`
- `knowledge_layer_validation_only_for_traceability = true`

prompt_router must not treat uploaded copies, knowledge-layer copies, or cached canonical text as sufficient validation authority when live canonical resolution is possible.

Governed Activation Semantics

prompt_router must distinguish between:
- informational request
- review request
- governed activation request
- auto-repair request

Prompt activation may influence execution eligibility, but it must not replace governed checks for:
- Task Routes resolution
- Workflow Registry resolution
- binding validity
- governed trigger qualification

Passive rows or passive control states must not auto-execute from prompt phrasing alone.

When governed control rows are consulted for activation readiness, prompt_router must preserve trigger-key traceability for:
- `HIGH_PRIORITY`
- `READY_TRIGGER`
- `PASSIVE`

Trigger modes must remain distinguishable as:
- `governed_auto`
- `manual`

New Governed Repair And Migration Intents

prompt_router must recognize intent patterns such as:
- run repair loop
- execute high priority fixes
- trigger system repair
- run binding migration
- run schema migration review
- repair schema
- fix schema drift
- reconcile schema

When these intents are validated through Registry-governed routing authority, prompt_router must prepare the corresponding governed execution handoff rather than collapsing them into generic analysis routes.

When schema repair intent patterns are matched:
- route -> `schema_reconciliation_repair`
- workflow -> `wf_schema_reconciliation_repair`

prompt_router must preserve:
- `repair_mode = true`
- drift context when available
- `schema_reconciliation_required = true` when schema drift intent or schema drift context is present

Prompt-Trigger Compatibility

Prompt activation can set execution eligibility, but it does not replace governed trigger checks, binding validation, repair-loop idempotency checks, or downstream execution-readiness enforcement.

Adaptive Optimization Routing Compatibility

When governed growth-loop or adaptive optimization context is available, prompt_router may:
- prioritize a better workflow candidate
- adjust governed route weighting
- prepare a follow-up optimization route

Adaptive optimization must remain bounded by:
- Task Routes authority
- Workflow Registry authority
- governed trigger qualification
- existing execution-readiness checks

Derived dashboards or ungoverned score notes must not directly change route authority.

Chain Readiness Rule

Chain-triggered routing must resolve a valid executable workflow row, not only a `chain_id`.

No chain handoff is executable unless:
- `Execution Chains Registry` resolves cleanly
- `Workflow Registry` resolves cleanly
- `target_workflow` exists as an active workflow row
- chain route compatibility and workflow route compatibility both remain valid

When chain-triggered routing is selected:
- resolve `chain_id`
- resolve the chain-targeted `target_workflow`
- validate that the workflow row is active and executable
- set `execution_class = autonomous chain`

If a chain exists but its workflow row is incomplete, inactive, or route compatibility is missing:
- set `route_status = degraded`
- set `executable = false`
- preserve `chain_id`, `route_override_status`, `decision_status`, and `target_workflow` for traceability

prompt_router must not emit executable chain routing from chain metadata alone.


Allowed route_status values:
- resolved
- degraded
- blocked

Allowed route_source values:
- registry_task_routes

If no valid active route is resolved from Task Routes:
- do not silently fallback to direct execution
- return degraded routing output
- preserve routing traceability


---


Routing Rules

Starter Intelligence Pre-Routing Rule

Before generic intent classification:

prompt_router must:
1. detect if input matches a governed Conversation Starter
2. resolve starter row using:
   - `Registry Surfaces Catalog`
   - `worksheet_gid` binding
3. extract:
   - `route_key`
   - `execution_class`
   - `capability_family`
   - `primary_goal_family`
   - `starter_priority`

Starter must be treated as:
- structured routing input

Starter may:
- influence route weighting
- prioritize goal-aligned workflows

Starter must not:
- override Task Routes authority

Starter Policy Resolution Routing Rule

When a governed Conversation Starter match is detected, prompt_router must not treat starter resolution alone as sufficient for executable routing.

Before route dispatch, prompt_router must:

- require active policy resolution from `Execution Policy Registry`
- preserve `entry_source = conversation_starter`
- preserve `policy_resolution_status`
- preserve `policy_source = Execution Policy Registry`
- preserve `policy_trace_id` when available

If starter match succeeds but policy resolution is absent, partial, or invalid:

- executable routing must remain degraded or blocked
- downstream handling must preserve `failure_reason = missing_starter_policy_resolution`
- repair-aware routing must remain available

Starter Policy Completeness Routing Rule

When starter-aware routing is active, prompt_router must also preserve starter policy readiness context when available:
- `starter_policy_coverage_status`
- `starter_policy_missing_component`
- `starter_policy_execution_ready`
- `starter_policy_repair_triggered`
- `starter_policy_repair_scope`

If starter policy coverage is incomplete:
- `executable` must remain `false` for normal starter execution
- routing must classify as `degraded` or `blocked` by policy
- repair-aware routing must remain available

Policy Gap Routing Rule

When:
- `starter_policy_execution_ready = false`
- or anomaly classification = `policy_gap`

prompt_router must preserve:
- `policy_gap_detected = true`
- `policy_gap_repair_eligible = false` unless manual trigger is present
- `repair_route_required = governed_addition` when manual trigger is present

Manual Trigger Policy Repair Routing Rule

If:
- `policy_gap_detected = true`
- and `starter_policy_repair_triggered = true`

prompt_router must:
- prefer governed addition routing
- preserve target repair scope from `starter_policy_repair_scope`
- preserve missing policy component context for downstream repair execution
- forbid normal starter execution in the same routing result

If:
- `policy_gap_detected = true`
- and `starter_policy_repair_triggered = false`

prompt_router must:
- keep `executable = false`
- preserve validation-only / repair-preparation output
- forbid automatic policy creation

Starter Policy Authority Preservation Rule

When starter-aware routing extracts starter_priority, follow-up route, follow-up starters, success signal, or goal family:
- prompt_router must treat Execution Policy Registry as the default authority source when no curated override row applies
- starter-derived signals may influence route weighting only after policy readiness is valid

Auto-Repair Routing Compatibility Rule

prompt_router must not execute repair or retry directly.

When a request explicitly asks for repair, retry, rerun after repair, or governed recovery execution, prompt_router may prepare a repair-compatible execution handoff only when:

- Task Routes resolves an active governed repair-capable route
- Workflow Registry resolves the governed executable workflow row
- execution policy allows repair-aware retry lifecycle

prompt_router must preserve in routing output when available:
- `retry_requested`
- `retry_reason`
- `repair_aware_execution`
- `original_route_id`
- `original_target_workflow`

prompt_router must not mark retry as executable if validation or policy prerequisites are unresolved.

Governed Addition Routing Rule

When a request asks to add, register, create, or promote a governed system item, prompt_router may prepare governed addition routing only when:
- Task Routes resolves the governed addition route
- Workflow Registry resolves the governed addition workflow
- execution policy allows governed addition behavior

prompt_router must preserve when available:
- addition_requested
- addition_type
- affected_scope
- affected_surfaces
- graph_impact_expected
- validation_required
- canonical_patch_required

Governed addition routing must remain advisory until downstream validation confirms readiness.

Google Workspace Registry-Governed Routing Rule

When a request implies Google Sheets, Google Docs, or Google Drive execution, prompt_router must not prepare executable routing from tool availability alone.

prompt_router must:
- resolve the governed route from `Task Routes`
- resolve the governed workflow from `Workflow Registry`
- preserve Registry validation expectations for the downstream target

When the request affects governed system resources, routing output must preserve when available:
- target_surface_id
- target_registry_validation_required
- target_validation_scope
- native_action_requested

If Registry-governed target validation is required but unresolved:
- executable must remain false
- routing must degrade or block by policy

Repository Canonical Fetch Routing Rule

- when repository-backed canonical authority is active, prompt_router must prepare canonical fetch routing through `github_api_mcp` before mutable live-surface validation is treated as sufficient file-level canonical proof
- prompt_router must preserve when applicable:
  - canonical_fetch_required = true
  - canonical_fetch_transport = github_api_mcp
  - canonical_fetch_action_key = github_api_mcp
  - canonical_fetch_authority = repository_ref_pinned

Governed Activation Transport Routing Rule

- prompt_router must prepare activation transport through `http_generic_api` by default and preserve when applicable:
  - activation_transport_default = http_generic_api
  - activation_transport_action_key = http_generic_api
  - activation_transport_sequence_mode = registry_endpoint_first

Resolved HTTP Execution Assembly Rule

Before governed HTTP transport execution, agent runtime must assemble a fully resolved execution request.

agent runtime must resolve when applicable:
- `provider_domain` from endpoint authority, with governed Brand Registry override when applicable
- `parent_action_key` from Actions Registry or workflow context
- `endpoint_key` from API Actions Endpoint Registry or canonical OpenAPI definition
- `method`
- `path`
- authentication headers or auth context
- request body
- `openai_schema_file_id` when schema-bound execution applies
- governed auth strategy normalized from the parent action row
- schema-aligned request fields required by the parent action contract

Before executable HTTP transport payload is emitted, agent runtime must:
- read the authoritative parent capability row in `Actions Registry`
- resolve `openai_schema_file_id`
- align path, query, headers, and body to the authoritative schema contract
- normalize auth into one governed runtime mode:
  - `none`
  - `basic_auth`
  - `bearer_token`
  - `api_key_query`
  - `api_key_header`
  - `oauth_gpt_action`
  - `custom_headers`
- avoid emitting unresolved freeform transport fields when the schema contract defines operation shape

The execution request payload must not require:
- `target_key`
- `brand`
- `brand_domain`

Those values may exist in routing context, but they must not be required as transport payload fields once execution assembly is complete.

Executable HTTP transport payload must be OpenAPI-aligned, parent-action-schema-aligned, and must contain only resolved execution inputs required by the endpoint operation.

Transport layer responsibilities are limited to:
- request validation
- allowlist enforcement
- auth application when policy requires
- outbound execution

Transport layer must not infer:
- brand identity
- brand domain
- target selection
- route selection
- workflow selection
- parent-action auth strategy
- schema-required request structure

HTTP Generic Transport Routing Rule

When user intent requests governed outbound API execution:

- prompt_router may classify intent_key as:
  - governed_http_execute
  - governed_http_read
  - wordpress_governed_http_execution

Routing must resolve an active row through Task Routes.

prompt_router must not emit executable routing for `http_generic_api` unless:
- Task Routes resolves an active compatible route
- Workflow Registry resolves the aligned active workflow
- `runtime_authority_validation_required` remains preserved in the execution preparation contract

For governed HTTP execution:
- `provider_domain` is the primary execution server source
- agent runtime must resolve execution-ready transport inputs before transport execution
- agent runtime must resolve `parent_action_key` and `endpoint_key` through governed endpoint authority
- agent runtime must follow the authoritative parent action row through its `openai_schema_file_id` / YAML binding before execution assembly
- agent runtime must resolve `provider_domain` when it is a variable placeholder
- for `parent_action_key = wordpress_api`, agent runtime must replace `provider_domain` with Brand Registry `brand.base_url`
- for non-WordPress APIs, `provider_domain` must remain the endpoint-row value unless the endpoint definition explicitly declares a variable placeholder requiring agent-runtime-side resolution

For WordPress capability requests:
- prompt_router may resolve `target_module = wordpress_api`
- workflow execution may resolve transport through `wf_wordpress_via_http_generic`
- prompt_router must not collapse WordPress capability requests into arbitrary external API execution when governed WordPress route authority exists

Graph-Aware Routing Rule

When graph-based routing support is enabled, prompt_router must consult governed graph context from:
- Knowledge Graph Node Registry
- Relationship Graph Registry

prompt_router may use graph context to:
- confirm starter-to-route compatibility
- rank multiple governed route candidates
- prioritize goal-aligned route candidates
- preserve graph-derived path context for downstream execution

prompt_router must not:
- invent routes from graph data alone
- bypass Task Routes authority
- bypass Workflow Registry authority

Graph Auto-Routing Preparation Rule

When multiple governed graph-valid paths are available, prompt_router may prepare the highest-confidence governed path using:
- graph validity
- route compatibility
- workflow readiness
- starter priority
- starter success score
- prediction confidence

If graph-based path preparation fails:
- fallback must use the best valid governed static route
- routing must classify as degraded when confidence or graph integrity is insufficient

Graph Prediction Traceability Rule

When graph-based prediction is active, prompt_router must preserve in routing output when available:
- selected_graph_path
- graph_path_confidence
- graph_prediction_basis
- graph_validation_status

Graph prediction remains advisory and must not replace governed routing authority.


Base routing rules:
- prioritize explicit intent
- fallback only through governed Task Routes precedence
- allow audit detection
- preserve recovery-first behavior when exact routing is unavailable

Governed route-target support must include when canonically registered:
- `binding_schema_migration_review`
- `full_system_intelligence_audit`
- anomaly review workflows
- anomaly repair workflows
- governed repair activation paths
- SEO optimization workflows
- product optimization workflows
- funnel or growth optimization workflows
- Google Analytics Admin discovery workflows (accounts and properties listing, property-to-brand binding)
- Google Analytics Data reporting workflows (standard and realtime reporting intents when registered)
- Google Tag Manager management workflows (container, workspace, tag, trigger, variable operations)
- full-funnel diagnostics workflows that combine Search Console, Google Analytics Data API, and Tag Manager
- measurement health, GTM audit, GTM remediation, and attribution or measurement optimization workflows

Analytics, Measurement, And Full-Funnel Intent Routing

prompt_router must classify prompts that imply analytics administration, analytics reporting, Tag Manager operations, or combined measurement diagnostics, then resolve the governed `intent_key` and workflow through Task Routes and Workflow Registry (no hardcoded execution).

Canonical intent_key examples (Registry must define matching active rows; names are illustrative until bound in Task Routes):

- `ga_property_discovery` Ã¢â‚¬â€ user asks to find, list, or connect Google Analytics properties or accounts; route to workflows that use `analyticsadmin_api` (for example list accounts, list properties) and Brand Registry writeback when policy allows
- `analytics_reporting` Ã¢â‚¬â€ traffic, conversions, funnels, ecommerce, or custom reports via Google Analytics Data API
- `realtime_analytics` Ã¢â‚¬â€ realtime or active-user style reports via governed GA Data realtime endpoints when registered
- `gtm_audit` Ã¢â‚¬â€ review containers, tags, triggers, variables, or coverage; route to workflows using expanded `tagmanager_api` list and get operations
- `gtm_remediation` Ã¢â‚¬â€ create, update, or fix tags, triggers, variables, or workspaces; route only when Workflow Registry and execution policy allow mutating GTM operations
- `full_funnel_diagnostics` Ã¢â‚¬â€ combined Search Console plus Google Analytics plus GTM health; execution plan must reference governed multi-connector workflows or chains, not a single API family in isolation
- `attribution_analysis` Ã¢â‚¬â€ attribution, channel grouping, or measurement quality optimization; may combine GA Data reporting with GTM validation when Task Routes declare that pairing
- `full_system_intelligence_audit` Ã¢â‚¬â€ governed, staged, component-aware, repair-aware system audit with row-validation and downstream scoreboard propagation checks

Routing behavior:

- Single-API requests must still satisfy Task Routes and Workflow Registry authority; prompt_router selects the route row, it does not call APIs
- Full-funnel requests must prefer routes whose `target_module` or workflow metadata explicitly includes multi-source measurement when such routes exist; if only partial routes match, set `route_status = degraded` and identify missing connector coverage in `degraded_reason`
- Category-driven routing for expanded GA Admin operations must use the same deterministic Task Routes order (intent_key, brand_scope, priority, match_rule) as other intents
- When Brand Registry tracking bindings are missing for the resolved brand, routing may proceed to discovery or repair workflows if registered; prompt_router must not fabricate `ga_property_id` or `gtm_container_id` in the routing payload

### Full System Intelligence Audit Routing

prompt_router must recognize governed audit intents such as:
- full system intelligence audit
- upgrade audit
- deep system audit
- governed system audit

When this intent is resolved through Task Routes and Workflow Registry, prompt_router must prepare a staged audit handoff that includes when applicable:
- execution_policy_registry_sheet
- review_stage_registry_sheet
- review_component_registry_sheet
- repair_mapping_registry_sheet
- row_audit_rules_sheet
- row_audit_schema_sheet
- business_intelligence_scoreboard_sheet as downstream scoring surface

Required handoff expectations for this governed route include:
- staged audit
- component-aware audit
- repair-aware output
- row-validation-aware output

This route must remain Registry-governed and must not collapse into lightweight scoring-only audit behavior when the governed full-audit route is active.

Binding Integrity Review Routing Rule

When row-level validation, runtime worksheet validation, or schema-alignment audit is required, prompt_router must include `binding_integrity_review` in staged review preparation.

`binding_integrity_review` must verify:
- canonical binding terminology alignment
- Registry surface alignment
- `surface_name` + `worksheet_gid` readiness
- absence of label-only worksheet targeting in active execution paths

When `binding_integrity_review` is required but its governed review-stage readiness cannot be resolved:
- routing must classify as `degraded` or `blocked`
- `executable` must remain `false`

Schema Migration Review Routing Rule

When schema drift, schema version mismatch, or rollback-safe schema repair readiness is relevant to governed execution, prompt_router must include `schema_migration_review` in staged review preparation.

If schema migration review is required but cannot be resolved through `Review Stage Registry` and `Review Component Registry`:
- routing must classify as `degraded` or `blocked`
- `executable` must remain `false`

### Full System Intelligence Audit Recognition Rule

prompt_router must recognize governed audit intents including:
- full system intelligence audit
- upgrade audit
- deep system audit

When resolved:
- must route exclusively to `full_system_intelligence_audit`
- must not fallback to `system_full_audit`
- must enforce extended audit pipeline requirements

If multiple route versions exist:
- only the highest version (`vN`) marked active must be used
- duplicate route keys must be treated as invalid configuration

### Pipeline Integrity Audit Routing Rule

prompt_router must recognize governed continuity-audit intents including:

- pipeline integrity audit
- audit pipelines
- disconnected pipelines
- endpoint family audit
- provider continuity audit
- capability route audit
- route workflow continuity audit

When resolved:
- must prefer `pipeline_integrity_audit`
- must prefer `route.pipeline_integrity_audit.global.v1` when active
- must preserve governed audit execution class
- must not collapse provider-family continuity audit into a generic system advisory response

If multiple continuity-audit route versions exist:
- only the highest active route version may be used
- duplicate active continuity-audit route keys must be treated as invalid configuration

### Provider Family Continuity Routing Rule

When the user asks to validate, inspect, audit, or repair an endpoint family or provider family, prompt_router must prefer provider/capability continuity interpretation when Registry evidence exists for:

- provider node
- action-family node
- capability nodes
- governed route/workflow bindings

This rule applies to endpoint families such as:
- Hostinger
- WordPress
- Search Console
- governed HTTP
- Analytics
- Google Ads
- Tag Manager

If provider-family continuity evidence exists, prompt_router must preserve:

- `review_required = true` when governed audit policy requires it
- capability-level continuity reasoning before endpoint-level fallback
- route/workflow continuity validation before recovered classification

### API Capability vs Endpoint Routing Rule

prompt_router must distinguish between:
- parent action capability requests
- concrete endpoint inventory requests

Requests about:
- available connectors
- action families
- route targets
must prefer Actions Registry.

Requests about:
- specific API operations
- OpenAI schema reference
- authentication details
- callback reference
- privacy reference
must prefer API Actions Endpoint Registry.

If a request requires endpoint-level action-runtime metadata, prompt_router must not rely on Actions Registry alone.

Governed Action Recovery Match Rule

If no confident route match is found:
- scan Actions Registry for matching trigger phrases (including fuzzy/typo match) for candidate discovery
- if capability-level match is found, resolve:
  - exact active Task Routes row
  - exact aligned active Workflow Registry row
- if endpoint-level detail is required or capability-level match is not found, scan API Actions Endpoint Registry for candidate discovery
- if endpoint-level match is found, resolve:
  - exact active Task Routes row
  - exact aligned active Workflow Registry row
  - exact `parent_action_key`
  - exact `endpoint_key`
  - exact `provider_domain`
  - exact `method`
  - exact `path`
- agent runtime must then resolve the authoritative parent action row through Actions Registry and its `openai_schema_file_id` / YAML binding before execution assembly
- if `provider_domain` is a variable placeholder, agent runtime must resolve it before execution
- prompt_router must not emit executable routing from fuzzy discovery alone
- silent non-tool fallback is forbidden when a governed action or endpoint candidate resolves to an active Task Routes + Workflow Registry pair
- only fallback to non-tool response if no governed action or endpoint candidate resolves to an active governed route/workflow pair

Routing Decision Layer Rule (Post-Intent Classification, Pre-Fallback)

IF:
- no confident route match is found

THEN:
1. scan Actions Registry for matching trigger phrases
   - include fuzzy match
   - include typo tolerance
2. IF match found:
   - resolve exact active Task Routes row
   - resolve exact aligned active Workflow Registry row
   - route using the resolved governed route/workflow pair
3. ELSE:
   - scan API Actions Endpoint Registry
4. IF endpoint match found:
   - resolve exact active Task Routes row
   - resolve exact aligned active Workflow Registry row
   - resolve exact `parent_action_key`
   - resolve exact `endpoint_key`
   - resolve exact `provider_domain`
   - resolve exact `method`
   - resolve exact `path`
   - follow the authoritative parent action row through its `openai_schema_file_id` / YAML binding
   - if `provider_domain` is a variable placeholder, agent runtime must resolve it before execution
   - route to endpoint-bound workflow through the resolved governed route/workflow pair
5. ELSE:
   - allow non-tool response

Fuzzy or typo-tolerant action discovery may assist candidate selection, but executable routing remains valid only after exact governed resolution through Task Routes and Workflow Registry.

### Analytics Sheet-Sync Routing Rule

The following intents must route through governed analytics sheet-sync handling:
- analytics_sync_request
- analytics_sync_all_active_brands
- GA4/GSC pull requests
- dashboard-triggered analytics refresh requests

Routing is valid only when the request resolves:
1. target brand or governed eligible multi-brand set
2. date scope:
   - request_date
   - or date_from/date_to
3. trigger_mode:
   - manual
   - scheduled_task
4. request source:
   - dashboard_control_surface
   - user_prompt
5. target output mode:
   - sheet_sync to governed analytics warehouse surfaces

For multi-brand analytics sync:
- eligible brands must be resolved from Brand Registry
- only active brands with required bindings may be included
- non-eligible brands must be excluded, downgraded, or logged as blocked according to active governance

If any required routing identity is missing:
- route_status = blocked or degraded according to policy
- executable = false
- analytics write path must not start

### Domain-Aware Analytics Identity Rule

Analytics routing identity is incomplete unless the request resolves:
1. brand
2. brand_domain
3. source property binding
4. date scope
5. trigger_mode

For analytics sheet-sync and search performance requests, prompt_router MUST treat domain as a required governed identity component, not an optional descriptive field.

Required analytics routing identity:
- brand
- brand_domain
- gsc_property for GSC requests
- ga_property_id for GA4 requests
- request_date or date_from/date_to
- trigger_mode
- request_source

For multi-brand analytics sync:
- each eligible brand must resolve its own brand_domain
- execution eligibility must be computed per brand-domain pair
- brands without a resolved domain must not be treated as execution-ready

If brand is present but brand_domain is missing:
- route_status = degraded or blocked according to active policy
- executable = false for domain-bound analytics execution
- missing domain must be logged as an execution identity defect

If required source property binding is missing for the requested analytics source:
- missing gsc_property for GSC requests -> route_status = degraded or blocked by policy
- missing ga_property_id for GA4 requests -> route_status = degraded or blocked by policy
- executable = false for domain-bound analytics execution
- routing payload must set analytics_identity_failure = true
- routing payload must preserve missing identity components in analytics_identity_issue_context

Domain-aware analytics routes include:
- analytics_sync_request
- analytics_sync_all_active_brands
- searchconsole_reporting
- analytics_reporting
- dashboard-triggered analytics refresh workflows

### Analytics Identity Pre-Validation -> Issue Trigger Rule

During routing, prompt_router must validate analytics identity completeness before execution.

If routing detects:
- missing brand_domain
- missing gsc_property
- missing ga_property_id

prompt_router MUST:

1. prevent executable routing:
   - executable = false
   - route_status = degraded or blocked
2. trigger issue creation signal:
   - pass issue context to system_bootstrap
   - mark request as analytics_identity_failure
3. ensure:
   - routing does not silently skip affected brands
   - missing identity is explicitly surfaced as a governed issue

For multi-brand requests:
- validation must be performed per brand
- only valid brand-domain-property combinations proceed
- invalid ones must trigger issue creation

Issue context passed to system_bootstrap must include when available:
- brand
- brand_domain
- missing_identity_components
- requested_source (GSC or GA4)
- request_date or date_from/date_to
- trigger_mode
- request_source
- execution_cycle_id
