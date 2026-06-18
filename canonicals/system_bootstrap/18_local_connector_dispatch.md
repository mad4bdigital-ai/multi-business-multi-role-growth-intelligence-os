# Local Connector Dispatch Layer

## Purpose

The local connector dispatch layer is a governed execution surface that routes
intent-keyed requests to device-side connector operations through the platform's
unified dispatcher. It is not a direct transport bypass — it is a registry-governed
execution path subject to the same validation, audit, and skill grant requirements
as all other governed execution surfaces.

## Dispatch Execution Rule

When execution resolves to `POST /dispatch`:

- `intent_key` must be resolved from `task_routes` before execution proceeds
- resolved `target_module` must be present in the registered `MODULE_EXECUTORS` map
  or the dispatcher must return routing advice with `suggested_endpoint`
- `agent_id` bearing requests must pass `agent_skill_grants` validation before execution
- `device_id` is required for all `local.*` intent_keys
- execution must not proceed if the required route is inactive (`active = '1'` required)

Recovered classification is forbidden when:
- `intent_key` resolves to no active route
- `agent_id` is present but the required skill grant is missing or not `status = 'active'`
- `device_id` is absent for a `local.*` intent

## Intent-to-Route Authority

`task_routes` is the routing authority surface for all dispatch calls.

Required fields per route row:
- `intent_key` — unique, stable, dot-separated identifier
- `workflow_key` — links to `workflows` registry row
- `target_module` — must match a registered MODULE_EXECUTORS key or a known endpoint pattern
- `active = '1'` and `enabled = 'true'`
- `execution_layer` — declares the caller surface (e.g. `custom_gpt`)

`intent_key` must not be changed once in use by live GPT sessions — changing it silently
breaks active dispatch calls. Deprecate by setting `active = '0'`; add a new row for renamed keys.

## Agent Skill Grant Validation Rule

When `agent_id` is present in a dispatch call:

- platform must query `agent_skill_grants JOIN agent_skills WHERE agent_id = ? AND skill_key = ? AND status = 'active'`
- if no matching active grant exists, the dispatch must return `403 skill_not_granted`
- if `agent_id` is absent (API-key-only caller), skill validation is bypassed

Skill grants must not be validated by trust assumption — they must be resolved live from
`agent_skill_grants` on every dispatch call. Cached grant state is not permitted.

Module-to-skill mapping:
- `local_connector_shell` → `local.connector.shell_execute`
- `local_connector_file` → `local.connector.file_access`
- `local_connector_health` → `local.connector.device_management`

## Local Connector Config Resolution Rule

When a dispatched module requires device communication:

- connector config must be resolved from `local_connector_user_configs` by `(user_id, tenant_id, device_id)`
- `connector_secret` from the config row is the device auth token
- fallback to `CONNECTOR_LOCAL_API_KEY` env var is permitted when `connector_secret` is null
- `tunnel_url` from the config row is the device endpoint
- execution must classify as `config_not_found` and return `ok: false` when no config row exists

`local_connector_user_configs` is the device authority surface. Platform must not
construct tunnel URLs or secrets from caller-supplied values.

## Auto-Provisioning Governance Rule

Device provisioning via `POST /local-connector/install` is a governed workflow:

1. Cloudflare tunnel is provisioned via CF API per `device_id` — tunnel named `{device_id}-connector`
2. DNS CNAME is added to Hostinger for `{device_id}.connector.mad4b.com` pointing to tunnel
3. `local_connector_user_configs` is seeded with tunnel URL, `connector_secret`, and CF tunnel metadata
4. `local_connector_shell_allowlists` is seeded with default and custom aliases (idempotent)
5. `install.bat` is returned for device-side cloudflared service installation

Provisioning is idempotent — re-calling without `reprovision=true` returns the existing bundle.
`reprovision=true` rotates the tunnel and `connector_secret`.

After provisioning, `CONNECTOR_LOCAL_API_KEY` on Cloud Run must be updated to the new
`connector_secret` if Cloud Run proxies requests through the platform-side orchestrator.

## Local Manager Capability Installer Invariants

Local Manager-owned connector repair and capability flows must request short-lived signed installers through `POST /local-connector/install/device-download-link` using the DPAPI-protected device token. App-owned flows must set `app_managed=true` and `suppress_pause=true`, launch the signed BAT through Windows UAC, handle cancellation, wait for completion when possible, and then verify the live connector.

The BAT wrapper is not the final authority for capability application. It downloads and runs `/connector-agent/installer.ps1`, which writes the effective local connector `.env`. Both paths must preserve the signed capability and permission-grant payload. The PowerShell installer must render opt-in capability flags and dynamic grants into:

- `CONNECTOR_POWERSHELL_ENABLED`
- `CONNECTOR_WIN_ENABLED`
- `CONNECTOR_FILE_PATHS`
- `CONNECTOR_APP_ALLOWLIST`
- `CONNECTOR_SHELL_ALLOWLIST`

`section=settings` control refresh is not proof of activation. A capability installer is validated only when live connector checks confirm the requested surfaces: PowerShell returns a version, Windows control returns process data, file grants appear in `allowed_paths`, and dynamic app grants appear in `connector_apps list`.

High-risk capabilities remain explicit local-consent surfaces. They must not be present in the base connector environment and must remain UAC-gated, signed-token-gated, and secret-safe.

## Shell and File Execution Invariants

For governed shell execution via local connector:

- `alias` must exist in `local_connector_shell_allowlists` for the resolved `config_id`
- `extra_args` are permitted only when `allow_extra_args = 1` on the allowlist entry
- shell metacharacter rejection applies to all `extra_args`
- file access is restricted to paths declared in `local_connector_file_access_rules`
- all execution must use `Authorization: Bearer {connector_secret}` — not prompt-supplied tokens

## MODULE_EXECUTORS Registration Rule

Only modules registered in `MODULE_EXECUTORS` are directly dispatched by `/dispatch`.
Unregistered modules receive routing advice via `suggested_endpoint` and `routed: false`.

Current directly-dispatched modules:
- `local_connector_shell` → executes governed shell alias on device
- `local_connector_health` → health check via tunnel URL
- `local_connector_file` → read or write governed file on device

New modules must be explicitly registered in `MODULE_EXECUTORS` before they can be
directly dispatched. Registering a module without backend validation logic is forbidden.

## DNS Management Governance Rule

`GET|POST|DELETE /admin/cli/dns` routes manage Hostinger DNS records for `mad4b.com`.

- DNS mutations must be audit-logged with action, name, type, and domain
- `api_key_ref` selects between `HOSTINGER_CLOUD_PLAN_01_API_KEY` and `HOSTINGER_SHARED_MANAGER_01_API_KEY`
- `DELETE` on DNS records is a destructive operation — requires explicit intent
- all DNS operations require admin principal auth (`is_admin = true`)
## Cloudflare 1033 Retry-Before-Repair Rule

Cloudflare error `1033` and HTTP `530` are transient-retry candidates, not immediate proof that the local connector requires reinstall or tunnel reprovisioning.

- perform three total public health attempts: the initial attempt plus two retries
- use short exponential backoff bounded by the runtime policy
- stop immediately when health passes or when the endpoint is reachable but authorization-gated
- call or continue `local_connector_self_repair` only after retryable evidence is exhausted
- the self-repair route must repeat the bounded attempts internally before generating installer assets
- return and audit no-secret `retry_evidence` with attempt count, statuses, delays, recovery-on-retry, and exhaustion state
- recovered classification requires same-cycle passing health evidence; installer generation is forbidden when a retry succeeds

The SQL runtime authority is `execution_policies` row `Local Connector Recovery Governance / Cloudflare 1033 Retry Before Repair`, registered by `318_sprint69_local_connector_transient_retry_policy.sql`.
