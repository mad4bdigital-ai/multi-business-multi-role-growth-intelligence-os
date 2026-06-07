import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runtime = readFileSync(new URL("./openClaudeBridgeRuntime.js", import.meta.url), "utf8");
const routes = readFileSync(new URL("./routes/devAgentRoutes.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/219_sprint67_openclaude_live_dispatch_certification.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(runtime, /runOpenClaudeOpenRouterLiveDispatch/);
assert.match(runtime, /platform_secrets/);
assert.match(runtime, /openrouter_api_key/);
assert.match(runtime, /decryptToken/);
assert.match(runtime, /buildCallModel/);
assert.match(runtime, /provider: "openrouter"/);
assert.match(runtime, /openrouter_model_selection_policy_v1/);
assert.match(runtime, /openclaude_platform_provider_bridge_v1/);
assert.match(runtime, /dispatch_allowed/);
assert.match(runtime, /secrets_included: false/);
assert.match(runtime, /repo_mutation_allowed: false/);
assert.match(runtime, /local_execution_attempted: false/);
assert.match(runtime, /AbortSignal\.timeout/);
assert.match(runtime, /allowed_tools: \["Read", "Grep", "Glob", "LS"\]/);
assert.match(runtime, /denied_tools: \["Edit", "Write", "MultiEdit", "NotebookEdit", "Bash", "git push", "git commit", "apply_patch"\]/);
assert.doesNotMatch(runtime, /console\.log\(apiKey|process\.stdout.*apiKey/s);
assert.doesNotMatch(runtime, /OPENROUTER_API_KEY\s*[:=]\s*[A-Za-z0-9_\-]{8,}/i);
assert.doesNotMatch(runtime, /sk-or-v1-[A-Za-z0-9_\-]+/i);

assert.match(routes, /runOpenClaudeOpenRouterLiveDispatch/);
assert.match(routes, /live_dispatch/);
assert.match(routes, /x-openclaude-bridge-live-dispatch/);
assert.match(routes, /mode: "live_provider_dispatch"/);
assert.match(routes, /provider_dispatch_attempted: true/);
assert.match(routes, /secrets_included: false/);
assert.doesNotMatch(routes, /provider_secret|api_key\s*:/i);

assert.match(migration, /openrouter_live_smoke_passed_scoped_openclaude_dispatch_enabled/);
assert.match(migration, /dispatch_allowed = 1/);
assert.match(migration, /apply_allowed = 0/);
assert.match(migration, /no_secrets/);
assert.match(migration, /no_local_execution/);
assert.match(migration, /no_repo_mutation/);
assert.match(migration, /active_live_provider_dispatch_smoke_passed/);
assert.match(migration, /secrets_returned_to_agent=0/);
assert.match(migration, /return_provider_api_key_to_agent/);
assert.doesNotMatch(migration, /OPENROUTER_API_KEY\s*[:=]\s*[A-Za-z0-9_\-]{8,}/i);
assert.doesNotMatch(migration, /sk-or-v1-[A-Za-z0-9_\-]+/i);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.match(runner, /219_sprint67_openclaude_live_dispatch_certification\.sql/);

console.log("OpenClaude live dispatch guard passed");
