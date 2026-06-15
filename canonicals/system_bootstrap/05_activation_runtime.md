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

If live canonical fetch is attempted through governed native APIs but cannot complete because provider authorization is not yet available:
- the result must be classified as `authorization_gated` when the condition is recoverable
- traceability must preserve that live fetch was attempted
- missing authorization must not be rewritten as missing Registry authority

Activation Validation Orchestration Rule

When routed execution resolves to:
- `intent_key = system_activation_check`
- `target_workflow = system_activation_validation`

system_bootstrap must orchestrate activation validation in this order:
1. preserve knowledge layer canonical traceability context
2. immediately auto-trigger governed native Google Drive, Google Sheets, and Google Docs connection attempts
3. require live Google Drive validation of canonical file bindings when authorization is available
4. require live Google Sheets validation of Registry-governed authority surfaces when authorization is available
5. compare knowledge-layer traceability against live governed bindings
6. classify activation readiness only after live governed validation completes, or classify the interim state as `authorization_gated` when provider authorization prevents completion

For activation validation:
- knowledge layer canonicals are traceability support only
- Google Drive and Google Sheets validation are readiness authority
- knowledge layer canonical files are used for traceability first.
- Governed HTTP client transport is used for runtime readiness authority.
- `Recovered` or `active` classification is forbidden when live governed validation is possible but skipped
- `Recovered` or `active` classification is forbidden when knowledge-layer trace and live governed validation materially disagree without reconciliation

For first-turn activation:
- activation transport connection attempts are mandatory after knowledge-layer traceability
- missing provider authorization must be classified as `authorization_gated`
- missing provider authorization must not be classified as missing Registry authority unless Registry resolution itself fails

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

Dynamic Hard Activation Evidence Rule

Hard activation must be evidence-driven in the same execution cycle. A hard activation response must not classify as `active` unless the evidence matrix includes all of the following required surfaces:

- `session_context.ok = true`
- `provider_bootstrap.ok = true`
- `repo_canonicals.ok = true`
- `tool_catalog.ok = true`

`repo_canonicals` must be derived from live repository readback, not from cached model knowledge. The runtime must verify the required canonical references, generated canonical root files, canonical source directories, manifest counts, and source-file counts from the repository filesystem or governed repository readback.

`tool_catalog` must be derived from SQL runtime authority and activation authorized surfaces. The runtime must preserve platform access readiness, authorized access readiness, registered surface count, runtime callable action count, degraded surface count, and auth gap count.

Connectivity-only provider success is insufficient for hard activation. If repo canonical evidence or dynamic runtime catalog evidence is missing, hard activation must classify as degraded with a machine-readable reason code and must not report `activation_complete=true`.

Adaptive Operational Dashboard Activation Rule

Activation must also return an operational awareness envelope when the relevant registries are available. This envelope is diagnostic and adaptive: it must be built from SQL runtime registry rows, visible connected systems, provider callback registries, and auth-source fallback routing.

The operational dashboard layer must include:

- registered operational tiles by provider/connector family
- callbacks available for each tile
- source chain ordering for each provider (`platform_native_connection_or_oauth`, `chatgpt_user_account_app`, then `manual_prompt` when allowed)
- visible native connected systems for the current subject
- fallback availability when no platform-native connection exists
- ownership context for platform-owner Brand activation when the admin owns the platform Brand
- freshness SLA and safe-mode metadata for callbacks
- degraded surfaces without leaking credentials or secret values

The runtime must not assume ChatGPT account Apps & integrations are connected unless runtime evidence exists in the current interface/tooling context. When such evidence is unavailable, ChatGPT account apps must be represented as `fallback_possible_user_account_app_check_required`, not as confirmed access.

Background refresh and persistent platform monitoring require platform-native OAuth, service-account, or connector credentials. ChatGPT account app fallback and prompt-guided fallback may support conversation-time awareness, but they must not be treated as platform-owned background sync.

Dynamic Workspace/Brand Tabs Rule

When the current subject can access multiple workspaces, Brands, or workspace-like containers, activation must group operational evidence by container. Each container must expose registry-driven dynamic tabs rather than a single flat response.

A dynamic tab container may represent a workspace, Brand workspace, platform-owner Brand, tenant space, user-private workspace, connector, or agent context. The first implemented tabs include overview, roles/access, connectors, agents, skills, tasks, and operational tiles.

Dynamic tabs must be built from SQL tab/section registries and subject-scoped rows. They must support:

- multiple workspaces per user
- linked Brand control state per workspace
- user roles and permissions per visible tenant/container
- connected systems and installations per visible scope
- agents and skills available to the container
- pending/blocking tasks relevant to the current subject
- operational tiles and callbacks associated with connected platforms
- degraded tab/section evidence without exposing secrets

Adding a new tab, section, connector family, agent surface, or task surface should prefer inserting registry rows over changing activation route code. Activation route code may evolve only to support new generic tab mechanics.

Dynamic Tab Auto-Discovery Rule

Activation must support automatic tab growth from the authorized surface registry. Runtime must read discovery rules from `activation_dynamic_tab_discovery_rule_registry` and map active rows from `activation_authorized_surface_registry` into dynamic tab sections. If no specialized rule matches a surface, runtime must place it under the default discovered-surfaces tab rather than dropping it.

Discovery classification must support internal and external growth surfaces, including workflows, agents, skills, connectors, app integrations, permissions, tasks, audit, execution evidence, knowledge, readiness, quality, lifecycle, ads, CRM, content, and other future platform surfaces. All auto-discovered sections must continue to use safe column allowlisting, subject scoping, and secret-field stripping.

Operational Intelligence Activation Rule

Activation must expose an `operational_intelligence` layer above dynamic tabs. This layer must convert passive evidence into prioritized operational guidance while remaining advisory unless an explicit governed action is confirmed.

The operational intelligence layer must include attention queue, tab badges, section actions, freshness policies and ledger, signal subscriptions and signal inbox summaries, connector packs, fallback negotiation, container relationship graph, and user dashboard preferences.

Attention queue items must be derived from subject-scoped evidence such as connector errors, pending connector setup, blocked/high-priority tasks, degraded/offline agents, skill grants requiring approval, stale/failed freshness rows, and critical signals. Write-capable recommendations must be marked as requiring governed capability and confirmation.

Connector packs must describe provider capabilities, required scopes, webhook/polling support, ChatGPT app fallback support, manual fallback support, and pack components. Fallback negotiation must distinguish native platform connection, ChatGPT account app check, and manual prompt snapshot. Background monitoring requires native platform credentials or governed connector authority.

Container graph evidence must model relationships among workspaces, Brands, connectors, agents, skills, tasks, evidence and actions. All graph, signal, action, freshness, and preference output must be secret-safe and subject-scoped.

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

Activation Awareness Completeness Contract

Hard activation must separate validation, evidence preparation, transport delivery, and consumer acknowledgement. These states must not be collapsed into one success flag:

- `validation_state`
- `evidence_state`
- `delivery_state`
- `consumer_ack_state`

Retryable activation calls must support an idempotency key and a governed session policy. The default policy is `reuse_or_create`; retries with the same tenant, user, and idempotency key inside the configured reuse window must reuse the existing active session/run instead of creating parallel duplicate activation rows. `create_new`, `reuse_only`, and `read_only` remain explicit alternatives.

The default hard-activation response profile is `evidence`. It must preserve complete awareness while limiting row hydration. A valid evidence response must include:

- current activation classification and evidence matrix
- account, workspace, Brand, permission, integration, agent, skill, task, action, and other available authorized counts
- Dynamic Tabs manifests for every visible container
- Operational Dashboard tile manifests
- attention-first summaries and freshness state
- `completeness` with known, visible, summarized, hydrated, deferred, blocked, stale, and degraded surface counts
- `awareness_index`
- snapshot id, registry version, and data watermark
- governed detail references with cursor support for every deferred surface
- `details_omitted_silently=false`
- `secrets_included=false`

Deferred hydration must not be classified as missing access, empty scope, or removed functionality. Dynamic Tabs and Dashboard must remain available in all response profiles. `diagnostic` and `full` may hydrate complete operational rows only when explicitly requested or required by governed diagnostics.

The response budget must be applied in semantic layers: attention rows, freshness detail, section metadata, then selected detail. If a response still exceeds the hard budget, the runtime must return governed chunk-continuation metadata; arbitrary string truncation is forbidden.

Snapshot preparation must be persisted before delivery. Successful transport updates the snapshot to delivered. Consumer acknowledgement is a separate explicit transition. A response must not claim acknowledged merely because HTTP delivery completed.

Tenant detail reads must derive tenant and user scope from signed JWT membership, enforce object-level scope, and ignore client-supplied identity overrides. Admin detail reads may span authorized workspaces and Brands, but must preserve explicit subject scope and secret-field stripping.

Tenant Growth Dashboard Activation Rule

When Session Context is requested by a non-admin Tenant GPT principal with a valid signed user JWT, activation must attach a bounded customer-facing growth product overlay when its runtime dependencies are available. The overlay must resolve, in order:

1. active tenant, workspace, and linked Brand container
2. `business_activity_type_registry` compatibility and business type
3. Brand Core readiness when the resolved activity or requested output requires it
4. growth stage, primary goal, and available connected-data coverage
5. relevant customer-facing Dynamic Tabs, starting with `tenant_today`
6. typed cards with freshness, provenance, confidence, and partial-data state
7. no more than three next-best actions with impact, effort, confidence, readiness, and confirmation state
8. customer-safe assistant instructions, quick commands, and governed drill-down references

The default activation response must include navigation and guidance, not complete operational row hydration. The product overlay must remain within the activation response budget; larger card lists, historical rows, connector records, and section data must resolve through `/tenant/dashboard`, tab reads, or cursor-based Dynamic Tab detail surfaces. Missing data must be represented as unavailable, stale, partial, or not connected and must never be converted to a numeric zero unless zero is an observed value.

Tenant product guidance is advisory by default. Read-only, advisory, and draft-only actions may return previews. Provider calls, publishing, budget changes, external sends, destructive changes, and other consequential writes remain blocked until route/workflow authority, capability readiness, credential resolution, Brand Core where required, object-level tenant scope, approval policy, and explicit confirmation all validate in the same execution cycle.

The product activation overlay must preserve lifecycle separation. Building guidance may advance `evidence_state`; serializing the bounded response may advance `delivery_state=prepared`; successful transport may advance `delivery_state=delivered`; neither state implies `consumer_ack_state=acknowledged`. A degraded product overlay must not invalidate otherwise valid Session Context evidence, but its degraded surfaces and missing dependencies must remain explicit.
