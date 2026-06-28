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
function compactError(error, fallback) {
  return {
    code: error?.code || fallback,
    message: error?.message || String(error || fallback),
  };
}

export function buildTenantActivationOverlayRoutes({ requireBackendApiKey } = {}) {
  const router = Router();
  const guards = [requireBackendApiKey].filter(Boolean);

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
      const unsupported = Object.keys(req.query || {}).filter((key) => !TENANT_ACTIVATION_SESSION_QUERY_ALLOWLIST.has(key));
      if (unsupported.length > 0) {
        return res.status(400).json({
          ok: false,
          error: {
            code: "tenant_activation_query_parameter_not_allowed",
            message: "One or more query parameters are not allowed for the tenant Activation session surface.",
            details: unsupported.map((field) => ({ field, issue: "unsupported" })),
          },
          secrets_included: false,
        });
      }
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
      const context = await buildActivationSessionContext(req);
      const responseProfile = normalizeActivationResponseProfile(req.query.response_profile || "evidence");
      const productGuidance = await buildTenantGrowthDashboard({
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
      await markActivationRunPrepared(getPool(), {
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
        markActivationRunDelivered(getPool(), {
          runId: context.run_id || null,
          statusCode: res.statusCode,
          deliveryState: res.statusCode < 500 ? "delivered" : "delivery_failed",
        }).catch(() => {});
      });
      const maxChars = Math.min(Math.max(Number(req.query.max_response_chars || 40000), 5000), 150000);
      const transportBody = responseBytes > maxChars
        ? await maybeChunkToolResponseBody(responseBody, {
            response_options: { max_chars: maxChars },
            source_tool_key: "tenant_activation_session_context",
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

  router.get("/tenant/activation/session-context", ...guards, (req, res, next) =>
    handleTenantActivationSessionContext(req, res, next, { allowFallthrough: false }));
  router.get("/activation/session-context", ...guards, (req, res, next) =>
    handleTenantActivationSessionContext(req, res, next, { allowFallthrough: true }));

  return router;
}
