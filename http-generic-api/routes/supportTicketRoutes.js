import { Router } from "express";
import jwt from "jsonwebtoken";
import { getPool } from "../db.js";
import {
  appendSupportTicketEvent,
  assignSupportTicket,
  createOrAppendSupportTicket,
  createSupportTicketApprovalHold,
  getSupportTicketWithEvents,
  linkSupportTicketWorkflow,
  listSupportTicketsForTenant,
  reconcileOpenSupportTickets,
  reconcileSupportTicketSla,
  transitionSupportTicket,
} from "../supportTicketService.js";

const JWT_SECRET = process.env.JWT_SECRET || "development_fallback_secret_only";

function verifyUserJwt(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  try { return jwt.verify(authHeader.slice(7), JWT_SECRET); } catch { return null; }
}

function requireUserJwt(req, res, next) {
  const payload = req.auth?.mode === "user_jwt" ? req.auth : verifyUserJwt(req.headers.authorization);
  if (!payload || !payload.user_id) {
    return res.status(401).json({ ok: false, error: { code: "user_jwt_required", message: "Sign in required." }, secrets_included: false });
  }
  req.auth = { mode: "user_jwt", user_id: payload.user_id, tenant_id: payload.tenant_id || null, is_admin: false };
  return next();
}

async function resolveTenantForUser(req, res) {
  const requestedTenantId = String(req.auth?.tenant_id || req.query?.tenant_id || req.body?.tenant_id || "").trim();
  const params = [req.auth.user_id];
  let where = "m.user_id = ? AND m.status = 'active' AND t.status = 'active'";
  if (requestedTenantId) {
    where += " AND m.tenant_id = ?";
    params.push(requestedTenantId);
  }
  const [rows] = await getPool().query(
    `SELECT m.user_id, m.tenant_id, m.role, t.display_name AS tenant_display_name
       FROM memberships m
       JOIN tenants t ON t.tenant_id = m.tenant_id
      WHERE ${where}
      ORDER BY m.granted_at ASC
      LIMIT 1`,
    params
  );
  const membership = rows[0] || null;
  if (!membership) {
    res.status(403).json({ ok: false, error: { code: "active_membership_required", message: "Active workspace membership required." }, secrets_included: false });
    return null;
  }
  return membership;
}

async function resolveTicketTenant(ticketId, fallbackTenantId = null) {
  if (fallbackTenantId) return fallbackTenantId;
  const [rows] = await getPool().query("SELECT tenant_id FROM tickets WHERE ticket_id = ? LIMIT 1", [ticketId]);
  return rows[0]?.tenant_id || null;
}

function sendError(res, err, fallbackCode) {
  return res.status(err.status || 500).json({ ok: false, error: { code: err.code || fallbackCode, message: err.message }, secrets_included: false });
}

function tenantTicketEnvelope(req, membership) {
  const body = req.body || {};
  return {
    tenant_id: membership.tenant_id,
    user_id: req.auth.user_id,
    actor_id: req.auth.user_id,
    actor_type: "tenant_user",
    role_at_creation: membership.role,
    source_layer: body.source_layer || "tenant_gpt",
    source_tool: body.source_tool || "support_ticket_create",
    source_event: body.source_event || body.ticket_type || body.issue_type || "general_support",
    ticket_type: body.ticket_type || body.issue_type || body.source_event || "general_support",
    title: body.title,
    customer_message: body.customer_message || body.message,
    internal_summary: body.internal_summary || body.body || "Tenant-created support work envelope.",
    category: body.category,
    priority: body.priority,
    severity: body.severity,
    service_mode: body.service_mode || "managed",
    resource: body.resource || { type: body.resource_type || null, ref: body.resource_ref || null, relationship: body.resource_relationship || "subject" },
    authority: body.authority || body.permission_snapshot || {
      role_at_creation: membership.role,
      requested_action: body.source_event || body.ticket_type || "support_ticket_create",
      source: "tenant_membership",
      decision: "ticket_created_by_active_member",
    },
    metadata_json: {
      ...(body.metadata_json && typeof body.metadata_json === "object" ? body.metadata_json : {}),
      tenant_display_name: membership.tenant_display_name || null,
      customer_safe: true,
      secrets_included: false,
    },
    dedupe_key: body.dedupe_key,
  };
}

export function buildSupportTicketRoutes(deps = {}) {
  const { requireBackendApiKey, requireAdminPrincipal } = deps;
  const router = Router();
  const adminGuards = [requireBackendApiKey, requireAdminPrincipal].filter(Boolean);

  router.post("/me/support/tickets", requireUserJwt, async (req, res) => {
    try {
      const membership = await resolveTenantForUser(req, res);
      if (!membership) return;
      const result = await createOrAppendSupportTicket(tenantTicketEnvelope(req, membership));
      return res.status(result.created ? 201 : 200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_create_failed");
    }
  });

  router.get("/me/support/tickets", requireUserJwt, async (req, res) => {
    try {
      const membership = await resolveTenantForUser(req, res);
      if (!membership) return;
      const tickets = await listSupportTicketsForTenant({
        tenant_id: membership.tenant_id,
        user_id: req.auth.user_id,
        status: req.query?.status || null,
        customer_visible: true,
        limit: req.query?.limit || 100,
      });
      return res.status(200).json({ ok: true, tenant_id: membership.tenant_id, tickets, count: tickets.length, secrets_included: false });
    } catch (err) {
      return sendError(res, err, "support_ticket_list_failed");
    }
  });

  router.get("/me/support/tickets/:ticket_id", requireUserJwt, async (req, res) => {
    try {
      const membership = await resolveTenantForUser(req, res);
      if (!membership) return;
      const result = await getSupportTicketWithEvents({ tenant_id: membership.tenant_id, ticket_id: req.params.ticket_id, customer_visible: true });
      if (!result) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      return res.status(200).json({ ok: true, ...result, secrets_included: false });
    } catch (err) {
      return sendError(res, err, "support_ticket_get_failed");
    }
  });

  router.post("/me/support/tickets/:ticket_id/events", requireUserJwt, async (req, res) => {
    try {
      const membership = await resolveTenantForUser(req, res);
      if (!membership) return;
      const result = await appendSupportTicketEvent({
        tenant_id: membership.tenant_id,
        ticket_id: req.params.ticket_id,
        event_type: req.body?.event_type || "customer_reply_added",
        summary: req.body?.summary || req.body?.message,
        actor_id: req.auth.user_id,
        actor_type: "tenant_user",
        visibility: "customer",
        payload_json: { ...(req.body?.payload_json || {}), customer_safe: true, secrets_included: false },
      });
      return res.status(201).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_event_append_failed");
    }
  });

  router.post("/admin/support/tickets/reconcile", ...adminGuards, async (req, res) => {
    try {
      const result = await reconcileOpenSupportTickets({
        tenant_id: req.body?.tenant_id || req.query?.tenant_id || null,
        limit: req.body?.limit || req.query?.limit || 100,
        apply: Boolean(req.body?.apply),
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_reconcile_failed");
    }
  });

  router.get("/admin/support/tickets", ...adminGuards, async (req, res) => {
    try {
      const params = [];
      const filters = [];
      if (req.query?.tenant_id) { filters.push("tenant_id = ?"); params.push(req.query.tenant_id); }
      if (req.query?.status) { filters.push("status = ?"); params.push(req.query.status); }
      if (req.query?.queue_key) { filters.push("queue_key = ?"); params.push(req.query.queue_key); }
      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
      params.push(Math.min(Math.max(Number(req.query?.limit || 100), 1), 500));
      const [rows] = await getPool().query(
        `SELECT ticket_id, tenant_id, user_id, title, ticket_type, category, priority, severity, status, lifecycle_state, customer_status, queue_key, assignment_status, assigned_to, service_mode, occurrence_count, created_at, updated_at, last_seen_at
           FROM tickets ${where}
          ORDER BY updated_at DESC
          LIMIT ?`,
        params
      );
      return res.status(200).json({ ok: true, tickets: rows, count: rows.length, secrets_included: false });
    } catch (err) {
      return sendError(res, err, "support_ticket_admin_list_failed");
    }
  });

  router.get("/admin/support/tickets/:ticket_id", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await getSupportTicketWithEvents({ tenant_id: tenantId, ticket_id: req.params.ticket_id, customer_visible: false });
      if (!result) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      return res.status(200).json({ ok: true, ...result, secrets_included: false });
    } catch (err) {
      return sendError(res, err, "support_ticket_admin_get_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/transition", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await transitionSupportTicket({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        to_state: req.body?.to_state,
        status: req.body?.status || null,
        customer_status: req.body?.customer_status || null,
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
        reason: req.body?.reason || "Admin lifecycle transition.",
        evidence_json: req.body?.evidence_json || {},
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_transition_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/assign", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await assignSupportTicket({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        queue_key: req.body?.queue_key || null,
        assigned_to: req.body?.assigned_to || null,
        assigned_actor_type: req.body?.assigned_actor_type || null,
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
        reason: req.body?.reason || "Admin assignment update.",
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_assign_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/events", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await appendSupportTicketEvent({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        event_type: req.body?.event_type || "internal_note_added",
        summary: req.body?.summary || req.body?.message,
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
        visibility: req.body?.visibility || "internal_support",
        payload_json: req.body?.payload_json || {},
      });
      return res.status(201).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_admin_event_append_failed");
    }
  });

  return router;
}
