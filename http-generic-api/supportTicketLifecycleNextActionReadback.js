import { getPool } from "./db.js";

function parseJson(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
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

function normalizeRowJson(row = {}, jsonFields = []) {
  const out = { ...row };
  for (const field of jsonFields) {
    if (Object.prototype.hasOwnProperty.call(out, field)) out[field] = parseJson(out[field], null);
  }
  return out;
}

function buildGuidance({ ticket, snapshot, recommendation }) {
  const decision = recommendation?.decision_json || {};
  const state = decision.state_classification || snapshot?.state_classification || ticket?.lifecycle_state || "unknown";
  const action = decision.recommended_next_action || "review_support_ticket_state";
  const blockers = recommendation?.blockers_json || snapshot?.blockers_json || [];
  const guidance = {
    state_classification: state,
    recommended_next_action: action,
    admin_next_action: action,
    customer_safe_summary: "Support Ticket lifecycle evidence has been reviewed. No customer-facing execution was performed.",
    customer_safe_next_step: "Retry or continue from the tenant-facing flow only after the operator confirms the recommendation.",
    requires_operator_review: true,
    requires_runtime_link_review: action === "evaluate_whether_runtime_or_approval_link_is_required",
    requires_approval_review: action === "request_or_decide_approval_hold",
    blocker_count: Array.isArray(blockers) ? blockers.length : 0,
  };

  if (state === "ticket_ready_for_customer_update") {
    guidance.customer_safe_summary = "The ticket has enough lifecycle evidence for a customer-safe update.";
    guidance.customer_safe_next_step = "Tell the tenant the runtime validation is ready and ask them to retry the Tenant GPT flow. If retry fails, capture the failure as a new runtime link before any execution change.";
  } else if (state === "ticket_awaiting_approval") {
    guidance.customer_safe_summary = "The ticket is waiting on an approval-related decision.";
    guidance.customer_safe_next_step = "Ask the responsible operator to review the approval hold before any execution or customer-facing send.";
  } else if (state === "ticket_blocked_by_failed_workflow") {
    guidance.customer_safe_summary = "A failed workflow or step is blocking the ticket.";
    guidance.customer_safe_next_step = "Review the failed run/step evidence and prepare remediation before customer confirmation.";
  } else if (state === "ticket_ready_for_triage") {
    guidance.customer_safe_summary = "The ticket is ready for triage.";
    guidance.customer_safe_next_step = "Complete triage and decide whether runtime, approval, or external delivery links are required.";
  }
  return guidance;
}

export async function readSupportTicketLifecycleNextAction(input = {}) {
  const ticketId = normalizeTicketId(input.ticket_id || input.ticketId);
  const pluginKey = "support_ticket_lifecycle_orchestrator";
  const pool = getPool();

  const [[ticketRows], [snapshotRows], [recommendationRows]] = await Promise.all([
    pool.query(
      `SELECT ticket_id, tenant_id, user_id, title, category, priority, severity, status,
              lifecycle_state, customer_status, queue_key, assignment_status, service_mode,
              metadata_json, sla_status, created_at, updated_at
         FROM tickets
        WHERE ticket_id = ?
        LIMIT 1`,
      [ticketId]
    ),
    pool.query(
      `SELECT snapshot_id, snapshot_key, plugin_key, scope_type, scope_id, tenant_id,
              subject_key, state_classification, maturity_score, input_sources_json,
              state_json, maturity_json, blockers_json, safety_json, status,
              secrets_included, created_at, updated_at
         FROM platform_orchestration_state_snapshots
        WHERE plugin_key = ?
          AND scope_type = 'ticket'
          AND scope_id = ?
        ORDER BY created_at DESC
        LIMIT 1`,
      [pluginKey, ticketId]
    ),
    pool.query(
      `SELECT recommendation_id, recommendation_key, snapshot_id, plugin_key,
              scope_type, scope_id, task_class, recommendation_type, priority,
              recommendation_status, decision_json, blockers_json, next_actions_json,
              safety_contract_json, secrets_included, created_at, updated_at
         FROM platform_orchestration_recommendations
        WHERE plugin_key = ?
          AND scope_type = 'ticket'
          AND scope_id = ?
        ORDER BY created_at DESC
        LIMIT 1`,
      [pluginKey, ticketId]
    ),
  ]);

  const ticket = ticketRows[0] ? normalizeRowJson(ticketRows[0], ["metadata_json"]) : null;
  if (!ticket) {
    const err = new Error("Support Ticket was not found.");
    err.status = 404;
    err.code = "support_ticket_not_found";
    throw err;
  }
  const snapshot = snapshotRows[0] ? normalizeRowJson(snapshotRows[0], ["input_sources_json", "state_json", "maturity_json", "blockers_json", "safety_json"]) : null;
  const recommendation = recommendationRows[0] ? normalizeRowJson(recommendationRows[0], ["decision_json", "blockers_json", "next_actions_json", "safety_contract_json"]) : null;
  const guidance = buildGuidance({ ticket, snapshot, recommendation });

  return {
    ok: true,
    ticket_id: ticketId,
    plugin_key: pluginKey,
    readback_mode: "support_ticket_lifecycle_next_action_readonly",
    readiness_status: snapshot && recommendation ? "ready_next_action_readback" : "degraded_missing_recorded_snapshot_or_recommendation",
    ticket,
    snapshot,
    recommendation,
    guidance,
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
      recommendation_only: true,
    },
    secrets_included: false,
  };
}
