// outputSinkRouter.js — Sprint 21
//
// Routes agent output (workflow_runs.output_json) into typed sink tables
// based on execution_class and output_artifact_type. Called by connectorExecutor
// immediately after finaliseWorkflowRun().
//
// Sink map:
//   ALL classes       → output_artifacts       (universal store)
//   rule_based        → adaptation_records      (pass/fail decision record)
//   Report/Analysis/  → reporting_views         (snapshot for dashboards)
//   Dataset/Research/
//   Scorecard
//   authority         → audit_log               (elevated supervisor entry)
//   linked_workflows  → agent_chain_events       (event bus for chaining)

import { randomUUID }  from "node:crypto";
import { getPool }     from "./db.js";
import { writeAuditLog } from "./auditLogger.js";

const REPORT_TYPES = new Set([
  "Report", "Analysis", "Scorecard", "Dataset", "Research", "Map",
]);

const PASS_KEYS = ["passed", "ok", "valid", "pass"];

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function loadWorkflowMeta(workflow_key) {
  if (!workflow_key) return null;
  const [rows] = await getPool().query(
    `SELECT output_artifact_type, primary_output, linked_workflows, execution_class
     FROM \`workflows\` WHERE workflow_key = ? LIMIT 1`,
    [workflow_key]
  );
  return rows[0] || null;
}

async function loadAgentMeta(agent_id) {
  if (!agent_id) return null;
  const [rows] = await getPool().query(
    "SELECT name, execution_class FROM `agents` WHERE agent_id = ? LIMIT 1",
    [agent_id]
  );
  return rows[0] || null;
}

function extractPassFail(output) {
  if (!output) return { passed: false, issues: [], severity: "none" };
  let obj = output;
  if (typeof output === "string") {
    try { obj = JSON.parse(output); } catch {
      return { passed: output.toLowerCase().includes("pass"), issues: [], severity: "none" };
    }
  }
  const passed = PASS_KEYS.some(k => obj[k] === true || obj[k] === 1 || obj[k] === "true");
  return {
    passed,
    issues:   Array.isArray(obj.issues)   ? obj.issues   : [],
    severity: obj.severity || (passed ? "none" : "minor"),
  };
}

function normaliseOutput(output) {
  if (output === null || output === undefined) return { text: null, json: null };
  if (typeof output === "string") return { text: output, json: null };
  return { text: null, json: JSON.stringify(output) };
}

async function logSink(run_id, agent_id, tenant_id, sink_type, sink_ref_id, status, error_msg) {
  await getPool().query(
    `INSERT INTO \`sink_dispatch_log\`
       (dispatch_id, run_id, agent_id, tenant_id, sink_type, sink_ref_id, status, error_msg)
     VALUES (?,?,?,?,?,?,?,?)`,
    [randomUUID(), run_id, agent_id || null, tenant_id || null,
     sink_type, sink_ref_id || null, status, error_msg || null]
  ).catch(() => {}); // non-blocking — never let observability break the main path
}

// ─── Sink handlers ────────────────────────────────────────────────────────────

async function sinkOutputArtifact({ run_id, agent_id, tenant_id, brand_key, workflow_key,
                                    artifact_type, primary_output, output }) {
  const artifact_id = randomUUID();
  const { text, json } = normaliseOutput(output);
  await getPool().query(
    `INSERT INTO \`output_artifacts\`
       (artifact_id, run_id, agent_id, tenant_id, brand_key, workflow_key,
        artifact_type, primary_output, content_text, content_json, sink_targets, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,JSON_ARRAY(),'delivered')`,
    [artifact_id, run_id, agent_id || null, tenant_id,
     brand_key || null, workflow_key || null,
     artifact_type || "Operational", primary_output || null, text, json]
  );
  return artifact_id;
}

async function sinkAdaptationRecord({ run_id, agent_id, tenant_id, workflow_key, output, execution_class }) {
  const { passed, issues, severity } = extractPassFail(output);
  const adaptation_id = randomUUID();
  await getPool().query(
    `INSERT INTO \`adaptation_records\`
       (adaptation_id, logic_id, agent_id, tenant_id, adapted_by, adaptation_type,
        original_json, adapted_json, reason, status)
     VALUES (?,?,?,?,'system','annotation',?,?,?,'approved')`,
    [
      adaptation_id,
      workflow_key || "unknown",
      agent_id || null,
      tenant_id,
      JSON.stringify({ run_id, execution_class }),
      JSON.stringify({ passed, issues, severity }),
      passed
        ? "rule_evaluation_passed"
        : `rule_evaluation_failed: ${issues.slice(0, 3).join("; ")}`,
    ]
  );
  return { adaptation_id, passed, severity };
}

async function sinkReportingView({ run_id, agent_id, tenant_id, workflow_key, output, primary_output }) {
  const view_id   = randomUUID();
  const view_key  = `agent_report.${run_id.slice(0, 8)}`;
  const snapshot  = typeof output === "string" ? output : JSON.stringify(output, null, 2);
  await getPool().query(
    `INSERT INTO \`reporting_views\`
       (view_id, tenant_id, view_key, display_name, view_type,
        source_run_id, agent_id, snapshot_json, updated_at)
     VALUES (?,?,?,?,'execution_summary',?,?,?,NOW())`,
    [view_id, tenant_id, view_key,
     primary_output || workflow_key || "Agent Report",
     run_id, agent_id || null, snapshot]
  );
  return view_id;
}

async function sinkChainEvents({ source_run_id, source_agent_id, linked_workflows,
                                  tenant_id, output, passed }) {
  let links = [];
  try {
    links = typeof linked_workflows === "string"
      ? (linked_workflows.startsWith("[") ? JSON.parse(linked_workflows) : linked_workflows.split("|").map(s => s.trim()))
      : Array.isArray(linked_workflows) ? linked_workflows : [];
  } catch { links = []; }

  links = links.filter(Boolean);
  if (!links.length) return [];

  const condition = passed === false ? "on_fail" : "on_pass";
  const events = [];

  for (const target_workflow_key of links) {
    const event_id = randomUUID();
    // Resolve target agent from workflow execution_layer
    const [wfRow] = await getPool().query(
      `SELECT w.execution_class, a.agent_id
       FROM \`workflows\` w
       LEFT JOIN \`agents\` a ON a.execution_layer = (
         SELECT tr.execution_layer FROM \`task_routes\` tr
         WHERE tr.workflow_key = w.workflow_key LIMIT 1
       )
       WHERE w.workflow_key = ? LIMIT 1`,
      [target_workflow_key]
    ).catch(() => [[]]);
    const target_agent_id = wfRow[0]?.agent_id || null;

    await getPool().query(
      `INSERT INTO \`agent_chain_events\`
         (event_id, source_run_id, source_agent_id, target_workflow_key, target_agent_id,
          tenant_id, trigger_condition, payload_json, status)
       VALUES (?,?,?,?,?,?,?,?,'pending')`,
      [event_id, source_run_id, source_agent_id || null, target_workflow_key,
       target_agent_id, tenant_id, condition,
       JSON.stringify({ source_output: typeof output === "string" ? output.slice(0, 500) : output })]
    );
    events.push({ event_id, target_workflow_key, target_agent_id, condition });
  }
  return events;
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function routeOutput({
  run_id,
  agent_id,
  tenant_id,
  brand_key,
  workflow_key,
  output,
}) {
  if (!run_id || !tenant_id) {
    return { ok: false, error: "run_id and tenant_id required" };
  }

  const [wfMeta, agentMeta] = await Promise.all([
    loadWorkflowMeta(workflow_key),
    loadAgentMeta(agent_id),
  ]);

  const execution_class  = agentMeta?.execution_class  || wfMeta?.execution_class  || "standard";
  const artifact_type    = wfMeta?.output_artifact_type || "Operational";
  const primary_output   = wfMeta?.primary_output       || null;
  const linked_workflows = wfMeta?.linked_workflows      || null;

  const dispatched = [];

  // ── 1. Universal: output_artifacts ───────────────────────────────────────────
  try {
    const artifact_id = await sinkOutputArtifact({
      run_id, agent_id, tenant_id, brand_key, workflow_key,
      artifact_type, primary_output, output,
    });
    dispatched.push({ sink: "output_artifact", id: artifact_id });
    await logSink(run_id, agent_id, tenant_id, "output_artifact", artifact_id, "ok");
  } catch (err) {
    await logSink(run_id, agent_id, tenant_id, "output_artifact", null, "failed", err.message);
  }

  // ── 2. rule_based → adaptation_records ────────────────────────────────────
  let rulePassed = null;
  if (execution_class === "rule_based") {
    try {
      const { adaptation_id, passed } = await sinkAdaptationRecord({
        run_id, agent_id, tenant_id, workflow_key, output, execution_class,
      });
      rulePassed = passed;
      dispatched.push({ sink: "adaptation_record", id: adaptation_id, passed });
      await logSink(run_id, agent_id, tenant_id, "adaptation_record", adaptation_id, "ok");
    } catch (err) {
      await logSink(run_id, agent_id, tenant_id, "adaptation_record", null, "failed", err.message);
    }
  }

  // ── 3. Report/Analysis/Dataset/etc → reporting_views ──────────────────────
  if (REPORT_TYPES.has(artifact_type)) {
    try {
      const view_id = await sinkReportingView({
        run_id, agent_id, tenant_id, workflow_key, output, primary_output,
      });
      dispatched.push({ sink: "reporting_view", id: view_id });
      await logSink(run_id, agent_id, tenant_id, "reporting_view", view_id, "ok");
    } catch (err) {
      await logSink(run_id, agent_id, tenant_id, "reporting_view", null, "failed", err.message);
    }
  }

  // ── 4. authority → elevated audit_log entry ───────────────────────────────
  if (execution_class === "authority") {
    try {
      await writeAuditLog({
        actor_id:      agent_id || "system",
        actor_type:    "agent",
        action:        "agent.authority_output",
        resource_type: "workflow_run",
        resource_id:   run_id,
        tenant_id,
        outcome:       "success",
        metadata: {
          artifact_type,
          primary_output,
          requires_supervisor_review: true,
          agent_id,
        },
      });
      dispatched.push({ sink: "audit_log" });
    } catch (err) {
      await logSink(run_id, agent_id, tenant_id, "audit_log", null, "failed", err.message);
    }
  }

  // ── 5. Linked workflows → agent_chain_events ──────────────────────────────
  if (linked_workflows) {
    try {
      const events = await sinkChainEvents({
        source_run_id:  run_id,
        source_agent_id: agent_id,
        linked_workflows,
        tenant_id,
        output,
        passed: rulePassed,
      });
      for (const e of events) {
        dispatched.push({ sink: "chain_event", id: e.event_id, target: e.target_workflow_key });
        await logSink(run_id, agent_id, tenant_id, "chain_event", e.event_id, "ok");
      }
    } catch (err) {
      await logSink(run_id, agent_id, tenant_id, "chain_event", null, "failed", err.message);
    }
  }

  return {
    ok: true,
    run_id,
    execution_class,
    artifact_type,
    dispatched,
  };
}
