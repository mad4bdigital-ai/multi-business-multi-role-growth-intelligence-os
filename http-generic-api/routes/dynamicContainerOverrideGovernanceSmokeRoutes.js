import { Router } from "express";
import { getPool } from "../db.js";
import { runDynamicContainerOverrideGovernanceSmoke } from "../dynamicContainerOverrideGovernanceSmoke.js";

function requestId(req) {
  return String(req.headers["x-request-id"] || req.headers["x-correlation-id"] || "");
}

function errorResponse(req, res, error) {
  const status = Number(error?.status || 500);
  return res.status(status).json({
    error: {
      code:error?.code || "container_override_governance_smoke_internal_error",
      message:status >= 500 ? "Container override governance smoke failed." : error.message,
      details:Array.isArray(error?.details) ? error.details : [],
      requestId:requestId(req)
    },
    secretsIncluded:false
  });
}

function assertAllowedKeys(body, allowed) {
  const unknown = Object.keys(body || {}).filter((key) => !allowed.has(key));
  if (!unknown.length) return;
  const error = new Error("Request contains unsupported fields.");
  error.status = 400;
  error.code = "validation_error";
  error.details = unknown.map((field) => ({ field,issue:"unsupported" }));
  throw error;
}

function actorId(req) {
  return req.auth?.user_id || req.auth?.principal_id || "platform_admin";
}

export function buildDynamicContainerOverrideGovernanceSmokeRoutes({ requireBackendApiKey,requireAdminPrincipal }) {
  const router = Router();
  const requireAdmin = [requireBackendApiKey,requireAdminPrincipal];

  router.post("/admin/container-authority/override-governance-smokes",...requireAdmin,async (req,res) => {
    let connection = null;
    try {
      assertAllowedKeys(req.body,new Set(["mode","confirm","capabilityEnvelopeId"]));
      const mode = String(req.body?.mode || "dry_run");
      connection = await getPool().getConnection();
      const result = await runDynamicContainerOverrideGovernanceSmoke({
        executor:connection,
        mode,
        confirm:req.body?.confirm || null,
        capabilityEnvelopeId:req.body?.capabilityEnvelopeId || null,
        actor:actorId(req)
      });
      return res.status(mode === "apply" ? 201 : 200).json(result);
    } catch (error) {
      return errorResponse(req,res,error);
    } finally {
      if (connection) connection.release();
    }
  });

  return router;
}

export const _testingDynamicContainerOverrideGovernanceSmokeRoutes = {
  assertAllowedKeys,
  actorId,
  errorResponse
};
