import express from "express";
import {
  getSqlCacheRuntimePolicyStatus,
  refreshSqlCacheRuntimePolicy,
  updateSqlCacheRuntimePolicy,
} from "../sqlCacheRuntimePolicy.js";

function requestId(req) {
  return String(req.headers["x-request-id"] || req.headers["x-correlation-id"] || "").trim() || null;
}

function sendError(req, res, error) {
  const status = Number(error?.status || 500);
  return res.status(status).json({
    ok: false,
    error: {
      code: error?.code || "sql_cache_runtime_policy_failed",
      message:
        status >= 500
          ? "SQL cache runtime policy operation failed."
          : String(error?.message || error),
      details: error?.details,
      requestId: requestId(req),
    },
    secrets_included: false,
  });
}

function assertBody(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const error = new Error("body must be an object.");
    error.status = 400;
    error.code = "validation_error";
    throw error;
  }
  const allowed = new Set(["expected_revision", "dry_run", "policy"]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) {
    const error = new Error("body contains unsupported fields.");
    error.status = 400;
    error.code = "validation_error";
    error.details = unknown.map((field) => ({ field: `body.${field}`, issue: "unsupported" }));
    throw error;
  }
}

function actor(req) {
  return String(
    req.auth?.user_id ||
      req.auth?.email ||
      req.auth?.mode ||
      req.headers["x-admin-actor"] ||
      "platform_admin"
  ).slice(0, 191);
}

export function buildSqlCachePolicyRoutes(deps = {}) {
  const router = express.Router();
  const requireBackendApiKey = deps.requireBackendApiKey || ((_req, _res, next) => next());
  const requireAdminPrincipal = deps.requireAdminPrincipal || ((_req, _res, next) => next());
  const guards = [requireBackendApiKey, requireAdminPrincipal];

  router.get("/admin/cache/sql-policy", ...guards, async (req, res) => {
    try {
      const policy = await refreshSqlCacheRuntimePolicy({
        force: String(req.query?.refresh || "").toLowerCase() === "true",
      });
      return res.json({
        ok: true,
        policy,
        runtime: getSqlCacheRuntimePolicyStatus(),
        secrets_included: false,
      });
    } catch (error) {
      return sendError(req, res, error);
    }
  });

  router.patch("/admin/cache/sql-policy", ...guards, async (req, res) => {
    try {
      assertBody(req.body);
      const policy = await updateSqlCacheRuntimePolicy({
        expectedRevision: req.body.expected_revision,
        patch: req.body.policy || {},
        updatedBy: actor(req),
        dryRun: req.body.dry_run === true,
      });
      return res.json({ ok: true, policy, secrets_included: false });
    } catch (error) {
      return sendError(req, res, error);
    }
  });

  return router;
}

export const _testingSqlCachePolicyRoutes = { assertBody, sendError };
