import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { loadWorkspaceAppContext } from "./appConnectionResolver.js";
import { evaluateAgentLoopPreflight, assertPreflightAllowed } from "./governedExecutionPreflight.js";
import { resolveSurfaceAuthority, SURFACE_KEYS } from "./surfaceAuthorityResolver.js";
import { resolveRuntimeWorkflow } from "./runtimeWorkflowResolver.js";
import { writeAuthorityBridgeDriftEvidence } from "./authorityBridgeEvidence.js";

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

async function loadBrandCoreEvidence(brand_key) {
  if (!brand_key) return null;
  const surfaceAuthority = await resolveSurfaceAuthority(SURFACE_KEYS.BRAND_CORE_REGISTRY, { requireExecution: true });
  const surfaceEvidence = {
    ok: surfaceAuthority.ok,
    resolved_surface_key: surfaceAuthority.resolved_surface_key,
    classification: surfaceAuthority.classification,
    code: surfaceAuthority.code,
    authority_status: surfaceAuthority.surface?.authority_status || null,
    required_for_execution: surfaceAuthority.surface?.required_for_execution || null,
    backend_type: surfaceAuthority.surface?.backend_type || null,
    backend_adapter: surfaceAuthority.surface?.backend_adapter || null,
    secrets_included: false,
  };
  if (!surfaceAuthority.ok) {
    return {
      ready: false,
      brand_key,
      document_count: 0,
      active_document_count: 0,
      valid_document_count: 0,
      surface_authority: surfaceEvidence,
      resolution_error: surfaceAuthority.code || "brand_core_surface_authority_failed",
      secrets_included: false,
    };
  }
  const [rows] = await getPool().query(
    `SELECT brand_key, brand_name, asset_key, asset_type, core_function,
            status, active_status, validation_status, priority, updated_at
       FROM \`brand_core\`
      WHERE brand_key = ?
        AND COALESCE(active_status, status, 'active') NOT IN ('archived','inactive','disabled','archived_placeholder')
      ORDER BY CAST(COALESCE(NULLIF(priority,''), '0') AS UNSIGNED) DESC, updated_at DESC
      LIMIT 25`,
    [brand_key]
  ).catch(() => [[]]);
  if (!rows.length) {
    return {
      ready: false,
      brand_key,
      document_count: 0,
      active_document_count: 0,
      valid_document_count: 0,
      surface_authority: surfaceEvidence,
      resolution_error: "brand_core_rows_not_found",
      secrets_included: false,
    };
  }
  const activeRows = rows.filter(row => isTruthy(row.active_status) || isTruthy(row.status) || ['active', 'valid', 'validated'].includes(String(row.active_status || row.status || '').toLowerCase()));
  const validRows = rows.filter(row => ['active', 'valid', 'validated'].includes(String(row.validation_status || '').toLowerCase()));
  return {
    ready: true,
    brand_key,
    brand_name: rows[0]?.brand_name || null,
    document_count: rows.length,
    active_document_count: activeRows.length || rows.length,
    valid_document_count: validRows.length,
    validation_statuses: [...new Set(rows.map(row => String(row.validation_status || '').trim()).filter(Boolean))].slice(0, 8),
    asset_types: [...new Set(rows.map(row => String(row.asset_type || '').trim()).filter(Boolean))].slice(0, 12),
    core_functions: [...new Set(rows.map(row => String(row.core_function || '').trim()).filter(Boolean))].slice(0, 12),
    latest_updated_at: rows[0]?.updated_at || null,
    surface_authority: surfaceEvidence,
    secrets_included: false,
  };
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

  const workflowResolution = await resolveRuntimeWorkflow({
    workflow_id: plan.workflow_id,
    workflow_key: plan.workflow_key,
  });
  if (!workflowResolution.ok) {
    return {
      ok: false,
      error: workflowResolution.resolution.code,
      workflow_id: plan.workflow_id || null,
      workflow_key: plan.workflow_key || null,
      resolution: workflowResolution.resolution,
    };
  }
  const workflow = workflowResolution.workflow;

  const logicDef = await loadLogicDefinition(workflow.target_module);
  const logicBody = logicDef?.body_json || {};
  const logic_key = logicDef?.logic_key || workflow.target_module || "unknown";

  const context = deps.buildGovernedContext
    ? await deps.buildGovernedContext(plan)
    : { plan_id: plan.plan_id, brand_key: plan.brand_key, workflow_key: plan.workflow_key };
  if (context.authority_bridge?.blocker_count > 0) {
    context.authority_bridge.drift_evidence = await writeAuthorityBridgeDriftEvidence(
      { ...plan, run_id },
      context.authority_bridge,
      { pool: deps.pool, writeExecutionEvidence: deps.writeExecutionEvidence }
    );
  }
  if (context.authority_bridge?.allowed === false) {
    return {
      ok: false,
      error: "governed_agent_execution_authority_denied",
      plan_id: plan.plan_id || null,
      authority_bridge: context.authority_bridge,
      secrets_included: false,
    };
  }

  const pathRows = deps.loadPathResolverRows
    ? await deps.loadPathResolverRows(plan).catch(() => null)
    : null;

  if (pathRows) context.path_resolver_rows = pathRows;

  const brandCoreEvidence = await loadBrandCoreEvidence(plan.brand_key || plan.target_key).catch((error) => ({
    ready: false,
    brand_key: plan.brand_key || plan.target_key || null,
    resolution_error: error?.code || "brand_core_evidence_lookup_failed",
    secrets_included: false,
  }));
  context.brand_core_lookup = brandCoreEvidence;
  if (brandCoreEvidence?.ready) {
    context.brand_core = brandCoreEvidence;
    context.brand_core_resolved = true;
  } else {
    context.brand_core_surface_authority = brandCoreEvidence?.surface_authority || null;
    context.brand_core_resolution_error = brandCoreEvidence?.resolution_error || "brand_core_evidence_not_resolved";
    context.brand_core_resolved = false;
  }

  // Inject workspace app-connection context when a workspace_key is present.
  // connected_apps lists metadata + allowed_actions per connection — no tokens.
  if (plan.workspace_key && plan.tenant_id) {
    const appCtx = await loadWorkspaceAppContext(
      plan.workspace_key, plan.tenant_id, plan.agent_id || null
    ).catch(() => ({ connected_apps: [] }));
    context.workspace_app_connections = appCtx.connected_apps;
    context.workspace_app_connection_count = appCtx.connected_apps.length;
  }

  const tools = buildToolsFromEngines(workflow.mapped_engines || "");

  const execution_class = workflow.execution_class || "standard";
  assertPreflightAllowed(await evaluateAgentLoopPreflight({
    plan,
    workflow,
    logicKey: logic_key,
    executionClass: execution_class,
    toolCount: tools.length,
    context,
  }));

  const engineRegistry = deps.engineExecutorRegistry;

  async function dispatchTool(toolName, args, ctx) {
    if (engineRegistry?.dispatch) return engineRegistry.dispatch(toolName, args, ctx);
    return { ok: false, error: "no_engine_registry" };
  }

  // Use class-aware callModel when available; fall back to deps.callModel.

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
