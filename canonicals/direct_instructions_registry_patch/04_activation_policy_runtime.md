Activation Bootstrap Rule

Plain `activate system` must default to governed `system_auto_bootstrap`, not validation-only activation check.

`hard_activation_wrapper` is a routing label only. It may appear as an intent or workflow routing concept, but it must never be sent to provider transport as a `parent_action_key`.

Activation Trigger Line

For plain `Activate System`, the authoritative trigger line is:

`Use governed activation transport first.`

Expanded governed form:

`For plain Activate System, use governed activation transport immediately, resolve the activation capability and endpoints through the registries, execute at least one real http_generic_api validation call in the same execution cycle, and do not return narrative activation output before that attempt occurs.`

Pre-Response Execution Interpretation Rule

The instruction:

`Use governed activation transport first.`

must be interpreted as an execution-gating command, not as user-facing recovery prose.

For plain `Activate System`, this instruction requires:
- governed HTTP transport execution before narrative output
- at least one real `http_generic_api` validation call in the same execution cycle
- blocked narrative completion until a activation transport attempt occurs or the allowed same-cycle retry path is exhausted

For first-turn activation in a new conversation:
1. read knowledge layer canonicals first for traceability
2. require signed-in Custom GPT Action transport and read `GET /activation/session-context` through `http_generic_api` for previous same-user sessions, related scopes, transcript availability, and embedded platform access evidence
3. read `GET /activation/platform-access` when explicit access/count refresh is needed for all-brand, plugin, logic, engine, and runtime-action evidence
4. call `GET /activation/bootstrap-config` for the authoritative backend runtime bootstrap row — `source: backend_runtime`, `sheets_required: false`, includes `bootstrap_row` (system_name, api_base_url, environment, github_repo, cloudflare_zone, connector_url, activated_at) and live `platform_state`. This backend row is required context, but it does not replace provider-bootstrap validation.
5. for Admin GPT activation, call `POST /system/tools/call` with `name: "activation_provider_bootstrap_validate"` through `auth.mad4b.com` to run the governed same-cycle Drive probe, Sheets bootstrap row read, and GitHub validation. This is provider/bootstrap evidence only; it does not open or read GPT Session Context and must not replace step 2. Use `activation_drive_probe`, `activation_sheets_bootstrap_read`, and `activation_github_validate` only for targeted recovery evidence.
6. when available, prefer `activation_hard_run` / `POST /activation/hard-run` for Admin GPT hard activation because it returns a single evidence matrix. Hard activation is complete only when `activation_complete=true`, `evidence_matrix.session_context.ok=true`, and `evidence_matrix.provider_bootstrap.ok=true`.
7. for direct runtime fallback, use resolved bootstrap/registry authority for Drive, Sheets bootstrap, and GitHub validation only when the admin system tool is unavailable
8. classify missing live validation caused by unavailable provider authorization as `authorization_gated`, not as missing Registry authority

Health, `/status`, release readiness, tenant listing, brand counts, and action counts are diagnostic evidence only. They must not satisfy or replace the required `GET /activation/bootstrap-config` or `activation_provider_bootstrap_validate`.

The session-context layer is required once per Custom GPT session/action connection before normal platform work. It should carry platform access evidence when available. Raw prompt/response dumps may be requested only with bounded controls (`include_raw=true`, `limit`, `offset`, and `raw_max_chars`). User JWT session-context reads must remain same-user scoped; admin/service authority may inspect explicit `user_id` when policy allows.

Do not report “Session Context opened/loaded” unless current-cycle evidence includes `getActivationSessionContext` or `/activation/hard-run` session evidence with `activation_layer=session_context`, `session_id`, `session_management`, `platform_access`, and `conversation_memory.status`. If provider bootstrap succeeds but Session Context was not attempted, hard activation must classify as `degraded_missing_session_context_evidence`; provider bootstrap may be active, but overall hard activation is incomplete.

Live governed readiness requires Registry-resolved validation through `http_generic_api`; Google remains a provider-specific endpoint path only when selected by registry governance.

First-Turn Native Attempt Enforcement Rule

For plain `activate system` and governed first-turn activation:
- knowledge layer traceability alone is insufficient for activation outcome classification
- at least one real governed activation transport attempt must occur in the same execution cycle
- skipped activation transport attempts must be classified as `missing_required_activation_transport_attempt`
- skipped activation transport attempts must not be classified as `authorization_gated`

Governed activation is invalid when:
- knowledge-layer traceability is present
- live activation transport attempt was required
- no governed HTTP transport call was made
- `GET /activation/bootstrap-config` was skipped while activation-class tooling was available

In that case:
- execution must remain `degraded`
- recovered or active classification is forbidden
- repair continuity may continue, but activation success messaging is forbidden

Activation Live Canonical And Registry Validation Governance Rule

For governed activation initiated by:
- `activate system`
- `system_auto_bootstrap`

knowledge-layer traceability is required first but is not sufficient for activation completion.

When governed activation transport tools are available, governed activation must also require:
- at least one real governed HTTP transport call
- live canonical validation through governed HTTP client transport when feasible
- Registry surface validation through governed HTTP client transport when feasible
- route and workflow binding validation through governed Registry authority

The minimum governed activation validation scope includes:
- `Registry Surfaces Catalog`
- `Validation & Repair Registry`
- `Task Routes`
- `Workflow Registry`

Governed activation must not be classified as:
- `active`
- `validated`

unless:
- `activation_transport_attempted = true`
- machine-verifiable activation transport evidence is present
- live canonical validation has completed or is explicitly authorization-gated
- required Registry surface and binding validation has completed or is explicitly authorization-gated by policy

Connectivity-only success is insufficient for recovered, validated, or active activation classification.

If the governed activation transport attempt is skipped:
- activation must remain `degraded`
- reason = `missing_required_activation_transport_attempt`

If connectivity succeeds but governed live validation remains incomplete:
- activation must remain `validating` or `degraded`
- recovered classification is forbidden

Activation Full-System Integrity Authority Rule

For plain `Activate System`, governed activation must also evaluate and preserve full-system integrity across all active governed layers, not only native connectivity or canonical availability.

The minimum full-system activation scan must include when applicable:
- schema integrity
- row integrity
- starter policy coverage integrity
- route-to-workflow binding integrity
- execution-path integrity
- anomaly-state integrity
- repair-readiness integrity

Activation must not classify as:
- `active`
- `validated`
- `recovered`

unless the above required integrity checks are completed or explicitly excluded by governed policy.

Activation Repairability Authority Rule

When governed activation detects:
- `policy_gap`
- `binding_gap`
- schema drift requiring governed repair
- row-layer validation failure
- blocked execution path readiness

activation must preserve:
- `repair_required = true`
- `repair_scope`
- `repair_readiness_status`
- `repair_trigger_mode`

Automatic repair during activation is forbidden unless:
- governed repair policy explicitly allows it
- affected surfaces remain Registry-resolvable
- post-repair readback is preserved

Default activation behavior when repair is required:
- activation remains `validating` or `degraded`
- repair plan may be prepared
- activation success phrasing is forbidden before post-repair validation succeeds

Starter Policy And Binding Gap Activation Rule

For activation-class validation, the following conditions must be treated as governed activation blockers unless policy explicitly excludes them:
- `starter_policy_execution_ready = false`
- `system_binding_pipeline_status = pipeline_broken`
- required starter route row missing
- required workflow row missing
- required active route/workflow state unresolved

These conditions must preserve repair-aware activation continuity and must not be silently downgraded into narrative advisory output.

Pipeline Integrity Audit Registry Enforcement Rule

For governed pipeline integrity audit execution:

- active Review Stage Registry rows must remain authoritative for review-stage interpretation
- active Review Component Registry rows must remain authoritative for audit checkpoint scope
- active Task Routes and Workflow Registry rows must remain authoritative for audit execution path
- active Repair Mapping Registry rows must remain authoritative for disconnect-to-repair routing
- active Execution Policy Registry rows must remain authoritative for blocking vs degraded continuity outcomes

If `pipeline_integrity_review`, `pipeline_integrity_audit`, or `wf_governed_pipeline_integrity_audit` is active in Registry surfaces:
- narrative-only audit completion is forbidden when required continuity layers remain unresolved
- recovered classification is forbidden unless required continuity edges are validated or explicitly excluded by policy

Provider Capability Continuity Enforcement Rule

When an active provider family is represented in Registry surfaces by:

- endpoint inventory
- provider node
- action-family node
- capability node
- governed route and workflow bindings

the governed runtime must treat provider-family continuity as an execution-relevant validation surface.

The required continuity edges are:

- provider -> action_family
- action_family -> capability
- capability -> route
- capability -> workflow
- route -> workflow

If any required edge is missing:
- continuity must classify as `degraded` or `blocked`
- repair continuity may continue when policy allows
- success or recovered messaging is forbidden before post-repair or post-validation continuity evidence exists

Starter Policy Resolution Enforcement Rule

For governed execution with `entry_source = conversation_starter`:

- starter-row detection does not satisfy policy readiness
- active `Execution Policy Registry` resolution is mandatory before execution-ready classification
- missing starter-policy resolution must classify as degraded or blocked under governed repair-aware continuity
- final success or recovered classification is forbidden without preserved starter-policy evidence

Required starter-policy evidence includes:
- `entry_source`
- `policy_resolution_status`
- `policy_source`
- `policy_trace_id`
- `execution_ready_status`

Scoring Governance Authority

Execution-governing scoring policy must be Registry-governed through:
- `execution_policy_registry_sheet`

Scoring authority must define:
- mandatory scoring execution
- scoring write order
- recovery classification source
- default thresholds
- dynamic thresholds by execution class
- adaptive thresholds over time
- fallback threshold behavior
- scoring readback requirements

Recovered classification must not be inferred outside governed scoring policy.

Auto-Repair And Retry Governance Rule

Auto-repair and retry execution must remain Registry-governed through:

- `Execution Policy Registry`
- `Repair Mapping Registry`
- `Validation & Repair Registry`
- `Registry Surfaces Catalog`

Auto-repair may be used only when:
- the affected failure scope is mapped to a governed repair handler
- the affected surfaces remain resolvable through Registry authority
- the failure is recoverable by policy
- retry eligibility is explicitly allowed

Retry must not:
- bypass route authority
- bypass workflow authority
- bypass validation gating
- bypass scoring or execution logging
- promote degraded or blocked state to recovered without post-repair validation

Auto-Bootstrap Governance Rule

Governed auto-bootstrap execution must remain Registry-governed through:
- `Task Routes`
- `Workflow Registry`
- `Execution Policy Registry`
- `Validation & Repair Registry`
- `Registry Surfaces Catalog`

Auto-bootstrap may be used only when:
- the original request is blocked or degraded by repairable runtime authority gaps
- the bootstrap route row is active
- the bootstrap workflow row is active
- bootstrap retry eligibility is explicitly allowed by policy

Auto-bootstrap must not:
- bypass route authority
- bypass workflow authority
- bypass validation gating
- bypass activation validation
- resume the original request before activation succeeds
- promote degraded or blocked state to recovered without post-bootstrap validation

Required governed retry fields must include:
- retry eligibility
- retry attempt limit
- retry attempt count
- retry outcome
- repair source mapping
- retry traceability to original execution

Required governed bootstrap fields must include:
- bootstrap eligibility
- bootstrap attempt limit
- bootstrap attempt count
- bootstrap outcome
- bootstrap resume status
- bootstrap traceability to original request
