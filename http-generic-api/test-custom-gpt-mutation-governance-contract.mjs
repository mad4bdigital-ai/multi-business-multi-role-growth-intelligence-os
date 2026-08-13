import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const governance = readFileSync(new URL("../docs/custom-gpt-mutation-governance.md", import.meta.url), "utf8");
const runtime = readFileSync(new URL("./remoteMcpConnectorRuntime.js", import.meta.url), "utf8");
const openapi = readFileSync(new URL("./openapi.yaml", import.meta.url), "utf8");
const inventory = readFileSync(new URL("../docs/remote-mcp-write-scope-inventory.md", import.meta.url), "utf8");

assert.match(governance, /مستويين منفصلين لحوكمة التغيير/u);
assert.match(governance, /لا تُعتبر mutation governance موحدة/u);
assert.match(governance, /mutation_governance_ready=false/u);
assert.match(governance, /لم تُفعّل write scopes/u);
assert.match(runtime, /evaluateRemoteMcpWriteScopeDecision/u);
assert.match(openapi, /x-custom-gpt-surfaces/u);
assert.match(inventory, /shadow/u);
assert.match(governance, /لا توجد write scopes مفعلة/u);
assert.match(governance, /لا activation/u);

console.log("Custom GPT mutation governance contract tests passed.");
