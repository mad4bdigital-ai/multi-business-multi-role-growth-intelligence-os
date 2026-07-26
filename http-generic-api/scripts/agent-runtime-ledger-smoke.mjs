#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import { runLogicWithModel } from "../modelAdapter.js";

function parseArgs(argv = process.argv.slice(2)) {
  const args = { mode: "smoke" };
  for (const item of argv) {
    if (item === "--json") args.json = true;
    else throw new Error(`Unsupported argument: ${item}`);
  }
  return args;
}

async function countLedger(traceId) {
  const [[modelRows]] = await getPool().query(
    `SELECT COUNT(*) AS row_count,
            SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed_count,
            SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(input_message_summary_json,'$.raw_content_stored')) = 'false' THEN 1 ELSE 0 END) AS no_raw_input_count,
            SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(output_message_summary_json,'$.raw_content_stored')) = 'false' THEN 1 ELSE 0 END) AS no_raw_output_count,
            SUM(CASE WHEN no_raw_thinking_stored = 1 THEN 1 ELSE 0 END) AS no_raw_thinking_count
       FROM agent_model_runs
      WHERE trace_id = ?`,
    [traceId]
  );
  const [[toolRows]] = await getPool().query(
    `SELECT COUNT(*) AS row_count,
            SUM(CASE WHEN authorization_status='authorized' THEN 1 ELSE 0 END) AS authorized_count,
            SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(input_summary_json,'$.raw_args_stored')) = 'false' THEN 1 ELSE 0 END) AS no_raw_args_count,
            SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(output_summary_json,'$.raw_result_stored')) = 'false' THEN 1 ELSE 0 END) AS no_raw_result_count,
            SUM(CASE WHEN secrets_returned_to_model = 0 THEN 1 ELSE 0 END) AS no_secret_return_count
       FROM agent_tool_calls
      WHERE trace_id = ?`,
    [traceId]
  );
  return { model: modelRows, tool: toolRows };
}

function buildFakeCallModel() {
  let callCount = 0;
  const callModel = async (messages, tools = []) => {
    callCount += 1;
    const hasToolMessage = Array.isArray(messages) && messages.some((msg) => msg?.role === "tool");
    if (callCount === 1 && !hasToolMessage) {
      return {
        content: "",
        tool_calls: [{
          id: "ledger_smoke_tool_call_1",
          type: "function",
          function: { name: "ledger_smoke_readonly_tool", arguments: JSON.stringify({ probe: "ledger_smoke", tool_count: tools.length }) },
        }],
        tokens_used: 0,
        provider_key: "fake_ledger_smoke_provider",
        model_key: "fake_ledger_smoke_model",
      };
    }
    return {
      content: "Agent ledger smoke completed.",
      tool_calls: [],
      tokens_used: 0,
      provider_key: "fake_ledger_smoke_provider",
      model_key: "fake_ledger_smoke_model",
    };
  };
  callModel.provider_key = "fake_ledger_smoke_provider";
  callModel.providerKey = "fake_ledger_smoke_provider";
  callModel.model_key = "fake_ledger_smoke_model";
  callModel.modelKey = "fake_ledger_smoke_model";
  return callModel;
}

async function main() {
  parseArgs();
  const decisionRunId = `agent_ledger_smoke:${randomUUID()}`;
  const result = await runLogicWithModel({
    logic_key: "agent_runtime_ledger_smoke",
    logic_body: {
      trigger_phrase: "agent ledger smoke",
      action_class: "diagnostic",
      execution_layer: "agent_runtime_ledger",
      system_prompt: "Exercise agent runtime ledger with a fake model and read-only fake tool. Do not call providers.",
    },
    user_input: "Run a no-side-effect ledger smoke.",
    context: { decision_run_id: decisionRunId, run_id: decisionRunId, source: "agent_runtime_ledger_smoke", secrets_included: false },
    tools: [{ type: "function", function: { name: "ledger_smoke_readonly_tool", description: "No-side-effect ledger smoke tool", parameters: { type: "object", properties: { probe: { type: "string" }, tool_count: { type: "number" } } } } }],
    max_iterations: 3,
  }, {
    provider_key: "fake_ledger_smoke_provider",
    model_key: "fake_ledger_smoke_model",
    callModel: buildFakeCallModel(),
    dispatchTool: async (name, args, context) => ({ ok: true, tool_name: name, arg_key_count: Object.keys(args || {}).length, context_source: context?.source || null, side_effects: false, secrets_included: false }),
  });

  const counts = await countLedger(result.execution_trace_id);
  const ok = result.ok === true
    && Number(counts.model?.row_count || 0) >= 2
    && Number(counts.tool?.row_count || 0) >= 1
    && Number(counts.model?.no_raw_input_count || 0) >= 2
    && Number(counts.model?.no_raw_output_count || 0) >= 2
    && Number(counts.model?.no_raw_thinking_count || 0) >= 2
    && Number(counts.tool?.no_raw_args_count || 0) >= 1
    && Number(counts.tool?.no_raw_result_count || 0) >= 1
    && Number(counts.tool?.no_secret_return_count || 0) >= 1;

  console.log(JSON.stringify({
    ok,
    smoke: "agent_runtime_ledger_smoke",
    decision_run_id: decisionRunId,
    execution_trace_id: result.execution_trace_id,
    model_rows: counts.model,
    tool_rows: counts.tool,
    provider_dispatch_used: false,
    external_model_called: false,
    side_effects: false,
    raw_prompt_stored: false,
    raw_tool_args_stored: false,
    raw_tool_result_stored: false,
    secrets_included: false,
  }, null, 2));
  process.exit(ok ? 0 : 2);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: { code: error.code || "agent_runtime_ledger_smoke_failed", message: error.message }, provider_dispatch_used: false, external_model_called: false, secrets_included: false }, null, 2));
  process.exit(1);
});
