# Agent Execution Runtime

## Purpose

The agent execution runtime wires the AI model loop, engine dispatch, and knowledge layer into a single governed execution chain.
All AI-driven workflow execution must flow through this layer — no workflow calls a model directly.

## Runtime Modules

| Module | Role |
|---|---|
| `agentRuntime.js` | Singleton factory — composes `callModel`, `runLogicWithModel`, `engineExecutorRegistry`, and `getCallModelForClass` into a single `deps` object |
| `agentLoopRunner.js` | Entry point — `runAgentLoop(plan, deps)` loads the workflow row, loads the logic definition, runs the ReAct model loop, and optionally runs the verify pass |
| `modelAdapterRouter.js` | `buildCallModel(config)` — normalises Anthropic / OpenAI / OpenRouter / Gemini request and response shapes to the common internal format |
| `agentModelRuntimeSettings.js` | Loads and validates `platform_runtime_config.agent_model_runtime`; resolves Gemini-primary/OpenRouter-fallback provider order, env-var references, and class-to-model mappings without storing secrets |
| `modelAdapter.js` | `runLogicWithModel` — executes the ReAct tool-calling loop with iteration cap and tool dispatch |
| `engineExecutorRegistry.js` | `buildEngineExecutorRegistry` — routes tool-call dispatch to MCP, HTTP action, or logic-as-engine by name |
| `connectorExecutor.js` | `dispatchContentWorkflow` — calls `runAgentLoop` with `getAgentDeps()` injected |
| `n8nWorkflowRuntime.js` | Governed visual workflow adapter — resolves `workflow_runtime_bindings`, validates input/output schemas, calls n8n webhooks, records `workflow_runs`, and keeps secrets in env/vault |
| `skillInstaller.mjs` | CLI — fetches `skill.json` from GitHub, upserts `logic_definitions` + `skill_packages` rows |
| `skillManifest.js` | Manifest normaliser for skill installation |

## Model Class Routing

The `execution_class` column on the `workflows` table controls which model tier is selected per workflow run.

| Class | Gemini primary | OpenRouter fallback | OpenAI fallback | Anthropic fallback |
|---|---|---|---|---|
| `standard` | `gemini-3.5-flash` | `openrouter/free` | `gpt-4o-mini` | `claude-haiku-4-5-20251001` |
| `complex` | `gemini-3.5-flash` | `openrouter/free` | `gpt-4o` | `claude-sonnet-4-6` |
| `authority` | `gemini-3.5-flash` | `openrouter/free` | `gpt-4o` | `claude-opus-4-7` |

Resolution order:
1. If `AGENT_MODEL_PROVIDER` env var is set, it hard-selects that provider.
2. Otherwise load `platform_runtime_config.config_key = agent_model_runtime` and iterate its `provider_order`.
3. Build an ordered fallback candidate chain from enabled providers whose primary or fallback credential env var is present.
4. `execution_class` selects the model. Missing class falls back to `standard`.
5. If `AGENT_MODEL` env var is set, it overrides the selected class model for the selected provider.
6. Async runtime routes, including dev-agent session summaries, try the candidate chain in order. By default this means Gemini first, OpenRouter second, then OpenAI and Anthropic if configured.

Class routing is cached per class/provider/model per process via `_classCache`. DB settings are cached briefly by `agentModelRuntimeSettings.js` and can be refreshed through the governed settings route.

## Task-specific model profiles

`platform_runtime_config.agent_model_runtime.task_profiles` assigns specific models to job types before generic class routing applies.

| Task class | Primary model | Purpose |
|---|---|---|
| `summary` | `gemini-3.5-flash` | Session summaries and background summarization |
| `classification` | `gemini-2.5-flash-lite` | Cheap intent/task classification and routing |
| `image_edit` | `gemini-3.1-flash-image-preview` | Future image editing/generation requests using Nano Banana |

Routes that know the task should use `getCallModelForTaskAsync(task_class, execution_class)`. Routes that only know workflow class may continue using `getCallModelForClassAsync(execution_class)`.

## Verify Pass

When `workflow.review_required = 1` (or `TRUE` or `'1'`), `agentLoopRunner` runs a post-execution quality review after the primary model loop completes.

Review model: always `standard` class - cost-controlled and provider-agnostic.

Review result shape: `{ passed: boolean, issues: string[], severity: "none"|"minor"|"major" }`.

Fix pass: if `passed = false` and `severity = "major"`, the fixer runs immediately and replaces `modelResult.output`.

Review outcome is written to `step_runs` as step_key `verify_pass` with step_type `review`.

The verify pass is non-blocking — a parse error in the review response is treated as `passed: true` to prevent false negatives.

## Engine Dispatch

`engineExecutorRegistry.dispatch(engineName, input, context)` resolves dispatch by name:

1. Custom handler registered via `registry.register(engineName, fn)` — checked first.
2. `make_*` or `mcp_*` prefix → `dispatchMcpTool` (returns error if not configured).
3. `_api` suffix or `_endpoint`/`_action`/`_connector` suffix, or matching row in `actions` table → `callHttpAction`.
4. Matching row in `logic_definitions` → `runLogicWithModel` (logic-as-engine recursive call).
5. Fallback: `{ ok: false, error: "engine_not_registered" }`.

## Drive Knowledge Layer

`logic_definitions` rows carry four Drive-linkage columns added by `sync-drive-to-db.mjs`:

| Column | Purpose |
|---|---|
| `source_doc_id` | Google Doc ID of the canonical logic or engine spec |
| `knowledge_folder_id` | Drive root knowledge folder for this logic or engine category |
| `knowledge_shared_folder_id` | Shared knowledge subfolder (00-shared pattern) |
| `knowledge_logic_specific_folder_id` | Logic-specific knowledge subfolder |

32 engine rows (across 9 categories: Product Intelligence, Market Intelligence, Brand Intelligence, SEO, Revenue, Innovation, Marketing, Content, Report) carry `source_doc_id` and `knowledge_folder_id` linking to authoritative Drive files.

`body_json.system_prompt` on each engine row is the canonical system prompt derived from the Drive engine spec file. This is the runtime system prompt used when the engine is dispatched as a logic.

## Sync Script

`http-generic-api/sync-drive-to-db.mjs` is the idempotent migration script for the Drive knowledge layer:

- ALTERs `logic_definitions` to add the four Drive-linkage columns (no-op if already present).
- UPSERTs 32 engine rows with enriched `body_json.system_prompt` and Drive IDs.
- UPSERTs `business_type_profiles` for `travel` and `hvac_air_conditioning_services`.
- UPSERTs `brand_paths` for `arab_cooling` with all 07-brand-assets subfolder IDs in `brand_core_docs_json`.
- UPSERTs 6 `brand_core` rows for `arab_cooling` (identity-core-assets, source-documents, media-visuals, proof-trust-evidence, legal-policy-reference, offers-products).

Usage: `node http-generic-api/sync-drive-to-db.mjs [--apply]` (dry-run by default).

## Google Workspace Auth

Platform-owned registry/bootstrap Drive and Sheets files use managed service account ADC by default through `googleAuthTokenResolver.js`. User-owned Drive/Sheets files and user-connected input sources use refresh-token auth, for example `GOOGLE_AUTH_MODE=refresh_token`.

`http-generic-api/generate-google-refresh-token.mjs` generates a fresh `GOOGLE_REFRESH_TOKEN` and writes it to `.env` for user-owned refresh-token flows only.

Modes:
- Default (auto): starts `localhost:3000` callback server and opens the browser.
- `--print-url`: prints the auth URL for headless / SSH environments.
- `--code=<AUTH_CODE>`: exchanges a previously obtained auth code.

Requires `http://localhost:3000/oauth2callback` in the OAuth client's Authorised Redirect URIs.
Run this when user-owned refresh-token Google APIs return `invalid_grant` (refresh token revoked or expired). Do not use refresh-token repair for platform-owned managed service account ADC activation.

## Governance Rules

- All AI-driven workflow execution must use `runAgentLoop` via `getAgentDeps()` — no direct model calls from routes.
- `execution_class` must be set on every workflow row that uses AI execution; default `standard` is safe but not optimal.
- `review_required` must be `1` for any workflow that writes governed content.
- Engine dispatch to HTTP actions requires `callHttpAction` to be configured in the `deps` object — otherwise returns `http_action_not_configured`.
- Engine dispatch to MCP tools requires `dispatchMcpTool` to be configured — otherwise returns `mcp_not_configured`.
- `sync-drive-to-db.mjs --apply` must be re-run after any Drive engine spec file update to keep `body_json.system_prompt` in sync.

## Supervisor runtime readiness boundary

Admin GPT and Tenant GPT may coordinate governed sub-agent work, but unrestricted master-agent execution is not active merely because agent registry, delegation, or chain-event tables exist.

Before claiming supervisor execution readiness, run `npm run supervisor:readiness` from `http-generic-api/`. Use `npm run supervisor:readiness:live` when configured live-schema evidence is required. The command is read-only, emits no secrets, and must return `execution_ready=true`.

The runtime enforces atomic execution-plan claiming, applicable capability-envelope validation before claim, fail-closed skill grants, deterministic healthy-agent selection, one bounded healthy fallback attempt, and durable chain lineage with depth/cycle rejection.

Static `execution_ready=true` is necessary but not sufficient for production activation. Sequential governed orchestration remains the supported default until live schema and controlled-tenant behavioral evidence are current.
