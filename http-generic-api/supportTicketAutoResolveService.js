import { getPool } from "./db.js";

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function compactTicket(row = {}) {
  return {
    ticket_id: row.ticket_id,
    tenant_id: row.tenant_id,
    user_id: row.user_id || null,
    title: row.title,
    ticket_type: row.ticket_type || null,
    category: row.category,
    priority: row.priority,
    severity: row.severity || null,
    status: row.status,
    lifecycle_state: row.lifecycle_state || null,
    customer_status: row.customer_status || null,
    queue_key: row.queue_key || null,
    assignment_status: row.assignment_status || null,
    assigned_to: row.assigned_to || null,
    service_mode: row.service_mode || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    metadata_json: parseJsonObject(row.metadata_json, null),
    secrets_included: false,
  };
}

const AUTO_RESOLVE_POLICIES = {
  brand_authority_missing: {
    allowed: true,
    confidence: 80,
    action_key: "brand_mapping_remediation_finalize",
    requires_admin_approval: true,
    readback_required: true,
    rollback_required: true,
    notify_before_apply: true,
    notify_after_apply: true,
    max_risk_level: "medium",
    summary: "Brand authority issues may be auto-resolved only by proposing a verified remediation plan; apply requires admin approval.",
  },
  tenant_onboarding_issue: {
    allowed: true,
    confidence: 65,
    action_key: "tenant_onboarding_diagnostic",
    requires_admin_approval: true,
    readback_required: true,
    rollback_required: false,
    notify_before_apply: true,
    notify_after_apply: true,
    max_risk_level: "low",
    summary: "Tenant onboarding tickets may be diagnosed automatically; corrective action requires admin approval.",
  },
  connector_unreachable: {
    allowed: true,
    confidence: 70,
    action_key: "connector_health_recovery_diagnostic",
    requires_admin_approval: true,
    readback_required: true,
    rollback_required: false,
    notify_before_apply: true,
    notify_after_apply: true,
    max_risk_level: "medium",
    summary: "Connector issues may receive an auto-resolution proposal, but restarts or credential changes require admin approval.",
  },
  workflow_failed: {
    allowed: true,
    confidence: 60,
    action_key: "workflow_retry_once",
    requires_admin_approval: true,
    readback_required: true,
    rollback_required: false,
    notify_before_apply: true,
    notify_after_apply: true,
    max_risk_level: "medium",
    summary: "Workflow failures may be proposed for a single governed retry with admin approval.",
  },
};

function policyForTicket(ticket = {}) {
  const type = ticket.ticket_type || ticket.category || "general_support";
  const policy = AUTO_RESOLVE_POLICIES[type] || null;
  if (!policy) {
    return {
      allowed: false,
      confidence: 0,
      action_key: null,
      requires_admin_approval: true,
      readback_required: true,
      rollback_required: false,
      notify_before_apply: true,
      notify_after_apply: true,
      max_risk_level: "unknown",
      summary: "No auto-resolve policy is registered for this ticket type.",
    };
  }
  return { ticket_type: type, ...policy };
}

function proposalForTicket(ticket = {}) {
  const policy = policyForTicket(ticket);
  const metadata = parseJsonObject(ticket.metadata_json, {});
  const blockers = [];
  if (!policy.allowed) blockers.push("auto_resolve_policy_not_registered");
  if (ticket.status === "resolved" || ticket.lifecycle_state === "verified") blockers.push("ticket_already_resolved");
  if (ticket.status === "awaiting_approval") blockers.push("ticket_already_waiting_for_approval");
  const proposal = {
    eligible: policy.allowed && blockers.length === 0,
    confidence: policy.confidence || 0,
    action_key: policy.action_key,
    requires_admin_approval: policy.requires_admin_approval !== false,
    readback_required: policy.readback_required !== false,
    rollback_required: Boolean(policy.rollback_required),
    notify_before_apply: policy.notify_before_apply !== false,
    notify_after_apply: policy.notify_after_apply !== false,
    max_risk_level: policy.max_risk_level || "unknown",
    summary: policy.summary,
    blockers,
    evidence: {
      ticket_type: ticket.ticket_type || null,
      category: ticket.category || null,
      priority: ticket.priority || null,
      lifecycle_state: ticket.lifecycle_state || null,
      source: metadata?.source || metadata?.metadata?.source || null,
      customer_safe: metadata?.metadata?.customer_safe ?? metadata?.customer_safe ?? null,
      secrets_included: false,
    },
    secrets_included: false,
  };
  return proposal;
}

export async function listSupportTicketAutoResolveCandidates({ tenant_id = null, limit = 50, include_ineligible = false } = {}, options = {}) {
  const pool = options.pool || getPool();
  const max = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const params = [];
  const filters = ["t.status IN ('open','in_review','awaiting_approval')", "t.status <> 'resolved'"];
  if (tenant_id) { filters.push("t.tenant_id = ?"); params.push(tenant_id); }
  params.push(max);
  const [rows] = await pool.query(
    `SELECT t.*
       FROM tickets t
      WHERE ${filters.join(" AND ")}
      ORDER BY FIELD(t.priority, 'urgent','high','normal','low'), t.updated_at DESC
      LIMIT ?`,
    params
  );
  const evaluated = rows.map((row) => ({ ticket: compactTicket(row), proposal: proposalForTicket(row) }));
  const candidates = include_ineligible ? evaluated : evaluated.filter((item) => item.proposal.eligible);
  return {
    ok: true,
    mode: "auto_resolve_candidates",
    tenant_id: tenant_id || null,
    count: candidates.length,
    candidates,
    policy_count: Object.keys(AUTO_RESOLVE_POLICIES).length,
    secrets_included: false,
  };
}

async function fetchTicket(connection, tenant_id, ticket_id) {
  const [rows] = await connection.query("SELECT * FROM tickets WHERE tenant_id = ? AND ticket_id = ? LIMIT 1", [tenant_id, ticket_id]);
  return rows[0] || null;
}

export async function proposeSupportTicketAutoResolution({ tenant_id, ticket_id, force = false, actor_id = null, actor_type = "backend_ai_agent", summary = null, evidence_json = {} } = {}, options = {}) {
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    if (ownsConnection) await connection.beginTransaction();
    const ticket = await fetchTicket(connection, tenant_id, ticket_id);
    if (!ticket) {
      const err = new Error("Ticket not found.");
      err.status = 404;
      err.code = "support_ticket_not_found";
      throw err;
    }
    const proposal = proposalForTicket(ticket);
    if (!proposal.eligible && !force) {
      const err = new Error("Ticket is not eligible for auto-resolution proposal under current policy.");
      err.status = 409;
      err.code = "support_ticket_auto_resolve_not_eligible";
      err.proposal = proposal;
      throw err;
    }
    const payload = {
      proposal,
      evidence_json,
      source: "backend_ai_auto_resolve_policy_engine",
      policy_version: "slice_u_v1",
      secrets_included: false,
    };
    await connection.query(
      `UPDATE tickets
          SET status = 'in_review', lifecycle_state = 'auto_resolution_proposed', customer_status = 'under_review', updated_at = NOW()
        WHERE tenant_id = ? AND ticket_id = ?`,
      [tenant_id, ticket_id]
    );
    await connection.query(
      `INSERT INTO ticket_lifecycle_events (event_id, ticket_id, tenant_id, event_type, from_state, to_state, actor_id, actor_type, visibility, summary, payload_json)
       VALUES (UUID(), ?, ?, 'backend_agent_proposed_resolution', ?, 'auto_resolution_proposed', ?, ?, 'internal_support', ?, ?)`,
      [ticket_id, tenant_id, ticket.lifecycle_state || null, actor_id, actor_type, summary || proposal.summary || "Backend AI agent proposed an auto-resolution candidate.", JSON.stringify(payload)]
    );
    await connection.query(
      `INSERT INTO audit_log (audit_id, tenant_id, actor_id, actor_type, action, resource_type, resource_id, after_json, service_mode)
       VALUES (UUID(), ?, ?, ?, 'support_ticket_auto_resolution_proposed', 'ticket', ?, ?, 'managed')`,
      [tenant_id, actor_id, actor_type, ticket_id, JSON.stringify({ proposal, secrets_included: false })]
    );
    const updated = await fetchTicket(connection, tenant_id, ticket_id);
    if (ownsConnection) await connection.commit();
    return { ok: true, proposal, ticket: compactTicket(updated), secrets_included: false };
  } catch (error) { if (ownsConnection) await connection.rollback(); throw error; }
  finally { if (ownsConnection) connection.release(); }
}
