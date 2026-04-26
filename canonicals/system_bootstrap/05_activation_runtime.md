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
