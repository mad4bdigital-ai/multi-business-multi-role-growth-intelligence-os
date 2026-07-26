import { Router } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import { writeAuditLog } from "../auditLogger.js";
import { createPlatformTopologyVerificationService } from "../src/application/authorityScope/platformTopologyVerificationService.js";
import { createPlatformTopologyVerificationRepository } from "../src/infrastructure/authorityScope/platformTopologyVerificationRepository.js";
import {
  createContainerRelationship,
  createContainerResourceBinding,
  createContainerRoleAssignment
} from "../dynamicContainerAuthorityMutationService.js";
import {
  approveContainerOverride,
  readContainerOverride,
  requestContainerOverride
} from "../dynamicContainerOverrideService.js";
import {
  applyLegacyContainerProjection,
  buildLegacyContainerProjectionPlan
} from "../dynamicContainerProjectionService.js";
import { readContainerResolution } from "../dynamicContainerAuthorityRepository.js";
import { runDynamicContainerShadowSampler } from "../dynamicContainerShadowSampler.js";
import { runDynamicContainerCanaryProbeSampler } from "../dynamicContainerCanaryProbeSampler.js";
import { runDynamicContainerPreviewCanaryProbeSampler } from "../dynamicContainerPreviewCanaryProbeSampler.js";
import { resolveContainerContextWithExecutor } from "../dynamicContainerResolverExecutor.js";
import {
  runContainerCanaryCloseout,
  runContainerCanaryPromotion,
  runContainerCanaryRollback
} from "../dynamicContainerRolloutSafety.js";
import { executeObservedReadOnlyCanary } from "../dynamicContainerCanaryRuntime.js";

const JWT_SECRET = process.env.JWT_SECRET || "development_fallback_secret_only";
const previewRate = new Map();
const topologyReadRate = new Map();

function requestId(req) {
  return String(req.headers["x-request-id"] || req.headers["x-correlation-id"] || randomUUID());
}

function errorResponse(req, res, error) {
  const status = Number(error?.status || 500);
  return res.status(status).json({
    error: {
      code:error?.code || "container_authority_internal_error",
      message:status >= 500 ? "Container authority operation failed." : error.message,
      details:Array.isArray(error?.details) ? error.details : [],
      requestId:requestId(req)
    },
    secretsIncluded:false
  });
}

function verifyUserJwt(authHeader) {
  if (!authHeader || !String(authHeader).startsWith("Bearer ")) return null;
  try { return jwt.verify(String(authHeader).slice(7),JWT_SECRET); } catch { return null; }
}

function requireResolutionPrincipal(deps) {
  return (req,res,next) => {
    const payload = req.auth?.mode === "user_jwt" ? req.auth : verifyUserJwt(req.headers.authorization);
    if (payload?.user_id && payload?.tenant_id) {
      req.containerPrincipal = { mode:"user",principal:{ type:"user",id:payload.user_id },tenantId:payload.tenant_id,isAdmin:false };
      return next();
    }
    return deps.requireBackendApiKey(req,res,() => {
      req.containerPrincipal = { mode:"admin",principal:{ type:"service",id:req.auth?.user_id || "platform_admin" },tenantId:null,isAdmin:true };
      return next();
    });
  };
}

function requireAdmin(deps, requireAdminPrincipal) {
  return [deps.requireBackendApiKey,requireAdminPrincipal];
}

function assertAllowedKeys(body, allowed) {
  const unknown = Object.keys(body || {}).filter(key => !allowed.has(key));
  if (unknown.length) {
    const error = new Error("Request contains unsupported fields.");
    error.status = 400;
    error.code = "validation_error";
    error.details = unknown.map(field => ({ field,issue:"unsupported" }));
    throw error;
  }
}

function enforcePreviewRate(req) {
  const principalKey = `${req.containerPrincipal.mode}:${req.containerPrincipal.principal.id}`;
  const now = Date.now();
  const current = previewRate.get(principalKey);
  if (!current || current.resetAt <= now) {
    previewRate.set(principalKey,{ count:1,resetAt:now+60000 });
    return;
  }
  current.count += 1;
  if (current.count > 60) {
    const error = new Error("Container resolution rate limit exceeded.");
    error.status = 429;
    error.code = "container_resolution_rate_limited";
    error.details = [{ retryAfterSeconds:Math.max(1,Math.ceil((current.resetAt-now)/1000)) }];
    throw error;
  }
}

function enforceTopologyReadRate(req) {
  const principalKey = `topology:${actorId(req)}`;
  const now = Date.now();
  const current = topologyReadRate.get(principalKey);
  if (!current || current.resetAt <= now) {
    topologyReadRate.set(principalKey,{ count:1,resetAt:now+60000 });
    return;
  }
  current.count += 1;
  if (current.count > 60) {
    const error = new Error("Platform topology verification rate limit exceeded.");
    error.status = 429;
    error.code = "platform_topology_verification_rate_limited";
    error.details = [{ retryAfterSeconds:Math.max(1,Math.ceil((current.resetAt-now)/1000)) }];
    throw error;
  }
}

function actorId(req) {
  return req.auth?.user_id || req.auth?.principal_id || "platform_admin";
}

export function buildDynamicContainerAuthorityRoutes({ requireBackendApiKey, requireAdminPrincipal }) {
  const router = Router();
  const deps = { requireBackendApiKey };

  router.post("/container-context-resolutions",requireResolutionPrincipal(deps),async (req,res) => {
    let connection = null;
    try {
      assertAllowedKeys(req.body,new Set(["principal","tenantId","targetContainerId","dimensionRequests","mode","expectedAuthorityEpoch","expectedRegistrySnapshotHash","legacyDecision","legacyEvidenceRef","requestId"]));
      enforcePreviewRate(req);
      const idempotencyKey = String(req.headers["idempotency-key"] || "").trim();
      if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
        const error = new Error("Idempotency-Key must contain 8 to 128 characters.");
        error.status = 400; error.code = "idempotency_key_invalid"; throw error;
      }
      const principalContext = req.containerPrincipal;
      const effectiveRequestId=req.body?.requestId || requestId(req);
      const input = {
        ...req.body,
        principal:principalContext.isAdmin ? (req.body?.principal || principalContext.principal) : principalContext.principal,
        tenantId:principalContext.isAdmin ? String(req.body?.tenantId || "") : principalContext.tenantId,
        mode:principalContext.isAdmin ? String(req.body?.mode || "preview") : "preview",
        idempotencyKey,
        requestId:effectiveRequestId
      };
      connection = await getPool().getConnection();
      if(input.mode !== "preview") {
        const result=await resolveContainerContextWithExecutor(input,connection);
        return res.status(201).json(result);
      }
      const observed = await executeObservedReadOnlyCanary({
        executor:connection,
        canaryKey:"container_authority_preview_resolution_v1",
        capabilityKey:"createContainerContextResolution",
        requestId:effectiveRequestId,
        execute:() => resolveContainerContextWithExecutor(input,connection)
      });
      return res.status(201).json(observed.response);
    } catch (error) { return errorResponse(req,res,error); }
    finally { if(connection) connection.release(); }
  });

  router.post("/admin/container-authority/resolution-preview",...requireAdmin(deps,requireAdminPrincipal),async (req,res) => {
    let connection = null;
    try {
      assertAllowedKeys(req.body,new Set(["principal","tenantId","targetContainerId","dimensionRequests","expectedAuthorityEpoch","expectedRegistrySnapshotHash","legacyDecision","legacyEvidenceRef","requestId","idempotencyKey"]));
      const idempotencyKey = String(req.body?.idempotencyKey || "").trim();
      if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
        const error = new Error("idempotencyKey must contain 8 to 128 characters.");
        error.status = 400; error.code = "idempotency_key_invalid"; throw error;
      }
      req.containerPrincipal = {
        mode:"admin_tool",
        principal:{ type:"service",id:actorId(req) },
        tenantId:String(req.body?.tenantId || ""),
        isAdmin:true
      };
      enforcePreviewRate(req);
      const effectiveRequestId=req.body?.requestId || requestId(req);
      const input={
        ...req.body,
        principal:req.body?.principal || req.containerPrincipal.principal,
        tenantId:req.containerPrincipal.tenantId,
        mode:"preview",
        idempotencyKey,
        requestId:effectiveRequestId
      };
      connection = await getPool().getConnection();
      const observed = await executeObservedReadOnlyCanary({
        executor:connection,
        canaryKey:"container_authority_preview_resolution_v1",
        capabilityKey:"createContainerContextResolution",
        requestId:effectiveRequestId,
        execute:async () => {
          const result=await resolveContainerContextWithExecutor(input,connection);
          return { ...result, enforced:false, providerCallMade:false, credentialPayloadRead:false, secretsIncluded:false };
        }
      });
      return res.status(201).json(observed.response);
    } catch (error) { return errorResponse(req,res,error); }
    finally { if(connection) connection.release(); }
  });

  router.get("/container-context-resolutions/:resolutionId",requireResolutionPrincipal(deps),async (req,res) => {
    try {
      const principalContext = req.containerPrincipal;
      const result = await readContainerResolution(req.params.resolutionId,principalContext.isAdmin ? {} : { tenantId:principalContext.tenantId,principalId:principalContext.principal.id });
      if (!result) {
        const error = new Error("Container resolution was not found."); error.status=404; error.code="container_resolution_not_found"; throw error;
      }
      return res.json(result);
    } catch (error) { return errorResponse(req,res,error); }
  });

  router.post("/container-relationships",...requireAdmin(deps,requireAdminPrincipal),async (req,res) => {
    try {
      assertAllowedKeys(req.body,new Set(["relationshipId","tenantId","fromContainerId","toContainerId","relationshipType","priority","conditions","validFrom","validUntil","approvedBy","metadata"]));
      const result = await createContainerRelationship(req.body,{ idempotencyKey:req.headers["idempotency-key"],ifMatch:req.headers["if-match"],actorId:actorId(req) });
      return res.status(201).json(result);
    } catch (error) { return errorResponse(req,res,error); }
  });

  router.post("/container-role-assignments",...requireAdmin(deps,requireAdminPrincipal),async (req,res) => {
    try {
      assertAllowedKeys(req.body,new Set(["assignmentId","tenantId","containerId","principal","roleTemplateKey","inlinePermissions","inheritanceMode","validUntil","approvedBy","metadata"]));
      const result = await createContainerRoleAssignment(req.body,{ idempotencyKey:req.headers["idempotency-key"],ifMatch:req.headers["if-match"],actorId:actorId(req) });
      return res.status(201).json(result);
    } catch (error) { return errorResponse(req,res,error); }
  });

  router.post("/container-resource-bindings",...requireAdmin(deps,requireAdminPrincipal),async (req,res) => {
    try {
      assertAllowedKeys(req.body,new Set(["bindingId","tenantId","containerId","dimension","resourceType","resourceRef","effect","permissionKey","operations","capabilityKeys","inheritanceMode","mergePriority","conditions","validUntil","sourceTable","sourcePk","delegatedByPrincipalType","delegatedByPrincipalId","delegatorResolutionId","delegationRelationshipId","approvedBy","metadata"]));
      const result = await createContainerResourceBinding(req.body,{ idempotencyKey:req.headers["idempotency-key"],ifMatch:req.headers["if-match"],actorId:actorId(req) });
      return res.status(201).json(result);
    } catch (error) { return errorResponse(req,res,error); }
  });

  router.post("/container-overrides",...requireAdmin(deps,requireAdminPrincipal),async (req,res) => {
    try {
      assertAllowedKeys(req.body,new Set(["overrideId","capabilityEnvelopeId","originalResolutionId","targetContainerId","dimension","dimensionKey","resourceType","resourceRef","operation","riskClass","reason","requestedTtlMinutes"]));
      const result = await requestContainerOverride(req.body,{ idempotencyKey:req.headers["idempotency-key"],requesterPrincipal:{ type:"service",id:actorId(req) } });
      return res.status(201).json(result);
    } catch (error) { return errorResponse(req,res,error); }
  });

  router.get("/container-overrides/:overrideId",...requireAdmin(deps,requireAdminPrincipal),async (req,res) => {
    try {
      const result = await readContainerOverride(req.params.overrideId);
      if (!result) { const error=new Error("Container override was not found.");error.status=404;error.code="container_override_not_found";throw error; }
      return res.json(result);
    } catch (error) { return errorResponse(req,res,error); }
  });

  router.post("/container-overrides/:overrideId/approvals",...requireAdmin(deps,requireAdminPrincipal),async (req,res) => {
    try {
      assertAllowedKeys(req.body,new Set(["decision","decisionNote"]));
      const result = await approveContainerOverride(req.params.overrideId,req.body,{ approverPrincipal:{ type:"service",id:actorId(req) } });
      return res.status(201).json(result);
    } catch (error) { return errorResponse(req,res,error); }
  });

  router.post("/admin/container-authority/projection-preview",...requireAdmin(deps,requireAdminPrincipal),async (req,res) => {
    try {
      assertAllowedKeys(req.body,new Set());
      const plan = await buildLegacyContainerProjectionPlan({ createdBy:actorId(req) });
      return res.json({
        ok:true,
        mode:"dry_run",
        projectionRunId:plan.projectionRunId,
        summary:plan.summary,
        issues:plan.issues,
        sourceSnapshotSha256:plan.sourceSnapshotSha256,
        willApply:false,
        providerCalls:false,
        credentialPayloadReads:false,
        externalWrites:false,
        secretsIncluded:false
      });
    } catch (error) { return errorResponse(req,res,error); }
  });

  router.post("/container-authority/projections",...requireAdmin(deps,requireAdminPrincipal),async (req,res) => {
    try {
      assertAllowedKeys(req.body,new Set(["mode"]));
      const mode = String(req.body?.mode || "dry_run");
      if (!new Set(["dry_run","apply"]).has(mode)) { const error=new Error("mode must be dry_run or apply.");error.status=400;error.code="projection_mode_invalid";throw error; }
      const plan = await buildLegacyContainerProjectionPlan({ createdBy:actorId(req) });
      if (mode === "dry_run") return res.json({ ok:true,mode,projectionRunId:plan.projectionRunId,summary:plan.summary,issues:plan.issues,sourceSnapshotSha256:plan.sourceSnapshotSha256,willApply:false,secretsIncluded:false });
      const result = await applyLegacyContainerProjection(plan,{ createdBy:actorId(req) });
      return res.status(201).json(result);
    } catch (error) { return errorResponse(req,res,error); }
  });

  router.post("/admin/container-authority/canary-promotions",...requireAdmin(deps,requireAdminPrincipal),async (req,res) => {
    let connection = null;
    try {
      assertAllowedKeys(req.body,new Set(["mode","targetCanaryKey","confirm","capabilityEnvelopeId"]));
      const mode = String(req.body?.mode || "dry_run");
      if(!new Set(["dry_run","apply"]).has(mode)) {
        const error = new Error("mode must be dry_run or apply.");
        error.status = 400;
        error.code = "container_canary_mode_invalid";
        throw error;
      }
      connection = await getPool().getConnection();
      const result = await runContainerCanaryPromotion({
        executor:connection,
        targetCanaryKey:req.body?.targetCanaryKey,
        apply:mode === "apply",
        confirm:req.body?.confirm || null,
        capabilityEnvelopeId:req.body?.capabilityEnvelopeId || null,
        requireCapabilityEnvelope:mode === "apply",
        actor:actorId(req)
      });
      return res.status(mode === "apply" ? 201 : 200).json(result);
    } catch (error) { return errorResponse(req,res,error); }
    finally { if(connection) connection.release(); }
  });

  router.post("/admin/container-authority/canary-closeouts",...requireAdmin(deps,requireAdminPrincipal),async (req,res) => {
    let connection = null;
    try {
      assertAllowedKeys(req.body,new Set(["mode","targetCanaryKey","confirm","capabilityEnvelopeId","reason"]));
      const mode = String(req.body?.mode || "dry_run");
      if(!new Set(["dry_run","apply"]).has(mode)) {
        const error = new Error("mode must be dry_run or apply.");
        error.status = 400;
        error.code = "container_canary_closeout_mode_invalid";
        throw error;
      }
      connection = await getPool().getConnection();
      const result = await runContainerCanaryCloseout({
        executor:connection,
        targetCanaryKey:req.body?.targetCanaryKey,
        apply:mode === "apply",
        confirm:req.body?.confirm || null,
        capabilityEnvelopeId:req.body?.capabilityEnvelopeId || null,
        reason:req.body?.reason || "monitoring_window_accepted",
        actor:actorId(req)
      });
      return res.status(mode === "apply" ? 201 : 200).json(result);
    } catch (error) { return errorResponse(req,res,error); }
    finally { if(connection) connection.release(); }
  });

  router.post("/admin/container-authority/canary-rollbacks",...requireAdmin(deps,requireAdminPrincipal),async (req,res) => {
    let connection = null;
    try {
      assertAllowedKeys(req.body,new Set(["mode","targetCanaryKey","confirm","capabilityEnvelopeId","reason"]));
      const mode = String(req.body?.mode || "dry_run");
      if(!new Set(["dry_run","apply"]).has(mode)) {
        const error = new Error("mode must be dry_run or apply.");
        error.status = 400;
        error.code = "container_canary_rollback_mode_invalid";
        throw error;
      }
      connection = await getPool().getConnection();
      const result = await runContainerCanaryRollback({
        executor:connection,
        targetCanaryKey:req.body?.targetCanaryKey,
        apply:mode === "apply",
        confirm:req.body?.confirm || null,
        capabilityEnvelopeId:req.body?.capabilityEnvelopeId || null,
        reason:req.body?.reason || "runtime_canary_not_observed",
        actor:actorId(req)
      });
      return res.status(mode === "apply" ? 201 : 200).json(result);
    } catch (error) { return errorResponse(req,res,error); }
    finally { if(connection) connection.release(); }
  });

  router.post("/admin/container-authority/canary-probes",...requireAdmin(deps,requireAdminPrincipal),async (req,res) => {
    let connection = null;
    try {
      assertAllowedKeys(req.body,new Set(["sampleCount","targetCanaryKey"]));
      connection = await getPool().getConnection();
      const result = await runDynamicContainerCanaryProbeSampler({
        sampleCount:req.body?.sampleCount,
        targetCanaryKey:req.body?.targetCanaryKey
      },{ executor:connection });
      return res.status(201).json(result);
    } catch (error) { return errorResponse(req,res,error); }
    finally { if(connection) connection.release(); }
  });

  router.post("/admin/container-authority/preview-canary-probes",...requireAdmin(deps,requireAdminPrincipal),async (req,res) => {
    let connection = null;
    try {
      assertAllowedKeys(req.body,new Set(["sampleCount"]));
      connection = await getPool().getConnection();
      const result = await runDynamicContainerPreviewCanaryProbeSampler({
        sampleCount:req.body?.sampleCount
      },{ executor:connection });
      return res.status(201).json(result);
    } catch (error) { return errorResponse(req,res,error); }
    finally { if(connection) connection.release(); }
  });

  router.post("/admin/container-authority/shadow-samples",...requireAdmin(deps,requireAdminPrincipal),async (req,res) => {
    try {
      assertAllowedKeys(req.body,new Set(["sampleCount","tenantId"]));
      const result = await runDynamicContainerShadowSampler({
        sampleCount:req.body?.sampleCount,
        tenantId:req.body?.tenantId || null,
        requestedBy:actorId(req)
      });
      return res.status(201).json(result);
    } catch (error) { return errorResponse(req,res,error); }
  });

  router.get("/container-authority/shadow-summary",...requireAdmin(deps,requireAdminPrincipal),async (req,res) => {
    try {
      const limit = Math.max(1,Math.min(200,Number(req.query.limit || 100)));
      const [rows] = await getPool().query("SELECT * FROM v_container_shadow_mismatch_summary ORDER BY mismatch_percent DESC,last_compared_at DESC LIMIT ?",[limit]);
      return res.json({ ok:true,items:rows,page:{ nextCursor:null,hasMore:false },secretsIncluded:false });
    } catch (error) { return errorResponse(req,res,error); }
  });

  router.get("/container-authority/rollout-readiness",...requireAdmin(deps,requireAdminPrincipal),async (req,res) => {
    let connection = null;
    try {
      connection = await getPool().getConnection();
      const observed = await executeObservedReadOnlyCanary({
        executor:connection,
        canaryKey:"container_authority_rollout_readiness_v1",
        capabilityKey:"getContainerAuthorityRolloutReadiness",
        requestId:requestId(req),
        execute:async () => {
          const [rows] = await connection.query("SELECT * FROM v_container_rollout_readiness ORDER BY policy_key");
          return { ok:true,items:rows,secretsIncluded:false };
        }
      });
      return res.json(observed.response);
    } catch (error) { return errorResponse(req,res,error); }
    finally { if(connection) connection.release(); }
  });

  router.get("/admin/container-authority/topology-verification",...requireAdmin(deps,requireAdminPrincipal),async (req,res) => {
    let connection = null;
    try {
      enforceTopologyReadRate(req);
      connection = await getPool().getConnection();
      const repository = createPlatformTopologyVerificationRepository({ executor:connection });
      const service = createPlatformTopologyVerificationService({
        repository,
        auditWriter:(event) => writeAuditLog({
          actor_id:event.actorId,
          actor_type:"service",
          request_id:event.requestId,
          action:event.action,
          resource_type:"authority_scope",
          resource_id:"platform:root",
          service_mode:"platform_admin",
          outcome:event.readinessCode,
          metadata:{
            gap_codes:event.gapCodes,
            gap_count:event.gapCount,
            authority_granted:false,
            secrets_included:false
          }
        })
      });
      const result = await service.verify({ actorId:actorId(req),requestId:requestId(req) });
      return res.json(result);
    } catch (error) { return errorResponse(req,res,error); }
    finally { if(connection) connection.release(); }
  });

  router.get("/container-authority/canary-monitoring",...requireAdmin(deps,requireAdminPrincipal),async (req,res) => {
    try {
      const [rows] = await getPool().query("SELECT * FROM v_container_canary_monitoring_summary ORDER BY canary_key");
      return res.json({ ok:true,items:rows,secretsIncluded:false });
    } catch (error) { return errorResponse(req,res,error); }
  });

  return router;
}

export const _testingDynamicContainerAuthorityRoutes = {
  verifyUserJwt,
  assertAllowedKeys,
  enforcePreviewRate,
  enforceTopologyReadRate,
  resetTopologyReadRateForTests:() => topologyReadRate.clear(),
  errorResponse
};
