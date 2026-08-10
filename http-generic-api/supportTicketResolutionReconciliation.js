import { ensureSupportTicketResolutionCase } from "./supportTicketResolutionService.js";

export const SUPPORT_TICKET_RESOLUTION_RECONCILIATION_CONFIRMATION = "APPLY_SUPPORT_TICKET_RESOLUTION_RECONCILIATION";

const OPEN_STATUSES = new Set(["open", "in_review", "awaiting_approval"]);

function text(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

export function supportTicketHasEscalationEvidence(ticket = {}) {
  const metadata = parseJson(ticket.metadata_json, {});
  const resolution = metadata && typeof metadata.resolution === "object" ? metadata.resolution : {};
  const values = [
    ticket.category,
    ticket.lifecycle_state,
    ticket.customer_status,
    ticket.source_event,
    metadata.case_status,
    metadata.current_step,
    metadata.current_step_key,
    resolution.case_status,
    resolution.current_step,
    resolution.current_step_key,
  ].map((value) => text(value, 191).toLowerCase()).filter(Boolean);
  return values.some((value) => value.includes("escalat") || value === "diagnostic_escalated");
}

function caseTicketId(row = {}) {
  const direct = text(row.ticket_id, 128);
  if (direct) return direct;
  const ref = text(row.resource_ref, 512);
  return ref.startsWith("ticket://") ? ref.slice("ticket://".length) : "";
}

function alertTicketId(row = {}) {
  if (text(row.source_type, 64).toLowerCase() !== "support_ticket") return "";
  const direct = text(row.source_record_id, 128);
  if (direct) return direct;
  const ref = text(row.source_ref, 512);
  return ref.startsWith("ticket://") ? ref.slice("ticket://".length) : "";
}

export function buildSupportTicketResolutionReconciliationPlan({
  tickets = [],
  cases = [],
  alerts = [],
  limit = 100,
} = {}) {
  const boundedLimit = Math.max(1, Math.min(Number(limit || 100), 500));
  const caseIds = new Set((Array.isArray(cases) ? cases : []).map(caseTicketId).filter(Boolean));
  const alertIds = new Set((Array.isArray(alerts) ? alerts : []).map(alertTicketId).filter(Boolean));
  const candidates = [];

  for (const ticket of Array.isArray(tickets) ? tickets : []) {
    if (!OPEN_STATUSES.has(text(ticket.status, 32).toLowerCase())) continue;
    const ticketId = text(ticket.ticket_id, 128);
    const tenantId = text(ticket.tenant_id, 64);
    if (!ticketId || !tenantId) continue;
    const caseMissing = !caseIds.has(ticketId);
    const escalation = supportTicketHasEscalationEvidence(ticket);
    const alertMissing = escalation && !alertIds.has(ticketId);
    if (!caseMissing && !alertMissing) continue;
    candidates.push({
      ticket_id: ticketId,
      tenant_id: tenantId,
      reason: caseMissing ? (alertMissing ? "resolution_case_and_alert_missing" : "resolution_case_missing") : "escalation_alert_missing",
      case_missing: caseMissing,
      escalation_evidence_present: escalation,
      alert_missing: alertMissing,
      operation: "ensure_support_ticket_resolution_case",
      secrets_included: false,
    });
    if (candidates.length >= boundedLimit) break;
  }

  return {
    ok: true,
    mode: "plan",
    candidate_count: candidates.length,
    truncated: candidates.length >= boundedLimit,
    limit: boundedLimit,
    candidates,
    safety: {
      uses_canonical_resolution_service: true,
      delete_allowed: false,
      provider_call_allowed: false,
      credential_payload_read_allowed: false,
      external_send_allowed: false,
      external_write_allowed: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}

export function assertSupportTicketResolutionReconciliationApplyAllowed({ apply = false, confirm = null } = {}) {
  if (!apply) {
    return {
      allowed: false,
      mode: "dry_run",
      required_confirmation: SUPPORT_TICKET_RESOLUTION_RECONCILIATION_CONFIRMATION,
    };
  }
  if (confirm !== SUPPORT_TICKET_RESOLUTION_RECONCILIATION_CONFIRMATION) {
    const error = new Error(`Apply requires confirmation ${SUPPORT_TICKET_RESOLUTION_RECONCILIATION_CONFIRMATION}.`);
    error.code = "SUPPORT_TICKET_RESOLUTION_RECONCILIATION_CONFIRMATION_REQUIRED";
    throw error;
  }
  return { allowed: true, mode: "apply" };
}

export async function applySupportTicketResolutionReconciliation({
  connection,
  tickets = [],
  plan,
  actor_id = "support_ticket_resolution_reconciliation",
} = {}) {
  if (!connection || typeof connection.query !== "function") {
    const error = new Error("A SQL transaction connection is required.");
    error.code = "SUPPORT_TICKET_RESOLUTION_RECONCILIATION_CONNECTION_REQUIRED";
    throw error;
  }
  const byId = new Map((Array.isArray(tickets) ? tickets : []).map((ticket) => [text(ticket.ticket_id, 128), ticket]));
  const results = [];
  for (const candidate of plan?.candidates || []) {
    const ticket = byId.get(candidate.ticket_id);
    if (!ticket) {
      const error = new Error(`Reconciliation candidate ticket ${candidate.ticket_id} is no longer present in the bounded snapshot.`);
      error.code = "SUPPORT_TICKET_RESOLUTION_RECONCILIATION_TICKET_SNAPSHOT_MISMATCH";
      throw error;
    }
    const resolution = await ensureSupportTicketResolutionCase({ connection, ticket, actor_id });
    results.push({
      ticket_id: candidate.ticket_id,
      case_id: resolution.summary?.case_id || null,
      case_created: resolution.created === true,
      alert_required: resolution.operational_alert?.required === true,
      alert_created_or_refreshed: resolution.operational_alert?.created_or_refreshed === true,
      alert_key: resolution.operational_alert?.alert_key || null,
      secrets_included: false,
    });
  }
  return {
    applied_count: results.length,
    results,
    secrets_included: false,
  };
}
