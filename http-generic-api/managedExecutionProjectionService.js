import { createHash } from "node:crypto";
import {
  assertManagedExecutionPayloadSecretFree,
  managedError,
  parseJson,
  sha256Json,
} from "./managedExecutionCore.js";
import { appendManagedEvent, withManagedTransaction } from "./managedExecutionPersistence.js";

const ACTIVE_STEP_STATUSES = new Set(["pending", "running", "awaiting"]);
const TERMINAL_STEP_STATUSES = new Set(["completed", "failed", "skipped"]);
const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);
const SAFE_EVENT_EVIDENCE_KEYS = new Set([
  "step_run_id",
  "step_key",
  "hold_id",
  "escalated_hold_id",
  "from_status",
  "to_status",
  "run_status",
  "attempt",
  "previous_attempt",
  "next_attempt",
  "max_attempts",
  "assigned_to",
  "previous_assigned_to",
  "assignee_role",
  "effect_class",
  "authority_fingerprint_sha256",
  "skipped_step_count",
  "rejected_hold_count",
  "reason",
]);

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function oneOrNull(rows = []) {
  return rows.length === 1 ? rows[0] : null;
}

function safeTimestamp(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeReason(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.slice(0, 240);
}

function safeEventEvidence(value) {
  const evidence = parseJson(value, {});
  const result = {};
  for (const key of SAFE_EVENT_EVIDENCE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(evidence, key)) continue;
    const child = evidence[key];
    if (["string", "number", "boolean"].includes(typeof child) || child === null) {
      result[key] = key === "reason" ? safeReason(child) : child;
    }
  }
  return result;
}

function evidenceDigest(value) {
  const evidence = parseJson(value, {});
  return sha256Json(evidence);
}

function authoritySummary(binding = {}) {
  const snapshot = parseJson(binding.authority_snapshot_json, {});
  return {
    authority_fingerprint_sha256: binding.authority_fingerprint_sha256 || snapshot.fingerprint_sha256 || null,
    capability_key: binding.capability_key || snapshot.capability_key || null,
    effect_class: binding.effect_class || snapshot.effect_class || null,
    resource: {
      type: binding.resource_type || snapshot.resource?.type || null,
      ref: binding.resource_ref || snapshot.resource?.ref || null,
    },
    approval_required: snapshot.approval?.required === true,
    approval_required_role: snapshot.approval?.required_role || null,
    resource_grant_id: snapshot.resource_grant?.grant_id || null,
    resource_grant_source: snapshot.resource_grant?.source || null,
    resolved_at: snapshot.authority_resolved_at || snapshot.resolved_at || null,
    secrets_included: false,
  };
}

function runSummary(run = {}) {
  const error = parseJson(run.error_json, {});
  return {
    run_id: run.run_id || null,
    tenant_id: run.tenant_id || null,
    requester_id: run.user_id || null,
    workflow_key: run.workflow_key || null,
    service_mode: run.service_mode || null,
    status: run.status || null,
    started_at: safeTimestamp(run.started_at),
    completed_at: safeTimestamp(run.completed_at),
    has_output: Boolean(run.output_json),
    has_error: Boolean(run.error_json),
    error_code: typeof error?.code === "string" ? error.code.slice(0, 128) : null,
    secrets_included: false,
  };
}

function stepSummary(step = {}) {
  return {
    step_run_id: step.step_run_id || null,
    step_key: step.step_key || null,
    step_type: step.step_type || null,
    assigned_to: step.assigned_to || null,
    status: step.status || null,
    attempt: Number(step.attempt || 1),
    started_at: safeTimestamp(step.started_at),
    completed_at: safeTimestamp(step.completed_at),
    has_output: Boolean(step.output_json),
    has_error: Boolean(step.error_message),
    secrets_included: false,
  };
}

function holdSummary(hold = {}) {
  return {
    hold_id: hold.hold_id || null,
    hold_type: hold.hold_type || null,
    required_role: hold.required_role || null,
    assigned_to: hold.assigned_to || null,
    status: hold.status || null,
    expires_at: safeTimestamp(hold.expires_at),
    decided_at: safeTimestamp(hold.decided_at),
    decision_by: hold.decision_by || null,
    secrets_included: false,
  };
}

function ticketSummary(ticket = {}) {
  if (!ticket?.ticket_id) return null;
  return {
    ticket_id: ticket.ticket_id,
    tenant_id: ticket.tenant_id || null,
    title: ticket.title || null,
    status: ticket.status || null,
    lifecycle_state: ticket.lifecycle_state || null,
    customer_status: ticket.customer_status || null,
    parent_ticket_id: ticket.parent_ticket_id || null,
    target_capability: ticket.target_capability || null,
    assigned_to: ticket.assigned_to || null,
    updated_at: safeTimestamp(ticket.updated_at),
    secrets_included: false,
  };
}

function contradiction(code, severity, message, options = {}) {
  return {
    code,
    severity,
    message,
    auto_repairable: options.auto_repairable === true,
    current: options.current ?? null,
    expected: options.expected ?? null,
    resource_ref: options.resource_ref || null,
    secrets_included: false,
  };
}

function latestRelevantHold(holds = []) {
  const ranked = [...holds].sort((left, right) => {
    const leftTime = new Date(left.decided_at || left.created_at || 0).getTime();
    const rightTime = new Date(right.decided_at || right.created_at || 0).getTime();
    return rightTime - leftTime;
  });
  return ranked[0] || null;
}

function canonicalState({ run = {}, binding = {}, holds = [], steps = [] }) {
  const runStatus = normalized(run.status);
  const openHolds = holds.filter((hold) => normalized(hold.status) === "open");
  const latestHold = latestRelevantHold(holds);
  const rollbackStep = steps.find((step) => step.step_key === "__managed_rollback__") || null;
  const rollbackCompleted = rollbackStep && normalized(rollbackStep.status) === "completed";

  if (binding.lifecycle_state === "rolled_back" || (runStatus === "cancelled" && rollbackCompleted)) {
    return {
      run_status: "cancelled",
      lifecycle_state: "rolled_back",
      customer_status: "cancelled",
      ticket_status: "resolved",
      approval_hold_id: binding.approval_hold_id || null,
      source: "completed_compensation_rollback",
    };
  }

  if (openHolds.length === 1) {
    const hold = openHolds[0];
    const escalated = normalized(hold.hold_type) === "supervisor_approval" || normalized(hold.required_role) === "supervisor";
    return {
      run_status: "awaiting_approval",
      lifecycle_state: escalated ? "escalated" : "awaiting_approval",
      customer_status: "waiting_for_approval",
      ticket_status: "awaiting_approval",
      approval_hold_id: hold.hold_id,
      source: escalated ? "open_supervisor_hold" : "open_approval_hold",
    };
  }

  if (latestHold && normalized(latestHold.status) === "approved" && runStatus === "awaiting_approval") {
    return {
      run_status: "running",
      lifecycle_state: "executing",
      customer_status: "in_progress",
      ticket_status: "in_review",
      approval_hold_id: latestHold.hold_id,
      source: "approved_hold",
    };
  }
  if (latestHold && normalized(latestHold.status) === "rejected") {
    return {
      run_status: "failed",
      lifecycle_state: "approval_rejected",
      customer_status: "failed",
      ticket_status: "resolved",
      approval_hold_id: latestHold.hold_id,
      source: "rejected_hold",
    };
  }
  if (latestHold && normalized(latestHold.status) === "expired") {
    return {
      run_status: "awaiting_approval",
      lifecycle_state: "approval_expired",
      customer_status: "needs_your_input",
      ticket_status: "awaiting_approval",
      approval_hold_id: latestHold.hold_id,
      source: "expired_hold",
    };
  }

  const mapping = {
    pending: ["ready", "in_progress", "in_review"],
    running: [binding.lifecycle_state === "rollback_executing" ? "rollback_executing" : "executing", "in_progress", "in_review"],
    paused: ["blocked", "blocked", "in_review"],
    awaiting_review: ["verification_pending", "under_review", "in_review"],
    awaiting_approval: ["awaiting_approval", "waiting_for_approval", "awaiting_approval"],
    completed: ["verified", "completed", "resolved"],
    failed: [binding.lifecycle_state === "approval_rejected" ? "approval_rejected" : "failed", "failed", "resolved"],
    cancelled: ["cancelled", "cancelled", "resolved"],
  };
  const values = mapping[runStatus] || [binding.lifecycle_state || "unknown", binding.customer_status || "under_review", "in_review"];
  return {
    run_status: runStatus || null,
    lifecycle_state: values[0],
    customer_status: values[1],
    ticket_status: values[2],
    approval_hold_id: binding.approval_hold_id || null,
    source: "run_status",
  };
}

export function analyzeManagedExecutionState({
  run = {},
  bindingRows = [],
  taskRows = [],
  parentRows = [],
  holds = [],
  steps = [],
}) {
  const contradictions = [];
  const binding = oneOrNull(bindingRows);
  const task = oneOrNull(taskRows);
  const parent = oneOrNull(parentRows);
  const openHolds = holds.filter((hold) => normalized(hold.status) === "open");
  const activeSteps = steps.filter((step) => ACTIVE_STEP_STATUSES.has(normalized(step.status)));
  const runningSteps = steps.filter((step) => normalized(step.status) === "running");
  const failedSteps = steps.filter((step) => normalized(step.status) === "failed");
  const rollbackSteps = steps.filter((step) => step.step_key === "__managed_rollback__");

  if (!run?.run_id) {
    contradictions.push(contradiction("managed_execution_run_missing", "critical", "Workflow run is missing."));
  }
  if (bindingRows.length !== 1) {
    contradictions.push(contradiction(
      bindingRows.length ? "managed_execution_binding_ambiguous" : "managed_execution_binding_missing",
      "critical",
      bindingRows.length ? "Multiple managed execution bindings exist for one run." : "Managed execution binding is missing.",
      { current: bindingRows.length, expected: 1 },
    ));
  }
  if (binding && taskRows.length !== 1) {
    contradictions.push(contradiction(
      taskRows.length ? "managed_execution_task_ambiguous" : "managed_execution_task_missing",
      "critical",
      taskRows.length ? "Multiple task tickets match the managed execution binding." : "Managed task ticket is missing.",
      { current: taskRows.length, expected: 1, resource_ref: binding.task_ticket_id },
    ));
  }
  if (binding && parentRows.length !== 1) {
    contradictions.push(contradiction(
      parentRows.length ? "managed_execution_parent_ticket_ambiguous" : "managed_execution_parent_ticket_missing",
      "critical",
      parentRows.length ? "Multiple parent tickets match the managed execution binding." : "Managed execution parent ticket is missing.",
      { current: parentRows.length, expected: 1, resource_ref: binding.parent_ticket_id },
    ));
  }

  if (binding && String(binding.tenant_id || "") !== String(run.tenant_id || "")) {
    contradictions.push(contradiction("managed_execution_binding_tenant_mismatch", "critical", "Run and binding tenant identifiers differ.", { current: binding.tenant_id, expected: run.tenant_id }));
  }
  if (task && String(task.tenant_id || "") !== String(run.tenant_id || "")) {
    contradictions.push(contradiction("managed_execution_task_tenant_mismatch", "critical", "Run and task ticket tenant identifiers differ.", { current: task.tenant_id, expected: run.tenant_id }));
  }
  if (parent && String(parent.tenant_id || "") !== String(run.tenant_id || "")) {
    contradictions.push(contradiction("managed_execution_parent_tenant_mismatch", "critical", "Run and parent ticket tenant identifiers differ.", { current: parent.tenant_id, expected: run.tenant_id }));
  }
  if (binding && task && String(task.ticket_id || "") !== String(binding.task_ticket_id || "")) {
    contradictions.push(contradiction("managed_execution_task_link_mismatch", "critical", "Task ticket does not match the binding task_ticket_id.", { current: task.ticket_id, expected: binding.task_ticket_id }));
  }
  if (binding && task && String(task.parent_ticket_id || "") !== String(binding.parent_ticket_id || "")) {
    contradictions.push(contradiction("managed_execution_task_parent_mismatch", "critical", "Task ticket parent relationship does not match the binding parent ticket.", { current: task.parent_ticket_id, expected: binding.parent_ticket_id }));
  }
  if (holds.some((hold) => String(hold.tenant_id || "") !== String(run.tenant_id || ""))) {
    contradictions.push(contradiction("managed_execution_hold_tenant_mismatch", "critical", "At least one approval hold belongs to a different tenant."));
  }
  if (steps.some((step) => String(step.tenant_id || "") !== String(run.tenant_id || ""))) {
    contradictions.push(contradiction("managed_execution_step_tenant_mismatch", "critical", "At least one step belongs to a different tenant."));
  }
  if (openHolds.length > 1) {
    contradictions.push(contradiction("managed_execution_multiple_open_holds", "critical", "Multiple approval holds are open for one run.", { current: openHolds.length, expected: 1 }));
  }
  if (rollbackSteps.length > 1) {
    contradictions.push(contradiction("managed_execution_multiple_rollback_steps", "critical", "Multiple managed rollback compensation steps exist.", { current: rollbackSteps.length, expected: 1 }));
  }
  if (openHolds.length && ["running", "completed", "cancelled"].includes(normalized(run.status))) {
    contradictions.push(contradiction("managed_execution_run_active_while_approval_open", "high", "Run status conflicts with an open approval hold."));
  }
  if (TERMINAL_RUN_STATUSES.has(normalized(run.status)) && activeSteps.length) {
    contradictions.push(contradiction("managed_execution_terminal_run_has_active_steps", "critical", "Terminal run still has active linked steps.", { current: activeSteps.map((step) => step.step_run_id), expected: [] }));
  }
  if (normalized(run.status) === "completed" && failedSteps.length) {
    contradictions.push(contradiction("managed_execution_completed_run_has_failed_steps", "critical", "Completed run contains failed steps.", { current: failedSteps.map((step) => step.step_run_id), expected: [] }));
  }
  if (normalized(run.status) === "awaiting_approval" && !openHolds.length) {
    const latest = latestRelevantHold(holds);
    if (!latest || !["approved", "rejected", "expired"].includes(normalized(latest.status))) {
      contradictions.push(contradiction("managed_execution_awaiting_approval_without_evidence", "critical", "Run awaits approval without one open or terminal approval record."));
    }
  }
  if (binding?.lifecycle_state === "rollback_executing" && rollbackSteps.length !== 1) {
    contradictions.push(contradiction("managed_execution_rollback_state_without_step", "critical", "Rollback lifecycle state requires exactly one compensation step."));
  }
  if (binding?.lifecycle_state === "rolled_back") {
    const rollback = rollbackSteps[0] || null;
    if (!rollback || normalized(rollback.status) !== "completed" || normalized(run.status) !== "cancelled") {
      contradictions.push(contradiction("managed_execution_rolled_back_without_completed_compensation", "critical", "Rolled-back lifecycle requires a completed compensation step and cancelled workflow run."));
    }
  }

  const canonical = binding ? canonicalState({ run, binding, holds, steps }) : null;
  if (canonical && normalized(run.status) !== normalized(canonical.run_status)) {
    contradictions.push(contradiction("managed_execution_run_status_drift", "high", "Workflow run status differs from approval/recovery evidence.", {
      auto_repairable: true,
      current: run.status || null,
      expected: canonical.run_status,
    }));
  }
  if (canonical && normalized(binding.lifecycle_state) !== normalized(canonical.lifecycle_state)) {
    contradictions.push(contradiction("managed_execution_binding_lifecycle_drift", "high", "Binding lifecycle state differs from canonical linked evidence.", {
      auto_repairable: true,
      current: binding.lifecycle_state || null,
      expected: canonical.lifecycle_state,
    }));
  }
  if (canonical && normalized(binding.customer_status) !== normalized(canonical.customer_status)) {
    contradictions.push(contradiction("managed_execution_binding_customer_status_drift", "medium", "Binding customer status differs from canonical linked evidence.", {
      auto_repairable: true,
      current: binding.customer_status || null,
      expected: canonical.customer_status,
    }));
  }
  if (canonical && task && normalized(task.lifecycle_state) !== normalized(canonical.lifecycle_state)) {
    contradictions.push(contradiction("managed_execution_task_lifecycle_drift", "high", "Task lifecycle state differs from canonical linked evidence.", {
      auto_repairable: true,
      current: task.lifecycle_state || null,
      expected: canonical.lifecycle_state,
    }));
  }
  if (canonical && task && normalized(task.customer_status) !== normalized(canonical.customer_status)) {
    contradictions.push(contradiction("managed_execution_task_customer_status_drift", "medium", "Task customer status differs from canonical linked evidence.", {
      auto_repairable: true,
      current: task.customer_status || null,
      expected: canonical.customer_status,
    }));
  }
  if (canonical && task) {
    const allowedPendingStatuses = canonical.run_status === "pending" ? new Set(["open", "in_review"]) : null;
    const statusMatches = allowedPendingStatuses
      ? allowedPendingStatuses.has(normalized(task.status))
      : normalized(task.status) === normalized(canonical.ticket_status);
    if (!statusMatches) {
      contradictions.push(contradiction("managed_execution_task_status_drift", "high", "Task status differs from canonical linked evidence.", {
        auto_repairable: true,
        current: task.status || null,
        expected: canonical.ticket_status,
      }));
    }
  }
  if (canonical && String(binding.approval_hold_id || "") !== String(canonical.approval_hold_id || "")) {
    contradictions.push(contradiction("managed_execution_binding_hold_link_drift", "medium", "Binding approval_hold_id differs from canonical approval evidence.", {
      auto_repairable: true,
      current: binding.approval_hold_id || null,
      expected: canonical.approval_hold_id || null,
    }));
  }

  const blocking = contradictions.filter((item) => item.auto_repairable !== true);
  const repairable = contradictions.filter((item) => item.auto_repairable === true);
  const reconciliationActions = [];
  if (!blocking.length && canonical && binding && task) {
    if (normalized(run.status) !== normalized(canonical.run_status)) {
      reconciliationActions.push({ table: "workflow_runs", key: run.run_id, field: "status", from: run.status || null, to: canonical.run_status });
    }
    for (const [field, expected] of [["lifecycle_state", canonical.lifecycle_state], ["customer_status", canonical.customer_status], ["approval_hold_id", canonical.approval_hold_id || null]]) {
      if (String(binding[field] || "") !== String(expected || "")) reconciliationActions.push({ table: "managed_execution_bindings", key: binding.binding_id, field, from: binding[field] || null, to: expected });
    }
    const taskExpected = {
      lifecycle_state: canonical.lifecycle_state,
      customer_status: canonical.customer_status,
      status: canonical.ticket_status,
    };
    for (const [field, expected] of Object.entries(taskExpected)) {
      const pendingCompatible = field === "status" && canonical.run_status === "pending" && ["open", "in_review"].includes(normalized(task[field]));
      if (!pendingCompatible && String(task[field] || "") !== String(expected || "")) reconciliationActions.push({ table: "tickets", key: task.ticket_id, field, from: task[field] || null, to: expected });
    }
  }

  const planPayload = {
    contract: "managed_execution_reconciliation_plan.v1",
    run_id: run.run_id || null,
    binding_id: binding?.binding_id || null,
    task_ticket_id: task?.ticket_id || binding?.task_ticket_id || null,
    canonical,
    actions: reconciliationActions,
    blocking_contradiction_codes: blocking.map((item) => item.code).sort(),
  };
  const planFingerprint = sha256Json(planPayload);
  return {
    canonical,
    contradictions,
    blocking_contradictions: blocking,
    repairable_contradictions: repairable,
    metrics: {
      total_steps: steps.length,
      active_steps: activeSteps.length,
      running_steps: runningSteps.length,
      completed_steps: steps.filter((step) => normalized(step.status) === "completed").length,
      failed_steps: failedSteps.length,
      skipped_steps: steps.filter((step) => normalized(step.status) === "skipped").length,
      open_holds: openHolds.length,
    },
    reconciliation: {
      auto_applicable: blocking.length === 0,
      action_count: reconciliationActions.length,
      actions: reconciliationActions,
      plan_fingerprint_sha256: planFingerprint,
      required_confirmation: run.run_id ? `RECONCILE_MANAGED_EXECUTION:${run.run_id}:${planFingerprint}` : null,
      secrets_included: false,
    },
    secrets_included: false,
  };
}

function deriveTenantAction({ analysis, run, holds, steps }) {
  if (analysis.blocking_contradictions.length) return "support_review_required";
  const openHold = holds.find((hold) => normalized(hold.status) === "open");
  if (openHold) return "approval_decision_required";
  if (steps.some((step) => normalized(step.status) === "failed")) return "recovery_action_required";
  if (normalized(run.status) === "paused") return "operator_action_required";
  if (normalized(run.status) === "awaiting_review") return "verification_in_progress";
  if (TERMINAL_RUN_STATUSES.has(normalized(run.status))) return "none";
  return "continue_execution";
}

function deriveTenantBlocker({ analysis, run, holds, steps }) {
  if (analysis.blocking_contradictions.length) {
    return { code: "linked_state_review", message: "The linked execution records require support review before work can continue." };
  }
  const openHold = holds.find((hold) => normalized(hold.status) === "open");
  if (openHold) return { code: "approval_required", message: "An approval decision is required before work can continue." };
  if (steps.some((step) => normalized(step.status) === "failed")) return { code: "step_failed", message: "A managed step failed and requires an authorized recovery action." };
  if (normalized(run.status) === "paused") return { code: "execution_paused", message: "Execution is paused pending operator action." };
  return null;
}

export function projectManagedExecutionForTenant({ state, analysis }) {
  const { run, binding, task, holds, steps } = state;
  const completed = analysis.metrics.completed_steps + analysis.metrics.skipped_steps;
  const progressPercent = analysis.metrics.total_steps
    ? Math.min(100, Math.round((completed / analysis.metrics.total_steps) * 100))
    : normalized(run.status) === "completed" ? 100 : 0;
  const openHold = holds.find((hold) => normalized(hold.status) === "open") || null;
  return {
    contract: "managed_execution_tenant_projection.v1",
    run_id: run.run_id,
    task_ticket_id: binding?.task_ticket_id || null,
    parent_ticket_id: binding?.parent_ticket_id || null,
    title: task?.title || null,
    status: run.status || null,
    lifecycle_state: analysis.blocking_contradictions.length ? "reconciliation_required" : (binding?.lifecycle_state || run.status || "unknown"),
    customer_status: analysis.blocking_contradictions.length ? "under_review" : (binding?.customer_status || "under_review"),
    progress: {
      percent: progressPercent,
      total_steps: analysis.metrics.total_steps,
      completed_steps: analysis.metrics.completed_steps,
      active_steps: analysis.metrics.active_steps,
      failed_steps: analysis.metrics.failed_steps,
    },
    approval: {
      pending: Boolean(openHold),
      required_role: openHold?.required_role || null,
      expires_at: safeTimestamp(openHold?.expires_at),
    },
    blocker: deriveTenantBlocker({ analysis, run, holds, steps }),
    requested_input: openHold ? "approval_decision" : null,
    next_action: deriveTenantAction({ analysis, run, holds, steps }),
    final_result: TERMINAL_RUN_STATUSES.has(normalized(run.status))
      ? { status: run.status, completed_at: safeTimestamp(run.completed_at) }
      : null,
    support_reference: analysis.blocking_contradictions.length ? run.run_id : null,
    secrets_included: false,
  };
}

export function projectManagedExecutionForAdmin({ state, analysis }) {
  const { run, binding, task, parent, holds, steps, events } = state;
  return {
    contract: "managed_execution_admin_projection.v1",
    tenant_projection: projectManagedExecutionForTenant({ state, analysis }),
    run: runSummary(run),
    binding: binding ? {
      binding_id: binding.binding_id,
      tenant_id: binding.tenant_id,
      parent_ticket_id: binding.parent_ticket_id,
      task_ticket_id: binding.task_ticket_id,
      lifecycle_state: binding.lifecycle_state,
      customer_status: binding.customer_status,
      approval_hold_id: binding.approval_hold_id || null,
      created_at: safeTimestamp(binding.created_at),
      updated_at: safeTimestamp(binding.updated_at),
      authority: authoritySummary(binding),
      secrets_included: false,
    } : null,
    task: ticketSummary(task),
    parent_ticket: ticketSummary(parent),
    holds: holds.map(holdSummary),
    steps: steps.map(stepSummary),
    interventions: events.map((event) => ({
      event_id: event.event_id || null,
      event_type: event.event_type || null,
      from_state: event.from_state || null,
      to_state: event.to_state || null,
      actor_id: event.actor_id || null,
      evidence_summary: safeEventEvidence(event.evidence_json),
      evidence_sha256: evidenceDigest(event.evidence_json),
      created_at: safeTimestamp(event.created_at),
      secrets_included: false,
    })),
    state_matrix: {
      run_status: run.status || null,
      binding_lifecycle_state: binding?.lifecycle_state || null,
      binding_customer_status: binding?.customer_status || null,
      task_status: task?.status || null,
      task_lifecycle_state: task?.lifecycle_state || null,
      task_customer_status: task?.customer_status || null,
      open_hold_ids: holds.filter((hold) => normalized(hold.status) === "open").map((hold) => hold.hold_id),
      active_step_ids: steps.filter((step) => ACTIVE_STEP_STATUSES.has(normalized(step.status))).map((step) => step.step_run_id),
      terminal_step_ids: steps.filter((step) => TERMINAL_STEP_STATUSES.has(normalized(step.status))).map((step) => step.step_run_id),
      secrets_included: false,
    },
    contradictions: analysis.contradictions,
    reconciliation: analysis.reconciliation,
    secrets_included: false,
  };
}

async function loadManagedProjectionState(connection, runId, { forUpdate = false } = {}) {
  const lock = forUpdate ? " FOR UPDATE" : "";
  const [runRows] = await connection.query(`SELECT * FROM workflow_runs WHERE run_id = ? LIMIT 2${lock}`, [runId]);
  if (runRows.length !== 1) throw managedError(404, "managed_execution_run_not_found", "Managed execution run was not found.");
  const run = runRows[0];
  const context = parseJson(run.execution_context_json, {});
  if (context.contract !== "tenant-managed-execution-v1") throw managedError(409, "managed_execution_run_contract_mismatch", "Run is not owned by managed execution lifecycle.");

  const [bindingRows] = await connection.query(`SELECT * FROM managed_execution_bindings WHERE run_id = ? ORDER BY id${lock}`, [runId]);
  const binding = oneOrNull(bindingRows);
  let taskRows = [];
  let parentRows = [];
  if (binding) {
    [taskRows] = await connection.query(`SELECT * FROM tickets WHERE ticket_id = ? AND tenant_id = ? LIMIT 2${lock}`, [binding.task_ticket_id, binding.tenant_id]);
    [parentRows] = await connection.query(`SELECT * FROM tickets WHERE ticket_id = ? AND tenant_id = ? LIMIT 2${lock}`, [binding.parent_ticket_id, binding.tenant_id]);
  }
  const [holds] = await connection.query(`SELECT * FROM approval_holds WHERE run_id = ? ORDER BY id${lock}`, [runId]);
  const [steps] = await connection.query(`SELECT * FROM step_runs WHERE run_id = ? ORDER BY id${lock}`, [runId]);
  const [events] = await connection.query(
    "SELECT event_id, event_type, from_state, to_state, actor_id, evidence_json, created_at FROM managed_execution_events WHERE run_id = ? ORDER BY id DESC LIMIT 100",
    [runId],
  );
  return {
    run,
    bindingRows,
    binding,
    taskRows,
    task: oneOrNull(taskRows),
    parentRows,
    parent: oneOrNull(parentRows),
    holds,
    steps,
    events,
  };
}

export async function readManagedExecutionProjection({ pool, runId, view = "tenant" }) {
  const state = await loadManagedProjectionState(pool, runId);
  const analysis = analyzeManagedExecutionState(state);
  return view === "admin"
    ? projectManagedExecutionForAdmin({ state, analysis })
    : projectManagedExecutionForTenant({ state, analysis });
}

function assertAdminReconciliation(isAdmin) {
  if (isAdmin !== true) {
    throw managedError(
      403,
      "managed_execution_reconciliation_admin_required",
      "Managed execution reconciliation requires platform admin authority.",
    );
  }
}

function actionDigest(actions = []) {
  return createHash("sha256").update(JSON.stringify(actions)).digest("hex");
}

async function applyReconciliationActions(connection, state, analysis) {
  const canonical = analysis.canonical;
  if (!canonical || !state.binding || !state.task) {
    throw managedError(409, "managed_execution_reconciliation_state_incomplete", "Managed execution reconciliation requires one binding and one task ticket.");
  }
  await connection.query(
    `UPDATE workflow_runs
        SET status = ?,
            started_at = CASE WHEN ? = 'running' THEN COALESCE(started_at, NOW()) ELSE started_at END,
            completed_at = CASE WHEN ? IN ('completed','failed','cancelled') THEN COALESCE(completed_at, NOW()) ELSE NULL END
      WHERE run_id = ?`,
    [canonical.run_status, canonical.run_status, canonical.run_status, state.run.run_id],
  );
  await connection.query(
    "UPDATE managed_execution_bindings SET lifecycle_state = ?, customer_status = ?, approval_hold_id = ? WHERE binding_id = ?",
    [canonical.lifecycle_state, canonical.customer_status, canonical.approval_hold_id, state.binding.binding_id],
  );
  await connection.query(
    "UPDATE tickets SET lifecycle_state = ?, customer_status = ?, status = ?, updated_at = NOW() WHERE ticket_id = ? AND tenant_id = ?",
    [canonical.lifecycle_state, canonical.customer_status, canonical.ticket_status, state.task.ticket_id, state.binding.tenant_id],
  );
}

export async function reconcileManagedExecutionState({
  pool,
  runId,
  mode = "dry_run",
  confirmation = null,
  actorId = null,
  isAdmin = false,
}) {
  assertAdminReconciliation(isAdmin);
  const normalizedMode = normalized(mode || "dry_run");
  if (!["dry_run", "apply"].includes(normalizedMode)) {
    throw managedError(400, "managed_execution_reconciliation_mode_invalid", "mode must be dry_run or apply.");
  }

  if (normalizedMode === "dry_run") {
    const state = await loadManagedProjectionState(pool, runId);
    const analysis = analyzeManagedExecutionState(state);
    return {
      ok: analysis.blocking_contradictions.length === 0,
      mode: "dry_run",
      applied: false,
      run_id: runId,
      contradictions: analysis.contradictions,
      reconciliation: analysis.reconciliation,
      admin_projection: projectManagedExecutionForAdmin({ state, analysis }),
      secrets_included: false,
    };
  }

  return withManagedTransaction(pool, async (connection) => {
    const state = await loadManagedProjectionState(connection, runId, { forUpdate: true });
    const analysis = analyzeManagedExecutionState(state);
    if (analysis.blocking_contradictions.length) {
      throw managedError(
        409,
        "managed_execution_reconciliation_blocked",
        "Managed execution has contradictions that require manual investigation.",
        { contradiction_codes: analysis.blocking_contradictions.map((item) => item.code) },
      );
    }
    if (confirmation !== analysis.reconciliation.required_confirmation) {
      throw managedError(
        409,
        "managed_execution_reconciliation_confirmation_required",
        "Reconciliation confirmation does not match the current plan fingerprint.",
        { required_confirmation: analysis.reconciliation.required_confirmation },
      );
    }
    if (!analysis.reconciliation.action_count) {
      return {
        ok: true,
        mode: "apply",
        applied: false,
        reused: true,
        run_id: runId,
        reconciliation: analysis.reconciliation,
        secrets_included: false,
      };
    }

    assertManagedExecutionPayloadSecretFree(analysis.reconciliation.actions, "reconciliation.actions");
    await applyReconciliationActions(connection, state, analysis);
    await appendManagedEvent(connection, {
      bindingId: state.binding.binding_id,
      runId,
      tenantId: state.binding.tenant_id,
      eventType: "managed_execution_reconciled",
      fromState: state.binding.lifecycle_state,
      toState: analysis.canonical.lifecycle_state,
      actorId,
      evidence: {
        plan_fingerprint_sha256: analysis.reconciliation.plan_fingerprint_sha256,
        action_digest_sha256: actionDigest(analysis.reconciliation.actions),
        action_count: analysis.reconciliation.action_count,
        canonical_source: analysis.canonical.source,
      },
    });

    const finalState = await loadManagedProjectionState(connection, runId, { forUpdate: true });
    const finalAnalysis = analyzeManagedExecutionState(finalState);
    if (finalAnalysis.contradictions.length) {
      throw managedError(
        409,
        "managed_execution_reconciliation_readback_failed",
        "Managed execution still contains contradictions after reconciliation readback.",
        { contradiction_codes: finalAnalysis.contradictions.map((item) => item.code) },
      );
    }
    return {
      ok: true,
      mode: "apply",
      applied: true,
      reused: false,
      run_id: runId,
      previous_plan_fingerprint_sha256: analysis.reconciliation.plan_fingerprint_sha256,
      projection: projectManagedExecutionForAdmin({ state: finalState, analysis: finalAnalysis }),
      secrets_included: false,
    };
  });
}
