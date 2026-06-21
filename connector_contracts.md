# Connector Contracts
**Authority document — updated when public connector APIs change**

This document defines the explicit public API surface for each provider connector module in `http-generic-api/`. Internal helpers are not exported unless required by callers outside the module.

---

## github.js

### Public exports

#### `githubGitBlobChunkRead({ input })`
- **Purpose:** Read a GitHub blob by SHA, with chunked range support.
- **Caller:** `jobRunner.js` — `dispatchEndpointKeyExecution` (endpoint key: `github_git_blob_chunk_read`)
- **Input:** `input.owner`, `input.repo`, `input.file_sha`, `input.byte_offset`, `input.length`
- **Returns:** `{ ok, chunk, byte_offset, length, total_size, sha }` or error object
- **Auth:** `GITHUB_TOKEN` environment variable

#### `fetchGitHubBlobPayload({ owner, repo, fileSha })`
- **Purpose:** Low-level fetch of a single GitHub blob by SHA.
- **Caller:** Internal helper, also exported for direct use if needed.
- **Returns:** `{ ok, content, encoding, sha, size }` or error object
- **Note:** This is the raw fetch primitive. Prefer `githubGitBlobChunkRead` for ranged access.

### Internal (not exported)
All helper utilities (base64 decoding, byte range slicing, error shaping) are private.

---

## hostinger.js

### Public exports

#### `hostingerSshRuntimeRead({ input })`
- **Purpose:** Read runtime state from a Hostinger SSH target (site inventory lookup).
- **Caller:** `jobRunner.js` — `dispatchEndpointKeyExecution` (endpoint key: `hostinger_ssh_runtime_read`)
- **Input:** `input.target_key` or `input.brand` to identify the hosting account row
- **Returns:** Governed runtime read result or error object

#### `matchesHostingerSshTarget(rowObj, input)`
- **Purpose:** Determines whether a registry row matches the given input criteria.
- **Caller:** Internal to `hostingerSshRuntimeRead`; exported for use in registry resolution helpers.

### Internal (not exported)
SSH transport logic, credential resolution internals.

---

## resolveLogicPointerContext.js

### Public exports

#### `resolveLogicPointerContext(input, deps)`
- **Purpose:** Resolve which logic document (canonical or governed legacy) is active for a given logic family/id, following the 6-step orchestration rule from `canonicals/system_bootstrap/01_logic_pointer_knowledge.md`.
- **Input:** `{ logic_id, logic_family, require_knowledge }` — at least one of `logic_id` or `logic_family` must be non-empty.
- **Deps:** `{ getPointerRow(id), isRollbackAuthorized(id)?, getKnowledgeProfile(id)? }` — all injected, none global.
- **Returns:** `{ ok, state, blocked_reason?, knowledge? }`
  - `state` always includes: `logic_pointer_surface_id`, `logic_pointer_resolution_status`, `resolved_logic_doc_id`, `resolved_logic_doc_mode`, `resolved_logic_mode`, `canonical_status`, `active_pointer`, `legacy_doc_retained`, `rollback_available`, `logic_association_status`, `used_logic_id`, `used_logic_name`, `logic_rollback_status`, `logic_knowledge_status`
  - Sink-compatible fields (`used_logic_id`, `used_logic_name`, `resolved_logic_doc_id`, `resolved_logic_mode`, `logic_pointer_resolution_status`, `logic_knowledge_status`, `logic_rollback_status`, `logic_association_status`) are emitted directly — no call-site translation needed before forwarding to writeback
  - `knowledge` present when `require_knowledge: true` and a profile was found
- **Resolution priority:** rollback check first (overrides `canonical_active`), then `canonical_active`, then `legacy_recovery`. No valid path → `degraded`.

#### `guardDirectLegacyExecution(pointerRow, rollbackAuthorized)`
- **Purpose:** Block direct legacy execution when the canonical pointer is active and no governed rollback is authorized.
- **Returns:** `{ blocked: true, reason }` or `{ blocked: false }`
- **Note:** Called before any legacy document is executed directly. Canonical-active with no rollback auth always blocks.

### Internal (not exported)
All intermediate evidence construction and status-string normalization are private.

---

---

## connectorExecutor.js

### Public exports

#### `dispatchPlan(plan_id, options)`
- **Purpose:** Execute an approved execution_plan by routing it to the correct connector dispatcher.
- **Caller:** Planner routes — `POST /planner/plans/:id/execute`
- **Input:** `plan_id` (UUID), options: `{ apply, post_types, publish_status, actor_id }`
- **Returns:** `{ ok, run_id, trace_id, plan_id, connector_type, plan_status, apply, duration_ms, result?, error? }`
- **Routing:** Detects connector type from loaded brand/connected_system:
  - `brand.auth_type = basic_auth_app_password` OR `connected_system.connector_family = wordpress` → `dispatchWordpress()`
  - `connected_system.connector_family = make_mcp` → `dispatchMcpConnector()`
  - else → `dispatchContentWorkflow()` (async stub)
- **Records:** `workflow_runs`, `step_runs`, `telemetry_spans`, `audit_log`

#### `dispatchMcpConnector(plan)` *(internal, via dispatchPlan)*
- **Purpose:** Send a JSON-RPC 2.0 `tools/call` to the Make MCP stateless endpoint.
- **Transport:** `POST https://eu2.make.com/mcp/stateless`, `Authorization: Bearer <MAKE_MCP_TOKEN>`
- **Envelope:** Built from first step in `plan.steps_json`: `{ jsonrpc: "2.0", method: "tools/call", params: { name: <tool>, arguments: <args> } }`
- **Auth:** Resolved via `resolveSecretFromReference("ref:secret:MAKE_MCP_TOKEN")` or `process.env.MAKE_MCP_TOKEN`
- **Returns:** `{ ok: true, dispatch_mode: "sync", rpc_id, tool, mcp_response }`

---

## googleAuthTokenResolver.js

### Public exports

#### `getGoogleAccessToken(options)`
- **Purpose:** Async — return a valid Google OAuth2 access token, fetching fresh if cache is stale.
- **Parent-action integration:** Called by `authCredentialResolution.normalizeAuthContract()` for `google_oauth2` and `google_ads_oauth2` auth modes.
- **Scoped inputs:** `options` may include `action`, `brand`, `targetKey`, `user_id`, `tenant_id`, `credential_scope`, `allow_platform_fallback`, and `auth_context`.
- **Credential chain:**
  1. User/tenant scoped OAuth from `user_app_connections` when explicitly requested through `credential_scope` or `auth_context`.
  2. Platform Google identity using service account ADC / `GOOGLE_APPLICATION_CREDENTIALS` / `GOOGLE_SA_JSON`.
  3. Platform refresh-token credentials via `GOOGLE_REFRESH_TOKEN` + `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`.
- **Fallback rule:** If caller requests user/tenant auth and `allow_platform_fallback=false`, missing scoped credentials must throw a scoped auth error rather than using platform identity.
- **Cache identity:** 55-minute TTL keyed by action key, credential scope, user, tenant, connection, app key, and effective OAuth ref. Different principals or connections must never share token entries.
- **Inflight behavior:** `runGoogleTokenResolutionOnce()` deduplicates only requests with the same complete context key and removes the inflight promise after completion; different context keys resolve independently.
- **Returns:** access token string, or `""` only when no allowed credential path is configured.

#### `buildGoogleTokenCacheKey(options)`
- **Purpose:** Produce the no-secret token cache identity from governed action and principal/connection context.
- **Security:** The key contains identifiers and references only, never raw tokens, client secrets, refresh tokens, or credential payloads.

#### `runGoogleTokenResolutionOnce(key, resolver)`
- **Purpose:** Share one inflight token-resolution promise for an identical governed context.
- **Boundary:** It is not a global lock; requests for different users, tenants, connections, actions, or OAuth refs execute independently.

### Internal (not exported)
Global token fetch, member-scoped token fetch, and OAuth ref parsing helpers.

---

## authCredentialResolution.js / userAppConnectionCredentials.js

### Public exports

#### `normalizeAuthContract(args)`
- **Purpose:** Build the auth contract used by schema validation and outbound HTTP execution.
- **Caller:** `executionPreparation.prepareExecutionRequest()`.
- **Parent strategy:** Reads `actions.runtime_binding_profile.auth_strategy` and optional `endpoints.runtime_binding_profile.auth_strategy_override` to choose credential scope and fallback behavior.
- **Supported runtime scopes:** `platform`, `user`, `tenant`, `connection`, `auto`.
- **Supported scoped credential types:** OAuth2, API key, bearer token, basic auth, custom headers, and provider-specific client credentials.
- **Fallback rule:** For user/tenant/connection requests with `allow_platform_fallback=false`, throw `external_credential_connection_not_found` if no active `user_app_connections` row resolves.

#### `findUserAppConnection(args)`
- **Purpose:** Resolve an active encrypted `user_app_connections` row for user, tenant, or explicit connection auth.
- **Inputs:** `action`, `authContext`, `credentialScope`, `userId`, `tenantId`, `appKey`, `authType`, `connectionId`, `requiredScopes`.
- **Returns:** `{ row, credentials, scope, authContext }` or `null`.
- **Security:** Secret material stays encrypted at rest and is not copied into `actions`, `endpoints`, or exported tool rows.

### Internal (not exported)
AES-GCM decryption helpers, credential field extraction, scope matching, and last-used telemetry helpers.

---

## Local connector installer routes

### `/local-connector/install/device-download-link` and `/local-connector/install/download`

- **Purpose:** Issue and download short-lived, signed connector repair/capability installer bootstraps for the linked Local Manager device.
- **Caller:** Local Manager Windows app using a DPAPI-protected `local_manager.device` token.
- **App-managed mode:** `app_managed=true` and `suppress_pause=true` make the generated BAT exit with `exit /b 0` or `exit /b 1` instead of pausing. Manual downloads retain `pause`.
- **Payload authority:** `capabilities` and `permission_grants` are signed into the installer token. The route must normalize and preserve requested capabilities, app grants, allowed paths, and helper shell aliases.
- **Security:** UAC/local Administrator approval is still required. Installer JSON responses and app diagnostics must not expose connector secrets or signed token values.

### `/connector-agent/installer.ps1`

- **Purpose:** Generate the PowerShell installer that downloads manifest-verified connector agent files, writes the effective local `.env`, configures cloudflared/NSSM, and restarts the `local-connector` service.
- **Caller:** The BAT wrapper returned by `/local-connector/install/download`.
- **Capability contract:** This route is the final `.env` writer and must render signed opt-in values into `CONNECTOR_POWERSHELL_ENABLED`, `CONNECTOR_WIN_ENABLED`, `CONNECTOR_FILE_PATHS`, `CONNECTOR_APP_ALLOWLIST`, and `CONNECTOR_SHELL_ALLOWLIST`.
- **Regression guard:** Do not declare capability install recovered from Settings refresh alone. Validate live connector behavior: `connector_ps`, `connector_win`, `connector_files`, and `connector_apps`.

## Dispatch entrypoint

Connector dispatch routes through two layers:

- `dispatchPlan()` in `connectorExecutor.js` for connector-family-based execution
- `dispatchEndpointKeyExecution` in `jobRunner.js` for endpoint-key execution

```js
// connectorExecutor.js — dispatchPlan() routing
case "make_mcp_connector":  // connector_family = make_mcp
  return await dispatchMcpConnector(plan);  // via dispatchPlan()

// jobRunner.js — dispatchEndpointKeyExecution routing
case "github_git_blob_chunk_read":
  return await githubGitBlobChunkRead({ input: requestPayload });

case "hostinger_ssh_runtime_read":
  return await hostingerSshRuntimeRead({ input: requestPayload });
```

No connector is called directly from route handlers or the main server entrypoint. All connector access goes through the dispatch layer.

---

## Contract rules

1. Each connector exports only what has a real caller or explicit contract purpose.
2. Internal helpers remain unexported unless another module requires them.
3. Dispatch is always by `endpoint_key` string — no connector is hard-wired to a route.
4. Auth credentials are read from environment variables inside the connector, not injected by callers.
5. Error returns are structured objects with `ok: false, error: { code, message }` — not thrown exceptions, except for configuration errors.

## Governed migration runner authorization boundary

The governed migration runner is an internal database-control surface, not a connector credential fallback. It must consult `governed_migration_authorization_registry` before dry-run or apply and must fail closed for missing authorization rows.

A narrowly bounded exception exists only for migrations `319_sprint69_dynamic_container_authority_foundation.sql` and `320_sprint69_dynamic_container_authority_runtime_contracts.sql`, because each migration creates its own authorization row. When either row is absent, `SELF_AUTHORIZING_BOOTSTRAP_MIGRATIONS` may authorize the first governed pass and must return `source=legacy_bootstrap_missing_row` with `bootstrap_required=true`.

An existing registry row always overrides bootstrap behavior. Disabled or archived rows, and rows with `allow_apply=0`, remain blocking. The runner still requires additive static preflight, exact typed confirmation for apply, ledger recording, and schema-object readback. No provider dispatch, connector credential resolution, raw secret access, or direct route-level SQL bypass is permitted.
