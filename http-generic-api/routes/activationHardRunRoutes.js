import { Router } from "express";
import { getPool } from "../db.js";
import { buildHardActivationEvidenceMatrix } from "../activationHardEvidence.js";
import {
  buildDynamicToolCatalogEvidence,
  buildRepoCanonicalRuntimeEvidence,
} from "../activationDynamicEvidence.js";
import {
  buildProfiledHardActivationResponse,
  normalizeActivationResponseProfile,
  recordPreparedActivationResponse,
} from "../activationHardResponseService.js";
import { markActivationRunDelivered } from "../activationSessionLifecycleService.js";
import { maybeChunkToolResponseBody } from "./gptToolsRoutes.js";
import { buildActivationSessionContext } from "./activationRoutes.js";

function compactError(err, fallback) {
  return { code: err?.code || fallback, message: err?.message || String(err || fallback) };
}

function buildSessionRequest(req) {
  const body = req.body || {};
  const profile = normalizeActivationResponseProfile(body.response_profile || req.query?.response_profile || "evidence");
  return {
    ...req,
    query: {
      ...(req.query || {}),
      ...(body.tenant_id ? { tenant_id: body.tenant_id } : {}),
      ...(body.user_id ? { user_id: body.user_id } : {}),
      ...(body.limit ? { limit: body.limit } : {}),
      ...(body.include_raw !== undefined ? { include_raw: body.include_raw } : {}),
      ...(body.close_previous_sessions !== undefined ? { close_previous_sessions: body.close_previous_sessions } : {}),
      response_profile: profile,
      session_policy: body.session_policy || req.query?.session_policy || "reuse_or_create",
      ...(body.idempotency_key ? { idempotency_key: body.idempotency_key } : {}),
      ...(body.conversation_ref ? { conversation_ref: body.conversation_ref } : {}),
      ...(body.reuse_window_hours ? { reuse_window_hours: body.reuse_window_hours } : {}),
      include_turns: body.include_turns === true ? "true" : "false",
      authorized_access_limit: body.authorized_access_limit || (profile === "full" || profile === "diagnostic" ? 25 : 5),
      authorized_surface_limit: body.authorized_surface_limit || (profile === "full" || profile === "diagnostic" ? 25 : 5),
    },
  };
}

async function runProviderBootstrap(req) {
  const internalBase = process.env.INTERNAL_BASE_URL || `http://localhost:${process.env.PORT || 8080}`;
  const response = await fetch(`${internalBase}/admin/system/tools/call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.BACKEND_API_KEY
        ? `Bearer ${process.env.BACKEND_API_KEY}`
        : (req.headers.authorization || ""),
    },
    body: JSON.stringify({
      name: "activation_provider_bootstrap_validate",
      arguments: req.body?.provider_arguments || {},
    }),
    signal: AbortSignal.timeout(300000),
  });
  const payload = await response.json().catch(() => ({}));
  const providerBootstrap = payload?.result || payload;
  if (payload?.ok === false && providerBootstrap?.ok !== false) {
    providerBootstrap.ok = false;
    providerBootstrap.error = payload.error || { code: "provider_bootstrap_failed", message: "Provider bootstrap validation failed." };
  }
  return providerBootstrap;
}

export function buildActivationHardRunRoutes({ requireBackendApiKey } = {}) {
  const router = Router();
  const guards = [requireBackendApiKey].filter(Boolean);

  router.post("/activation/hard-run", ...guards, async (req, res) => {
    let sessionContext = null;
    let providerBootstrap = null;
    try {
      const context = await buildActivationSessionContext(buildSessionRequest(req));
      sessionContext = { ok: true, activation_layer: "session_context", ...context };
    } catch (err) {
      sessionContext = {
        ok: false,
        activation_layer: "session_context",
        error: compactError(err, "session_context_failed"),
      };
    }

    try {
      providerBootstrap = await runProviderBootstrap(req);
    } catch (err) {
      providerBootstrap = {
        ok: false,
        activation_layer: "provider_bootstrap_system_tool",
        error: compactError(err, "provider_bootstrap_failed"),
      };
    }

    try {
      const [repoCanonicals] = await Promise.all([
        buildRepoCanonicalRuntimeEvidence(),
      ]);
      const hard = buildHardActivationEvidenceMatrix({
        sessionContext,
        providerBootstrap,
        repoCanonicals,
        toolCatalog: buildDynamicToolCatalogEvidence({
          platformAccess: sessionContext?.platform_access || null,
          authorizedAccess: sessionContext?.authorized_access || null,
        }),
      });
      const responseBody = await buildProfiledHardActivationResponse({
        request: req,
        hard,
        sessionContext,
        providerBootstrap,
      });
      const preparedRecord = await recordPreparedActivationResponse(responseBody);
      responseBody.delivery_registry = {
        prepared_recorded: preparedRecord.ok === true,
        degraded: preparedRecord.ok === false,
        error: preparedRecord.error || null,
      };

      const statusCode = hard.activation_complete ? 200 : 424;
      const runId = responseBody.run_id || null;
      res.on("finish", () => {
        markActivationRunDelivered(getPool(), {
          runId,
          statusCode,
          deliveryState: res.statusCode < 500 ? "delivered" : "delivery_failed",
        }).catch(() => {});
      });

      const shouldChunk = responseBody.response_projection?.semantic_chunk_fallback_required === true;
      const transportBody = shouldChunk
        ? maybeChunkToolResponseBody(responseBody, {
            response_options: {
              max_chars: Number(req.body?.max_response_chars || 40000),
            },
          })
        : responseBody;
      return res.status(statusCode).json(transportBody);
    } catch (err) {
      return res.status(500).json({
        ok: false,
        activation_layer: "hard_activation_orchestrator",
        error: compactError(err, "hard_activation_profiled_response_failed"),
        session_context_available: sessionContext?.ok === true,
        provider_bootstrap_available: providerBootstrap?.ok === true,
        secrets_included: false,
      });
    }
  });

  return router;
}
