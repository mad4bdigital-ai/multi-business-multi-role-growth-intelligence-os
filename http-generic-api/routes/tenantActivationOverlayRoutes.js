import { Router } from "express";
import { getPool } from "../db.js";
import { buildActivationSessionContext } from "./activationRoutes.js";
import { buildTenantGrowthDashboard } from "../tenantGrowthDashboardService.js";
import {
  normalizeActivationResponseProfile,
  projectActivationSessionContext,
} from "../activationHardResponseService.js";
import {
  markActivationRunPrepared,
  markActivationRunDelivered,
} from "../activationSessionLifecycleService.js";
import { maybeChunkToolResponseBody } from "./gptToolsRoutes.js";

const TENANT_ACTIVATION_SESSION_QUERY_ALLOWLIST = new Set([
  "chunk_ttl_minutes",
  "close_previous_sessions",
  "container_key",
  "conversation_ref",
  "date_range",
  "idempotency_key",
  "limit",
  "max_response_chars",
  "offset",
  "response_profile",
  "reuse_window_hours",
  "session_policy",
  "tab",
  "tab_key",
]);
const TENANT_ACTIVATION_SESSION_LIST_QUERY_ALLOWLIST = new Set([
  "limit",
  "session_status",
]);
const TENANT_ACTIVATION_SESSION_STATUSES = new Set([
  "pending",
  "active",
  "completed",
  "failed",
]);

function compactError(error, fallback) {
  return {
    code: error?.code || fallback,
    message: error?.message || String(error || fallback),
  };
}

export function buildTenantActivationOverlayRoutes({
  requireBackendApiKey,
  buildSessionContext = buildActivationSessionContext,
  buildGrowthDashboard = buildTenantGrowthDashboard,
  getRuntimePool = getPool,
  markRunPrepared = markActivationRunPrepared,
  markRunDelivered = markActivationRunDelivered,
  chunkResponse = maybeChunkToolResponseBody,
} = {}) {
  const router = Router();
  const guards = [requireBackendApiKey].filter(Boolean);

  function tenantActivationSubject(req) {
    if (
      req.auth?.mode !== "user_jwt"
      || req.auth?.is_admin === true
      || !req.auth?.tenant_id
      || !req.auth?.user_id
    ) {
      return null;
    }
    return {
      tenant_id: req.auth.tenant_id,
      user_id: req.auth.user_id,
      is_admin: false,
    };
  }

  function requireTenantUserJwt(req, res, next) {
    if (tenantActivationSubject(req)) return next();
    return res.status(401).json({
      ok: false,
      error: {
        code: "tenant_activation_subject_required",
        message: "A signed non-admin tenant user JWT with tenant_id and user_id is required.",
      },
      secrets_included: false,
    });
  }

  function rejectUnsupportedQueryParameters(req, res, allowlist) {
    const unsupported = Object.keys(req.query || {}).filter((key) => !allowlist.has(key));
    if (unsupported.length === 0) return false;
    res.status(400).json({
      ok: false,
      error: {
        code: "tenant_activation_query_parameter_not_allowed",
        message: "One or more query parameters are not allowed for the tenant Activation session surface.",
        details: unsupported.map((field) => ({ field, issue: "unsupported" })),
      },
      secrets_included: false,
    });
    return true;
  }

  async function handleTenantActivationSessionList(req, res) {
    const subject = tenantActivationSubject(req);
    if (!subject) {
      return res.status(401).json({
        ok: false,
        error: {
          code: "tenant_activation_subject_required",
          message: "A signed non-admin tenant user JWT with tenant_id and user_id is required.",
        },
        secrets_included: false,
      });
    }
    if (rejectUnsupportedQueryParameters(req, res, TENANT_ACTIVATION_SESSION_LIST_QUERY_ALLOWLIST)) {
      return undefined;
    }

    const sessionStatus = String(req.query.session_status || "").trim().toLowerCase() || null;
    if (sessionStatus && !TENANT_ACTIVATION_SESSION_STATUSES.has(sessionStatus)) {
      return res.status(400).json({
        ok: false,
        error: {
          code: "tenant_activation_session_status_invalid",
          message: "session_status must be pending, active, completed, or failed.",
        },
        secrets_included: false,
      });
    }
    const requestedLimit = req.query.limit === undefined ? 50 : Number(req.query.limit);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 50) {
      return res.status(400).json({
        ok: false,
        error: {
          code: "tenant_activation_session_limit_invalid",
          message: "limit must be an integer between 1 and 50.",
        },
        secrets_included: false,
      });
    }

    try {
      let sql = `SELECT session_id, originator, session_status, brand_key, workspace_key,
                        turn_count, started_at, ended_at, created_at
                   FROM \`customer_sessions\`
                  WHERE tenant_id = ?
                    AND user_id = ?
                    AND originator = 'gpt_action'`;
      const params = [subject.tenant_id, subject.user_id];
      if (sessionStatus) {
        sql += " AND session_status = ?";
        params.push(sessionStatus);
      }
      sql += " ORDER BY started_at DESC, created_at DESC LIMIT ?";
      params.push(requestedLimit);

      const [rows] = await getRuntimePool().query(sql, params);
      const sessions = (rows || []).map((row) => ({
        session_id: row.session_id,
        originator: row.originator ?? null,
        session_status: row.session_status,
        brand_key: row.brand_key ?? null,
        workspace_key: row.workspace_key ?? null,
        turn_count: Number(row.turn_count || 0),
        started_at: row.started_at ?? null,
        ended_at: row.ended_at ?? null,
        created_at: row.created_at ?? null,
      }));
      return res.status(200).json({
        ok: true,
        activation_layer: "session_list",
        subject,
        sessions,
        total: sessions.length,
        secrets_included: false,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: compactError(error, "tenant_activation_session_list_failed"),
        secrets_included: false,
      });
    }
  }

  async function handleTenantActivationSessionContext(req, res, next, { allowFallthrough }) {
    if (req.auth?.mode !== "user_jwt" || req.auth?.is_admin === true) {
      if (allowFallthrough) return next();
      return res.status(401).json({
        ok: false,
        error: {
          code: "tenant_activation_subject_required",
          message: "A signed non-admin tenant user JWT is required.",
        },
        secrets_included: false,
      });
    }
    if (!allowFallthrough) {
      if (rejectUnsupportedQueryParameters(req, res, TENANT_ACTIVATION_SESSION_QUERY_ALLOWLIST)) return undefined;
    }
    if (!req.auth?.tenant_id || !req.auth?.user_id) {
      return res.status(401).json({
        ok: false,
        error: {
          code: "tenant_activation_subject_required",
          message: "A signed tenant user JWT with tenant_id and user_id is required.",
        },
        secrets_included: false,
      });
    }

    try {
      const context = await buildSessionContext(req);
      const responseProfile = normalizeActivationResponseProfile(req.query.response_profile || "evidence");
      const productGuidance = await buildGrowthDashboard({
        tenantId: req.auth.tenant_id,
        userId: req.auth.user_id,
        containerKey: req.query.container_key || null,
        tabKey: req.query.tab || req.query.tab_key || null,
        dateRange: req.query.date_range || null,
        mode: "activation",
      }).catch((error) => ({
        ok: false,
        product_layer: "tenant_growth_dashboard",
        degraded_surfaces: [{
          surface: "tenant_growth_dashboard",
          error: compactError(error, "tenant_growth_dashboard_activation_failed"),
        }],
        secrets_included: false,
      }));

      const projectedContext = ["full", "diagnostic"].includes(responseProfile)
        ? context
        : projectActivationSessionContext(context, responseProfile);
      const responseBody = {
        ok: true,
        activation_layer: "session_context",
        response_profile: responseProfile,
        ...projectedContext,
        product_guidance: productGuidance,
        dashboard_entry: {
          path: "/tenant/dashboard",
          active_container_key: productGuidance?.active_container?.container_key || null,
          active_tab_key: productGuidance?.navigation?.active_tab || "tenant_today",
        },
        secrets_included: false,
      };
      const responseBytes = Buffer.byteLength(JSON.stringify(responseBody), "utf8");
      await markRunPrepared(getRuntimePool(), {
        runId: context.run_id || null,
        responseProfile,
        responseBytes,
        validationState: "complete",
        evidenceState: "complete",
        deliveryState: "prepared",
        projection: {
          profile: responseProfile,
          response_bytes: responseBytes,
          tenant_product_guidance_included: true,
        },
      }).catch(() => {});
      res.on("finish", () => {
        markRunDelivered(getRuntimePool(), {
          runId: context.run_id || null,
          statusCode: res.statusCode,
          deliveryState: res.statusCode < 500 ? "delivered" : "delivery_failed",
        }).catch(() => {});
      });
      const maxChars = Math.min(Math.max(Number(req.query.max_response_chars || 40000), 5000), 150000);
      const chunkTtlMinutes = Math.min(Math.max(Number(req.query.chunk_ttl_minutes || 20), 5), 120);
      const transportBody = responseBytes > maxChars
        ? await chunkResponse(responseBody, {
            response_options: {
              max_chars: maxChars,
              chunk_ttl_minutes: chunkTtlMinutes,
            },
            auth: req.auth,
            source_tool_key: "tenant_activation_session_context",
            source_surface: "tenant_activation_session_context",
          })
        : responseBody;
      return res.status(200).json(transportBody);
    } catch (error) {
      return res.status(error?.status || 500).json({
        ok: false,
        error: compactError(error, "tenant_activation_overlay_failed"),
        secrets_included: false,
      });
    }
  }

  router.get("/tenant/activation/session-context", ...guards, requireTenantUserJwt, (req, res, next) =>
    handleTenantActivationSessionContext(req, res, next, { allowFallthrough: false }));
  router.get("/tenant/activation/sessions", ...guards, requireTenantUserJwt, handleTenantActivationSessionList);
  router.get("/activation/session-context", ...guards, (req, res, next) =>
    handleTenantActivationSessionContext(req, res, next, { allowFallthrough: true }));

  return router;
}
