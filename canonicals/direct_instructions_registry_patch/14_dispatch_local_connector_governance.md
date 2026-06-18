# Dispatch and Local Connector Governance — Direct Instruction Patch

## Dispatch Route Mutation Enforcement

`task_routes` is the routing authority for all `/dispatch` calls. Mutations to this table are governed.

- `intent_key` must not be renamed once in use by live GPT sessions. Rename = silent break for all callers using that key.
- Deprecate by setting `active = '0'` and inserting a new row with the replacement `intent_key`.
- `target_module` must match a registered `MODULE_EXECUTORS` key or be a known `suggested_endpoint` pattern — not a free-form string.
- `execution_layer` must be set to the caller surface (`custom_gpt`, `agent`, `api`) — not left null.
- `active = '1'` and `enabled = 'true'` are both required before a route can be dispatched. Inserting a route without setting both is forbidden.

## MODULE_EXECUTORS Registration Enforcement

Only modules in `MODULE_EXECUTORS` are directly dispatched. Adding a new module requires:

1. Backend validation logic must be written and reviewed before registration.
2. The module must be registered in `MODULE_EXECUTORS` in `dispatchRoutes.js`.
3. A corresponding `task_routes` row with a stable `intent_key` must be inserted.

Registering a module without validation logic, or inserting a `task_routes` row for an unregistered module, is forbidden.

Current registered modules:
- `local_connector_shell` → `local.connector.shell_execute` skill required
- `local_connector_health` → `local.connector.device_management` skill required
- `local_connector_file` → `local.connector.file_access` skill required

## Agent Skills and Grants Mutation Enforcement

`agent_skills`, `agent_skill_grants`, and `agent_workflow_bindings` are governance surfaces. Mutations require:

- `agent_skills`: `skill_key` must be globally unique and stable. Do not repurpose a `skill_key` for a different capability once granted.
- `agent_skill_grants`: `status = 'active'` is required for the grant to be operative. Inserting without `status = 'active'` creates a dormant grant, not an active one.
- Grants must not be validated by trust assumption. The `/dispatch` handler must query live on every call — cached grant state is not permitted.
- `agent_workflow_bindings`: links an `agent_id` to a `workflow_key`. Binding an agent to a workflow without a corresponding skill grant for that workflow's module is permitted but will fail at dispatch time — pre-validate before inserting.

## Agent Supervision Policy Enforcement

`agent_supervision_policy` rows declare escalation and verification rules per agent.

- `policy_type = 'escalate'`: dispatch must pause and surface the decision to a human when the declared condition is met.
- `policy_type = 'verify'`: a verify pass must run after primary execution and the result must be written to `step_runs` with `step_key = 'verify_pass'`.
- `active = 1` is required for a policy to be operative. Inserting without `active = 1` creates a dormant policy.
- Supervision policy must not be bypassed by dispatch callers. Routes that skip the policy check are non-compliant.

## Local Connector Config Authority

`local_connector_user_configs` is the device authority surface.

- `tunnel_url` must come from the DB row, not from the caller request.
- `connector_secret` must come from the DB row. Fallback to `CONNECTOR_LOCAL_API_KEY` env var is permitted only when `connector_secret` is null.
- Constructing tunnel URLs or secrets from caller-supplied values is forbidden.
- If no config row exists for `(user_id, tenant_id, device_id)`, dispatch must return `config_not_found` and `ok: false` — not attempt connection with fallback credentials.

## Shell Allowlist and File Access Rule Enforcement

- Shell execution via `local_connector_shell` must resolve `alias` from `local_connector_shell_allowlists` for the resolved `config_id`. Executing an alias not present in the allowlist is forbidden.
- `extra_args` may only be passed when `allow_extra_args = 1` on the allowlist entry. Shell metacharacters in `extra_args` must be rejected before execution.
- File access via `local_connector_file` must be restricted to paths declared in `local_connector_file_access_rules`. Access to paths not in the ruleset is forbidden regardless of caller auth level.

## DNS Mutation Enforcement

`GET|POST|DELETE /admin/cli/dns` mutations are destructive operations subject to audit.

- All DNS mutations (POST = upsert, DELETE = remove) must be audit-logged with `action`, `name`, `type`, and `domain` before the Hostinger API call.
- `DELETE` on DNS records must require explicit `name` and `type` — no wildcard deletes.
- All DNS operations require admin principal auth (`is_admin = true`). API-key-only callers without admin status must receive `403`.
- `api_key_ref` must select from the two declared Hostinger API key env vars only — `HOSTINGER_CLOUD_PLAN_01_API_KEY` or `HOSTINGER_SHARED_MANAGER_01_API_KEY`. Accepting arbitrary `api_key_ref` values is forbidden.

## Provisioning Idempotency Rule

`POST /local-connector/install` is idempotent.

- Without `reprovision=true`: return the existing bundle if a config row exists for the `device_id`. Do not re-provision.
- With `reprovision=true`: rotate the Cloudflare tunnel and `connector_secret`, update the DB row, and return a new bundle.
- After reprovisioning, `CONNECTOR_LOCAL_API_KEY` on Cloud Run must be updated to the new `connector_secret` if Cloud Run proxies requests through the platform-side orchestrator.
- Shell allowlist seeding during install must be idempotent — re-running install must not create duplicate allowlist entries.
## Cloudflare 1033 Retry-Before-Repair Rule

Cloudflare error `1033` and HTTP `530` are transient-retry candidates, not immediate proof that the local connector requires reinstall or tunnel reprovisioning.

- perform three total public health attempts: the initial attempt plus two retries
- use short exponential backoff bounded by the runtime policy
- stop immediately when health passes or when the endpoint is reachable but authorization-gated
- call or continue `local_connector_self_repair` only after retryable evidence is exhausted
- the self-repair route must repeat the bounded attempts internally before generating installer assets
- return and audit no-secret `retry_evidence` with attempt count, statuses, delays, recovery-on-retry, and exhaustion state
- recovered classification requires same-cycle passing health evidence; installer generation is forbidden when a retry succeeds

The SQL runtime authority is `execution_policies` row `Local Connector Recovery Governance / Cloudflare 1033 Retry Before Repair`, registered by `1015_sprint69_local_connector_transient_retry_policy.sql`.
