Universal Parent Action And Schema Alignment Rule

For any governed request that resolves through `parent_action_key`, the system must treat the parent capability row in `Actions Registry` as the authority for:
- auth strategy classification
- `openai_schema_file_id`
- credential location semantics
- capability-level execution ownership

agent runtime must:
- resolve `parent_action_key`
- read `openai_schema_file_id`
- align path, query, headers, and body to the authoritative parent schema contract before execution
- normalize auth into one governed runtime mode:
  - `none`
  - `basic_auth`
  - `bearer_token`
  - `api_key_query`
  - `api_key_header`
  - `oauth_gpt_action`
  - `custom_headers`

The transport layer must:
- apply the resolved auth strategy
- execute the outbound request
- avoid inventing auth strategy or schema-required request shape

Caller-supplied raw auth strings, curl-only flags, or unnormalized freeform transport input must not be treated as governed readiness by themselves.

Parent Action Schema Authority Rule

When `openai_schema_file_id` is present on the resolved action row:
- agent runtime must treat that file as authoritative schema contract metadata for request assembly
- endpoint method/path from API Actions Endpoint Registry must remain compatible with the parent schema contract
- request execution must block or degrade when schema alignment is unresolved
- transport execution must not silently drop required auth fields, query fields, or body fields that are required by the authoritative schema contract

Auth-Path Routing Authority Rule

For governed capability execution:
- auth normalization is execution-path authority, not only credential authority
- `oauth_gpt_action` may require native-only execution when governed policy so specifies
- delegated HTTP execution must not override native-only auth-path requirements
- `basic_auth`, `bearer_token`, `api_key_query`, and `api_key_header` may support delegated HTTP execution only when transport governance is valid

HTTP Schema-First Execution Authority Rule

The following instruction is mandatory:

- no HTTP or OpenAPI request may be constructed before `openai_schema_file_id` is resolved and read
- no request may omit required schema parameters when schema is available
- partial request execution is forbidden
- guessing or inferring missing required parameters is forbidden

### HTTP Client Action And Endpoint Variable Contract Rule

Actions Registry and API Actions Endpoint Registry must preserve governed variable-contract linkage for executable HTTP parameters.

Required governed linkage fields must include or govern equivalents that resolve:
- `required_variable_contracts`
- `runtime_binding_profile`

Validation must enforce:
- action-bound required variables resolve through active variable-contract rows
- endpoint-bound required variables resolve through active variable-contract rows
- delegated HTTP routing fields (`target_key`, `brand`, `brand_domain`, `provider_domain`, `method`, `path`, `query`, `headers`, `body`) must not bypass governed variable authority
- wrapper-field promotion must not break canonical top-level routing integrity
- native runtime actions must preserve valid runtime binding profiles when required by policy

Rows missing required variable-contract linkage must not classify as execution-ready.

HTTP Execution Classification Repair Rule

The repaired execution classification rule is active:

- governed HTTP execution must preserve `runtime_capability_class`, `runtime_callable`, and `primary_executor` from `Actions Registry`
- governed HTTP execution must preserve `endpoint_role`, `execution_mode`, `transport_required`, and `transport_action_key` from `API Actions Endpoint Registry`
- `native_direct` endpoints must not execute through delegated HTTP transport
- `http_delegated` endpoints must not execute unless `primary_executor = http_client_backend`
- inventory-only or non-primary endpoint rows must not be treated as direct execution-ready
- delegated transport must not proceed when required `transport_action_key` is unresolved or unsupported

### HTTP Client Variable Contract Authority Rule

No governed HTTP execution path may rely on implicit variables when variable-contract authority is required.

The system must treat `Variable Contract Registry` as the authoritative source for:
- required variable declaration
- variable type declaration
- variable source legitimacy
- fallback behavior
- runtime binding profile
- contract grouping

Direct HTTP execution is forbidden when:
- a required variable has no active contract row
- a required action or endpoint parameter is passed without governed contract coverage
- a runtime-bound variable lacks a valid runtime binding profile
- a non-guaranteed variable requires fallback behavior but none is declared
- canonical HTTP routing fields are supplied in a way that bypasses governed contract authority

The system must not:
- invent undeclared required variables
- silently pass undeclared execution parameters to actions or endpoints
- downgrade missing variable-contract authority into normal HTTP execution readiness

HTTP Connector-Scoped Resilience Authority Rule

The following instruction is mandatory:

- retry behavior must be restricted to connectors listed in `Affected Parent Action Keys`
- non-listed connectors must not inherit retry or escalation logic
- `premium` and `ultra_premium` mutation behavior must only apply to eligible connectors

HTTP Retry Escalation Authority Rule

For eligible connectors only:

- first attempt must use baseline request
- retry stage 1 may add `premium=true`
- retry stage 2 may add `premium=true, ultra_premium=true`
- escalation must occur only when retry trigger conditions are satisfied

Execution Logging Surface Authority Rule

The authoritative raw execution logging surface for governed runtime execution is:

- `surface.operations_log_unified_sheet`

When active and Registry-bound, this surface must map to:
- `Execution Log Unified`

No other workbook_sheet may act as the primary runtime raw execution sink.

Legacy And Non-Authoritative Logging Surface Rule

The following surfaces must not be treated as active raw execution logging authority:

- `surface.execution_log`
- `surface.execution_log_import`
- `surface.review_execution_view`
- `surface.review_run_history_sheet`

These surfaces may remain present only as:
- legacy archive
- external intake
- derived scoped view
- review-facing projection

They must not receive direct raw runtime execution writes.

Scoped Review And Intelligence Surface Rule

The following surfaces remain valid scoped interpreted-output surfaces and are not raw execution logging sinks:

- `surface.review_findings_log`
- `surface.review_anomaly_detection`
- `surface.repair_control_sheet`
- `surface.review_stage_reports` when retained

These surfaces may receive:
- findings
- anomaly records
- repair records
- stage-report records

They must not duplicate raw execution authority.

Scoped Event Surface Separation Rule

The following runtime-scoped event surfaces are valid operational event logs and do not replace the authoritative raw execution log:

- `surface.system_enforcement_events_sheet`
- `surface.query_engine_events_sheet`

Authority requirements:

- `surface.operations_log_unified_sheet` remains the only authoritative raw execution logging sink
- `surface.system_enforcement_events_sheet` may receive scoped enforcement-event writeback only
- `surface.query_engine_events_sheet` may receive scoped query-intake or decision-event writeback only
- neither scoped event surface may be treated as the primary runtime raw execution sink
- neither scoped event surface may be used to satisfy canonical raw execution logging requirements in place of `surface.operations_log_unified_sheet`

Surface role requirements:

- `System Enforcement` is a governance/state surface and must not act as a runtime event ledger
- `Business Intelligence Query Engine` is a routing/reference surface and must not act as a runtime event ledger
- runtime event writeback formerly directed to those surfaces must be redirected to the corresponding scoped event sheets in `Activity Log`

Allowed write scope:

- `surface.system_enforcement_events_sheet`
  - enforcement checks
  - enforcement event outcomes
  - scoped governance-event traces
- `surface.query_engine_events_sheet`
  - query intake events
  - decision payload events
  - routing-pre-enrichment event traces

Forbidden behavior:

- writing raw execution truth to `System Enforcement`
- writing runtime event rows to `Business Intelligence Query Engine`
- treating scoped event surfaces as substitutes for `Execution Log Unified`

Raw Execution Single-Write Rule

For governed execution:

- raw execution must be written once
- the write target must be `surface.operations_log_unified_sheet`
- duplicate raw execution writes to review, import, or derived-view surfaces are forbidden

Pre-Response Logging Completion Rule

When a governed execution reaches:
- success
- failed
- blocked
- retry

the authoritative raw execution log write must complete before final user-facing completion, unless execution is explicitly degraded due to logging-sink unavailability.

Workflow-Level Logging Retry Authority Rule

Governed execution logging must support one bounded same-cycle retry before any final completion is allowed.

Authority requirements:

- retry applies only to the authoritative raw execution logging sink
- retry must preserve the original execution identity
- retry must not redirect raw execution truth to legacy, intake-only, or interpreted-output surfaces
- retry exhaustion must not be masked as success

If authoritative log write fails after the allowed retry:

- classification must remain `logging_incomplete`, `Degraded`, or `Blocked`
- final success phrasing is forbidden
- recovery routing may proceed only after failed same-cycle retry is recorded

Required authoritative completion rule:

No governed execution may be presented as finished unless:

- downstream write requirements are satisfied when applicable
- authoritative log write has succeeded
- same-cycle verification of the authoritative log handoff has completed

Derived View Non-Authority Rule

The following surface types must not be upgraded into raw runtime write authority by behavior alone:

- derived scoped views
- dashboards
- review-facing history views
- import sheets

Direct writes to such surfaces do not create authority.

Anomaly And Repair Surface Separation Rule

Anomaly and repair surfaces must remain semantically separate from the raw execution log.

This means:
- anomaly clustering writes belong to `Anomaly Detection`
- repair execution and repair coordination writes belong to `Repair Control`
- raw execution rows remain only in `Execution Log Unified`

Recovered classification is forbidden if raw execution truth and anomaly/repair truth are mixed into the same non-authoritative surface.

Anomaly Clustering Authority Rule

A governed `anomaly_surface` may carry anomaly-cluster intelligence fields including:
- `cluster_id`
- `cluster_pattern`
- `cluster_confidence`
- `cluster_frequency_band`
- `cluster_last_seen_at`
- `cluster_repair_recommended`
- `cluster_notes`

These fields are valid interpreted anomaly intelligence and do not convert the anomaly surface into raw execution authority.

Cluster-derived anomaly intelligence may be consumed by governed repair orchestration only through:
- `Anomaly Detection`
- governed repair handoff
- governed repair priority propagation

Cluster metadata must not be written into the authoritative raw execution logging sink in place of raw execution truth.

Cluster-Informed Repair Priority Authority Rule

When `Repair Control` or another governed `repair_surface` consumes anomaly-cluster signals, the following are permitted governed priority inputs:
- anomaly severity
- cluster frequency band
- cluster confidence
- cluster repair recommendation
- cluster recency signal

Cluster-informed priority may increase repair urgency, dispatch recommendation, or auto-execution readiness, but must remain subordinate to:
- surface authority rules
- validation compatibility
- repair readback requirements

Priority uplift from cluster signals must remain traceable and must not silently replace anomaly severity.

Cross-Workbook Formula Stability Rule

When a governed surface reads another workbook through formulas, permission alone does not satisfy governed readiness.

The governed formula pattern must prefer:
- one local staged import
- downstream local filtering or projection

Repeated direct IMPORTRANGE chains inside live FILTER, QUERY, or ARRAYFORMULA logic should be classified as formula instability risk and may require:
- `importrange_rebind`
- `formula_repair`
- `projection_repair`

---
This document defines the authority model, structural rules, validation rules, repair-aware registry governance, and runtime contract for the system registry layer.


It does not store live IDs, file bindings, worksheet bindings, folder bindings, or version records.


All live dependency records must be stored in the authoritative Registry Google Sheet.


---


Authority


This document governs:
- registry structure rules
- dependency classification rules
- dependency validation rules
- dependency resolution rules
- registry authority semantics
- fallback authority rules
- candidate promotion and rollback rules
- loader-to-registry contract
- registry operating constraints
- repair-aware registry validation
- binding validation rules
- repair signal emission
- growth feedback authority
- growth-loop trigger authority
- adaptive optimization authority


This document does not govern:
- live `file_id` cell values as data (Drive IDs for non-migrated dependencies; HTTPS URLs for URL-migrated canonical dependencies per Canonical URL Authority rules)
- live folder IDs
- live spreadsheet IDs
- live worksheet gids
- per-row runtime values
- operational execution logs
- repair execution lifecycle
- route selection


---
