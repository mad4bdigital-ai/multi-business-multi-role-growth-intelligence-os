import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSource = readFileSync("routes/devAgentRoutes.js", "utf8");

assert(
  routeSource.includes('router.get("/dev-agent/openclaude/bridge/v1/health"'),
  "OpenClaude bridge health route must be registered."
);
assert(
  routeSource.includes('router.post("/dev-agent/openclaude/bridge/v1/chat/completions"'),
  "OpenClaude OpenAI-compatible chat completions dry-run route must be registered."
);
assert(
  routeSource.includes("openclaude_bridge_dispatch_disabled"),
  "Provider dispatch must be blocked unless the request is an explicit dry run."
);
assert(
  routeSource.includes("dry_run_no_provider_call"),
  "Chat route must return a no-provider-call dry-run mode."
);
assert(
  routeSource.includes("provider_dispatch_attempted: false"),
  "Dry-run route must not dispatch to a provider."
);
assert(
  routeSource.includes("local_execution_attempted: false"),
  "Dry-run route must not execute local commands."
);
assert(
  routeSource.includes("repo_mutation_allowed: false"),
  "Dry-run route must keep repository mutation disabled."
);
assert(
  routeSource.includes("secrets_included: false"),
  "Bridge routes must explicitly mark responses as secret-free."
);
assert(
  routeSource.includes("copy_platform_secret_to_device: false"),
  "Health route must expose the no-secret-copy boundary."
);
assert(
  !routeSource.includes("OPENROUTER_API_KEY") && !routeSource.includes("GEMINI_API_KEY"),
  "Bridge routes must not read provider API keys directly."
);

console.log("OpenClaude provider bridge route safety tests passed");
