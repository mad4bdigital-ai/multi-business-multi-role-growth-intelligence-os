import { Router } from "express";
import jwt from "jsonwebtoken";
import { appendReleaseOperationStep, createReleaseGateEvent, createReleaseOperation, getReleaseOperation, listReleaseOperations, runReleaseAdvisor } from "../releaseIntelligenceService.js";

function verifyUserJwt(authorization) {
  if (!authorization || !authorization.startsWith("Bearer ")) return null;
  try { return jwt.verify(authorization.slice(7), process.env.JWT_SECRET || "dev-secret"); } catch { return null; }
}

function requireUserJwt(req, res, next) {
  if (req.auth?.mode === "user_jwt") return next();
  const payload = verifyUserJwt(req.headers.authorization);
  if (!payload?.user_id || !payload?.tenant_id) return res.status(401).json({ ok: false, error: { code: "user_jwt_required", message: "Tenant sign-in is required." }, secrets_included: false });
  req.auth = { mode: "user_jwt", user_id: payload.user_id, tenant_id: payload.tenant_id, is_admin: false };
  return next();
}

function adminContext(req) {
  return { scope_type: "admin", user_id: req.user?.user_id || req.auth?.user_id || req.user?.id || "platform_admin", tenant_id: req.body?.tenant_id || req.query?.tenant_id || null, workspace_id: req.body?.workspace_id || req.query?.workspace_id || null };
}

function tenantContext(req) {
  return { scope_type: "tenant", user_id: req.auth.user_id, tenant_id: req.auth.tenant_id, workspace_id: req.body?.workspace_id || req.query?.workspace_id || null };
}

function handleError(res, error, fallbackCode) {
  const status = error.status || 500;
  return res.status(status).json({ ok: false, error: { code: error.code || fallbackCode, message: error.message }, secrets_included: false });
}

export function buildReleaseIntelligenceRoutes({ requireBackendApiKey, requireAdminPrincipal } = {}) {
  const router = Router();
  const adminGuards = [requireBackendApiKey, requireAdminPrincipal].filter(Boolean);

  router.get("/admin/release-intelligence/operations", ...adminGuards, async (req, res) => {
    try { return res.status(200).json({ ok: true, scope: "admin", ...(await listReleaseOperations(req.query || {}, adminContext(req))) }); } catch (error) { return handleError(res, error, "release_operations_list_failed"); }
  });

  router.post("/admin/release-intelligence/operations", ...adminGuards, async (req, res) => {
    try { return res.status(201).json({ ok: true, scope: "admin", operation: await createReleaseOperation(req.body || {}, adminContext(req)), secrets_included: false }); } catch (error) { return handleError(res, error, "release_operation_create_failed"); }
  });

  router.get("/admin/release-intelligence/operations/:operationId", ...adminGuards, async (req, res) => {
    try { const operation = await getReleaseOperation(req.params.operationId, adminContext(req)); if (!operation) return res.status(404).json({ ok: false, error: { code: "release_operation_not_found", message: "Release operation was not found." }, secrets_included: false }); return res.status(200).json({ ok: true, scope: "admin", operation, secrets_included: false }); } catch (error) { return handleError(res, error, "release_operation_get_failed"); }
  });

  router.post("/admin/release-intelligence/operations/:operationId/steps", ...adminGuards, async (req, res) => {
    try { return res.status(200).json({ ok: true, scope: "admin", operation: await appendReleaseOperationStep(req.params.operationId, req.body || {}, adminContext(req)), secrets_included: false }); } catch (error) { return handleError(res, error, "release_operation_step_failed"); }
  });

  router.post("/admin/release-intelligence/gate-events", ...adminGuards, async (req, res) => {
    try { return res.status(201).json({ ok: true, scope: "admin", operation: await createReleaseGateEvent(req.body || {}, adminContext(req)), secrets_included: false }); } catch (error) { return handleError(res, error, "release_gate_event_create_failed"); }
  });

  router.post("/admin/release-intelligence/advisor", ...adminGuards, async (req, res) => {
    try { return res.status(200).json({ scope: "admin", ...(await runReleaseAdvisor(req.body || {}, adminContext(req))) }); } catch (error) { return handleError(res, error, "release_advisor_failed"); }
  });

  router.get("/me/release-intelligence/operations", requireUserJwt, async (req, res) => {
    try { return res.status(200).json({ ok: true, scope: "tenant", ...(await listReleaseOperations(req.query || {}, tenantContext(req))) }); } catch (error) { return handleError(res, error, "tenant_release_operations_list_failed"); }
  });

  router.post("/me/release-intelligence/operations", requireUserJwt, async (req, res) => {
    try { return res.status(201).json({ ok: true, scope: "tenant", operation: await createReleaseOperation(req.body || {}, tenantContext(req)), secrets_included: false }); } catch (error) { return handleError(res, error, "tenant_release_operation_create_failed"); }
  });

  router.get("/me/release-intelligence/operations/:operationId", requireUserJwt, async (req, res) => {
    try { const operation = await getReleaseOperation(req.params.operationId, tenantContext(req)); if (!operation) return res.status(404).json({ ok: false, error: { code: "release_operation_not_found", message: "Release operation was not found for this tenant." }, secrets_included: false }); return res.status(200).json({ ok: true, scope: "tenant", operation, secrets_included: false }); } catch (error) { return handleError(res, error, "tenant_release_operation_get_failed"); }
  });

  router.post("/me/release-intelligence/advisor", requireUserJwt, async (req, res) => {
    try { return res.status(200).json({ scope: "tenant", ...(await runReleaseAdvisor(req.body || {}, tenantContext(req))) }); } catch (error) { return handleError(res, error, "tenant_release_advisor_failed"); }
  });

  return router;
}
