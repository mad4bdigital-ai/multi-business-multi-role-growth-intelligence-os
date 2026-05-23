# Agent Execution Runtime — Direct Instruction Patch

## Enforcement

All AI-driven workflow execution must use `runAgentLoop` from `agentLoopRunner.js` with `getAgentDeps()` from `agentRuntime.js` injected as the `deps` argument.

Direct model calls from routes, connectors, or workflow handlers outside this chain are forbidden.

## Model Tier Selection

The `execution_class` field on the `workflows` table row is authoritative for model tier selection.

| Class | Tier |
|---|---|
| `standard` | default/low-cost |
| `complex` | multi-step reasoning |
| `authority` | highest-stakes decisions |

If `execution_class` is absent on the workflow row, `standard` is applied.

If `AGENT_MODEL` env var is set, it overrides all class routing for all workflows in that process.

Model selection must not be hardcoded in routes or connectors. All routing goes through `getCallModelForClass(execution_class)` / `getCallModelForClassAsync(execution_class)` and `modelAdapterRouter` maps the selected tier to the configured provider.

Provider routing is governed by `platform_runtime_config.config_key = agent_model_runtime` when available. This row may define `provider_order`, `free_first`, provider enabled flags, env-var names, and class-to-model mappings. It must never store raw API keys, tokens, private keys, passwords, or provider secrets.

Supported provider keys are `openrouter`, `openai`, `anthropic`, and `gemini`. `openrouter` uses the OpenAI-compatible OpenRouter endpoint and may default low-cost/background work to `openrouter/free` when `OPENROUTER_API_KEY` is configured.

## Verify Pass Enforcement

If `workflow.review_required = 1`, a verify pass must run after the primary model loop.

The verify pass must use the `standard` class model (never `authority` or `complex`).

If `severity = "major"` and `passed = false`, the fixer must run and replace the primary output before the result is written to `workflow_runs`.

A parse failure in the verify pass response must be treated as `passed: true` (fail-open). The verify pass must never block completion due to its own failures.

The verify pass result must be written to `step_runs` with `step_key = "verify_pass"`, `step_type = "review"`.

## Engine Dispatch Enforcement

Tool calls from the model loop must route through `engineExecutorRegistry.dispatch`. The registry resolves:

1. Custom handlers (`registry.register`) — checked first.
2. MCP engines (`make_*`, `mcp_*` prefix) → `dispatchMcpTool`.
3. HTTP action engines (matching `actions` table or `_api`/`_endpoint`/`_action` suffix) → `callHttpAction`.
4. Logic engines (matching `logic_definitions` `logic_key`) → `runLogicWithModel`.

If `dispatchMcpTool` or `callHttpAction` is not configured in `deps`, the registry must return a typed error (`mcp_not_configured`, `http_action_not_configured`) — never throw.

## Drive Knowledge Layer Enforcement

`logic_definitions` rows for engines must carry `source_doc_id` and `knowledge_folder_id` linking to the authoritative Drive files.

`body_json.system_prompt` is the canonical runtime system prompt for the engine. It must be populated from the Drive spec file via `sync-drive-to-db.mjs --apply`.

When `source_doc_id` is present on a `logic_definitions` row, the runtime may fetch the live Drive document to refresh the system prompt before execution when governed by the workflow.

## Skill Install Enforcement

Skills installed via `skillInstaller.mjs` must upsert `logic_definitions` rows with `logic_type = "execution"`. Skills that lack a `skill.json` manifest at any standard path must be rejected — no silent fallback to package name only.

## Required Env Vars for Agent Execution

| Var | Purpose |
|---|---|
| `AGENT_MODEL_PROVIDER` | `anthropic` (default) / `openai` / `gemini` |
| `ANTHROPIC_API_KEY` | Required when provider is `anthropic` |
| `OPENAI_API_KEY` | Required when provider is `openai` |
| `GOOGLE_AI_API_KEY` | Required when provider is `gemini` |
| `AGENT_MODEL` | Override: forces a specific model for all classes |
| `GOOGLE_CLIENT_ID` | Required for user-owned Google OAuth token generation |
| `GOOGLE_CLIENT_SECRET` | Required for user-owned Google OAuth token generation |
| `GOOGLE_REFRESH_TOKEN` | Required only when user-owned Drive/Sheets flows use refresh-token auth |
| `GOOGLE_AUTH_MODE` | Set to `refresh_token` for user-owned Drive/Sheets input sources |

Platform-owned registry/bootstrap Drive and Sheets files use managed service account ADC by default. If a user-owned refresh-token flow returns `invalid_grant`, run the token generator and restart the server before retrying that user-owned flow.
