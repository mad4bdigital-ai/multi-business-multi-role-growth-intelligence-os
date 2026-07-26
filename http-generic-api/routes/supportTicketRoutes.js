import { Router } from "express";
import jwt from "jsonwebtoken";
import { getPool } from "../db.js";
import {
  appendSupportTicketEvent,
  applySupportTicketBrandMappingRemediation,
  applySupportTicketBrandMappingVerified,
  approveSupportTicketBrandRefSelection,
  approveSupportTicketNewBrandRef,
  assignSupportTicket,
  completeSupportTicketBrandRefSelectionRemediation,
  completeSupportTicketBrandMappingRemediation,
  createOrAppendSupportTicket,
  createSupportTicketApprovalHold,
  createSupportTicketExecutionPlan,
  createSupportTicketStepRuns,
  createSupportTicketWorkflowRun,
  decideSupportTicketApprovalHold,
  executeSupportTicketDiagnosticStep,
  finalizeSupportTicketBrandMappingRemediation,
  getSupportTicketWithEvents,
  linkSupportTicketWorkflow,
  listSupportTicketsForTenant,
  reconcileOpenSupportTickets,
  reconcileSupportTicketSla,
  resolveSupportTicketBrandRefs,
  requestSupportTicketBrandRefSelection,
  requestSupportTicketNewBrandRefApproval,
  runSupportTicketDiagnosticChain,
  syncSupportTicketRuntimeStatus,
  transitionSupportTicket,
  updateSupportTicketStepRun,
} from "../supportTicketService.js";
import {
  getActivationTicketInbox,
  recordSupportTicketAdminFeedback,
} from "../supportTicketActivationInboxService.js";
import {
  listSupportTicketAutoResolveCandidates,
  proposeSupportTicketAutoResolution,
} from "../supportTicketAutoResolveService.js";
import {
  createSupportTicketNotificationCycle,
  listSupportTicketNotificationQueue,
  recordSupportTicketNotificationAck,
} from "../supportTicketNotificationService.js";
import {
  dispatchSupportTicketNotificationDelivery,
  listSupportTicketNotificationAdapters,
  previewSupportTicketNotificationDelivery,
} from "../supportTicketNotificationAdapterService.js";
import {
  checkSupportTicketExternalDeliveryReadiness,
  decideSupportTicketExternalDeliveryApproval,
  requestSupportTicketExternalDeliveryApproval,
} from "../supportTicketExternalDeliveryPolicyService.js";
import {
  certifySupportTicketExternalDeliveryCompletion,
} from "../supportTicketExternalDeliveryCompletionService.js";
import {
  planSupportTicketExternalSendExecution,
  recordSupportTicketExternalSendExecution,
} from "../supportTicketExternalSendExecutionService.js";
import {
  planSupportTicketExternalSendProviderGate,
  recordSupportTicketExternalSendProviderGateAttempt,
} from "../supportTicketExternalSendProviderGateService.js";
import {
  listSupportTicketExternalProviderContracts,
} from "../supportTicketExternalProviderContractService.js";
import {
  listSupportTicketExternalProviderEnablementCandidates,
  proposeSupportTicketExternalProviderAdapterEnablement,
} from "../supportTicketExternalProviderEnablementProposalService.js";
import {
  decideSupportTicketExternalAdapterReadinessChecklist,
  planSupportTicketExternalAdapterReadinessChecklist,
  recordSupportTicketExternalAdapterReadinessChecklist,
} from "../supportTicketExternalAdapterReadinessChecklistService.js";
import {
  planSupportTicketExternalAdapterFuturePrScope,
  recordSupportTicketExternalAdapterFuturePrScope,
} from "../supportTicketExternalAdapterFuturePrScopeService.js";
import {
  decideSupportTicketExternalCredentialBinding,
  listSupportTicketExternalCredentialCandidates,
  requestSupportTicketExternalCredentialBinding,
} from "../supportTicketExternalCredentialBindingService.js";
import {
  activateSupportTicketExternalSecretReference,
  planSupportTicketExternalSecretIntake,
  registerSupportTicketExternalSecretReference,
} from "../supportTicketExternalSecretIntakeService.js";
import {
  activateAndBindSupportTicketExternalCredential,
  planSupportTicketExternalCredentialActivation,
} from "../supportTicketExternalCredentialActivationService.js";
import {
  disableExternalDeliveryRecipientAllowlist,
  getExternalDeliveryAdminOverview,
  revokeGmailUserConnection,
  setExternalDeliveryAdapterDispatch,
  upsertExternalDeliveryRecipientAllowlist,
} from "../supportTicketExternalDeliveryAdminControlService.js";
import {
  approveActivateBindAndVerifySupportTicketExternalCredential,
  planSupportTicketExternalCredentialOrchestration,
} from "../supportTicketExternalCredentialOrchestrationService.js";
import {
  getAuthEmailOutboxStatus,
  runAuthEmailOutboxWorker,
  skipAuthEmailOutboxIneligible,
} from "../authEmailOutboxWorker.js";
import { canViewSupportTicketResolution } from "../supportTicketResolutionService.js";

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

async function resolveApprovedBrandRefSelection({ tenant_id, ticket_id }) {
  const [rows] = await getPool().query(
    `SELECT ah.hold_id,
            JSON_UNQUOTE(JSON_EXTRACT(ah.execution_context_json, '$.selected_brand_ref')) AS selected_brand_ref
       FROM ticket_workflow_links twl
       JOIN approval_holds ah ON ah.hold_id = twl.approval_hold_id AND ah.tenant_id = twl.tenant_id
      WHERE twl.tenant_id = ?
        AND twl.ticket_id = ?
        AND twl.relationship = 'brand_ref_selection'
        AND ah.status = 'approved'
        AND JSON_UNQUOTE(JSON_EXTRACT(ah.execution_context_json, '$.selected_brand_ref')) IS NOT NULL
        AND JSON_UNQUOTE(JSON_EXTRACT(ah.execution_context_json, '$.selected_brand_ref')) <> ''
      ORDER BY ah.decided_at DESC, ah.created_at DESC
      LIMIT 1`,
    [tenant_id, ticket_id]
  );
  const row = rows[0] || null;
  if (!row?.selected_brand_ref) return null;
  return { hold_id: row.hold_id, selected_brand_ref: String(row.selected_brand_ref).trim() };
}

async function requireTrustedBrandRefForRemediation({ tenant_id, ticket_id, body = {} }) {
  const explicitRefs = explicitBrandRefsFromBody(body);
  if (explicitRefs.length) return { brand_ref: explicitRefs[0], brand_refs: explicitRefs, source: "explicit_request", resolution: null, selection_hold_id: null };
  const approvedSelection = await resolveApprovedBrandRefSelection({ tenant_id, ticket_id });
  if (approvedSelection?.selected_brand_ref) return { brand_ref: approvedSelection.selected_brand_ref, brand_refs: [approvedSelection.selected_brand_ref], source: "approved_brand_ref_selection", resolution: null, selection_hold_id: approvedSelection.hold_id };
  const resolution = await resolveSupportTicketBrandRefs({ tenant_id, ticket_id, min_confidence: body.min_confidence || 75, limit: body.limit || 25 });
  if (resolution.selected_brand_ref) return { brand_ref: resolution.selected_brand_ref, brand_refs: [resolution.selected_brand_ref], source: "trusted_resolution", resolution, selection_hold_id: null };
  const err = new Error("A trusted brand_ref is required before applying brand mapping remediation.");
  err.status = 400;
  err.code = "support_ticket_trusted_brand_ref_required";
  err.resolution = resolution;
  throw err;
}

async function resolveMembershipForAdminTenantTicketSimulation({ tenant_id, user_id } = {}) {
  const requestedTenantId = String(tenant_id || "").trim();
  const requestedUserId = String(user_id || "").trim();
  if (!requestedTenantId || !requestedUserId) {
    const err = new Error("tenant_id and user_id are required for admin tenant-ticket simulation.");
    err.status = 400;
    err.code = "support_ticket_tenant_user_simulation_identity_required";
    throw err;
  }
  const [rows] = await getPool().query(
    `SELECT m.user_id, m.tenant_id, m.role, t.display_name AS tenant_display_name
       FROM memberships m
       JOIN tenants t ON t.tenant_id = m.tenant_id
      WHERE m.user_id = ?
        AND m.tenant_id = ?
        AND m.status = 'active'
        AND t.status = 'active'
      LIMIT 1`,
    [requestedUserId, requestedTenantId]
  );
  const membership = rows[0] || null;
  if (!membership) {
    const err = new Error("Active tenant membership was not found for simulation identity.");
    err.status = 403;
    err.code = "support_ticket_tenant_user_simulation_membership_required";
    throw err;
  }
  return membership;
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

  router.get("/admin/support/tickets/auth-email-outbox/status", ...adminGuards, async (req, res) => {
    try {
      const result = await getAuthEmailOutboxStatus({
        purposes: req.query?.purposes || "support_ticket_admin_notification",
      });
      return res.status(200).json({ ...result, resource_authority: "auth_email_outbox", secrets_included: false });
    } catch (err) {
      return sendError(res, err, "auth_email_outbox_status_failed");
    }
  });

  router.post("/admin/support/tickets/auth-email-outbox/dry-run", ...adminGuards, async (req, res) => {
    try {
      const result = await runAuthEmailOutboxWorker({
        purposes: req.body?.purposes || req.query?.purposes || "support_ticket_admin_notification",
        limit: req.body?.limit || req.query?.limit || 10,
        dryRun: true,
      });
      return res.status(200).json({ ...result, resource_authority: "auth_email_outbox", applies_delivery: false, secrets_included: false });
    } catch (err) {
      return sendError(res, err, "auth_email_outbox_dry_run_failed");
    }
  });

  router.post("/admin/support/tickets/auth-email-outbox/skip-ineligible", ...adminGuards, async (req, res) => {
    try {
      const result = await skipAuthEmailOutboxIneligible({
        purposes: req.body?.purposes || "support_ticket_admin_notification",
        limit: req.body?.limit || 10,
        actorId: req.auth?.user_id || "auth_email_outbox_skip_ineligible",
      });
      return res.status(200).json({ ...result, resource_authority: "auth_email_outbox", applies_delivery: false, external_send_performed: false, secrets_included: false });
    } catch (err) {
      return sendError(res, err, "auth_email_outbox_skip_ineligible_failed");
    }
  });

  router.post("/admin/support/tickets/auth-email-outbox/apply", ...adminGuards, async (req, res) => {
    try {
      const result = await runAuthEmailOutboxWorker({
        purposes: req.body?.purposes || "support_ticket_admin_notification",
        limit: req.body?.limit || 10,
        dryRun: false,
        confirm: req.body?.confirm || "",
        senderConnectionId: req.body?.sender_connection_id || req.body?.senderConnectionId || "",
      });
      return res.status(200).json({ ...result, resource_authority: "auth_email_outbox", secrets_included: false });
    } catch (err) {
      return sendError(res, err, "auth_email_outbox_apply_failed");
    }
  });

  router.get("/admin/support/tickets/external-delivery/control/overview", ...adminGuards, async (req, res) => {
    try {
      const result = await getExternalDeliveryAdminOverview({ tenant_id: req.query?.tenant_id || null, limit: req.query?.limit || 25 });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "external_delivery_control_overview_failed");
    }
  });

  router.post("/admin/support/tickets/external-delivery/control/allowlist/upsert", ...adminGuards, async (req, res) => {
    try {
      const result = await upsertExternalDeliveryRecipientAllowlist({
        tenant_id: req.body?.tenant_id || null,
        adapter_key: req.body?.adapter_key || "*",
        channel: req.body?.channel || "email",
        match_type: req.body?.match_type || "exact_email",
        recipient_pattern: req.body?.recipient_pattern,
        approval_hold_id: req.body?.approval_hold_id || null,
        reason: req.body?.reason || null,
        expires_at: req.body?.expires_at || null,
        actor_id: req.auth?.user_id || "admin_system",
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "external_delivery_control_allowlist_upsert_failed");
    }
  });

  router.post("/admin/support/tickets/external-delivery/control/allowlist/disable", ...adminGuards, async (req, res) => {
    try {
      const result = await disableExternalDeliveryRecipientAllowlist({
        allowlist_id: req.body?.allowlist_id || null,
        tenant_id: req.body?.tenant_id || null,
        adapter_key: req.body?.adapter_key || null,
        recipient_pattern: req.body?.recipient_pattern || null,
        reason: req.body?.reason || null,
        actor_id: req.auth?.user_id || "admin_system",
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "external_delivery_control_allowlist_disable_failed");
    }
  });

  router.post("/admin/support/tickets/external-delivery/control/adapter/dispatch", ...adminGuards, async (req, res) => {
    try {
      const result = await setExternalDeliveryAdapterDispatch({
        adapter_key: req.body?.adapter_key,
        dispatch_enabled: Boolean(req.body?.dispatch_enabled),
        provider_dispatch_enabled: Boolean(req.body?.provider_dispatch_enabled),
        reason: req.body?.reason || null,
        actor_id: req.auth?.user_id || "admin_system",
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "external_delivery_control_adapter_dispatch_failed");
    }
  });

  router.post("/admin/support/tickets/external-delivery/control/gmail/revoke", ...adminGuards, async (req, res) => {
    try {
      const result = await revokeGmailUserConnection({
        connection_id: req.body?.connection_id,
        reason: req.body?.reason || null,
        actor_id: req.auth?.user_id || "admin_system",
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "external_delivery_control_gmail_revoke_failed");
    }
  });

  router.post("/admin/support/tickets/tenant-user/create-simulation", ...adminGuards, async (req, res) => {
    try {
      const membership = await resolveMembershipForAdminTenantTicketSimulation({
        tenant_id: req.body?.tenant_id,
        user_id: req.body?.user_id,
      });
      const simulatedReq = {
        body: {
          ...req.body,
          source_layer: req.body?.source_layer || "tenant_gpt",
          source_tool: req.body?.source_tool || "support_ticket_create",
          metadata_json: {
            ...(req.body?.metadata_json && typeof req.body.metadata_json === "object" ? req.body.metadata_json : {}),
            admin_simulation: true,
            route_equivalent: "/me/support/tickets",
            support_additive_only: true,
            secrets_included: false,
          },
        },
        auth: { user_id: membership.user_id },
      };
      const result = await createOrAppendSupportTicket(tenantTicketEnvelope(simulatedReq, membership));
      return res.status(result.created ? 201 : 200).json({
        ...result,
        mode: "tenant_user_route_equivalent_simulation",
        route_equivalent: "/me/support/tickets",
        support_additive_only: true,
        secrets_included: false,
      });
    } catch (err) {
      return sendError(res, err, "support_ticket_tenant_user_create_simulation_failed");
    }
  });

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
      const result = await getSupportTicketWithEvents({
        tenant_id: membership.tenant_id,
        ticket_id: req.params.ticket_id,
        customer_visible: true,
        include_resolution: canViewSupportTicketResolution({
          tenant_role: membership.role,
        }),
      });
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

  router.post("/admin/support/tickets/:ticket_id/external-credential/orchestration-plan", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await planSupportTicketExternalCredentialOrchestration({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        ref_id: req.body?.ref_id,
        approval_hold_id: req.body?.approval_hold_id,
        channel: req.body?.channel || "email",
        audience: req.body?.audience || "admin",
        approve_first: req.body?.approve_first !== false,
        validation_evidence: req.body?.validation_evidence || {},
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_external_credential_orchestration_plan_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/external-credential/approve-activate-bind-verify", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await approveActivateBindAndVerifySupportTicketExternalCredential({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        ref_id: req.body?.ref_id,
        approval_hold_id: req.body?.approval_hold_id,
        channel: req.body?.channel || "email",
        audience: req.body?.audience || "admin",
        approve_first: req.body?.approve_first !== false,
        validation_evidence: req.body?.validation_evidence || {},
        decision_note: req.body?.decision_note || null,
        mode: req.body?.mode || "dry_run",
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_external_credential_approve_activate_bind_verify_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/external-credential/activation-plan", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await planSupportTicketExternalCredentialActivation({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        ref_id: req.body?.ref_id,
        channel: req.body?.channel || "email",
        audience: req.body?.audience || "admin",
        approval_hold_id: req.body?.approval_hold_id || null,
        validation_evidence: req.body?.validation_evidence || {},
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_external_credential_activation_plan_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/external-credential/activate-and-bind", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await activateAndBindSupportTicketExternalCredential({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        ref_id: req.body?.ref_id,
        channel: req.body?.channel || "email",
        audience: req.body?.audience || "admin",
        approval_hold_id: req.body?.approval_hold_id || null,
        validation_evidence: req.body?.validation_evidence || {},
        decision_note: req.body?.decision_note || null,
        mode: req.body?.mode || "dry_run",
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_external_credential_activate_and_bind_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/external-secret/intake-plan", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await planSupportTicketExternalSecretIntake({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        channel: req.body?.channel || "email",
        store_type: req.body?.store_type || "vault",
        owner_type: req.body?.owner_type || "tenant",
        owner_id: req.body?.owner_id || tenantId,
        provider_family: req.body?.provider_family || null,
        credential_type: req.body?.credential_type || null,
        env_var_name: req.body?.env_var_name || null,
        vault_path: req.body?.vault_path || null,
        external_ref: req.body?.external_ref || null,
        description: req.body?.description || null,
        scope_json: req.body?.scope_json || {},
        evidence_json: req.body?.evidence_json || {},
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_external_secret_intake_plan_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/external-secret/reference/register", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await registerSupportTicketExternalSecretReference({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        channel: req.body?.channel || "email",
        store_type: req.body?.store_type || "vault",
        owner_type: req.body?.owner_type || "tenant",
        owner_id: req.body?.owner_id || tenantId,
        provider_family: req.body?.provider_family || null,
        credential_type: req.body?.credential_type || null,
        env_var_name: req.body?.env_var_name || null,
        vault_path: req.body?.vault_path || null,
        external_ref: req.body?.external_ref || null,
        description: req.body?.description || null,
        scope_json: req.body?.scope_json || {},
        evidence_json: req.body?.evidence_json || {},
        mode: req.body?.mode || "dry_run",
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_external_secret_reference_register_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/external-secret/reference/activate", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await activateSupportTicketExternalSecretReference({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        ref_id: req.body?.ref_id,
        approval_hold_id: req.body?.approval_hold_id,
        validation_evidence: req.body?.validation_evidence || {},
        decision_note: req.body?.decision_note || null,
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_external_secret_reference_activate_failed");
    }
  });

  router.get("/admin/support/tickets/external-delivery/credential-candidates", ...adminGuards, async (req, res) => {
    try {
      const result = await listSupportTicketExternalCredentialCandidates({
        tenant_id: req.query?.tenant_id || null,
        channel: req.query?.channel || "email",
        limit: req.query?.limit || 25,
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_external_credential_candidates_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/external-delivery/credential-binding/request", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await requestSupportTicketExternalCredentialBinding({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        channel: req.body?.channel || "email",
        audience: req.body?.audience || "admin",
        credential_ref: req.body?.credential_ref || null,
        reason: req.body?.reason || null,
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
        evidence_json: req.body?.evidence_json || {},
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_external_credential_binding_request_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/external-delivery/credential-binding/decision", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await decideSupportTicketExternalCredentialBinding({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        approval_hold_id: req.body?.approval_hold_id,
        decision: req.body?.decision,
        decision_note: req.body?.decision_note || null,
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_external_credential_binding_decision_failed");
    }
  });

  router.post("/admin/support/tickets/external-send/provider-adapter-future-pr-scope/plan", ...adminGuards, async (req, res) => {
    try {
      const result = await planSupportTicketExternalAdapterFuturePrScope({
        decision_id: req.body?.decision_id,
        evidence_json: req.body?.evidence_json || {},
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_external_adapter_future_pr_scope_plan_failed");
    }
  });

  router.post("/admin/support/tickets/external-send/provider-adapter-future-pr-scope/record", ...adminGuards, async (req, res) => {
    try {
      const result = await recordSupportTicketExternalAdapterFuturePrScope({
        decision_id: req.body?.decision_id,
        evidence_json: req.body?.evidence_json || {},
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_external_adapter_future_pr_scope_record_failed");
    }
  });

  router.post("/admin/support/tickets/external-send/provider-adapter-readiness/plan", ...adminGuards, async (req, res) => {
    try {
      const result = await planSupportTicketExternalAdapterReadinessChecklist({
        proposal_id: req.body?.proposal_id,
        evidence_json: req.body?.evidence_json || {},
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_external_adapter_readiness_plan_failed");
    }
  });

  router.post("/admin/support/tickets/external-send/provider-adapter-readiness/record", ...adminGuards, async (req, res) => {
    try {
      const result = await recordSupportTicketExternalAdapterReadinessChecklist({
        proposal_id: req.body?.proposal_id,
        evidence_json: req.body?.evidence_json || {},
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_external_adapter_readiness_record_failed");
    }
  });

  router.post("/admin/support/tickets/external-send/provider-adapter-readiness/decision", ...adminGuards, async (req, res) => {
    try {
      const result = await decideSupportTicketExternalAdapterReadinessChecklist({
        checklist_id: req.body?.checklist_id,
        decision: req.body?.decision,
        decision_note: req.body?.decision_note || null,
        evidence_json: req.body?.evidence_json || {},
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_external_adapter_readiness_decision_failed");
    }
  });

  router.post("/admin/support/tickets/external-send/provider-adapter-enablement/candidates", ...adminGuards, async (req, res) => {
    try {
      const result = await listSupportTicketExternalProviderEnablementCandidates({
        family_key: req.body?.family_key || null,
        channel: req.body?.channel || null,
        adapter_key: req.body?.adapter_key || null,
        include_internal: Boolean(req.body?.include_internal),
        limit: req.body?.limit || 50,
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_external_provider_enablement_candidates_failed");
    }
  });

  router.post("/admin/support/tickets/external-send/provider-adapter-enablement/propose", ...adminGuards, async (req, res) => {
    try {
      const result = await proposeSupportTicketExternalProviderAdapterEnablement({
        adapter_key: req.body?.adapter_key,
        requested_mode: req.body?.requested_mode || "provider_send_blocked",
        requested_by: req.auth?.user_id || "admin_system",
        reason: req.body?.reason || null,
        evidence_json: req.body?.evidence_json || {},
        proposed_target_json: req.body?.proposed_target_json || {},
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_external_provider_enablement_propose_failed");
    }
  });

  router.get("/admin/support/tickets/external-send/provider-contracts", ...adminGuards, async (req, res) => {
    try {
      const result = await listSupportTicketExternalProviderContracts({
        family_key: req.query?.family_key || null,
        channel: req.query?.channel || null,
        include_disabled: req.query?.include_disabled !== "false",
        limit: req.query?.limit || 100,
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_external_provider_contracts_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/external-send/provider-gate-plan", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await planSupportTicketExternalSendProviderGate({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        channel: req.body?.channel || "email",
        audience: req.body?.audience || "admin",
        approval_hold_id: req.body?.approval_hold_id || null,
        credential_ref: req.body?.credential_ref || null,
        provider_key: req.body?.provider_key || null,
        send_mode: req.body?.send_mode || "dry_run",
        subject: req.body?.subject || null,
        body: req.body?.body || null,
        payload_json: req.body?.payload_json || {},
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_external_send_provider_gate_plan_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/external-send/provider-gate-attempt", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await recordSupportTicketExternalSendProviderGateAttempt({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        channel: req.body?.channel || "email",
        audience: req.body?.audience || "admin",
        approval_hold_id: req.body?.approval_hold_id || null,
        credential_ref: req.body?.credential_ref || null,
        provider_key: req.body?.provider_key || null,
        send_mode: req.body?.send_mode || "dry_run",
        mode: req.body?.mode || "dry_run",
        subject: req.body?.subject || null,
        body: req.body?.body || null,
        payload_json: req.body?.payload_json || {},
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_external_send_provider_gate_attempt_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/external-send/execution-plan", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await planSupportTicketExternalSendExecution({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        channel: req.body?.channel || "email",
        audience: req.body?.audience || "admin",
        approval_hold_id: req.body?.approval_hold_id || null,
        credential_ref: req.body?.credential_ref || null,
        subject: req.body?.subject || null,
        body: req.body?.body || null,
        payload_json: req.body?.payload_json || {},
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_external_send_execution_plan_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/external-send/execution-record", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await recordSupportTicketExternalSendExecution({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        channel: req.body?.channel || "email",
        audience: req.body?.audience || "admin",
        approval_hold_id: req.body?.approval_hold_id || null,
        credential_ref: req.body?.credential_ref || null,
        subject: req.body?.subject || null,
        body: req.body?.body || null,
        mode: req.body?.mode || "dry_run",
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
        payload_json: req.body?.payload_json || {},
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_external_send_execution_record_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/external-delivery/readiness", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await checkSupportTicketExternalDeliveryReadiness({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        channel: req.body?.channel || "email",
        audience: req.body?.audience || "admin",
        credential_ref: req.body?.credential_ref || null,
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_external_delivery_readiness_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/external-delivery/approval/request", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await requestSupportTicketExternalDeliveryApproval({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        channel: req.body?.channel || "email",
        audience: req.body?.audience || "admin",
        credential_ref: req.body?.credential_ref || null,
        preview_subject: req.body?.preview_subject || req.body?.subject || null,
        preview_body: req.body?.preview_body || req.body?.body || null,
        reason: req.body?.reason || null,
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
        evidence_json: req.body?.evidence_json || {},
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_external_delivery_approval_request_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/external-delivery/approval/decision", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await decideSupportTicketExternalDeliveryApproval({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        approval_hold_id: req.body?.approval_hold_id,
        decision: req.body?.decision,
        decision_note: req.body?.decision_note || null,
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_external_delivery_approval_decision_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/external-delivery/completion-certification", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await certifySupportTicketExternalDeliveryCompletion({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        channel: req.body?.channel || "email",
        audience: req.body?.audience || "admin",
        provider_key: req.body?.provider_key || null,
        send_mode: req.body?.send_mode || "dry_run",
        approval_hold_id: req.body?.approval_hold_id || null,
        credential_ref: req.body?.credential_ref || null,
        idempotency_key: req.body?.idempotency_key || null,
        subject: req.body?.subject || null,
        body: req.body?.body || null,
        payload_json: req.body?.payload_json || {},
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_external_delivery_completion_certification_failed");
    }
  });

  router.get("/admin/support/tickets/notifications/adapters", ...adminGuards, async (req, res) => {
    try {
      const result = await listSupportTicketNotificationAdapters();
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_notification_adapters_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/notification-delivery/preview", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await previewSupportTicketNotificationDelivery({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        channel: req.body?.channel || "activation_inbox",
        notification_type: req.body?.notification_type || null,
        audience: req.body?.audience || "admin",
        subject: req.body?.subject || null,
        body: req.body?.body || null,
        payload_json: req.body?.payload_json || {},
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_notification_delivery_preview_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/notification-delivery/dispatch", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await dispatchSupportTicketNotificationDelivery({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        channel: req.body?.channel || "activation_inbox",
        notification_type: req.body?.notification_type || null,
        audience: req.body?.audience || "admin",
        subject: req.body?.subject || null,
        body: req.body?.body || null,
        mode: req.body?.mode || "dry_run",
        delivery_approval_hold_id: req.body?.delivery_approval_hold_id || null,
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
        payload_json: req.body?.payload_json || {},
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_notification_delivery_dispatch_failed");
    }
  });

  router.get("/admin/support/tickets/notifications/queue", ...adminGuards, async (req, res) => {
    try {
      const result = await listSupportTicketNotificationQueue({
        tenant_id: req.query?.tenant_id || null,
        limit: req.query?.limit || 50,
        include_resolved_days: req.query?.include_resolved_days || 7,
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_notification_queue_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/notification-cycle", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await createSupportTicketNotificationCycle({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        notification_type: req.body?.notification_type || null,
        audience: req.body?.audience || "admin",
        channel: req.body?.channel || "activation_inbox",
        delivery_status: req.body?.delivery_status || "queued",
        summary: req.body?.summary || null,
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
        payload_json: req.body?.payload_json || {},
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_notification_cycle_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/notification-ack", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await recordSupportTicketNotificationAck({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        ack_action: req.body?.ack_action,
        notification_type: req.body?.notification_type || null,
        audience: req.body?.audience || "admin",
        channel: req.body?.channel || "activation_inbox",
        summary: req.body?.summary || null,
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
        payload_json: req.body?.payload_json || {},
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_notification_ack_failed");
    }
  });

  router.get("/admin/support/tickets/auto-resolve/candidates", ...adminGuards, async (req, res) => {
    try {
      const result = await listSupportTicketAutoResolveCandidates({
        tenant_id: req.query?.tenant_id || null,
        limit: req.query?.limit || 50,
        include_ineligible: req.query?.include_ineligible === "true" || req.query?.include_ineligible === true,
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_auto_resolve_candidates_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/auto-resolve/propose", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await proposeSupportTicketAutoResolution({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        force: Boolean(req.body?.force),
        actor_id: req.auth?.user_id || "backend_ai_agent",
        actor_type: req.auth?.mode || "backend_ai_agent",
        summary: req.body?.summary || null,
        evidence_json: req.body?.evidence_json || {},
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_auto_resolve_propose_failed");
    }
  });

  router.get("/admin/activation/ticket-inbox", ...adminGuards, async (req, res) => {
    try {
      const result = await getActivationTicketInbox({
        tenant_id: req.query?.tenant_id || null,
        limit: req.query?.limit || 50,
        include_resolved_days: req.query?.include_resolved_days || 7,
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_activation_inbox_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/admin-feedback", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await recordSupportTicketAdminFeedback({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        feedback_action: req.body?.feedback_action,
        decision: req.body?.decision || null,
        summary: req.body?.summary || null,
        queue_key: req.body?.queue_key || null,
        assigned_to: req.body?.assigned_to || null,
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
        evidence_json: req.body?.evidence_json || {},
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_admin_feedback_failed");
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
      const result = await getSupportTicketWithEvents({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        customer_visible: false,
        include_resolution: true,
      });
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

  router.post("/admin/support/tickets/:ticket_id/brand-ref-selection/request", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await requestSupportTicketBrandRefSelection({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        min_confidence: req.body?.min_confidence || 70,
        limit: req.body?.limit || 25,
        required_role: req.body?.required_role || "workspace_owner_admin",
        assigned_to: req.body?.assigned_to || null,
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
        reason: req.body?.reason || "Manual brand_ref selection required before remediation.",
      });
      return res.status(result.created ? 201 : 200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_brand_ref_selection_request_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/new-brand-ref-approval/request", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await requestSupportTicketNewBrandRefApproval({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        selected_brand_ref: req.body?.selected_brand_ref,
        allow_new_ref: req.body?.allow_new_ref !== false,
        required_role: req.body?.required_role || "platform_admin",
        assigned_to: req.body?.assigned_to || null,
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
        reason: req.body?.reason || "New brand_ref approval required before remediation apply.",
      });
      return res.status(result.created ? 201 : 200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_new_brand_ref_approval_request_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/new-brand-ref-approval/approve", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await approveSupportTicketNewBrandRef({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        approval_hold_id: req.body?.approval_hold_id || null,
        selected_brand_ref: req.body?.selected_brand_ref,
        allow_new_ref: req.body?.allow_new_ref !== false,
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
        decision_note: req.body?.decision_note || null,
        reason: req.body?.reason || "New brand_ref approved for remediation apply.",
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_new_brand_ref_approval_approve_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/brand-ref-selection/approve-and-complete", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await completeSupportTicketBrandRefSelectionRemediation({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        brand_ref_selection_hold_id: req.body?.brand_ref_selection_hold_id || req.body?.selection_hold_id || null,
        remediation_approval_hold_id: req.body?.remediation_approval_hold_id || req.body?.approval_hold_id || null,
        selected_brand_ref: req.body?.selected_brand_ref,
        allow_new_ref: Boolean(req.body?.allow_new_ref),
        mode: req.body?.mode || "dry_run",
        approve_first: Boolean(req.body?.approve_first),
        close_if_verified: req.body?.close_if_verified !== false,
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
        reason: req.body?.reason || "Brand ref selection and remediation completion orchestrated.",
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_brand_ref_selection_completion_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/brand-ref-selection/approve", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await approveSupportTicketBrandRefSelection({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        approval_hold_id: req.body?.approval_hold_id || null,
        selected_brand_ref: req.body?.selected_brand_ref,
        allow_new_ref: Boolean(req.body?.allow_new_ref),
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
        decision_note: req.body?.decision_note || null,
        reason: req.body?.reason || "Manual brand_ref selection approved.",
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_brand_ref_selection_approve_failed");
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

  router.post("/admin/support/tickets/:ticket_id/brand-mapping-remediation/finalize", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const result = await finalizeSupportTicketBrandMappingRemediation({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        selected_brand_ref: req.body?.selected_brand_ref || req.body?.brand_ref,
        brand_ref_selection_hold_id: req.body?.brand_ref_selection_hold_id || req.body?.selection_hold_id || null,
        new_brand_ref_approval_hold_id: req.body?.new_brand_ref_approval_hold_id || null,
        remediation_approval_hold_id: req.body?.remediation_approval_hold_id || req.body?.approval_hold_id || null,
        workflow_run_id: req.body?.workflow_run_id || req.body?.run_id || null,
        plan_id: req.body?.plan_id || null,
        permission: req.body?.permission || "manage",
        mode: req.body?.mode || "dry_run",
        close_if_verified: req.body?.close_if_verified !== false,
        max_steps: req.body?.max_steps || 10,
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
        reason: req.body?.reason || "Finalize brand mapping remediation.",
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_finalize_brand_mapping_remediation_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/brand-mapping-remediation/verified-apply", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const trustedBrandRef = await requireTrustedBrandRefForRemediation({ tenant_id: tenantId, ticket_id: req.params.ticket_id, body: req.body || {} });
      const result = await applySupportTicketBrandMappingVerified({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        approval_hold_id: req.body?.approval_hold_id || req.body?.remediation_approval_hold_id || null,
        brand_ref: trustedBrandRef.brand_ref,
        brand_refs: trustedBrandRef.brand_refs,
        permission: req.body?.permission || "manage",
        mode: req.body?.mode || "dry_run",
        rollback_on_failed_verification: req.body?.rollback_on_failed_verification !== false,
        actor_id: req.auth?.user_id || "admin_system",
        actor_type: req.auth?.mode || "admin",
        reason: req.body?.reason || "Verified brand mapping remediation apply.",
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "support_ticket_verified_brand_mapping_apply_failed");
    }
  });

  router.post("/admin/support/tickets/:ticket_id/brand-mapping-remediation", ...adminGuards, async (req, res) => {
    try {
      const tenantId = await resolveTicketTenant(req.params.ticket_id, req.body?.tenant_id || req.query?.tenant_id || null);
      if (!tenantId) return res.status(404).json({ ok: false, error: { code: "support_ticket_not_found", message: "Ticket not found." }, secrets_included: false });
      const trustedBrandRef = await requireTrustedBrandRefForRemediation({ tenant_id: tenantId, ticket_id: req.params.ticket_id, body: req.body || {} });
      const result = await applySupportTicketBrandMappingRemediation({
        tenant_id: tenantId,
        ticket_id: req.params.ticket_id,
        approval_hold_id: req.body?.approval_hold_id || null,
        brand_ref: trustedBrandRef.brand_ref,
        brand_refs: trustedBrandRef.brand_refs,
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
