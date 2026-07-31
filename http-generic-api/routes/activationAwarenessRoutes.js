import { Router } from "express";
import jwt from "jsonwebtoken";
import { getPool } from "../db.js";
import {
  buildActivationSnapshot,
  buildActivationTabManifest,
  buildActivationOperationalSummary,
  buildActivationDashboardManifest,
  buildCompletenessEnvelope,
  buildAwarenessIndex,
  readActivationDynamicTabDetail,
} from "../activationAwarenessService.js";
import {
  readOperationalAlerts,
  synchronizeOperationalAlerts,
  updateOperationalAlertLifecycle,
} from "../operationalAlertService.js";
import { ingestCiGuardSignal } from "../ciGuardOperationalAlertService.js";
import { readTenantResolutionProblemCards } from "../tenantResolutionProjectionService.js";
import { createTenantResolutionCase } from "../tenantResolutionCaseService.js";
import {
  listTenantResolutionCases,
  getTenantResolutionCase,
  transitionTenantResolutionCase,
} from "../tenantResolutionCaseLifecycleService.js";
import { runTenantResolutionDiagnosticAction } from "../tenantResolutionDiagnosticService.js";
import { previewTenantTaskSourceRepair } from "../tenantTaskSourceRepairPreviewService.js";
import { applyTenantTaskSourceRepair } from "../tenantTaskSourceRepairApplyService.js";
import { verifyTenantTaskSourceRepair } from "../tenantTaskSourceRepairVerificationService.js";
import {
  listTenantSkillApprovals,
  decideTenantSkillApproval,
} from "../tenantSkillApprovalCenterService.js";
import { acknowledgeActivationRun, readActivationRunArchive } from "../activationSessionLifecycleService.js";
import { maybeChunkToolResponseBody } from "./gptToolsRoutes.js";

const JWT_SECRET = process.env.JWT_SECRET || "development_fallback_secret_only";
const ALLOWED_PROFILES = new Set(["evidence", "summary", "dashboard", "diagnostic", "full"]);

function verifyUserJwt(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(authHeader.slice(7), JWT_SECRET);
  } catch {
    return null;
  }
}

async function fetchActiveMembership({ userId, tenantId = null }) {
  const params = [userId];
  let tenantClause = "";
  if (tenantId) {
    tenantClause = "AND m.tenant_id = ?";
    params.push(tenantId);
  }
  const [rows] = await getPool().query(
    `SELECT m.tenant_id, m.role, m.status
       FROM memberships m
       JOIN tenants t ON t.tenant_id = m.tenant_id
      WHERE m.user_id = ?
        AND m.status = 'active'
        AND t.status = 'active'
        ${tenantClause}
      ORDER BY m.granted_at ASC
      LIMIT 1`,
    params
  );
  return rows[0] || null;
}

async function requireTenantUserJwt(req, res, next) {
  const payload = req.auth?.mode === "user_jwt" ? req.auth : verifyUserJwt(req.headers.authorization);
  if (!payload?.user_id) {
    return res.status(401).json({
      ok: false,
      error: { code: "user_jwt_required", message: "Sign in required." },
      secrets_included: false,
    });
  }
  const requestedTenantId = payload.tenant_id || req.headers["x-tenant-id"] || null;
  const membership = await fetchActiveMembership({ userId: payload.user_id, tenantId: requestedTenantId });
  if (!membership) {
    return res.status(403).json({
      ok: false,
      error: { code: "active_tenant_membership_required", message: "No active tenant membership found for this user." },
      secrets_included: false,
    });
  }
  req.auth = {
    mode: "user_jwt",
    user_id: payload.user_id,
    tenant_id: membership.tenant_id,
    tenant_role: membership.role,
    is_admin: false,
  };
  return next();
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function queryText(value, max = 200) {
  if (Array.isArray(value)) value = value[0];
  const text = String(value || "").trim();
  return text ? text.slice(0, max) : null;
}

function queryBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function profileValue(value) {
  const profile = String(value || "evidence").trim().toLowerCase();
  return ALLOWED_PROFILES.has(profile) ? profile : "evidence";
}

function subjectContext(req, isAdmin) {
  return {
    subject: {
      is_admin: isAdmin,
      tenant_id: req.auth?.tenant_id || null,
      user_id: req.auth?.user_id || null,
    },
    platform_access: {
      access_scope: isAdmin ? "platform_admin_all" : "user_scoped",
      principal: {
        is_admin: isAdmin,
        tenant_id: req.auth?.tenant_id || null,
        user_id: req.auth?.user_id || null,
        type: req.auth?.mode || null,
      },
    },
  };
}

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: {
      code: err.code || fallbackCode,
      message: err.message,
      details: err.details || null,
      requestId: res.locals?.request_id || null,
    },
    secrets_included: false,
  });
}

async function buildAwarenessResponse(req, isAdmin) {
  const sessionContext = subjectContext(req, isAdmin);
  const profile = profileValue(req.query.profile || req.query.response_profile);
  const operationalSummary = await buildActivationOperationalSummary({
    sessionContext,
    attentionLimit: boundedInt(req.query.attention_limit, 10, 1, 20),
  });
  const preliminaryManifest = await buildActivationTabManifest({ sessionContext, operationalSummary });
  const snapshot = buildActivationSnapshot({
    sessionContext,
    registryVersion: preliminaryManifest.registry_version,
    profile,
  });
  const [dynamicTabs, dashboard] = await Promise.all([
    buildActivationTabManifest({ sessionContext, snapshot, operationalSummary }),
    buildActivationDashboardManifest({ sessionContext, snapshot }),
  ]);
  const completeness = buildCompletenessEnvelope({
    tabManifest: dynamicTabs,
    operationalSummary,
    dashboardManifest: dashboard,
    fullyHydratedSurfaces: 0,
  });
  return {
    ok: dynamicTabs.ok && operationalSummary.ok && dashboard.ok,
    activation_layer: "activation_awareness_readback",
    response_profile: profile,
    snapshot,
    dynamic_tabs: dynamicTabs,
    operational_summary: operationalSummary,
    dashboard,
    completeness,
    awareness_index: buildAwarenessIndex({ completeness, operationalSummary }),
    auth_context: {
      source: isAdmin ? "backend_api_key" : "user_jwt",
      is_admin: isAdmin,
      tenant_id: req.auth?.tenant_id || null,
      user_id: req.auth?.user_id || null,
      tenant_role: req.auth?.tenant_role || null,
    },
    secrets_included: false,
  };
}

export async function chunkActivationAwarenessResponse(body, req, sourceToolKey, deps = {}) {
  return maybeChunkToolResponseBody(body, {
    response_options: {
      max_response_chars: req?.query?.max_response_chars,
      chunk_ttl_minutes: req?.query?.chunk_ttl_minutes,
    },
    auth: req?.auth || null,
    source_tool_key: sourceToolKey,
    source_surface: "activation_awareness",
  }, deps);
}

async function detailResponse(req, isAdmin) {
  const containerKey = queryText(req.query.container_key, 240);
  const tabKey = queryText(req.query.tab_key, 180);
  if (!containerKey || !tabKey) {
    const err = new Error("container_key and tab_key are required.");
    err.status = 400;
    err.code = "activation_detail_scope_required";
    throw err;
  }
  return readActivationDynamicTabDetail({
    sessionContext: subjectContext(req, isAdmin),
    explicitSubject: {
      is_admin: isAdmin,
      tenant_id: req.auth?.tenant_id || null,
      user_id: req.auth?.user_id || null,
      auth_mode: req.auth?.mode || null,
    },
    containerKey,
    tabKey,
    sectionKey: queryText(req.query.section_key, 180),
    cursor: boundedInt(req.query.cursor, 0, 0, 1000000),
    limit: boundedInt(req.query.limit, 25, 1, 100),
    snapshotId: queryText(req.query.snapshot_id, 180),
  });
}

async function operationalAttentionResponse(req, isAdmin) {
  return readOperationalAlerts({
    sessionContext: subjectContext(req, isAdmin),
    explicitSubject: {
      is_admin: isAdmin,
      tenant_id: req.auth?.tenant_id || null,
      user_id: req.auth?.user_id || null,
      auth_mode: req.auth?.mode || null,
    },
    cursor: boundedInt(req.query.cursor, 0, 0, 1000000),
    limit: boundedInt(req.query.limit, 500, 1, 1000),
    lookbackHours: boundedInt(req.query.lookback_hours, 168, 1, 2160),
    includeResolved: queryBoolean(req.query.include_resolved, false),
    severity: queryText(req.query.severity, 32),
    sourceType: queryText(req.query.source_type, 128),
    lifecycleStatus: queryText(req.query.lifecycle_status, 64),
    q: queryText(req.query.q, 300),
  });
}

async function tenantProblemCardsResponse(req) {
  return readTenantResolutionProblemCards({
    sessionContext: subjectContext(req, false),
    explicitSubject: {
      is_admin: false,
      tenant_id: req.auth?.tenant_id || null,
      user_id: req.auth?.user_id || null,
      auth_mode: req.auth?.mode || null,
    },
    cursor: boundedInt(req.query.cursor, 0, 0, 1000000),
    limit: boundedInt(req.query.limit, 25, 1, 100),
    lookbackHours: boundedInt(req.query.lookback_hours, 168, 1, 2160),
    rootFamily: queryText(req.query.root_family, 128),
    severity: queryText(req.query.severity, 32),
    q: queryText(req.query.q, 300),
  });
}

async function tenantResolutionCaseCreateResponse(req) {
  return createTenantResolutionCase({
    sessionContext: subjectContext(req, false),
    explicitSubject: {
      is_admin: false,
      tenant_id: req.auth?.tenant_id || null,
      user_id: req.auth?.user_id || null,
      auth_mode: req.auth?.mode || null,
    },
    input: req.body || {},
  });
}

function tenantWorkspaceScope(req) {
  return queryText(req.query?.workspace_id || req.body?.workspace_id || req.headers?.["x-workspace-id"], 64);
}

async function tenantResolutionCaseListResponse(req) {
  return listTenantResolutionCases({
    sessionContext: subjectContext(req, false),
    explicitSubject: {
      is_admin: false,
      tenant_id: req.auth?.tenant_id || null,
      user_id: req.auth?.user_id || null,
      auth_mode: req.auth?.mode || null,
    },
    cursor: boundedInt(req.query.cursor, 0, 0, 1000000),
    limit: boundedInt(req.query.limit, 25, 1, 100),
    workspaceId: tenantWorkspaceScope(req),
    status: queryText(req.query.status, 64),
    rootFamily: queryText(req.query.root_family, 128),
    severity: queryText(req.query.severity, 32),
  });
}

async function tenantResolutionCaseDetailResponse(req) {
  return getTenantResolutionCase({
    sessionContext: subjectContext(req, false),
    explicitSubject: {
      is_admin: false,
      tenant_id: req.auth?.tenant_id || null,
      user_id: req.auth?.user_id || null,
      auth_mode: req.auth?.mode || null,
    },
    caseId: req.params.caseId,
    workspaceId: tenantWorkspaceScope(req),
    eventLimit: boundedInt(req.query.event_limit, 50, 1, 100),
  });
}

async function tenantResolutionCaseTransitionResponse(req) {
  return transitionTenantResolutionCase({
    sessionContext: subjectContext(req, false),
    explicitSubject: {
      is_admin: false,
      tenant_id: req.auth?.tenant_id || null,
      user_id: req.auth?.user_id || null,
      auth_mode: req.auth?.mode || null,
    },
    caseId: req.params.caseId,
    workspaceId: tenantWorkspaceScope(req),
    input: req.body || {},
  });
}

async function tenantResolutionDiagnosticActionResponse(req) {
  return runTenantResolutionDiagnosticAction({
    sessionContext: subjectContext(req, false),
    explicitSubject: {
      is_admin: false,
      tenant_id: req.auth?.tenant_id || null,
      user_id: req.auth?.user_id || null,
      auth_mode: req.auth?.mode || null,
    },
    caseId: req.params.caseId,
    workspaceId: tenantWorkspaceScope(req),
    input: req.body || {},
  });
}

async function tenantTaskSourceRepairPreviewResponse(req) {
  return previewTenantTaskSourceRepair({
    sessionContext: subjectContext(req, false),
    explicitSubject: {
      is_admin: false,
      tenant_id: req.auth?.tenant_id || null,
      user_id: req.auth?.user_id || null,
      auth_mode: req.auth?.mode || null,
    },
    caseId: req.params.caseId,
    workspaceId: tenantWorkspaceScope(req),
    input: req.body || {},
  });
}

async function tenantTaskSourceRepairApplyResponse(req) {
  return applyTenantTaskSourceRepair({
    sessionContext: subjectContext(req, false),
    explicitSubject: {
      is_admin: false,
      tenant_id: req.auth?.tenant_id || null,
      user_id: req.auth?.user_id || null,
      auth_mode: req.auth?.mode || null,
    },
    caseId: req.params.caseId,
    workspaceId: tenantWorkspaceScope(req),
    input: req.body || {},
  });
}

async function tenantTaskSourceRepairVerificationResponse(req) {
  return verifyTenantTaskSourceRepair({
    sessionContext: subjectContext(req, false),
    explicitSubject: {
      is_admin: false,
      tenant_id: req.auth?.tenant_id || null,
      user_id: req.auth?.user_id || null,
      auth_mode: req.auth?.mode || null,
    },
    caseId: req.params.caseId,
    workspaceId: tenantWorkspaceScope(req),
    input: req.body || {},
  });
}

async function tenantSkillApprovalListResponse(req) {
  return listTenantSkillApprovals({
    sessionContext: subjectContext(req, false),
    explicitSubject: {
      is_admin: false,
      tenant_id: req.auth?.tenant_id || null,
      user_id: req.auth?.user_id || null,
      tenant_role: req.auth?.tenant_role || null,
      auth_mode: req.auth?.mode || null,
    },
    cursor: boundedInt(req.query.cursor, 0, 0, 1000000),
    limit: boundedInt(req.query.limit, 25, 1, 100),
    status: queryText(req.query.status, 32),
    workspaceId: tenantWorkspaceScope(req),
    q: queryText(req.query.q, 300),
  });
}

async function tenantSkillApprovalDecisionResponse(req) {
  return decideTenantSkillApproval({
    sessionContext: subjectContext(req, false),
    explicitSubject: {
      is_admin: false,
      tenant_id: req.auth?.tenant_id || null,
      user_id: req.auth?.user_id || null,
      tenant_role: req.auth?.tenant_role || null,
      auth_mode: req.auth?.mode || null,
    },
    approvalKey: req.params.approvalKey,
    input: req.body || {},
  });
}

async function operationalAttentionSyncResponse(req, isAdmin) {
  return synchronizeOperationalAlerts({
    sessionContext: subjectContext(req, isAdmin),
    explicitSubject: {
      is_admin: isAdmin,
      tenant_id: req.auth?.tenant_id || null,
      user_id: req.auth?.user_id || null,
      auth_mode: req.auth?.mode || null,
    },
    lookbackHours: boundedInt(req.body?.lookback_hours, 168, 1, 2160),
    requestedBy: queryText(req.body?.requested_by || req.auth?.user_id || "platform_admin", 191),
  });
}

async function operationalCiSignalResponse(req) {
  return ingestCiGuardSignal({
    input: req.body || {},
    requestedBy: queryText(req.auth?.user_id || "github_actions", 191),
  });
}

async function activationRunArchiveResponse(req, res, isAdmin) {
  try {
    const result = await readActivationRunArchive(getPool(), {
      runId: req.params.runId,
      subject: {
        is_admin: isAdmin,
        tenant_id: req.auth?.tenant_id || null,
        user_id: req.auth?.user_id || null,
      },
    });
    if (!result.found) {
      return res.status(404).json({
        ok: false,
        error: { code: "activation_run_not_found", message: "Activation run was not found within the caller scope." },
        secrets_included: false,
      });
    }
    return res.status(200).json(result);
  } catch (err) {
    return errorResponse(res, err, "activation_run_archive_lookup_failed");
  }
}

export function buildActivationAwarenessRoutes({ requireBackendApiKey } = {}) {
  const router = Router();
  const adminGuards = [requireBackendApiKey].filter(Boolean);

  router.get("/activation/awareness", ...adminGuards, async (req, res) => {
    try {
      const responseBody = await buildAwarenessResponse(req, true);
      const transportBody = await chunkActivationAwarenessResponse(
        responseBody,
        req,
        "activation_awareness_read_api"
      );
      return res.status(200).json(transportBody);
    } catch (err) {
      return errorResponse(res, err, "activation_awareness_read_failed");
    }
  });

  router.get("/activation/dynamic-tabs/detail", ...adminGuards, async (req, res) => {
    try {
      return res.status(200).json(await detailResponse(req, true));
    } catch (err) {
      return errorResponse(res, err, "activation_dynamic_tab_detail_failed");
    }
  });

  router.get("/activation/operational-attention", ...adminGuards, async (req, res) => {
    try {
      return res.status(200).json(await operationalAttentionResponse(req, true));
    } catch (err) {
      return errorResponse(res, err, "activation_operational_attention_read_failed");
    }
  });

  router.post("/activation/operational-attention/sync", ...adminGuards, async (req, res) => {
    try {
      return res.status(200).json(await operationalAttentionSyncResponse(req, true));
    } catch (err) {
      return errorResponse(res, err, "activation_operational_attention_sync_failed");
    }
  });

  router.post("/activation/operational-attention/ci-signals", ...adminGuards, async (req, res) => {
    try {
      const result = await operationalCiSignalResponse(req);
      return res.status(result.created ? 201 : 200).json(result);
    } catch (err) {
      return errorResponse(res, err, "activation_operational_ci_signal_ingest_failed");
    }
  });

  router.post("/activation/operational-attention/:alertId/lifecycle", ...adminGuards, async (req, res) => {
    try {
      return res.status(200).json(await updateOperationalAlertLifecycle({
        sessionContext: subjectContext(req, true),
        explicitSubject: { is_admin: true, user_id: req.auth?.user_id || null, auth_mode: req.auth?.mode || null },
        alertId: req.params.alertId,
        lifecycleStatus: req.body?.lifecycle_status,
        actor: queryText(req.body?.actor || req.auth?.user_id || "platform_admin", 191),
        actorType: queryText(req.body?.actor_type || (req.auth?.mode === "user_jwt" ? "tenant_user" : "platform_admin"), 64),
        note: queryText(req.body?.note, 2000),
        idempotencyKey: queryText(req.body?.idempotency_key, 191),
      }));
    } catch (err) {
      return errorResponse(res, err, "activation_operational_alert_lifecycle_failed");
    }
  });

  router.post("/activation/runs/:runId/ack", ...adminGuards, async (req, res) => {
    try {
      const result = await acknowledgeActivationRun(getPool(), {
        runId: req.params.runId,
        acknowledgedBy: req.body?.acknowledged_by || req.auth?.user_id || "platform_admin",
        consumerState: req.body?.consumer_state || "acknowledged",
      });
      if (!result.affected_rows) {
        return res.status(404).json({
          ok: false,
          error: { code: "activation_run_not_found", message: "Activation run was not found." },
          secrets_included: false,
        });
      }
      return res.status(200).json({ ...result, run_id: req.params.runId, secrets_included: false });
    } catch (err) {
      return errorResponse(res, err, "activation_run_ack_failed");
    }
  });

  router.get("/activation/runs/:runId/archive", ...adminGuards, async (req, res) => activationRunArchiveResponse(req, res, true));

  router.get("/tenant/activation/awareness", requireTenantUserJwt, async (req, res) => {
    try {
      const responseBody = await buildAwarenessResponse(req, false);
      const transportBody = await chunkActivationAwarenessResponse(
        responseBody,
        req,
        "tenant_activation_awareness_read_api"
      );
      return res.status(200).json(transportBody);
    } catch (err) {
      return errorResponse(res, err, "tenant_activation_awareness_read_failed");
    }
  });

  router.get("/tenant/activation/operational-attention", requireTenantUserJwt, async (req, res) => {
    try {
      return res.status(200).json(await operationalAttentionResponse(req, false));
    } catch (err) {
      return errorResponse(res, err, "tenant_activation_operational_attention_read_failed");
    }
  });

  router.get("/tenant/resolution/problem-cards", requireTenantUserJwt, async (req, res) => {
    try {
      return res.status(200).json(await tenantProblemCardsResponse(req));
    } catch (err) {
      return errorResponse(res, err, "tenant_resolution_problem_cards_read_failed");
    }
  });

  router.get("/tenant/resolution/cases", requireTenantUserJwt, async (req, res) => {
    try {
      return res.status(200).json(await tenantResolutionCaseListResponse(req));
    } catch (err) {
      return errorResponse(res, err, "tenant_resolution_case_list_failed");
    }
  });

  router.post("/tenant/resolution/cases", requireTenantUserJwt, async (req, res) => {
    try {
      const result = await tenantResolutionCaseCreateResponse(req);
      return res.status(result.created ? 201 : 200).json(result);
    } catch (err) {
      return errorResponse(res, err, "tenant_resolution_case_create_failed");
    }
  });

  router.get("/tenant/resolution/cases/:caseId", requireTenantUserJwt, async (req, res) => {
    try {
      return res.status(200).json(await tenantResolutionCaseDetailResponse(req));
    } catch (err) {
      return errorResponse(res, err, "tenant_resolution_case_read_failed");
    }
  });

  router.post("/tenant/resolution/cases/:caseId/transitions", requireTenantUserJwt, async (req, res) => {
    try {
      return res.status(200).json(await tenantResolutionCaseTransitionResponse(req));
    } catch (err) {
      return errorResponse(res, err, "tenant_resolution_case_transition_failed");
    }
  });

  router.post("/tenant/resolution/cases/:caseId/diagnostics", requireTenantUserJwt, async (req, res) => {
    try {
      return res.status(200).json(await tenantResolutionDiagnosticActionResponse(req));
    } catch (err) {
      return errorResponse(res, err, "tenant_resolution_diagnostic_action_failed");
    }
  });

  router.post("/tenant/resolution/cases/:caseId/task-source-repair/preview", requireTenantUserJwt, async (req, res) => {
    try {
      return res.status(200).json(await tenantTaskSourceRepairPreviewResponse(req));
    } catch (err) {
      return errorResponse(res, err, "tenant_task_source_repair_preview_failed");
    }
  });

  router.post("/tenant/resolution/cases/:caseId/task-source-repair/apply", requireTenantUserJwt, async (req, res) => {
    try {
      return res.status(200).json(await tenantTaskSourceRepairApplyResponse(req));
    } catch (err) {
      return errorResponse(res, err, "tenant_task_source_repair_apply_failed");
    }
  });

  router.post("/tenant/resolution/cases/:caseId/task-source-repair/verify", requireTenantUserJwt, async (req, res) => {
    try {
      return res.status(200).json(await tenantTaskSourceRepairVerificationResponse(req));
    } catch (err) {
      return errorResponse(res, err, "tenant_task_source_repair_verification_failed");
    }
  });

  router.get("/tenant/resolution/skill-approvals", requireTenantUserJwt, async (req, res) => {
    try {
      return res.status(200).json(await tenantSkillApprovalListResponse(req));
    } catch (err) {
      return errorResponse(res, err, "tenant_skill_approval_list_failed");
    }
  });

  router.post("/tenant/resolution/skill-approvals/:approvalKey/decision", requireTenantUserJwt, async (req, res) => {
    try {
      return res.status(200).json(await tenantSkillApprovalDecisionResponse(req));
    } catch (err) {
      return errorResponse(res, err, "tenant_skill_approval_decision_failed");
    }
  });

  router.get("/tenant/activation/dynamic-tabs/detail", requireTenantUserJwt, async (req, res) => {
    try {
      return res.status(200).json(await detailResponse(req, false));
    } catch (err) {
      return errorResponse(res, err, "tenant_activation_dynamic_tab_detail_failed");
    }
  });

  router.get("/tenant/activation/runs/:runId/archive", requireTenantUserJwt, async (req, res) => activationRunArchiveResponse(req, res, false));

  return router;
}

export const _testingActivationAwarenessRoutes = {
  verifyUserJwt,
  boundedInt,
  queryText,
  queryBoolean,
  profileValue,
  subjectContext,
  tenantProblemCardsResponse,
  tenantResolutionCaseCreateResponse,
  tenantWorkspaceScope,
  tenantResolutionCaseListResponse,
  tenantResolutionCaseDetailResponse,
  tenantResolutionCaseTransitionResponse,
  tenantResolutionDiagnosticActionResponse,
  tenantTaskSourceRepairPreviewResponse,
  tenantTaskSourceRepairApplyResponse,
  tenantTaskSourceRepairVerificationResponse,
  tenantSkillApprovalListResponse,
  tenantSkillApprovalDecisionResponse,
};
