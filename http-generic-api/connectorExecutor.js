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
import { evaluateConnectorDispatchPreflight, assertPreflightAllowed } from "./governedExecutionPreflight.js";
import { resolveRuntimeWorkflow } from "./runtimeWorkflowResolver.js";
import {
  dispatchWordpressBlogPublish,
  isWordpressBlogPublishWorkflow,
} from "./wordpressBlogPublishOrchestrator.js";

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

async function createWorkflowRun(run_id, trace_id, plan, service_mode) {
  // Resolve agent_id from execution plan if not already on plan object
  let agent_id = plan.agent_id || null;
  if (!agent_id && plan.plan_id) {
    const [planRow] = await getPool().query(
      "SELECT agent_id FROM `execution_plans` WHERE plan_id = ? LIMIT 1", [plan.plan_id]
    ).catch(() => [[]]);
    agent_id = planRow[0]?.agent_id || null;
  }

  const actorId = plan.user_id || null;
  const inputContext = {
    brand_key: plan.brand_key || null,
    target_key: plan.target_key || null,
    intent_key: plan.intent_key || null,
    workflow_id: plan.workflow_id || null,
    workflow_key: plan.workflow_key || null,
    trace_id,
    run_id,
    secrets_included: false,
  };
  await getPool().query(
    `INSERT INTO \`workflow_runs\`
       (run_id, tenant_id, workspace_id, workspace_key, user_id, actor_id, actor_type,
        brand_id, brand_key, request_id, session_id, conversation_id, correlation_id,
        execution_context_json, workflow_key, agent_id, plan_id, service_mode, status, input_json, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, NOW())`,
    [
      run_id,
      plan.tenant_id || null,
      plan.workspace_id || null,
      plan.workspace_key || null,
      plan.user_id || null,
      actorId,
      actorId ? "user" : "system",
      plan.brand_id || null,
      plan.brand_key || plan.target_key || null,
      plan.request_id || null,
      plan.session_id || null,
      plan.conversation_id || null,
      trace_id || run_id,
      JSON.stringify({ source: "connector_executor", ...inputContext }),
      plan.workflow_key || "connector_dispatch",
      agent_id,
      plan.plan_id,
      service_mode || "self_serve",
      JSON.stringify(inputContext),
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

async function createStepRun(run_id, trace_id, plan, step_key, status, input, output, error_msg) {
  try {
    const stepRunId = randomUUID();
    const actorId = plan.user_id || null;
    await getPool().query(
      `INSERT INTO \`step_runs\`
         (step_run_id, run_id, tenant_id, workspace_id, workspace_key, user_id,
          actor_id, actor_type, brand_id, brand_key, request_id, session_id,
          conversation_id, correlation_id, execution_context_json,
          step_key, step_type, status, input_json, output_json, error_message, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'action', ?, ?, ?, ?, NOW(), NOW())`,
      [
        stepRunId,
        run_id,
        plan.tenant_id || null,
        plan.workspace_id || null,
        plan.workspace_key || null,
        plan.user_id || null,
        actorId,
        actorId ? "user" : "system",
        plan.brand_id || null,
        plan.brand_key || plan.target_key || null,
        plan.request_id || null,
        plan.session_id || null,
        plan.conversation_id || null,
        trace_id || run_id,
        JSON.stringify({ source: "connector_executor", run_id, step_run_id: stepRunId, step_key, secrets_included: false }),
        step_key,
        status,
        input ? JSON.stringify(input) : null,
        output ? JSON.stringify(output) : null,
        error_msg || null,
      ]
    );
  } catch { /* non-blocking */ }
}

async function createSpan(trace_id, run_id, span_name, status, duration_ms, plan, attrs) {
  try {
    const actorId = plan.user_id || null;
    await getPool().query(
      `INSERT INTO \`telemetry_spans\`
         (span_id, trace_id, run_id, tenant_id, workspace_id, workspace_key,
          user_id, actor_id, actor_type, brand_id, brand_key,
          request_id, session_id, conversation_id, correlation_id, execution_context_json,
          span_name, span_type, status, duration_ms, attributes_json, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'internal', ?, ?, ?, NOW())`,
      [
        randomUUID(),
        trace_id,
        run_id,
        plan.tenant_id || null,
        plan.workspace_id || null,
        plan.workspace_key || null,
        plan.user_id || null,
        actorId,
        actorId ? "user" : "system",
        plan.brand_id || null,
        plan.brand_key || plan.target_key || null,
        plan.request_id || null,
        plan.session_id || null,
        plan.conversation_id || null,
        trace_id || run_id,
        JSON.stringify({ source: "connector_executor", trace_id, run_id, secrets_included: false }),
        span_name,
        status,
        duration_ms || 0,
        JSON.stringify(attrs || {}),
      ]
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
  // Resolve the bearer token from the canonical Make.com MCP action's secret reference.
  // Keep make_mcp_server as a temporary legacy fallback for one release window.
  let token = process.env.MAKE_MCP_TOKEN || "";
  if (!token) {
    const [rows] = await getPool().query(
      `SELECT secret_store_ref, action_key
         FROM \`actions\`
        WHERE action_key IN ('makecom_mcp_client', 'make_mcp_server')
        ORDER BY CASE action_key
          WHEN 'makecom_mcp_client' THEN 0
          WHEN 'make_mcp_server' THEN 1
          ELSE 2
        END
        LIMIT 1`
    );
    if (rows[0]?.secret_store_ref) token = resolveSecretFromReference(rows[0].secret_store_ref);
  }
  if (!token) {
    throw new Error("MAKE_MCP_TOKEN not configured - set ref:secret:MAKE_MCP_TOKEN on action makecom_mcp_client and provide the env secret.");
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

  const [brand, connectedSystem, workflowResolution, actionRow] = await Promise.all([
    loadBrand(plan.brand_key || plan.target_key),
    loadConnectedSystem(plan.tenant_id, plan.brand_key || plan.target_key),
    resolveRuntimeWorkflow({
      workflow_id: plan.workflow_id,
      workflow_key: plan.workflow_key,
    }),
    loadAction(plan.workflow_key || plan.intent_key),
  ]);
  if (!workflowResolution.ok && workflowResolution.resolution.code !== "workflow_identity_missing") {
    return {
      ok: false,
      plan_id,
      error: {
        code: workflowResolution.resolution.code,
        message: workflowResolution.resolution.message,
        resolution: workflowResolution.resolution,
      },
    };
  }
  const workflowDef = workflowResolution.ok ? workflowResolution.workflow : null;

  const isWordpress =
    brand?.auth_type === "basic_auth_app_password" ||
    connectedSystem?.connector_family === "wordpress" ||
    isWordpressBlogPublishWorkflow(plan.workflow_key);

  // GAP 6: runtime_capability_class from actions table is authoritative when
  // connector_family is not set on the connected_systems row.
  const isMcp =
    connectedSystem?.connector_family === "make_mcp" ||
    (!connectedSystem && actionRow?.runtime_capability_class === "mcp_connector");

  const connector_type = isWordpress ? "wordpress" : isMcp ? "mcp_connector" : "content_workflow";
  const service_mode   = plan.service_mode || "self_serve";

  assertPreflightAllowed(await evaluateConnectorDispatchPreflight({
    plan,
    connectorType: connector_type,
    workflowDef,
    apply,
  }));

  await createWorkflowRun(run_id, trace_id, plan, service_mode);
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
        const message = `Agent '${plan.agent_id}' lacks required connector skill '${requiredSkill}'.`;
        await finaliseWorkflowRun(run_id, "failed", null, message);
        await getPool().query(
          "UPDATE `execution_plans` SET plan_status = 'failed', validation_errors = ? WHERE plan_id = ?",
          [JSON.stringify([{ code: "required_agent_skill_grant_missing", required_skill: requiredSkill }]), plan_id]
        );
        return {
          ok: false,
          run_id,
          trace_id,
          plan_id,
          connector_type,
          error: {
            code: "required_agent_skill_grant_missing",
            message,
            required_skill: requiredSkill,
          },
          external_send_performed: false,
          secrets_included: false,
        };
      }
    } catch (error) {
      const message = `Connector skill authorization could not be resolved: ${String(error?.code || error?.message || "skill_gate_failed").slice(0, 240)}`;
      await finaliseWorkflowRun(run_id, "failed", null, message);
      await getPool().query(
        "UPDATE `execution_plans` SET plan_status = 'failed', validation_errors = ? WHERE plan_id = ?",
        [JSON.stringify([{ code: "agent_skill_grant_resolution_failed" }]), plan_id]
      );
      return {
        ok: false,
        run_id,
        trace_id,
        plan_id,
        connector_type,
        error: { code: "agent_skill_grant_resolution_failed", message },
        external_send_performed: false,
        secrets_included: false,
      };
    }
  }

  let result, dispatchError;
  try {
    if (isWordpressBlogPublishWorkflow(plan.workflow_key)) {
      result = await dispatchWordpressBlogPublish(plan, { ...deps, brand });
    } else if (isWordpress) {
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
      // Pass run_id so runAgentLoop writes step_runs against the same workflow_runs record.
      result = await dispatchContentWorkflow({ ...plan, run_id }, workflowDef, deps);
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
      run_id, trace_id, plan,
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
    createSpan(trace_id, run_id, `connector.${connector_type}`, succeeded ? "ok" : "error", duration_ms, plan, {
      plan_id, run_id, connector_type, apply, brand_key: plan.brand_key,
      workflow_id: plan.workflow_id || workflowDef?.workflow_id || null,
      workflow_key: plan.workflow_key,
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
      workflow_id: plan.workflow_id || workflowDef?.workflow_id || null,
      output:       result.output,
    }).catch(err => console.warn("[outputSinkRouter] non-fatal:", err?.message));
  }

  writeAuditLogAsync({
    actor_id: actor_id || plan.user_id || "system",
    actor_type: actor_id || plan.user_id ? "user" : "system",
    user_id: plan.user_id || null,
    tenant_id: plan.tenant_id,
    workspace_id: plan.workspace_id || null,
    workspace_key: plan.workspace_key || null,
    brand_id: plan.brand_id || null,
    brand_key: plan.brand_key || plan.target_key || null,
    request_id: plan.request_id || null,
    session_id: plan.session_id || null,
    conversation_id: plan.conversation_id || null,
    correlation_id: trace_id,
    action: "connector.dispatch",
    resource_type: "execution_plan",
    resource_id: plan_id,
    outcome: succeeded ? "success" : "failure",
    metadata: { run_id, trace_id, connector_type, apply, duration_ms, secrets_included: false },
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
