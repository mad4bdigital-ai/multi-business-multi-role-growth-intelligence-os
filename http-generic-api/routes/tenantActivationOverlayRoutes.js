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

function compactError(error, fallback) {
  return {
    code: error?.code || fallback,
    message: error?.message || String(error || fallback),
  };
}

export function buildTenantActivationOverlayRoutes({ requireBackendApiKey } = {}) {
  const router = Router();
  const guards = [requireBackendApiKey].filter(Boolean);

  router.get("/activation/session-context", ...guards, async (req, res, next) => {
    if (req.auth?.mode !== "user_jwt" || req.auth?.is_admin === true) return next();
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
  });

  return router;
}
