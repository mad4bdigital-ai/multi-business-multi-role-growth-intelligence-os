import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const governance = readFileSync(new URL("../docs/custom-gpt-mutation-governance.md", import.meta.url), "utf8");
const runtime = readFileSync(new URL("./remoteMcpConnectorRuntime.js", import.meta.url), "utf8");
const shared = readFileSync(new URL("./sharedMutationPolicy.js", import.meta.url), "utf8");
const openapiMiddleware = readFileSync(new URL("./openApiMutationGovernance.js", import.meta.url), "utf8");
const routeIndex = readFileSync(new URL("./routes/index.js", import.meta.url), "utf8");
const openapi = readFileSync(new URL("./openapi.yaml", import.meta.url), "utf8");
const inventory = readFileSync(new URL("../docs/remote-mcp-write-scope-inventory.md", import.meta.url), "utf8");

assert.match(governance, /نقلين مستقلين/u);
assert.match(governance, /shared mutation decision adapter/u);
assert.match(governance, /mutation_governance_ready=false/u);
assert.match(governance, /لم تُفعّل write scopes/u);
assert.match(runtime, /evaluateRemoteMcpWriteScopeDecision/u);
assert.match(shared, /evaluateSharedMutationPolicyDecision/u);
assert.match(openapiMiddleware, /OPENAPI_MUTATION_GOVERNANCE_DENIED/u);
assert.match(routeIndex, /createOpenApiMutationGovernanceMiddleware/u);
assert.match(openapi, /x-custom-gpt-surfaces/u);
assert.match(inventory, /shadow/u);
assert.match(governance, /لا توجد write scopes مفعلة/u);
assert.match(governance, /لا activation/u);

console.log("Custom GPT mutation governance contract tests passed.");
