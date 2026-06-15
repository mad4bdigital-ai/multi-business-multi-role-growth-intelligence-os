import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCallModel } from "./modelAdapterRouter.js";

const localRuntime = readFileSync(new URL("../local-connector/local-agent-runtime.mjs", import.meta.url), "utf8");
const connector = readFileSync(new URL("../local-connector/server.mjs", import.meta.url), "utf8");
const proxy = readFileSync(new URL("./routes/connectorProxyRoutes.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/1011_sprint69_hybrid_local_managed_agent_runtime.sql", import.meta.url), "utf8");
const localOpenApi = readFileSync(new URL("./openapi.gpt-action.local-connector.yaml", import.meta.url), "utf8");
const platformOpenApi = readFileSync(new URL("./openapi.yaml", import.meta.url), "utf8");

assert.match(localRuntime, /delegation_approved/);
assert.match(localRuntime, /manual_api/);
assert.match(localRuntime, /installation_approved/);
assert.match(localRuntime, /model_installation_approved/);
assert.match(localRuntime, /installModel/);
assert.match(localRuntime, /settings_update_approved/);
assert.match(localRuntime, /automatic_delegation_allowed: false/);
assert.match(localRuntime, /platform_managed/);
assert.match(localRuntime, /huggingface\.co\/spaces\/hf-accelerate\/model-memory-usage/);
assert.match(localRuntime, /ollama\.com\/library/);
assert.match(connector, /url === '\/agent-runtime'/);
assert.match(proxy, /"\/connector\/:device_id\/agent-runtime"/);
assert.match(migration, /tenant_platform_endpoint_tools/);
assert.match(migration, /connector_agent_runtime/);
assert.match(migration, /local\.connector\.agent_runtime/);
assert.match(localOpenApi, /\/agent-runtime:/);
assert.match(platformOpenApi, /\/connector\/\{device_id\}\/agent-runtime:/);

let request = null;
const callModel = buildCallModel({
  provider: "ollama",
  model: "qwen3:4b",
  base_url: "http://127.0.0.1:11434",
  fetch: async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      json: async () => ({
        message: { content: "LOCAL_OK", tool_calls: [] },
        prompt_eval_count: 3,
        eval_count: 2,
      }),
    };
  },
});
const result = await callModel([{ role: "user", content: "test" }], []);
assert.equal(result.content, "LOCAL_OK");
assert.equal(result.provider_key, "ollama");
assert.equal(result.tokens_used, 5);
assert.equal(request.url, "http://127.0.0.1:11434/api/chat");

console.log("hybrid local/managed agent runtime tests passed");
