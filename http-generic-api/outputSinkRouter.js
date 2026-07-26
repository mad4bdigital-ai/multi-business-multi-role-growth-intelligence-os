// outputSinkRouter.js — Sprint 21
//
// Routes agent output (workflow_runs.output_json) into typed sink tables
// based on execution_class and output_artifact_type. Called by the core
// execution loop (e.g., in server.js) after a workflow run completes.
//
// Sink map:
//   ALL classes       → output_artifacts       (universal store)
//   rule_based        → adaptation_records     (pass/fail decision record)
//   Report/Analysis/  → reporting_views        (snapshot for dashboards)
//   authority         → audit_log              (elevated supervisor entry)
//   linked_workflows  → agent_chain_events     (event bus for chaining)

import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { writeAuditLog } from "./auditLogger.js"; // Assuming auditLogger.js exists
import { resolveRuntimeWorkflow } from "./runtimeWorkflowResolver.js";
import { requireAgentDelegationOptIn } from "./agentDelegationOptIn.js";

const REPORT_TYPES = new Set([
  "Report", "Analysis", "Scorecard", "Dataset", "Research", "Map",
]);

const PASS_KEYS = ["passed", "ok", "valid", "pass", "true", "1"];

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function loadAgentMeta(agent_id) {
  if (!agent_id) return null;
  const [rows] = await getPool().query(
    "SELECT name, execution_class FROM `agents` WHERE agent_id = ? LIMIT 1",
    [agent_id]
  );
  return rows[0] || null;
}

function extractPassFail(output) {
  if (output === null || output === undefined) return { passed: false, issues: [], severity: "none" };
  let obj = output;
  if (typeof output === "string") {
    try { obj = JSON.parse(output); } catch {
      return { passed: PASS_KEYS.includes(output.toLowerCase()), issues: [], severity: "none" };
    }
  }
  const passed = PASS_KEYS.some(k => String(obj[k]).toLowerCase() === "true" || obj[k] === true || obj[k] === 1);
  return {
    passed,
    issues: Array.isArray(obj.issues) ? obj.issues : [],
    severity: obj.severity || (passed ? "none" : "minor"),
  };
}

function normaliseOutput(output) {
  if (output === null || output === undefined) return { text: null, json: null };
  if (typeof output === "string") {
    try {
      const parsed = JSON.parse(output);
      return { text: null, json: JSON.stringify(parsed) };
    } catch {
      return { text: output, json: null };
    }
  }
  return { text: null, json: JSON.stringify(output) };
}

async function logSink(run_id, agent_id, tenant_id, sink_type, sink_ref_id, status, error_msg, context = {}) {
  const actorId = context.actor_id || context.user_id || agent_id || null;
  await getPool().query(
    `INSERT INTO \`sink_dispatch_log\`
       (dispatch_id, run_id, agent_id, tenant_id, workspace_id, workspace_key,
        user_id, actor_id, actor_type, brand_id, brand_key,
        request_id, session_id, conversation_id, correlation_id, execution_context_json,
        sink_type, sink_ref_id, status, error_msg)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [randomUUID(), run_id, agent_id || null, tenant_id || null,
     context.workspace_id || null, context.workspace_key || null,
     context.user_id || null, actorId,
     context.actor_type || (actorId ? "agent_or_user" : null),
     context.brand_id || null, context.brand_key || null,
     context.request_id || null, context.session_id || null, context.conversation_id || null,
     context.correlation_id || run_id,
     JSON.stringify({ source: "output_sink_router", run_id, sink_type, secrets_included: false }),
     sink_type, sink_ref_id || null, status, error_msg || null]
  ).catch(err => console.error("CRITICAL: sink_dispatch_log failed to write.", err));
}

// ─── Sink handlers ────────────────────────────────────────────────────────────

async function sinkOutputArtifact({ run_id, agent_id, tenant_id, brand_key, workflow_key,
                                    artifact_type, primary_output, output, sink_targets }) {
  const artifact_id = randomUUID();
  const { text, json } = normaliseOutput(output);
  await getPool().query(
    `INSERT INTO \`output_artifacts\`
       (artifact_id, run_id, agent_id, tenant_id, brand_key, workflow_key,
        artifact_type, primary_output, content_text, content_json, sink_targets, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [artifact_id, run_id, agent_id || null, tenant_id,
     brand_key || null, workflow_key || null,
     artifact_type || "Operational", primary_output || null, text, json,
     JSON.stringify(sink_targets), 'delivered']
  );
  return artifact_id;
}

async function sinkAdaptationRecord({ run_id, agent_id, tenant_id, workflow_key, target_module, output, execution_class }) {
  const { passed, issues, severity } = extractPassFail(output);
  const adaptation_id = randomUUID();

  const [ldRows] = await getPool().query(
    "SELECT logic_id FROM `logic_definitions` WHERE logic_key = ? LIMIT 1",
    [target_module || workflow_key]
  ).catch(() => [[]]);
  const logic_id = ldRows[0]?.logic_id || null;

  await getPool().query(
    `INSERT INTO \`adaptation_records\`
       (adaptation_id, logic_id, agent_id, tenant_id, adapted_by, adaptation_type,
        original_json, adapted_json, reason, status)
     VALUES (?,?,?,?,?,'annotation',?,?,?,'approved')`,
    [
      adaptation_id, logic_id, agent_id || null, tenant_id, 'system',
      JSON.stringify({ run_id, execution_class }),
      JSON.stringify({ passed, issues, severity }),
      passed ? "rule_evaluation_passed" : `rule_evaluation_failed: ${issues.slice(0, 3).join("; ")}`,
    ]
  );
  return { adaptation_id, passed, severity };
}

async function sinkReportingView({ run_id, agent_id, tenant_id, workflow_key, output, primary_output }) {
  const snapshot = typeof output === "string" ? output : JSON.stringify(output, null, 2);
  const view_id  = randomUUID();
  const view_key = `agent_report.${run_id.slice(0, 8)}`;
  await getPool().query(
    `INSERT INTO \`reporting_views\`
       (view_id, tenant_id, view_key, display_name, view_type,
        source_run_id, agent_id, snapshot_json, updated_at)
     VALUES (?,?,?,?,'execution_summary',?,?,?,NOW())
     ON DUPLICATE KEY UPDATE
       source_run_id = VALUES(source_run_id),
       agent_id      = VALUES(agent_id),
       snapshot_json = VALUES(snapshot_json),
       updated_at    = NOW()`,
    [view_id, tenant_id, view_key,
     primary_output || workflow_key || "Agent Report",
     run_id, agent_id || null, snapshot]
  );
  return view_id;
}

export function normalizeLinkedWorkflowKeys(linked_workflows) {
  let links = [];
  try {
    links = typeof linked_workflows === "string"
      ? (linked_workflows.trim().startsWith("[") ? JSON.parse(linked_workflows) : linked_workflows.split(/[|;,]/).map((value) => value.trim()))
      : Array.isArray(linked_workflows) ? linked_workflows : [];
  } catch { links = []; }
  return [...new Set(links.map((value) => String(value || "").trim()).filter(Boolean))];
}

async function sinkChainEvents({ source_run_id, source_agent_id, source_workflow_key, linked_workflows, tenant_id, output, passed }) {
  const links = normalizeLinkedWorkflowKeys(linked_workflows);
  if (!links.length) return [];

  const condition = passed === false ? "on_fail" : (passed === true ? "on_pass" : "always");
  const events = [];
  const [parentRows] = await getPool().query(
    `SELECT event_id, root_event_id, chain_depth, max_chain_depth, workflow_path_json
     FROM \`agent_chain_events\`
     WHERE dispatched_run_id = ?
     ORDER BY dispatched_at DESC LIMIT 1`,
    [source_run_id]
  ).catch(() => [[]]);
  const parent = parentRows[0] || null;

  for (const target_workflow_key of links) {
    const event_id = randomUUID();
    let parentPath = [];
    try {
      parentPath = Array.isArray(parent?.workflow_path_json)
        ? parent.workflow_path_json
        : JSON.parse(parent?.workflow_path_json || "[]");
    } catch {}
    if (!parentPath.length && source_workflow_key) parentPath.push(source_workflow_key);

    const chain_depth = parent ? Number(parent.chain_depth || 0) + 1 : 0;
    const max_chain_depth = Number(parent?.max_chain_depth || 8);
    const cycleDetected = parentPath.includes(target_workflow_key);
    const depthExceeded = chain_depth > max_chain_depth;
    const status = cycleDetected || depthExceeded ? "skipped" : "pending";
    const failure_reason = cycleDetected
      ? "chain_cycle_detected"
      : depthExceeded
        ? "chain_depth_exceeded"
        : null;
    const workflowPath = [...parentPath, target_workflow_key];
    const root_event_id = parent?.root_event_id || parent?.event_id || event_id;

    await getPool().query(
      `INSERT INTO \`agent_chain_events\`
         (event_id, root_event_id, parent_event_id, chain_depth, max_chain_depth,
          workflow_path_json, source_run_id, source_agent_id, target_workflow_key,
          tenant_id, trigger_condition, payload_json, status, failure_reason)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [event_id, root_event_id, parent?.event_id || null, chain_depth, max_chain_depth,
       JSON.stringify(workflowPath), source_run_id, source_agent_id || null, target_workflow_key,
       tenant_id, condition,
       JSON.stringify({ source_output: typeof output === "string" ? output.slice(0, 2000) : output }),
       status, failure_reason]
    );
    events.push({ event_id, target_workflow_key, condition, status, failure_reason });
  }
  return events;
}

export async function createExplicitChainEvents(input = {}) {
  const delegation = requireAgentDelegationOptIn(input);
  if (!input.source_run_id || !input.tenant_id || !input.target_workflow_keys) {
    const error = new Error("source_run_id, tenant_id, and target_workflow_keys are required.");
    error.code = "agent_chain_event_fields_required";
    error.status = 400;
    throw error;
  }
  const targetWorkflowKeys = normalizeLinkedWorkflowKeys(input.target_workflow_keys);
  if (!targetWorkflowKeys.length || targetWorkflowKeys.length > 8) {
    const error = new Error("Explicit delegation requires between 1 and 8 unique target workflow keys.");
    error.code = "agent_delegation_target_count_invalid";
    error.status = 400;
    throw error;
  }
  const [runRows] = await getPool().query(
    `SELECT run_id, tenant_id, agent_id, workflow_key, output_json, status
     FROM \`workflow_runs\`
     WHERE run_id = ? AND tenant_id = ?
     LIMIT 1`,
    [input.source_run_id, input.tenant_id]
  );
  const sourceRun = runRows[0];
  if (!sourceRun || sourceRun.status !== "completed") {
    const error = new Error("Explicit delegation requires a completed source workflow run in the same tenant.");
    error.code = "agent_delegation_source_run_invalid";
    error.status = 409;
    throw error;
  }
  const events = await sinkChainEvents({
    source_run_id: sourceRun.run_id,
    source_agent_id: sourceRun.agent_id || null,
    source_workflow_key: sourceRun.workflow_key || null,
    linked_workflows: targetWorkflowKeys,
    tenant_id: sourceRun.tenant_id,
    output: sourceRun.output_json ?? null,
    passed: input.passed,
  });
  return { ok: true, delegation, events, secrets_included: false };
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function routeOutput({ run_id, agent_id, tenant_id, brand_key, workflow_id, workflow_key, output }) {
  if (!run_id || !tenant_id) return { ok: false, error: "run_id and tenant_id required" };

  const [workflowResolution, agentMeta] = await Promise.all([
    resolveRuntimeWorkflow({ workflow_id, workflow_key }),
    loadAgentMeta(agent_id),
  ]);
  if (!workflowResolution.ok && workflowResolution.resolution.code !== "workflow_identity_missing") {
    return {
      ok: false,
      error: workflowResolution.resolution.code,
      resolution: workflowResolution.resolution,
    };
  }
  const wfMeta = workflowResolution.ok ? workflowResolution.workflow : null;

  const execution_class = agentMeta?.execution_class || wfMeta?.execution_class || "standard";
  const artifact_type = wfMeta?.output_artifact_type || "Operational";
  const primary_output = wfMeta?.primary_output || null;
  const linked_workflows = wfMeta?.linked_workflows || null;
  const target_module = wfMeta?.target_module || null;

  const sinkContext = { brand_key: brand_key || null, correlation_id: run_id };
  const dispatched = [];
  let rulePassed = null;

  if (execution_class === "rule_based") {
    try {
      const { adaptation_id, passed } = await sinkAdaptationRecord({ run_id, agent_id, tenant_id, workflow_key, target_module, output, execution_class });
      rulePassed = passed;
      dispatched.push({ sink: "adaptation_record", id: adaptation_id, passed });
      await logSink(run_id, agent_id, tenant_id, "adaptation_record", adaptation_id, "ok", null, sinkContext);
    } catch (err) { await logSink(run_id, agent_id, tenant_id, "adaptation_record", null, "failed", err.message, sinkContext); }
  }

  if (REPORT_TYPES.has(artifact_type)) {
    try {
      const view_id = await sinkReportingView({ run_id, agent_id, tenant_id, workflow_key, output, primary_output });
      dispatched.push({ sink: "reporting_view", id: view_id });
      await logSink(run_id, agent_id, tenant_id, "reporting_view", view_id, "ok", null, sinkContext);
    } catch (err) { await logSink(run_id, agent_id, tenant_id, "reporting_view", null, "failed", err.message, sinkContext); }
  }

  if (execution_class === "authority") {
    try {
      await writeAuditLog({ actor_id: agent_id || "system", actor_type: "agent", action: "agent.authority_output", resource_type: "workflow_run", resource_id: run_id, tenant_id, brand_key: brand_key || null, correlation_id: run_id, outcome: "success", metadata: { artifact_type, primary_output, requires_supervisor_review: true, agent_id, secrets_included: false } });
      dispatched.push({ sink: "audit_log" });
    } catch (err) { await logSink(run_id, agent_id, tenant_id, "audit_log", null, "failed", err.message, sinkContext); }
  }

  if (linked_workflows) {
    dispatched.push({
      sink: "delegation_option",
      status: "manual_api_opt_in_required",
      target_workflow_keys: normalizeLinkedWorkflowKeys(linked_workflows),
      automatic_delegation_allowed: false,
    });
  }

  try {
    const artifact_id = await sinkOutputArtifact({ run_id, agent_id, tenant_id, brand_key, workflow_key, artifact_type, primary_output, output, sink_targets: dispatched.map(d => d.sink) });
    dispatched.unshift({ sink: "output_artifact", id: artifact_id });
    await logSink(run_id, agent_id, tenant_id, "output_artifact", artifact_id, "ok", null, sinkContext);
  } catch (err) { await logSink(run_id, agent_id, tenant_id, "output_artifact", null, "failed", err.message, sinkContext); }

  return { ok: true, run_id, execution_class, artifact_type, dispatched };
}
