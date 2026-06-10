import { createHash } from "node:crypto";
import { getPool } from "./db.js";
import { readPlatformOrchestrationReadback } from "./platformOrchestrationReadback.js";

function parseJson(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeTicketId(value) {
  const ticketId = String(value || "").trim();
  if (!ticketId || ticketId.length > 128 || !/^[A-Za-z0-9_.:-]+$/.test(ticketId)) {
    const err = new Error("ticket_id must be a non-empty Support Ticket id.");
    err.status = 400;
    err.code = "invalid_support_ticket_id";
    throw err;
  }
  return ticketId;
}

function redactSecretLike(value) {
  if (Array.isArray(value)) return value.map(redactSecretLike);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    const lower = String(key).toLowerCase();
    if (lower.includes("secret") || lower.includes("token") || lower.includes("password") || lower.includes("api_key") || lower.includes("apikey")) {
      out[key] = "[redacted]";
    } else {
      out[key] = redactSecretLike(raw);
    }
  }
  return out;
}

function normalizeRowJson(row = {}, jsonFields = []) {
  const out = { ...row };
  for (const field of jsonFields) {
    if (Object.prototype.hasOwnProperty.call(out, field)) {
      out[field] = redactSecretLike(parseJson(out[field], null));
    }
  }
  return out;
}

async function firstRow(sql, params = []) {
  const [rows] = await getPool().query(sql, params);
  return rows[0] || null;
}

async function allRows(sql, params = []) {
  const [rows] = await getPool().query(sql, params);
  return rows || [];
}

function classifyTicket({ ticket, events, workflowLinks, executionPlans, workflowRuns, stepRuns, approvalHolds, pendingTasks }) {
  const blockers = [];
  const lifecycleState = String(ticket.lifecycle_state || "").toLowerCase();
  const status = String(ticket.status || "").toLowerCase();
  const customerStatus = String(ticket.customer_status || "").toLowerCase();
  const failedRuns = workflowRuns.filter((row) => ["failed", "error", "cancelled"].includes(String(row.status || "").toLowerCase()));
  const failedSteps = stepRuns.filter((row) => ["failed", "error", "cancelled"].includes(String(row.status || "").toLowerCase()));
  const openApprovals = approvalHolds.filter((row) => ["open", "pending", "awaiting_approval"].includes(String(row.status || "").toLowerCase()));
  const blockedTasks = pendingTasks.filter((row) => ["pending", "blocked", "deferred"].includes(String(row.status || "").toLowerCase()));

  if (failedRuns.length || failedSteps.length) {
    blockers.push({
      blocker_class: "workflow_runtime",
      code: "workflow_or_step_failed",
      severity: "blocker",
      failed_run_count: failedRuns.length,
      failed_step_count: failedSteps.length,
    });
  }

  if (status === "awaiting_approval" || lifecycleState.includes("approval") || openApprovals.length) {
    blockers.push({
      blocker_class: "approval_required",
      code: "approval_required_or_pending",
      severity: "blocker",
      open_approval_count: openApprovals.length,
    });
  }

  if (lifecycleState.includes("validation_pending") || lifecycleState.includes("schema") || customerStatus.includes("schema")) {
    blockers.push({
      blocker_class: "runtime_validation",
      code: "runtime_or_schema_validation_pending",
      severity: "blocker",
      lifecycle_state: ticket.lifecycle_state,
      customer_status: ticket.customer_status,
    });
  }

  if (status === "open" && lifecycleState === "triage_pending") {
    blockers.push({ blocker_class: "triage", code: "triage_pending", severity: "warn" });
  }

  if (blockedTasks.length) {
    blockers.push({
      blocker_class: "pending_task",
      code: "linked_pending_tasks_present",
      severity: "warn",
      pending_task_count: blockedTasks.length,
    });
  }

  let stateClassification = "ticket_ready_for_customer_update";
  if (["resolved", "closed"].includes(status) || lifecycleState === "verified") {
    stateClassification = "ticket_closed_or_verified";
  } else if (failedRuns.length || failedSteps.length) {
    stateClassification = "ticket_blocked_by_failed_workflow";
  } else if (status === "awaiting_approval" || lifecycleState.includes("approval") || openApprovals.length) {
    stateClassification = "ticket_awaiting_approval";
  } else if (lifecycleState.includes("validation_pending") || lifecycleState.includes("schema") || customerStatus.includes("schema")) {
    stateClassification = "ticket_runtime_validation_pending";
  } else if (lifecycleState === "triage_pending") {
    stateClassification = "ticket_ready_for_triage";
  } else if (lifecycleState.includes("auto_resolution") || status === "in_review") {
    stateClassification = "ticket_ready_for_resolution_review";
  }

  const recommendedNextAction = (() => {
    if (failedRuns.length || failedSteps.length) return "inspect_failed_workflow_or_step_run";
    if (status === "awaiting_approval" || lifecycleState.includes("approval") || openApprovals.length) return "request_or_decide_approval_hold";
    if (lifecycleState.includes("validation_pending") || lifecycleState.includes("schema") || customerStatus.includes("schema")) return "run_ticket_runtime_readback";
    if (lifecycleState === "triage_pending") return "complete_ticket_triage";
    if (["resolved", "closed"].includes(status) || lifecycleState === "verified") return "no_action_readback_only";
    if (blockedTasks.length) return "review_linked_pending_tasks";
    if (events.length === 0) return "append_initial_internal_support_event";
    if (workflowLinks.length === 0) return "evaluate_whether_runtime_or_approval_link_is_required";
    return "prepare_customer_safe_status_update";
  })();

  return { blockers, stateClassification, recommendedNextAction };
}

export async function proposeSupportTicketLifecycleSnapshot(input = {}) {
  const ticketId = normalizeTicketId(input.ticket_id || input.ticketId);
  const pluginKey = "support_ticket_lifecycle_orchestrator";

  const ticket = await firstRow(
    `SELECT ticket_id, tenant_id, user_id, title, ticket_type, category, priority, severity, status,
            lifecycle_state, customer_status, queue_key, assigned_to, assignment_status,
            service_mode, source_layer, source_tool, source_event, metadata_json,
            first_response_due_at, triage_due_at, resolution_due_at, sla_status,
            last_seen_at, occurrence_count, created_at, updated_at
       FROM tickets
      WHERE ticket_id = ?
      LIMIT 1`,
    [ticketId]
  );
  if (!ticket) {
    const err = new Error("Support Ticket was not found.");
    err.status = 404;
    err.code = "support_ticket_not_found";
    throw err;
  }

  const events = await allRows(
    `SELECT event_id, ticket_id, tenant_id, event_type, from_state, to_state,
            actor_type, visibility, summary, payload_json, created_at
       FROM ticket_lifecycle_events
      WHERE ticket_id = ?
      ORDER BY created_at DESC
      LIMIT 25`,
    [ticketId]
  );

  const workflowLinks = await allRows(
    `SELECT link_id, ticket_id, tenant_id, plan_id, run_id, approval_hold_id,
            relationship, status, evidence_json, created_at, updated_at
       FROM ticket_workflow_links
      WHERE ticket_id = ?
      ORDER BY updated_at DESC
      LIMIT 25`,
    [ticketId]
  );

  const executionPlans = await allRows(
    `SELECT plan_id, tenant_id, workspace_id, workspace_key, user_id, actor_type,
            brand_key, intent_key, target_key, workflow_key, route_key,
            service_mode, access_decision, plan_status, preview_json, validation_errors,
            created_at, updated_at
       FROM execution_plans
      WHERE plan_id IN (SELECT plan_id FROM ticket_workflow_links WHERE ticket_id = ? AND plan_id IS NOT NULL)
         OR request_id = ?
      ORDER BY updated_at DESC
      LIMIT 25`,
    [ticketId, ticketId]
  );

  const workflowRuns = await allRows(
    `SELECT run_id, tenant_id, workspace_id, workspace_key, user_id, actor_type,
            brand_key, workflow_key, agent_id, plan_id, service_mode, status,
            current_step, error_json, started_at, completed_at, created_at, updated_at
       FROM workflow_runs
      WHERE run_id IN (SELECT run_id FROM ticket_workflow_links WHERE ticket_id = ? AND run_id IS NOT NULL)
         OR plan_id IN (SELECT plan_id FROM ticket_workflow_links WHERE ticket_id = ? AND plan_id IS NOT NULL)
         OR request_id = ?
      ORDER BY updated_at DESC
      LIMIT 25`,
    [ticketId, ticketId, ticketId]
  );

  const stepRuns = await allRows(
    `SELECT step_run_id, run_id, tenant_id, workspace_id, workspace_key, user_id,
            actor_type, brand_key, step_key, step_type, assigned_to, status,
            attempt, error_message, started_at, completed_at, created_at
       FROM step_runs
      WHERE run_id IN (SELECT run_id FROM ticket_workflow_links WHERE ticket_id = ? AND run_id IS NOT NULL)
      ORDER BY created_at DESC
      LIMIT 25`,
    [ticketId]
  );

  const approvalHolds = await allRows(
    `SELECT hold_id, run_id, step_run_id, tenant_id, workspace_id, workspace_key,
            hold_type, requested_by, user_id, actor_type, brand_key, request_id,
            status, decision_by, expires_at, decided_at, created_at
       FROM approval_holds
      WHERE hold_id IN (SELECT approval_hold_id FROM ticket_workflow_links WHERE ticket_id = ? AND approval_hold_id IS NOT NULL)
         OR request_id = ?
      ORDER BY created_at DESC
      LIMIT 25`,
    [ticketId, ticketId]
  );

  const pendingTasks = await allRows(
    `SELECT task_id, task_key, title, task_type, priority, status, blocker_level,
            owner_scope, tenant_id, user_id, source_surface, source_ref,
            activation_visibility, due_at, completed_at, created_at, updated_at
       FROM platform_pending_tasks
      WHERE source_ref = ? OR task_key LIKE ?
      ORDER BY updated_at DESC
      LIMIT 25`,
    [ticketId, `%${ticketId}%`]
  );

  const orchestrationReadback = await readPlatformOrchestrationReadback({
    plugin_key: pluginKey,
    include_snapshots: false,
    include_recommendations: false,
    limit: 1,
  });

  const normalizedTicket = normalizeRowJson(ticket, ["metadata_json"]);
  const normalizedEvents = events.map((row) => normalizeRowJson(row, ["payload_json"]));
  const normalizedWorkflowLinks = workflowLinks.map((row) => normalizeRowJson(row, ["evidence_json"]));
  const normalizedPlans = executionPlans.map((row) => normalizeRowJson(row, ["preview_json", "validation_errors"]));
  const normalizedRuns = workflowRuns.map((row) => normalizeRowJson(row, ["error_json"]));
  const normalizedSteps = stepRuns.map((row) => normalizeRowJson(row, []));
  const normalizedApprovals = approvalHolds.map((row) => normalizeRowJson(row, []));
  const normalizedPendingTasks = pendingTasks.map((row) => normalizeRowJson(row, []));

  const { blockers, stateClassification, recommendedNextAction } = classifyTicket({
    ticket: normalizedTicket,
    events: normalizedEvents,
    workflowLinks: normalizedWorkflowLinks,
    executionPlans: normalizedPlans,
    workflowRuns: normalizedRuns,
    stepRuns: normalizedSteps,
    approvalHolds: normalizedApprovals,
    pendingTasks: normalizedPendingTasks,
  });

  const maturityParts = [
    normalizedTicket ? 20 : 0,
    normalizedEvents.length ? 15 : 0,
    normalizedWorkflowLinks.length ? 15 : 0,
    normalizedPlans.length || normalizedRuns.length || normalizedSteps.length ? 15 : 0,
    normalizedApprovals.length || !blockers.some((b) => b.code === "approval_required_or_pending") ? 10 : 0,
    orchestrationReadback?.readiness_status === "ready_readonly_graph_seeded" ? 15 : 0,
    blockers.filter((b) => b.severity === "blocker").length === 0 ? 10 : 0,
  ];
  const maturityScore = maturityParts.reduce((sum, value) => sum + value, 0);

  const snapshotCandidate = {
    snapshot_key: `${pluginKey}:${ticketId}:proposal`,
    plugin_key: pluginKey,
    scope_type: "ticket",
    scope_id: ticketId,
    tenant_id: normalizedTicket.tenant_id,
    user_id: normalizedTicket.user_id || null,
    subject_key: `ticket:${ticketId}`,
    state_classification: stateClassification,
    maturity_score: maturityScore,
    input_sources: [
      "tickets",
      "ticket_lifecycle_events",
      "ticket_workflow_links",
      "execution_plans",
      "workflow_runs",
      "step_runs",
      "approval_holds",
      "platform_pending_tasks",
      "platform_orchestration_*",
    ],
    state: {
      ticket: normalizedTicket,
      lifecycle_events: normalizedEvents,
      workflow_links: normalizedWorkflowLinks,
      execution_plans: normalizedPlans,
      workflow_runs: normalizedRuns,
      step_runs: normalizedSteps,
      approval_holds: normalizedApprovals,
      pending_tasks: normalizedPendingTasks,
      orchestration_readback: {
        readiness_status: orchestrationReadback.readiness_status,
        stage_count: orchestrationReadback.graph?.stage_count,
        edge_count: orchestrationReadback.graph?.edge_count,
      },
    },
    maturity: {
      score: maturityScore,
      max_score: 100,
      parts: maturityParts,
    },
    blockers,
    safety: {
      no_ticket_mutation: true,
      no_workflow_dispatch: true,
      no_approval_decision: true,
      no_provider_call: true,
      no_credential_payload_read: true,
      no_spend_change: true,
      no_external_send: true,
      no_external_write: true,
      no_deploy: true,
      no_publish: true,
      recommendation_only: true,
      secrets_included: false,
    },
    secrets_included: false,
  };

  const recommendationCandidate = {
    recommendation_key: `${pluginKey}:${ticketId}:next_best_action:proposal`,
    snapshot_key: snapshotCandidate.snapshot_key,
    plugin_key: pluginKey,
    scope_type: "ticket",
    scope_id: ticketId,
    task_class: "support_ticket_lifecycle_next_best_action",
    recommendation_type: "next_best_action",
    priority: blockers.some((b) => b.severity === "blocker") ? "high" : "medium",
    recommendation_status: "proposed",
    decision: {
      state_classification: stateClassification,
      maturity_score: maturityScore,
      recommended_next_action: recommendedNextAction,
      execution_allowed_by_this_route: false,
    },
    blockers,
    next_actions: blockers.length
      ? blockers.map((blocker) => ({ blocker_code: blocker.code, action: blocker.code }))
      : [{ action: recommendedNextAction }],
    safety_contract: snapshotCandidate.safety,
    secrets_included: false,
  };

  return {
    ok: true,
    ticket_id: ticketId,
    plugin_key: pluginKey,
    mode: "proposal_only",
    writes_database: false,
    snapshot_candidate: snapshotCandidate,
    recommendation_candidate: recommendationCandidate,
    candidate_sha256: sha256Json({ snapshotCandidate, recommendationCandidate }),
    execution: {
      will_record_snapshot: false,
      will_record_recommendation: false,
      will_mutate_ticket: false,
      will_dispatch_workflow: false,
      will_decide_approval: false,
      will_execute_provider_call: false,
      will_read_credential_payload: false,
      will_change_spend: false,
      will_external_send: false,
      will_external_write: false,
      will_deploy: false,
      will_publish: false,
    },
    secrets_included: false,
  };
}
