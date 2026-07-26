import { getPool } from "./db.js";

function parseJson(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function boundedInt(value, fallback = 10, min = 1, max = 50) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function normalizeRowJson(row = {}, jsonFields = []) {
  const out = { ...row };
  for (const field of jsonFields) {
    if (Object.prototype.hasOwnProperty.call(out, field)) {
      out[field] = parseJson(out[field], null);
    }
  }
  return out;
}

function normalizeTicket(row = {}) {
  return normalizeRowJson(row, ["metadata_json"]);
}

export async function readSupportTicketLifecycleOrchestrationReadiness(input = {}) {
  const pool = getPool();
  const limit = boundedInt(input.limit, 10, 1, 50);
  const tenantId = String(input.tenant_id || input.tenantId || "").trim();

  let readiness = null;
  try {
    const [rows] = await pool.query(
      `SELECT * FROM v_platform_orchestration_support_ticket_lifecycle_readiness LIMIT 1`
    );
    readiness = rows[0] ? normalizeRowJson(rows[0], ["state_distribution_json", "safety_json", "evidence_json"]) : null;
  } catch {
    readiness = null;
  }

  const ticketParams = [];
  const ticketFilters = [];
  if (tenantId) {
    ticketFilters.push("tenant_id = ?");
    ticketParams.push(tenantId);
  }
  ticketParams.push(limit);
  const [ticketRows] = await pool.query(
    `SELECT ticket_id, tenant_id, title, category, priority, severity, status,
            lifecycle_state, customer_status, queue_key, assignment_status,
            service_mode, source_layer, source_tool, source_event,
            metadata_json, sla_status, occurrence_count, last_seen_at,
            first_response_due_at, triage_due_at, resolution_due_at,
            created_at, updated_at
       FROM tickets
      ${ticketFilters.length ? `WHERE ${ticketFilters.join(" AND ")}` : ""}
      ORDER BY updated_at DESC
      LIMIT ?`,
    ticketParams
  );

  const eventParams = [];
  const eventFilters = [];
  if (tenantId) {
    eventFilters.push("tenant_id = ?");
    eventParams.push(tenantId);
  }
  eventParams.push(limit);
  const [eventRows] = await pool.query(
    `SELECT event_id, ticket_id, tenant_id, event_type, from_state, to_state,
            actor_type, visibility, summary, payload_json, created_at
       FROM ticket_lifecycle_events
      ${eventFilters.length ? `WHERE ${eventFilters.join(" AND ")}` : ""}
      ORDER BY created_at DESC
      LIMIT ?`,
    eventParams
  );

  const linkParams = [];
  const linkFilters = [];
  if (tenantId) {
    linkFilters.push("tenant_id = ?");
    linkParams.push(tenantId);
  }
  linkParams.push(limit);
  const [workflowLinkRows] = await pool.query(
    `SELECT link_id, ticket_id, tenant_id, plan_id, run_id, approval_hold_id,
            relationship, status, evidence_json, created_at, updated_at
       FROM ticket_workflow_links
      ${linkFilters.length ? `WHERE ${linkFilters.join(" AND ")}` : ""}
      ORDER BY updated_at DESC
      LIMIT ?`,
    linkParams
  );

  return {
    ok: true,
    plugin_key: "support_ticket_lifecycle_orchestrator",
    readback_mode: "support_ticket_lifecycle_readonly",
    readiness_status: readiness?.readiness_status || "validating_support_ticket_lifecycle_readiness_view",
    readiness,
    recent_tickets: ticketRows.map(normalizeTicket),
    recent_events: eventRows.map((row) => normalizeRowJson(row, ["payload_json"])),
    recent_workflow_links: workflowLinkRows.map((row) => normalizeRowJson(row, ["evidence_json"])),
    execution: {
      will_execute_provider_call: false,
      will_read_credential_payload: false,
      will_change_spend: false,
      will_external_write: false,
      will_external_send: false,
      will_deploy: false,
      will_publish: false,
      recommendation_only: true,
    },
    secrets_included: false,
  };
}
