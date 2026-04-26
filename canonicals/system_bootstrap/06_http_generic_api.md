
If the governed pipeline integrity audit completes with only non-blocking continuity defects:
- system_bootstrap may classify as `degraded`
- prompt-first repair continuation remains preferred
- target binding revalidation when target surfaces are involved
- native action readiness revalidation when Google Workspace actions are involved
- schema compatibility revalidation when schema-bound API execution applies

system_bootstrap must not treat prior activation success as sufficient proof for later request execution.

Post-Activation Drift Detection Rule

After activation, system_bootstrap must detect and preserve drift across:
- Registry bindings
- worksheet_gid bindings
- schema metadata
- validation-state rows
- route/workflow compatibility
- canonical file bindings
- execution policy compatibility
- graph-path compatibility when graph-aware execution is active

If drift is detected:
- execution must classify as degraded or blocked according to policy
- repair-aware handling must remain available
- active classification must not be preserved silently

Post-Activation Optimization Gate Rule

Optimization, improvement, or enhancement execution after activation must not proceed from activation status alone.

Before any optimization or improvement workflow executes, system_bootstrap must confirm:
- live authority remains valid
- the relevant route is still active
- the relevant workflow is still active
- required dependencies remain executable
- required write targets remain valid
- readback requirements remain satisfiable
- no unresolved repair-critical findings override the optimization request

If these checks fail:
- optimization must degrade or block
- repair-aware routing must remain available

Post-Activation Trust Decay Rule

Active state must be treated as time-sensitive operational confidence, not permanent truth.

When post-activation live validation has not been refreshed for the current request or current execution cycle:
- operational trust must decay
- fresh runtime validation must be required before governed execution continues
- stale activation success must not be reused as direct execution authority

Post-Activation General-Execution Alignment Rule

After activation, system_bootstrap must ensure that requests to improve, optimize, execute, automate, repair, enhance, or extend the system remain aligned with the current live architecture.

For such requests, system_bootstrap must verify in the current execution cycle:
- live route/workflow alignment
- current dependency readiness
- target-surface validity
- validation-state compatibility
- schema compatibility when applicable
- repair-state compatibility when unresolved findings exist
- architecture reconciliation completeness when structural changes were recently applied

If any of these are unresolved:
- execution must remain degraded or blocked according to policy
- repair-aware continuation must remain available
- the system must not claim architectural alignment from activation alone

Runtime Authority Validation Applies To

Mandatory runtime authority validation applies to:
- starter execution
- direct governed execution
- repair execution
- retry execution
- graph-based auto-routing execution
- governed addition execution
- governed Google Workspace execution when system resources are affected

HTTP Generic API Execution Classification Rule

When `target_module` or routed workflow resolves to `http_generic_api`:

- execution must be treated as governed external API execution
- runtime authority validation must include:
  - `provider_domain` resolution readiness
  - `parent_action_key` validation readiness
  - `endpoint_key` validation readiness
  - endpoint validation readiness
  - schema contract validation readiness
  - credential resolution readiness
  - method/path governance readiness
  - governed auth mode normalization readiness
  - parent-action request schema alignment readiness
  - transport request contract readiness

Execution must not proceed if:
- `provider_domain` validation fails
- `parent_action_key` validation fails
- `endpoint_key` validation fails
- endpoint validation fails
- schema contract validation fails
- credential resolution fails
- method/path allowlist validation fails

Execution result must preserve:
- `external_execution_status`
- `provider_domain`
- `parent_action_key`
- `endpoint_key`
- `endpoint_path`
- validation state
- transport module identity
- `schema_contract_validation_status` when applicable
- `resolved_auth_mode` when applicable
- `credential_resolution_status` when applicable
- `request_schema_alignment_status` when applicable
- `transport_request_contract_status` when applicable

Recovered classification is forbidden unless:
- external execution succeeds
- runtime validation passes
- response integrity is confirmed

HTTP Async Execution Governance Rule

When governed execution resolves to the validated HTTP client async surface:

- `/jobs`
- `/jobs/{jobId}`
- `/jobs/{jobId}/result`

system_bootstrap must treat async HTTP execution as a governed execution lifecycle, not as a detached transport convenience.

system_bootstrap must require before async execution proceeds:
- runtime authority validation for `parent_action_key`
- runtime authority validation for `endpoint_key`
- request schema alignment for the normalized execution payload
- async job policy compatibility
- idempotency handling readiness when idempotency key is present
- persisted job-state readiness when async execution is enabled by policy
- webhook governance readiness when `webhook_url` is present

system_bootstrap must preserve when applicable:
- `job_id`
- `job_type`
- `job_status`
- `attempt_count`
- `max_attempts`
- `next_retry_at`
- `idempotency_key`
- `webhook_status`
