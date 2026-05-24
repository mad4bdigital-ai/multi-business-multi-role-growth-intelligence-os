# http-generic-api-connector

Policy-enforced HTTP executor with governed agent execution runtime.

## Key behavior
- Resolves `parent_action_key`, `endpoint_key`, and brand target from registry sheets
- Resolves `action_key.openai_schema_file_id` and validates request against the schema before transport execution
- Normalizes auth modes:
  - `none`
  - `basic_auth`
  - `bearer_token`
  - `api_key_query`
  - `api_key_header`
  - `oauth_gpt_action`
  - `custom_headers`
- Injects auth server-side
- Rejects caller-supplied `Authorization`
- Blocks `oauth_gpt_action` on this transport and requires native connector path

## Key runtime modules

- `server.js` — Express route surface, top-level orchestration, and engine evidence auto-derivation
- `execution.js` — execution-result classification, `Execution Log Unified` row shaping (56 columns), logic/engine evidence normalizers, `buildEngineEvidenceFromWorkflow`, `getWorkflowRowByKey`, `getActiveEngineRegistryRows`, and writeback wrappers
- `resolveLogicPointerContext.js` — canonical logic pointer resolution (`resolveLogicPointerContext`, `guardDirectLegacyExecution`); emits sink-compatible evidence fields directly
- `sinkOrchestration.js` — universal writeback orchestration accepting full logic and engine evidence payloads
- `registryCache.js` — Redis-backed registry cache with configurable TTL; transparent to callers of `registrySheets.js`
- `registryResolution.js`, `registrySheets.js`, `registryMutations.js` — registry-backed routing and execution control
- `mutationGovernance.js`, `governedChangeControl.js`, `governedSheetWrites.js` — governed writeback and mutation control
- `normalization.js` — canonical payload normalization for all A–H domains
- `wordpress/` — 16 phase modules (A–P) for governed site migration

**Agent execution runtime:**
- `agentRuntime.js` — singleton composing `callModel` + `runLogicWithModel` + `engineExecutorRegistry` + sync/async `getCallModelForClass`; async model routing uses governed provider fallback chains
- `agentModelRuntimeSettings.js` — validates `platform_runtime_config.agent_model_runtime`; default routing is Gemini primary with OpenRouter fallback
- `agentLoopRunner.js` — `runAgentLoop(plan, deps)`: loads workflow + logic definition, runs ReAct loop, verify pass (when `review_required=1`), writes results to DB
- `modelAdapterRouter.js` — `buildCallModel`: normalizes Anthropic / OpenAI / OpenRouter / Gemini shapes
- `modelAdapter.js` — `runLogicWithModel`: ReAct tool-calling loop with iteration cap
- `engineExecutorRegistry.js` — routes tool dispatch to MCP / HTTP action / logic-as-engine
- `connectorExecutor.js` — `dispatchContentWorkflow` injects `getAgentDeps()`; also handles WordPress and MCP connector dispatch
- `skillInstaller.mjs` — CLI: install/list/enable/disable skills from GitHub (`skill.json` → `logic_definitions` + `skill_packages`)
- `skillManifest.js` — manifest normalizer for skill installation

**Operational scripts:**
- `sync-drive-to-db.mjs` — syncs Drive knowledge layer to DB: adds columns to `logic_definitions`, upserts 32 engine rows with real system prompts, seeds `business_type_profiles` + `brand_paths` + `brand_core`
- `generate-google-refresh-token.mjs` — generates `GOOGLE_REFRESH_TOKEN` via OAuth2 flow (auto browser or headless `--print-url` / `--code=`)
- `migrate-platform-tables.mjs` — runs all DDL migrations in order
- `migrate-sheets-to-sql.mjs` — syncs 18 registry sheets to MySQL

Test suite: 394 assertions across 21 test files (`npm test`). Architecture checks: 173 checks (`npm run validate`).

## Data source mode

`DATA_SOURCE` controls where the platform reads and writes registry data:

| Value | Behaviour |
|---|---|
| `sql` (default) | All reads/writes go to MySQL. Sheets I/O is skipped entirely — no Drive or Sheets calls are made during execution, writeback, or activation. Set this on Hostinger. |
| `dual` | SQL primary. Falls back to Sheets on read failure. Writes go to SQL then mirror async to Sheets. |
| `sheets` | Legacy Sheets-only mode. Do not use in production. |

When `DATA_SOURCE=sql`, the following are no-ops and will not block activation or execution even if the referenced spreadsheet IDs are deleted or inaccessible:
- `assertGovernedSinkSheetsExist`
- `writeExecutionLogUnifiedRow`
- `persistOversizedArtifactImpl`

## Running migrations

```bash
# Run all migrations (safe — most use IF NOT EXISTS / ON DUPLICATE KEY UPDATE)
node migrate-platform-tables.mjs

# Run a single migration by prefix (avoids re-running destructive DROP TABLE steps)
node migrate-platform-tables.mjs --only 051

# Dry-run: print SQL only, no DB writes
node migrate-platform-tables.mjs --dry-run
```

## Required env
- `REGISTRY_SPREADSHEET_ID`
- **Agent execution:**
  - `AGENT_MODEL_PROVIDER` — optional hard override: `gemini` / `openrouter` / `openai` / `anthropic`
  - `GEMINI_API_KEY` — Google AI Studio Gemini key; primary for default session-summary routing
  - `GOOGLE_AI_API_KEY` — legacy Gemini key alias, still supported as fallback
  - `OPENROUTER_API_KEY` — OpenRouter key; default fallback provider after Gemini
  - `OPENROUTER_SITE_URL` — optional OpenRouter `HTTP-Referer` metadata
  - `OPENROUTER_APP_NAME` — optional OpenRouter `X-Title` metadata
  - `OPENAI_API_KEY` — required when provider is `openai`
  - `ANTHROPIC_API_KEY` — required when provider is `anthropic`
  - `AGENT_MODEL` — override: forces a specific model string, bypasses class routing
- **Google auth (for Sheets, Drive, Analytics):**
  - Default production path: Cloud Run Application Default Credentials from the managed service account.
  - `GOOGLE_AUTH_MODE=refresh_token` — use refresh-token OAuth first for user-owned Drive/Sheets input sources, then fall back to service-account auth.
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_REFRESH_TOKEN` — generate via `node generate-google-refresh-token.mjs`
  - `GOOGLE_APPLICATION_CREDENTIALS` or `GOOGLE_SA_JSON` — optional explicit service-account credentials for local/non-Cloud Run execution.
- **Data source:**
  - `DATA_SOURCE` — `sql` (default) / `dual` / `sheets`
  - `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` — MySQL connection (required when `DATA_SOURCE=sql` or `dual`)
- **Cloudflare (admin CLI + local connector installer):**
  - `CLOUDFLARE_API_TOKEN` — Cloudflare API token; enables `POST /admin/cli/cloudflare` and `admin_cloudflare` GPT tool
  - `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account ID; used by tunnel diagnostic tools
  - `CLOUDFLARE_ZONE_ID` — Cloudflare zone ID for DNS operations via `/admin/cli/dns`
  - `CLOUDFLARE_TUNNEL_TOKEN` — Tunnel token embedded into the generated Windows `.bat` installer via `GET /admin/cli/local-connector/install-bundle`
- **Hostinger:**
  - `HOSTINGER_CLOUD_PLAN_01_API_KEY` — Hostinger API key; enables `POST /admin/cli/hostinger` and `admin_hostinger` GPT tool
  - `HOSTINGER_SHARED_MANAGER_01_API_KEY` — optional second key (pass `api_key_ref: "shared_manager"`)
- optional:
  - `BRAND_REGISTRY_SHEET`
  - `ACTIONS_REGISTRY_SHEET`
  - `ENDPOINT_REGISTRY_SHEET`
  - `EXECUTION_POLICY_SHEET`
  - `HOSTING_ACCOUNT_REGISTRY_SHEET`
  - `BACKEND_API_KEY`
  - `REGISTRY_CACHE_TTL_SECONDS` (default: `600`) — Redis cache TTL for registry sheets; set to `0` to disable caching
  - `JSON_BODY_LIMIT` (default: `20mb`)
  - `JOB_MAX_ATTEMPTS` (default: `3`)
  - `MAX_TIMEOUT_SECONDS` (default: `300`, max: `3600`) - upper bound for sync and queued execution timeouts
  - `WORKER_CONCURRENCY` (default: `2`) - BullMQ worker concurrency; use `1` for scheduled bursts when providers are slow or rate-limited
  - `JOB_QUEUE_TICK_MS` (default: `1000`)
  - `JOB_WEBHOOK_TIMEOUT_MS` (default: `10000`)
  - `JOB_STATE_FILE` (default: `./data/http-job-state.json`)
  - `JOB_STATE_FLUSH_DEBOUNCE_MS` (default: `250`)
  - `hostinger_cloud_plan_01` (must match `ref:secret:hostinger_cloud_plan_01` in Hosting Account Registry)

## Admin CLI routes (`/admin/cli/*`)

All routes require `Authorization: Bearer <BACKEND_API_KEY>` + admin principal.

| Route | Purpose |
|---|---|
| `POST /admin/cli/hostinger` | Forward any call to the Hostinger REST API |
| `POST /admin/cli/cloudflare` | Forward any call to the Cloudflare REST API (tunnels, DNS, zones) |
| `GET /admin/cli/local-connector/install-bundle` | Generate a pre-filled Windows `.bat` installer with `CLOUDFLARE_TUNNEL_TOKEN` embedded; uploads to Google Drive and returns a shareable download link |
| `GET /admin/cli/dns` | List DNS records for a domain (via Hostinger DNS API) |
| `POST /admin/cli/dns` | Upsert a DNS record |
| `DELETE /admin/cli/dns` | Delete a DNS record |

The `POST /admin/control` endpoint also accepts `tool=cloudflare` alongside `github`, `gcloud`, `db`, `env`, `shell`, `hostinger`, `windows_app`.

## GPT tool registry (`admin_platform_endpoint_tools`)

The admin GPT discovers all platform operations via `GET /gpt/tools` and executes them via `POST /gpt/tools/call`. Key self-repair tools seeded by migrations 047–052:

| Tool key | Action |
|---|---|
| `admin_cloudflare` | Call any Cloudflare API path |
| `cloudflare_tunnel_status` | List Cloudflare tunnels to diagnose 1033 errors |
| `admin_hostinger` | Call any Hostinger API path |
| `admin_connector_activate` | Flip a connector `status` from `pending` to `active` |
| `local_connector_install_bundle` | Generate + upload the Windows `.bat` installer |
| `platform_self_repair_diagnose` | Run bootstrap config check as repair triage |

## Endpoints
- `POST /http-execute` (existing sync execution)
- `POST /jobs` (new async execution)
- `GET /jobs/:jobId` (job status/metadata)
- `GET /jobs/:jobId/result` (final result/error)

## Sync request body (`POST /http-execute`)
```json
{
  "provider_domain": "https://donatours.com/wp-json",
  "parent_action_key": "wordpress_api",
  "endpoint_key": "wordpress_create_post",
  "method": "POST",
  "path": "/wp/v2/posts",
  "query": {},
  "headers": {
    "Content-Type": "application/json"
  },
  "path_params": {},
  "body": {
    "title": "Example",
    "status": "draft",
    "content": "Hello"
  }
}
```

## Async request body (`POST /jobs`)
```json
{
  "target_key": "donatours_wp",
  "parent_action_key": "hostinger_api",
  "endpoint_key": "hostinger_subscriptions_list",
  "method": "GET",
  "path": "/api/billing/v1/subscriptions",
  "webhook_url": "https://your-app.com/webhooks/job-finished",
  "callback_secret": "optional-signing-secret",
  "idempotency_key": "optional-client-generated-key",
  "max_attempts": 3
}
```

For scheduled queue jobs that perform large reads or validation scans, use:
```json
{
  "timeout_seconds": 900,
  "max_attempts": 3
}
```

For small reads such as bounded Sheets ranges, use:
```json
{
  "timeout_seconds": 60,
  "max_attempts": 3
}
```

## Async response examples
Create job:
```json
{
  "job_id": "job_123",
  "job_type": "http_execute",
  "status": "queued",
  "created_at": "2026-04-12T09:00:00Z",
  "updated_at": "2026-04-12T09:00:00Z",
  "requested_by": "127.0.0.1",
  "target_key": "donatours_wp",
  "parent_action_key": "hostinger_api",
  "endpoint_key": "hostinger_subscriptions_list",
  "attempt_count": 0,
  "max_attempts": 3,
  "next_retry_at": null,
  "status_url": "/jobs/job_123",
  "result_url": "/jobs/job_123/result"
}
```

Check status:
```json
{
  "job_id": "job_123",
  "status": "running",
  "attempt_count": 1
}
```

Get final result:
```json
{
  "job_id": "job_123",
  "status": "succeeded",
  "result": {
    "ok": true
  }
}
```
