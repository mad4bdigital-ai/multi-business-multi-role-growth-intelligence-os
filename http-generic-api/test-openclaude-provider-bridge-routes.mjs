import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSource = readFileSync("routes/devAgentRoutes.js", "utf8");
const startMarker = 'router.get("/dev-agent/openclaude/bridge/v1/health"';
const endMarker = "// ── POST /dev-agent/summary-comparison/run";
const start = routeSource.indexOf(startMarker);
const end = routeSource.indexOf(endMarker, start);
assert(start >= 0, "OpenClaude bridge health route must be registered.");
assert(end > start, "OpenClaude bridge route block must appear before summary comparison routes.");
const bridgeBlock = routeSource.slice(start, end);

assert(
  bridgeBlock.includes('router.post("/dev-agent/openclaude/bridge/v1/chat/completions"'),
  "OpenClaude OpenAI-compatible chat completions dry-run route must be registered."
);
assert(
  bridgeBlock.includes("openclaude_bridge_dispatch_mode_required"),
  "Bridge route must require explicit dry_run=true or live_dispatch=true."
);
assert(
  bridgeBlock.includes("runOpenClaudeOpenRouterLiveDispatch"),
  "Live dispatch must be delegated to the governed OpenClaude/OpenRouter runtime helper."
);
assert(
  bridgeBlock.includes("dry_run_no_provider_call"),
  "Chat route must return a no-provider-call dry-run mode."
);
assert(
  bridgeBlock.includes("provider_dispatch_attempted: false"),
  "Dry-run route must not dispatch to a provider."
);
assert(
  bridgeBlock.includes("local_execution_attempted: false"),
  "Dry-run route must not execute local commands."
);
assert(
  bridgeBlock.includes("repo_mutation_allowed: false"),
  "Dry-run route must keep repository mutation disabled."
);
assert(
  bridgeBlock.includes("secrets_included: false"),
  "Bridge routes must explicitly mark responses as secret-free."
);
assert(
  bridgeBlock.includes("copy_platform_secret_to_device: false"),
  "Health route must expose the no-secret-copy boundary."
);
assert(
  bridgeBlock.includes('readiness: liveProviderReady ? "ready_for_live_provider_dispatch"'),
  "Health route must report certified live provider dispatch readiness."
);
assert(
  bridgeBlock.includes("local_runtime_required_for_provider_bridge: false"),
  "Health route must distinguish the platform provider bridge from the local OpenClaude runtime."
);
assert(
  !bridgeBlock.includes("OPENROUTER_API_KEY") && !bridgeBlock.includes("GEMINI_API_KEY"),
  "Bridge route block must not read provider API keys directly."
);
assert(
  !bridgeBlock.includes("fetch(") && !bridgeBlock.includes("callModel"),
  "Dry-run bridge route block must not call upstream providers."
);

console.log("OpenClaude provider bridge route safety tests passed");
