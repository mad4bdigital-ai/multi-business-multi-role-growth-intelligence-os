/**
 * connectorExecutor.js — Sprint 09: Connector Execution Bridge
 *
 * Bridges execution_plans to the connector execution layer.
 * Takes an approved/validated plan and dispatches it to:
 *   - WordPress connector (runWordpressConnectorMigration) for brands with
 *     auth_type = basic_auth_app_password or connector_family = wordpress
 *   - Content workflow dispatcher (async stub) for AI/content generation workflows
 *
 * Records execution state in: workflow_runs, step_runs, telemetry_spans, audit_log.
 */

import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { resolveWpAppPassword, resolveSecretFromReference } from "./authCredentialResolution.js";
import { runWordpressConnectorMigration } from "./wordpress/phaseA.js";
import { writeAuditLogAsync } from "./auditLogger.js";
import { runAgentLoop } from "./agentLoopRunner.js";
import { getAgentDeps } from "./agentRuntime.js";
import { routeOutput }  from "./outputSinkRouter.js";

const EXECUTABLE_DECISIONS = new Set([
  "ALLOW_SELF_SERVE",
  "ALLOW_WITH_OPTIONAL_ASSISTANCE",
]);

const EXECUTABLE_PLAN_STATUSES = new Set(["validated", "approved"]);

// ── Loaders ───────────────────────────────────────────────────────────────────

async function loadPlan(plan_id) {
  const [rows] = await getPool().query(
    "SELECT * FROM `execution_plans` WHERE plan_id = ? LIMIT 1",
    [plan_id]
  );
  if (!rows.length) return null;
  const p = rows[0];
  for (const f of ["steps_json", "validation_errors"]) {
    if (p[f]) try { p[f] = JSON.parse(p[f]); } catch {}
  }
  return p;
}

async function loadBrand(brand_key) {
  if (!brand_key) return null;
  const [rows] = await getPool().query(
    `SELECT brand_name, brand_domain, target_key, auth_type, username,
            application_password, default_wp_api_base, write_allowed, destructive_allowed
     FROM \`brands\` WHERE target_key = ? OR normalized_brand_name = ? LIMIT 1`,
    [brand_key, brand_key]
  );
  return rows[0] || null;
}

async function loadConnectedSystem(tenant_id, brand_key) {
  if (!tenant_id || !brand_key) return null;
  const [rows] = await getPool().query(
    `SELECT system_id, system_key, connector_family, provider_domain, status
     FROM \`connected_systems\`
     WHERE tenant_id = ? AND (system_key = ? OR system_key LIKE ?) AND status = 'active' LIMIT 1`,
    [tenant_id, brand_key, `%${brand_key}%`]
  );
  return rows[0] || null;
}

async function loadWorkflowDef(workflow_key) {
  if (!workflow_key) return null;
  const [rows] = await getPool().query(
    `SELECT workflow_key, execution_mode, execution_class, target_module, review_required
     FROM \`workflows\`
     WHERE workflow_key = ? AND (active = 1 OR active = 'TRUE' OR active = '1') LIMIT 1`,
    [workflow_key]
  );
  return rows[0] || null;
}

async function loadAction(action_key) {
  if (!action_key) return null;
  const [rows] = await getPool().query(
    "SELECT action_key, runtime_capability_class FROM `actions` WHERE action_key = ? LIMIT 1",
    [action_key]
  );
  return rows[0] || null;
}

// ── WordPress context builder ─────────────────────────────────────────────────

function buildWpContext(brand) {
  const appPassword = resolveWpAppPassword(brand);
  const baseUrl = brand.default_wp_api_base
    || (brand.brand_domain ? `https://${brand.brand_domain}/wp-json/wp/v2` : null);
  if (!baseUrl) return null;

  return {
    destination: {
      url: baseUrl,
      brand_name: brand.brand_name,
      auth: {
        type: "basic_auth",
        username: brand.username || "gpt",
        password: appPassword,
      },
      settings: { permalink_structure: "/%postname%/" },
      runtime: { supported_cpts: [] },
      plugins: { active_plugins: [] },
      write_allowed:
        brand.write_allowed === 1 || brand.write_allowed === "1" || brand.write_allowed === "TRUE",
      destructive_allowed:
        brand.destructive_allowed === 1 || brand.destructive_allowed === "TRUE",
    },
  };
}

// ── DB write helpers (all non-throwing) ──────────────────────────────────────

async function createWorkflowRun(run_id, plan, service_mode) {
  // Resolve agent_id from execution plan if not already on plan object
  let agent_id = plan.agent_id || null;
  if (!agent_id && plan.plan_id) {
    const [planRow] = await getPool().query(
      "SELECT agent_id FROM `execution_plans` WHERE plan_id = ? LIMIT 1", [plan.plan_id]
    ).catch(() => [[]]);
    agent_id = planRow[0]?.agent_id || null;
  }

  await getPool().query(
    `INSERT INTO \`workflow_runs\`
       (run_id, tenant_id, user_id, workflow_key, agent_id, plan_id, service_mode, status, input_json, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, NOW())`,
    [
      run_id,
      plan.tenant_id || null,
      plan.user_id || null,
      plan.workflow_key || "connector_dispatch",
      agent_id,
      plan.plan_id,
      service_mode || "self_serve",
      JSON.stringify({ brand_key: plan.brand_key, target_key: plan.target_key, intent_key: plan.intent_key }),
    ]
  );
}

async function finaliseWorkflowRun(run_id, final_status, output, error_msg) {
  await getPool().query(
    `UPDATE \`workflow_runs\`
       SET status = ?, output_json = ?, error_json = ?,
           completed_at = IF(? IN ('completed','failed','cancelled'), NOW(), NULL)
     WHERE run_id = ?`,
    [
      final_status,
      output ? JSON.stringify(output) : null,
      error_msg ? JSON.stringify({ message: error_msg }) : null,
      final_status,
      run_id,
    ]
  );
}

async function createStepRun(run_id, tenant_id, step_key, status, input, output, error_msg) {
  try {
    await getPool().query(
      `INSERT INTO \`step_runs\`
         (step_run_id, run_id, tenant_id, step_key, step_type, status, input_json, output_json, error_message, started_at, completed_at)
       VALUES (?, ?, ?, ?, 'action', ?, ?, ?, ?, NOW(), NOW())`,
      [
        randomUUID(), run_id, tenant_id || null, step_key, status,
        input ? JSON.stringify(input) : null,
        output ? JSON.stringify(output) : null,
        error_msg || null,
      ]
    );
  } catch { /* non-blocking */ }
}

async function createSpan(trace_id, run_id, span_name, status, duration_ms, tenant_id, attrs) {
  try {
    await getPool().query(
      `INSERT INTO \`telemetry_spans\`
         (span_id, trace_id, run_id, tenant_id, span_name, span_type, status, duration_ms, attributes_json, started_at)
       VALUES (?, ?, ?, ?, ?, 'internal', ?, ?, ?, NOW())`,
      [randomUUID(), trace_id, run_id, tenant_id || null, span_name, status, duration_ms || 0, JSON.stringify(attrs || {})]
    );
  } catch { /* non-blocking */ }
}

// ── Dispatcher implementations ────────────────────────────────────────────────

async function dispatchWordpress(plan, brand, wpContext, options) {
  const { apply = false, post_types = ["post"], publish_status = "draft" } = options;
  return runWordpressConnectorMigration({
    payload: {
      migration: {
        apply,
        post_types,
        publish_status,
        brand_key: plan.brand_key || null,
        target_key: plan.target_key || null,
      },
    },
    wpContext,
    mutationPlan: { workflow_key: plan.workflow_key, intent_key: plan.intent_key, plan_id: plan.plan_id },
    writebackPlan: { enabled: false },
  });
}

async function dispatchContentWorkflow(plan, workflowDef, deps = {}) {
  return runAgentLoop(plan, {
    ...getAgentDeps(),
    ...deps,
    workflowDef,
  });
}

async function dispatchMcpConnector(plan) {
  // Resolve the bearer token from the make_mcp_server action's secret reference.
  // Falls back to MAKE_MCP_TOKEN env var directly if the action row isn't found.
  let token = process.env.MAKE_MCP_TOKEN || "";
  if (!token) {
    const [rows] = await getPool().query(
      "SELECT secret_store_ref FROM `actions` WHERE action_key = 'make_mcp_server' LIMIT 1"
    );
    if (rows[0]?.secret_store_ref) token = resolveSecretFromReference(rows[0].secret_store_ref);
  }
  if (!token) {
    throw new Error("MAKE_MCP_TOKEN not configured — set in .env and run patch-make-mcp-connector.mjs --apply");
  }

  // Build a JSON-RPC 2.0 tools/call envelope from the plan's first step.
  const steps = plan.steps_json || [];
  const step = Array.isArray(steps) ? steps[0] : null;
  const toolName = step?.tool || step?.action || plan.intent_key || "tools/list";
  const toolArgs = step?.arguments || step?.params || {};

  const rpcBody = {
    jsonrpc: "2.0",
    id: randomUUID(),
    method: "tools/call",
    params: { name: toolName, arguments: toolArgs },
  };

  const resp = await fetch("https://eu2.make.com/mcp/stateless", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify(rpcBody),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Make MCP returned HTTP ${resp.status}: ${errText.slice(0, 300)}`);
  }

  let data;
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("event-stream")) {
    // SSE transport: collect all data: lines and parse the last one.
    const text = await resp.text();
    const dataLines = text.split("\n").filter(l => l.startsWith("data:"));
    if (!dataLines.length) throw new Error("Make MCP SSE: no data lines in response");
    data = JSON.parse(dataLines[dataLines.length - 1].slice(5).trim());
  } else {
    data = await resp.json();
  }

  if (data.error) {
    throw new Error(`MCP error [${data.error.code}]: ${data.error.message}`);
  }

  return {
    ok: true,
    dispatch_mode: "sync",
    rpc_id: rpcBody.id,
    tool: toolName,
    mcp_response: data.result ?? data,
  };
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function dispatchPlan(plan_id, {
  apply = false,
  post_types = ["post"],
  publish_status = "draft",
  actor_id = null,
  deps = {},
} = {}) {
  const t0 = Date.now();
  const trace_id = randomUUID();
  const run_id   = randomUUID();

  const plan = await loadPlan(plan_id);
  if (!plan) {
    return { ok: false, error: { code: "plan_not_found", message: `Plan ${plan_id} not found.` } };
  }

  if (!EXECUTABLE_PLAN_STATUSES.has(plan.plan_status)) {
    return {
      ok: false,
      error: {
        code: "plan_not_executable",
        message: `Plan '${plan.plan_status}' is not executable. Advance to validated or approved first.`,
      },
    };
  }

  if (plan.access_decision && !EXECUTABLE_DECISIONS.has(plan.access_decision)) {
    return {
      ok: false,
      error: {
        code: "access_denied",
        message: `Access decision '${plan.access_decision}' requires human approval before execution.`,
        access_decision: plan.access_decision,
      },
    };
  }

  const [brand, connectedSystem, workflowDef, actionRow] = await Promise.all([
    loadBrand(plan.brand_key || plan.target_key),
    loadConnectedSystem(plan.tenant_id, plan.brand_key || plan.target_key),
    loadWorkflowDef(plan.workflow_key),
    loadAction(plan.workflow_key || plan.intent_key),
  ]);

  const isWordpress =
    brand?.auth_type === "basic_auth_app_password" ||
    connectedSystem?.connector_family === "wordpress";

  // GAP 6: runtime_capability_class from actions table is authoritative when
  // connector_family is not set on the connected_systems row.
  const isMcp =
    connectedSystem?.connector_family === "make_mcp" ||
    (!connectedSystem && actionRow?.runtime_capability_class === "mcp_connector");

  const connector_type = isWordpress ? "wordpress" : isMcp ? "mcp_connector" : "content_workflow";
  const service_mode   = plan.service_mode || "self_serve";

  await createWorkflowRun(run_id, plan, service_mode);
  await getPool().query(
    "UPDATE `execution_plans` SET plan_status = 'executing' WHERE plan_id = ?",
    [plan_id]
  );

  // Skill gate: verify the agent is granted the skill required for this connector type.
  // Fails open (warns but proceeds) when the agent_skill_grants table is absent or empty,
  // so existing plans remain executable while skills are still being seeded.
  const CONNECTOR_SKILL_MAP = {
    wordpress:        "api.wordpress_write",
    mcp_connector:    "api.make_mcp",
    content_workflow: "logic.evaluate_pack",
  };
  const requiredSkill = CONNECTOR_SKILL_MAP[connector_type];
  if (requiredSkill && plan.agent_id) {
    try {
      const [skillRows] = await getPool().query(
        `SELECT sg.grant_id FROM \`agent_skill_grants\` sg
         JOIN \`agent_skills\` sk ON sk.skill_id = sg.skill_id
         WHERE sg.agent_id = ? AND sk.skill_key = ?
           AND sg.status = 'active' AND sk.status = 'active'
           AND (sg.tenant_id IS NULL OR sg.tenant_id = ?)
           AND (sg.expires_at IS NULL OR sg.expires_at > NOW())
         LIMIT 1`,
        [plan.agent_id, requiredSkill, plan.tenant_id]
      );
      if (!skillRows.length) {
        console.warn(
          `[connectorExecutor] skill gate: agent '${plan.agent_id}' lacks '${requiredSkill}' — proceeding (fail-open until grants are fully seeded)`
        );
      }
    } catch { /* non-blocking — never let skill check break execution */ }
  }

  let result, dispatchError;
  try {
    if (isWordpress) {
      const wpContext = buildWpContext(brand);
      if (!wpContext) {
        throw new Error(
          `Cannot build WordPress context for '${plan.brand_key || plan.target_key}'. ` +
          `Ensure brand_domain or default_wp_api_base is set and credentials are configured.`
        );
      }
      result = await dispatchWordpress(plan, brand, wpContext, { apply, post_types, publish_status });
    } else if (isMcp) {
      result = await dispatchMcpConnector(plan);
    } else {
      result = await dispatchContentWorkflow(plan, workflowDef, deps);
    }
  } catch (err) {
    dispatchError = err;
    result = { ok: false };
  }

  const duration_ms  = Date.now() - t0;
  const succeeded    = !dispatchError && result?.ok !== false;
  const final_status = succeeded
    ? (connector_type === "content_workflow" ? "running" : "completed")
    : "failed";
  // content_workflow is async (stays "running"); wordpress and mcp_connector are sync (→ "completed")

  await Promise.all([
    finaliseWorkflowRun(run_id, final_status, succeeded ? result : null, dispatchError?.message),
    createStepRun(
      run_id, plan.tenant_id,
      `connector_dispatch.${connector_type}`,
      succeeded ? "completed" : "failed",
      { plan_id, connector_type, apply },
      succeeded ? result : null,
      dispatchError?.message
    ),
    getPool().query(
      "UPDATE `execution_plans` SET plan_status = ? WHERE plan_id = ?",
      [succeeded ? "completed" : "failed", plan_id]
    ),
    createSpan(trace_id, run_id, `connector.${connector_type}`, succeeded ? "ok" : "error", duration_ms, plan.tenant_id, {
      plan_id, run_id, connector_type, apply, brand_key: plan.brand_key, workflow_key: plan.workflow_key,
    }),
  ]);

  // Route output to typed sinks (non-blocking — never fail the main response)
  if (succeeded && result?.output !== undefined) {
    routeOutput({
      run_id,
      agent_id:     plan.agent_id || null,
      tenant_id:    plan.tenant_id,
      brand_key:    plan.brand_key || null,
      workflow_key: plan.workflow_key || null,
      output:       result.output,
    }).catch(err => console.warn("[outputSinkRouter] non-fatal:", err?.message));
  }

  writeAuditLogAsync({
    actor_id: actor_id || plan.user_id || "system",
    actor_type: "system",
    action: "connector.dispatch",
    resource_type: "execution_plan",
    resource_id: plan_id,
    tenant_id: plan.tenant_id,
    outcome: succeeded ? "success" : "failure",
    metadata: { run_id, trace_id, connector_type, apply, duration_ms },
  });

  return {
    ok: succeeded,
    run_id,
    trace_id,
    plan_id,
    connector_type,
    plan_status: succeeded ? "completed" : "failed",
    apply,
    duration_ms,
    result: succeeded ? result : undefined,
    error: dispatchError
      ? { code: "dispatch_failed", message: dispatchError.message }
      : undefined,
  };
}
