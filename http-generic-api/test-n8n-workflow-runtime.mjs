import assert from "node:assert/strict";
import {
  callN8nWorkflowBinding,
  normalizeWorkflowRuntimeBinding,
  redactWorkflowRuntimeBinding,
  runN8nWorkflowRuntime,
  upsertWorkflowRuntimeBinding,
  validateBasicJsonSchema,
} from "./n8nWorkflowRuntime.js";

function makePool(bindingRows = []) {
  const state = { calls: [], bindingRows, upsertParams: null, runs: [] };
  return {
    state,
    async query(sql, params = []) {
      state.calls.push({ sql, params });
      if (String(sql).includes("FROM `workflow_runtime_bindings`")) return [state.bindingRows, []];
      if (String(sql).includes("INSERT INTO `workflow_runtime_bindings`")) {
        state.upsertParams = params;
        return [{ affectedRows: 1 }, []];
      }
      if (String(sql).includes("INSERT INTO `workflow_runs`")) {
        state.runs.push({ action: "insert", params });
        return [{ affectedRows: 1 }, []];
      }
      if (String(sql).includes("UPDATE `workflow_runs`")) {
        state.runs.push({ action: "update", params });
        return [{ affectedRows: 1 }, []];
      }
      return [[], []];
    },
  };
}

{
  const schema = { type: "object", required: ["prompt"], properties: { prompt: { type: "string" }, count: { type: "integer" } } };
  assert.equal(validateBasicJsonSchema(schema, { prompt: "x", count: 1 }).ok, true);
  assert.equal(validateBasicJsonSchema(schema, { count: 1 }).ok, false);
  assert.equal(validateBasicJsonSchema(schema, { prompt: "x", count: 1.5 }).error.code, "input_schema_property_type_mismatch");
}

{
  const binding = normalizeWorkflowRuntimeBinding({
    binding_key: "classify_v1",
    workflow_key: "classification",
    runtime_type: "n8n",
    task_class: "classification",
    n8n_webhook_path: "/webhook/classify",
    auth_mode: "bearer_env",
    credential_env_var: "N8N_WEBHOOK_TOKEN",
    input_schema_json: JSON.stringify({ type: "object", required: ["text"] }),
  });
  assert.equal(binding.binding_key, "classify_v1");
  assert.deepEqual(binding.input_schema_json.required, ["text"]);
  const redacted = redactWorkflowRuntimeBinding({ ...binding, n8n_webhook_url: "https://x.test/webhook?api_key=secret" });
  assert.equal(redacted.secrets_included, false);
  assert(!redacted.n8n_webhook_url.includes("secret"));
}

{
  const calls = [];
  const binding = normalizeWorkflowRuntimeBinding({
    binding_key: "classify_v1",
    workflow_key: "classification",
    runtime_type: "n8n",
    task_class: "classification",
    n8n_webhook_path: "/webhook/classify",
    auth_mode: "bearer_env",
    credential_env_var: "N8N_WEBHOOK_TOKEN",
    input_schema_json: { type: "object", required: ["text"], properties: { text: { type: "string" } } },
    output_schema_json: { type: "object", required: ["label"] },
  });
  const result = await callN8nWorkflowBinding({
    binding,
    input: { text: "please edit this image" },
    run_id: "run-1",
    tenant_id: "tenant-1",
    user_id: "user-1",
    env: { N8N_WEBHOOK_BASE_URL: "https://n8n.test", N8N_WEBHOOK_TOKEN: "token-1" },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify({ label: "image_edit", confidence: 0.98 }); },
      };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.result.label, "image_edit");
  assert.equal(calls[0].url, "https://n8n.test/webhook/classify");
  assert.equal(calls[0].options.headers.Authorization, "Bearer token-1");
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.task_class, "classification");
  assert.equal(payload.governance.secrets_included, false);
}

{
  const binding = normalizeWorkflowRuntimeBinding({
    binding_key: "classify_v1",
    workflow_key: "classification",
    runtime_type: "n8n",
    n8n_webhook_url: "https://n8n.test/webhook/classify",
    auth_mode: "none",
    input_schema_json: { type: "object", required: ["text"] },
  });
  await assert.rejects(
    () => callN8nWorkflowBinding({ binding, input: {}, fetchImpl: async () => ({ ok: true, status: 200, text: async () => "{}" }) }),
    /input.text is required/
  );
}

{
  const pool = makePool();
  const result = await upsertWorkflowRuntimeBinding({
    pool,
    binding: {
      binding_key: "summary_v1",
      workflow_key: "session_summary_autosweep",
      runtime_type: "n8n",
      task_class: "summary",
      n8n_webhook_path: "/webhook/summary",
      input_schema_json: { type: "object" },
    },
  });
  assert.equal(result.ok, true);
  assert(pool.state.upsertParams, "upsert should write params");
  assert(!JSON.stringify(pool.state.upsertParams).includes("Bearer"));
}

{
  const pool = makePool([
    {
      binding_key: "classify_v1",
      workflow_key: "classification",
      runtime_type: "n8n",
      task_class: "classification",
      n8n_webhook_url: "https://n8n.test/webhook/classify",
      auth_mode: "none",
      input_schema_json: JSON.stringify({ type: "object", required: ["text"] }),
      output_schema_json: JSON.stringify({ type: "object", required: ["label"] }),
      status: "active",
    },
  ]);
  const result = await runN8nWorkflowRuntime({
    pool,
    binding_key: "classify_v1",
    tenant_id: "tenant-1",
    input: { text: "route this" },
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ label: "summary" }) }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.result.label, "summary");
  assert(pool.state.runs.some((r) => r.action === "insert"), "workflow_run insert should be attempted");
  assert(pool.state.runs.some((r) => r.action === "update"), "workflow_run update should be attempted");
}

console.log("n8n workflow runtime tests passed");
