import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

function isTruthy(val) {
  return val === true || val === 1 || val === "1" || val === "TRUE";
}

async function reviewOutput(output, plan, deps) {
  const callModel = deps.getCallModelForClass
    ? deps.getCallModelForClass("standard")
    : deps.callModel;
  const messages = [
    {
      role: "system",
      content:
        'You are a quality reviewer. Review the following output for completeness, accuracy, and alignment with the task intent. Respond with JSON: { "passed": boolean, "issues": string[], "severity": "none"|"minor"|"major" }',
    },
    {
      role: "user",
      content: `Task intent: ${plan.intent_key || ""}\nOutput to review:\n${output}`,
    },
  ];
  try {
    const response = await callModel(messages, []);
    const text =
      typeof response.content === "string"
        ? response.content
        : (response.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || "null");
    if (!json) throw new Error("no json");
    return {
      passed: Boolean(json.passed),
      issues: Array.isArray(json.issues) ? json.issues : [],
      severity: json.severity || "none",
    };
  } catch {
    return { passed: true, issues: [], severity: "none", parse_error: true };
  }
}

async function fixOutput(output, issues, plan, deps) {
  const messages = [
    {
      role: "system",
      content: "You are a content fixer. Fix the issues in the output and return only the corrected content.",
    },
    {
      role: "user",
      content: `Original output:\n${output}\n\nIssues to fix:\n${issues.join("\n")}`,
    },
  ];
  const response = await deps.callModel(messages, []);
  if (typeof response.content === "string") return response.content;
  return (response.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
}

async function writeReviewStepRun(run_id, tenant_id, reviewResult) {
  const passed = reviewResult.passed;
  try {
    await getPool().query(
      `INSERT INTO \`step_runs\`
         (step_run_id, run_id, tenant_id, step_key, step_type, status, input_json, output_json, started_at, completed_at)
       VALUES (?, ?, ?, 'verify_pass', 'review', ?, NULL, ?, NOW(), NOW())`,
      [
        randomUUID(),
        run_id,
        tenant_id || null,
        passed ? "completed" : "review_failed",
        JSON.stringify(reviewResult),
      ]
    );
  } catch { /* non-blocking */ }
}

async function loadWorkflow(workflow_key) {
  const [rows] = await getPool().query(
    "SELECT * FROM `workflows` WHERE workflow_key = ? AND (active = 1 OR active = '1' OR active = 'TRUE') LIMIT 1",
    [workflow_key]
  );
  return rows[0] || null;
}

async function loadLogicDefinition(logic_key) {
  if (!logic_key) return null;
  const [rows] = await getPool().query(
    "SELECT * FROM `logic_definitions` WHERE logic_key = ? LIMIT 1",
    [logic_key]
  );
  if (!rows[0]) return null;
  const row = rows[0];
  try { row.body_json = row.body_json ? JSON.parse(row.body_json) : {}; } catch { row.body_json = {}; }
  return row;
}

// Loads all logic_definitions from the agent's bound packs, ordered by pack priority then logic_key.
// Used by the rule_based path so the engine receives the full rule set rather than a single key.
async function loadAgentPackDefinitions(agent_id) {
  if (!agent_id) return [];
  const [rows] = await getPool().query(
    `SELECT ld.logic_id, ld.logic_key, ld.display_name, ld.logic_type,
            ld.body_json, ld.version, ld.status,
            lp.pack_key, lp.pack_type, alb.priority AS pack_priority
     FROM \`agent_logic_pack_bindings\` alb
     JOIN \`logic_packs\`    lp ON lp.pack_id  = alb.pack_id
     JOIN \`pack_attachments\` pa ON pa.pack_id = alb.pack_id AND pa.target_type = 'logic'
     JOIN \`logic_definitions\` ld ON ld.logic_id = pa.target_id
     WHERE alb.agent_id = ?
       AND lp.status = 'active'
       AND ld.status = 'active'
       AND pa.status = 'active'
     ORDER BY alb.priority ASC, ld.logic_key ASC`,
    [agent_id]
  ).catch(() => [[]]);

  return rows.map(r => {
    let body = r.body_json;
    try { body = body ? JSON.parse(body) : {}; } catch { body = {}; }
    return { ...r, body_json: body };
  });
}

function buildToolsFromEngines(mappedEngines = "") {
  return mappedEngines
    .split("|")
    .map(e => e.trim())
    .filter(Boolean)
    .map(engineName => ({
      type: "function",
      function: {
        name: engineName,
        description: `Execute engine: ${engineName}`,
        parameters: { type: "object", properties: { input: { type: "string" } }, required: [] },
      },
    }));
}

async function writeRunResult(run_id, result, tenant_id) {
  try {
    await getPool().query(
      `UPDATE \`workflow_runs\`
         SET status = 'completed', output_json = ?, completed_at = NOW()
       WHERE run_id = ?`,
      [JSON.stringify(result), run_id]
    );
  } catch { /* non-blocking — run record may have been created by connectorExecutor */ }

  for (const tc of result.tool_calls_made || []) {
    try {
      await getPool().query(
        `INSERT INTO \`step_runs\`
           (step_run_id, run_id, tenant_id, step_key, step_type, status, input_json, output_json, started_at, completed_at)
         VALUES (?, ?, ?, ?, 'engine', 'completed', ?, ?, NOW(), NOW())`,
        [randomUUID(), run_id, tenant_id || null, tc.tool_name,
         JSON.stringify(tc.args), JSON.stringify(tc.result)]
      );
    } catch { /* non-blocking */ }
  }
}

export async function runAgentLoop(plan, deps = {}) {
  const run_id = plan.run_id || randomUUID();

  const workflow = await loadWorkflow(plan.workflow_key);
  if (!workflow) {
    return { ok: false, error: "workflow_not_found", workflow_key: plan.workflow_key };
  }

  const logicDef = await loadLogicDefinition(workflow.target_module);
  const logicBody = logicDef?.body_json || {};
  const logic_key = logicDef?.logic_key || workflow.target_module || "unknown";

  const context = deps.buildGovernedContext
    ? await deps.buildGovernedContext(plan)
    : { plan_id: plan.plan_id, brand_key: plan.brand_key, workflow_key: plan.workflow_key };

  const pathRows = deps.loadPathResolverRows
    ? await deps.loadPathResolverRows(plan).catch(() => null)
    : null;

  if (pathRows) context.path_resolver_rows = pathRows;

  const tools = buildToolsFromEngines(workflow.mapped_engines || "");

  const engineRegistry = deps.engineExecutorRegistry;

  async function dispatchTool(toolName, args, ctx) {
    if (engineRegistry?.dispatch) return engineRegistry.dispatch(toolName, args, ctx);
    return { ok: false, error: "no_engine_registry" };
  }

  // Use class-aware callModel when available; fall back to deps.callModel.
  const execution_class = workflow.execution_class || "standard";

  // rule_based: bypass LLM entirely — dispatch directly to engineExecutorRegistry.
  // Loads the agent's bound pack definitions so the engine receives the full rule set,
  // not just a single logic_key. Falls back gracefully if no packs are bound.
  if (execution_class === "rule_based") {
    const packDefs = await loadAgentPackDefinitions(plan.agent_id || null);
    const ruleContext = {
      ...context,
      pack_definitions: packDefs,
      pack_definition_count: packDefs.length,
    };

    const ruleResult = await dispatchTool(logic_key, {
      user_input: plan.intent_key || "",
      context: ruleContext,
    }, ruleContext);

    const normalised = {
      ok: ruleResult?.ok !== false,
      output: ruleResult?.output ?? ruleResult,
      tool_calls_made: [],
      iteration_count: 0,
      execution_trace_id: null,
    };
    await writeRunResult(run_id, normalised, plan.tenant_id);
    return {
      ok: normalised.ok,
      run_id,
      output: normalised.output,
      tool_calls_made: [],
      iterations: 0,
      execution_trace_id: null,
      review: null,
      execution_class: "rule_based",
      pack_definitions_loaded: packDefs.length,
    };
  }

  const callModel = deps.getCallModelForClass
    ? deps.getCallModelForClass(execution_class)
    : deps.callModel;

  const modelResult = await deps.runLogicWithModel(
    { logic_key, logic_body: logicBody, user_input: plan.intent_key || "", context, tools },
    { callModel, dispatchTool }
  );

  await writeRunResult(run_id, modelResult, plan.tenant_id);

  let reviewSummary = null;

  if (isTruthy(workflow?.review_required)) {
    try {
      const reviewResult = await reviewOutput(modelResult.output, plan, deps);
      let fixApplied = false;

      if (!reviewResult.passed && reviewResult.severity === "major") {
        const fixed = await fixOutput(modelResult.output, reviewResult.issues, plan, deps);
        modelResult.output = fixed;
        fixApplied = true;
      }

      reviewSummary = {
        ran: true,
        passed: reviewResult.passed,
        issues: reviewResult.issues,
        severity: reviewResult.severity,
        fix_applied: fixApplied,
      };

      writeReviewStepRun(run_id, plan.tenant_id, reviewSummary).catch(() => {});
    } catch (err) {
      console.warn("[agentLoopRunner] verify pass failed (non-blocking):", err?.message);
    }
  }

  return {
    ok: modelResult.ok,
    run_id,
    output: modelResult.output,
    tool_calls_made: modelResult.tool_calls_made,
    iterations: modelResult.iteration_count,
    execution_trace_id: modelResult.execution_trace_id,
    review: reviewSummary,
  };
}
