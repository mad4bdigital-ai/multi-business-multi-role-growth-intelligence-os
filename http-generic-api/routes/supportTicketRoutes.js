import { Router } from "express";
import jwt from "jsonwebtoken";
import { getPool } from "../db.js";
import {
  appendSupportTicketEvent,
  applySupportTicketBrandMappingRemediation,
  assignSupportTicket,
  completeSupportTicketBrandMappingRemediation,
  createOrAppendSupportTicket,
  createSupportTicketApprovalHold,
  createSupportTicketExecutionPlan,
  createSupportTicketStepRuns,
  createSupportTicketWorkflowRun,
  decideSupportTicketApprovalHold,
  executeSupportTicketDiagnosticStep,
  getSupportTicketWithEvents,
  linkSupportTicketWorkflow,
  listSupportTicketsForTenant,
  reconcileOpenSupportTickets,
  reconcileSupportTicketSla,
  resolveSupportTicketBrandRefs,
  runSupportTicketDiagnosticChain,
  syncSupportTicketRuntimeStatus,
  transitionSupportTicket,
  updateSupportTicketStepRun,
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

function explicitBrandRefsFromBody(body = {}) {
  const refs = [];
  if (body.brand_ref) refs.push(String(body.brand_ref).trim());
  if (Array.isArray(body.brand_refs)) refs.push(...body.brand_refs.map((ref) => String(ref || "").trim()));
  return [...new Set(refs.filter(Boolean))];
}

async function requireTrustedBrandRefForRemediation({ tenant_id, ticket_id, body = {} }) {
  const explicitRefs = explicitBrandRefsFromBody(body);
  if (explicitRefs.length) return { brand_ref: explicitRefs[0], brand_refs: explicitRefs, source: "explicit_request", resolution: null };
  const resolution = await resolveSupportTicketBrandRefs({ tenant_id, ticket_id, min_confidence: body.min_confidence || 75, limit: body.limit || 25 });
  if (resolution.selected_brand_ref) return { brand_ref: resolution.selected_brand_ref, brand_refs: [resolution.selected_brand_ref], source: "trusted_resolution", resolution };
  const err = new Error("A trusted brand_ref is required before applying brand mapping remediation.");
  err.status = 400;
  err.code = "support_ticket_trusted_brand_ref_required";
  err.resolution = resolution;
  throw err;
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

  router.post("/admin/support/tickets/sla/reconcile", ...adminGuards, async (req, res) => {
    try {
      const result = await reconcileSupportTicketSla({
        tenant_id: req.body?.tenant_id || req.query?.tenant_id || null,
        limit: req.body?.limit || req.query?.limit || 100,
        apply: Boolean(req.body?.apply),
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_sla_reconcile_failed");
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

  router.post("/admin/support/tickets/:ticket_id/approval-hold", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await createSupportTicketApprovalHold({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        hold_type: req.body?.hold_type || "review",
        required_role: req.body?.required_role || "workspace_owner_admin",
        assigned_to: req.body?.assigned_to || null,
        reason: req.body?.reason || "Approval required for support ticket action.",
        expires_at: req.body?.expires_at || null,
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
        evidence_json: req.body?.evidence_json || {},
      });
      return res.status(201).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_approval_hold_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/execution-plan", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await createSupportTicketExecutionPlan({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        workflow_key: req.body?.workflow_key || null,
        intent_key: req.body?.intent_key || null,
        target_key: req.body?.target_key || null,
        route_key: req.body?.route_key || null,
        service_mode: req.body?.service_mode || "managed",
        access_decision: req.body?.access_decision || null,
        steps_json: req.body?.steps_json || null,
        preview_json: req.body?.preview_json || null,
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
        reason: req.body?.reason || "Execution plan created from support ticket.",
        evidence_json: req.body?.evidence_json || {},
      });
      return res.status(201).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_execution_plan_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/workflow-run", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await createSupportTicketWorkflowRun({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        plan_id: req.body?.plan_id || null,
        status: req.body?.status || "pending",
        current_step: req.body?.current_step || null,
        input_json: req.body?.input_json || null,
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
        reason: req.body?.reason || "Workflow run created from support ticket execution plan.",
        evidence_json: req.body?.evidence_json || {},
      });
      return res.status(201).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_workflow_run_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/step-runs", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await createSupportTicketStepRuns({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        run_id: req.body?.run_id || null,
        plan_id: req.body?.plan_id || null,
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
        reason: req.body?.reason || "Step runs created from support ticket workflow run.",
        evidence_json: req.body?.evidence_json || {},
      });
      return res.status(201).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_step_runs_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/approval-hold/decision", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await decideSupportTicketApprovalHold({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        approval_hold_id: req.body?.approval_hold_id || null,
        decision: req.body?.decision,
        decision_note: req.body?.decision_note || null,
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
        reason: req.body?.reason || "Approval hold decision recorded.",
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_approval_hold_decision_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/brand-mapping-remediation/complete", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const trustedBrandRef = await requireTrustedBrandRefForRemediation({ tenant_id: tenantId, ticket_id: req.params.ticket_id, body: req.body || {} });
      const result = await completeSupportTicketBrandMappingRemediation({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        approval_hold_id: req.body?.approval_hold_id || null,
        brand_ref: trustedBrandRef.brand_ref,
        brand_refs: trustedBrandRef.brand_refs,
        permission: req.body?.permission || "manage",
        approve_first: Boolean(req.body?.approve_first),
        close_if_verified: req.body?.close_if_verified !== false,
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
        reason: req.body?.reason || "Approved brand mapping remediation completed.",
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_brand_mapping_remediation_complete_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/brand-ref-resolution", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await resolveSupportTicketBrandRefs({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        user_id: req.body?.user_id || null,
        brand_ref: req.body?.brand_ref || null,
        brand_refs: req.body?.brand_refs || null,
        min_confidence: req.body?.min_confidence || 70,
        limit: req.body?.limit || 25,
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_brand_ref_resolution_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/brand-mapping-remediation", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await applySupportTicketBrandMappingRemediation({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        approval_hold_id: req.body?.approval_hold_id || null,
        brand_ref: req.body?.brand_ref || null,
        brand_refs: req.body?.brand_refs || null,
        permission: req.body?.permission || "manage",
        dry_run: Boolean(req.body?.dry_run),
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
        reason: req.body?.reason || "Approved brand mapping remediation applied.",
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_brand_mapping_remediation_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/diagnostic-chain", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await runSupportTicketDiagnosticChain({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        run_id: req.body?.run_id || null,
        plan_id: req.body?.plan_id || null,
        max_steps: req.body?.max_steps || 10,
        create_remediation_hold: req.body?.create_remediation_hold !== false,
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
        reason: req.body?.reason || "Diagnostic chain executed for support ticket.",
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_diagnostic_chain_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/step-run/execute", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await executeSupportTicketDiagnosticStep({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        step_run_id: req.body?.step_run_id || null,
        run_id: req.body?.run_id || null,
        step_key: req.body?.step_key || null,
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
        reason: req.body?.reason || "Diagnostic step executed for support ticket.",
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_diagnostic_step_execute_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/step-run", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await updateSupportTicketStepRun({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        step_run_id: req.body?.step_run_id || null,
        run_id: req.body?.run_id || null,
        step_key: req.body?.step_key || null,
        status: req.body?.status,
        output_json: req.body?.output_json || null,
        error_message: req.body?.error_message || null,
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
        reason: req.body?.reason || "Step run status updated.",
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_step_run_update_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/runtime-sync", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await syncSupportTicketRuntimeStatus({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        run_id: req.body?.run_id || null,
        plan_id: req.body?.plan_id || null,
        approval_hold_id: req.body?.approval_hold_id || null,
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
        reason: req.body?.reason || "Runtime status synchronized to support ticket.",
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_runtime_sync_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/link-workflow", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await linkSupportTicketWorkflow({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        plan_id: req.body?.plan_id || null,
        run_id: req.body?.run_id || null,
        approval_hold_id: req.body?.approval_hold_id || null,
        relationship: req.body?.relationship || "diagnostic",
        status: req.body?.status || "linked",
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
        evidence_json: req.body?.evidence_json || {},
      });
      return res.status(201).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_workflow_link_failed");
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
