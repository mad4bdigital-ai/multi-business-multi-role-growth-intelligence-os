import { Router } from "express";
import { getPool } from "../db.js";
import {
  createOrAppendSupportTicketWithIntegrity,
  listSupportTicketsWithIntegrity,
  reconcileSupportTicketIntegrity,
} from "../supportTicketLifecycleIntegrityService.js";
import { createUserJwtMiddleware } from "../userJwtAuth.js";

async function resolveTenantMembership({ userId, tenantId = null }) {
  const params = [userId];
  const filters = ["m.user_id = ?", "m.status = 'active'", "t.status = 'active'"];
  if (tenantId) {
    filters.push("m.tenant_id = ?");
    params.push(tenantId);
  }
  const [rows] = await getPool().query(
    `SELECT m.user_id, m.tenant_id, m.role, t.display_name AS tenant_display_name
       FROM memberships m
       JOIN tenants t ON t.tenant_id = m.tenant_id
      WHERE ${filters.join(" AND ")}
      ORDER BY m.granted_at ASC
      LIMIT 1`,
    params,
  );
  return rows[0] || null;
}

function buildTenantEnvelope(req, membership, overrides = {}) {
  const body = req.body || {};
  const metadata = body.metadata_json && typeof body.metadata_json === "object" ? body.metadata_json : {};
  return {
    ...body,
    ...overrides,
    tenant_id: membership.tenant_id,
    user_id: overrides.user_id || req.auth?.user_id || membership.user_id,
    actor_id: overrides.actor_id || req.auth?.user_id || membership.user_id,
    actor_type: overrides.actor_type || "tenant_user",
    role_at_creation: membership.role,
    source_layer: body.source_layer || "tenant_gpt",
    source_tool: body.source_tool || "support_ticket_create",
    source_event: body.source_event || body.ticket_type || body.issue_type || "general_support",
    ticket_type: body.ticket_type || body.issue_type || body.source_event || "general_support",
    title: body.title,
    customer_message: body.customer_message || body.message,
    internal_summary: body.internal_summary || body.body || "Tenant-created support work envelope.",
    resource: body.resource || {
      type: body.resource_type || null,
      ref: body.resource_ref || null,
      relationship: body.resource_relationship || "subject",
    },
    authority: body.authority || body.permission_snapshot || {
      role_at_creation: membership.role,
      requested_action: body.source_event || body.ticket_type || "support_ticket_create",
      source: "tenant_membership",
      decision: "ticket_created_by_active_member",
    },
    metadata_json: {
      ...metadata,
      tenant_display_name: membership.tenant_display_name || null,
      customer_safe: true,
      secrets_included: false,
      ...(overrides.metadata_json || {}),
    },
  };
}

function sendError(res, error, fallbackCode) {
  return res.status(error.status || 500).json({
    ok: false,
    error: {
      code: error.code || fallbackCode,
      message: error.message,
      ...(error.schema ? { schema: error.schema } : {}),
    },
    secrets_included: false,
  });
}

export function buildSupportTicketLifecycleIntegrityRoutes(deps = {}) {
  const router = Router();
  const requireUserJwt = deps.requireUserJwt || createUserJwtMiddleware({ env: deps.env || process.env });
  const adminGuards = [deps.requireBackendApiKey, deps.requireAdminPrincipal].filter(Boolean);

  // Mounted before the legacy support router so new ticket creation always uses
  // the v2 dedupe and integrity contract without changing legacy read/detail APIs.
  router.post("/me/support/tickets", requireUserJwt, async (req, res) => {
    try {
      const requestedTenantId = String(req.auth?.tenant_id || req.query?.tenant_id || req.body?.tenant_id || "").trim() || null;
      const membership = await resolveTenantMembership({ userId: req.auth.user_id, tenantId: requestedTenantId });
      if (!membership) {
        return res.status(403).json({
          ok: false,
          error: { code: "active_membership_required", message: "Active workspace membership required." },
          secrets_included: false,
        });
      }
      const result = await createOrAppendSupportTicketWithIntegrity(buildTenantEnvelope(req, membership));
      return res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      return sendError(res, error, "support_ticket_integrity_create_failed");
    }
  });

  router.get("/me/support/tickets", requireUserJwt, async (req, res) => {
    try {
      const requestedTenantId = String(req.auth?.tenant_id || req.query?.tenant_id || "").trim() || null;
      const membership = await resolveTenantMembership({ userId: req.auth.user_id, tenantId: requestedTenantId });
      if (!membership) {
        return res.status(403).json({
          ok: false,
          error: { code: "active_membership_required", message: "Active workspace membership required." },
          secrets_included: false,
        });
      }
      const result = await listSupportTicketsWithIntegrity({
        tenant_id: membership.tenant_id,
        user_id: req.auth.user_id,
        status: req.query?.status || null,
        include_test: false,
        limit: req.query?.limit || 100,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error, "support_ticket_integrity_list_failed");
    }
  });

  router.post("/admin/support/tickets/tenant-user/create-simulation", ...adminGuards, async (req, res) => {
    try {
      const tenantId = String(req.body?.tenant_id || "").trim();
      const userId = String(req.body?.user_id || "").trim();
      if (!tenantId || !userId) {
        const error = new Error("tenant_id and user_id are required for admin tenant-ticket simulation.");
        error.status = 400;
        error.code = "support_ticket_tenant_user_simulation_identity_required";
        throw error;
      }
      const membership = await resolveTenantMembership({ userId, tenantId });
      if (!membership) {
        const error = new Error("Active tenant membership was not found for simulation identity.");
        error.status = 403;
        error.code = "support_ticket_tenant_user_simulation_membership_required";
        throw error;
      }
      const simulatedReq = {
        body: req.body || {},
        auth: { user_id: membership.user_id },
      };
      const result = await createOrAppendSupportTicketWithIntegrity(buildTenantEnvelope(simulatedReq, membership, {
        user_id: membership.user_id,
        actor_id: req.auth?.user_id || "admin_ticket_simulation",
        actor_type: "admin_simulation",
        is_test: true,
        environment: req.body?.environment || "production",
        visibility_class: "internal_test",
        metadata_json: {
          admin_simulation: true,
          route_equivalent: "/me/support/tickets",
          support_additive_only: true,
          secrets_included: false,
        },
      }));
      return res.status(result.created ? 201 : 200).json({
        ...result,
        mode: "tenant_user_route_equivalent_simulation",
        route_equivalent: "/me/support/tickets",
        support_additive_only: true,
        secrets_included: false,
      });
    } catch (error) {
      return sendError(res, error, "support_ticket_tenant_user_create_simulation_failed");
    }
  });

  router.get("/admin/support/tickets/integrity/reconcile", ...adminGuards, async (req, res) => {
    try {
      const result = await reconcileSupportTicketIntegrity({
        tenant_id: req.query?.tenant_id || null,
        limit: req.query?.limit || 100,
        apply: false,
        actor_id: req.auth?.user_id || "support_ticket_integrity_reconciler",
        actor_type: "admin",
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error, "support_ticket_integrity_reconcile_failed");
    }
  });

  router.post("/admin/support/tickets/integrity/reconcile", ...adminGuards, async (req, res) => {
    try {
      const apply = req.body?.mode === "apply" || req.body?.apply === true;
      if (apply && req.body?.confirm !== "APPLY_SUPPORT_TICKET_INTEGRITY_RECONCILIATION") {
        return res.status(409).json({
          ok: false,
          error: {
            code: "support_ticket_integrity_confirmation_required",
            message: "Typed confirmation is required for apply mode.",
          },
          expected_confirmation: "APPLY_SUPPORT_TICKET_INTEGRITY_RECONCILIATION",
          secrets_included: false,
        });
      }
      const result = await reconcileSupportTicketIntegrity({
        tenant_id: req.body?.tenant_id || null,
        limit: req.body?.limit || 100,
        apply,
        actor_id: req.auth?.user_id || "support_ticket_integrity_reconciler",
        actor_type: "admin",
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error, "support_ticket_integrity_reconcile_failed");
    }
  });

  return router;
}
