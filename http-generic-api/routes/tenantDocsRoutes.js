import { Router } from "express";
import jwt from "jsonwebtoken";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../db.js";

const JWT_SECRET = process.env.JWT_SECRET || "development_fallback_secret_only";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const MAX_DOC_CHARS = 20000;

const TENANT_SAFE_DOC_ALLOWLIST = new Map([
  ["GPT_Tenant_Connector_Instructions.md", "GPT_Tenant_Connector_Instructions.md"],
  ["GPT_Tenant_Connector_Knowledge.md", "GPT_Tenant_Connector_Knowledge.md"],
  ["docs/tenant-platform-plugin-self-serve.md", "docs/tenant-platform-plugin-self-serve.md"],
  ["docs/local-manager-n8n-runtime-governance.md", "docs/local-manager-n8n-runtime-governance.md"],
  ["docs/platform-plugin-tenant-install.md", "docs/platform-plugin-tenant-install.md"],
  ["docs/platform-plugin-private-runtime.md", "docs/platform-plugin-private-runtime.md"],
]);

function verifyUserJwt(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(authHeader.slice(7), JWT_SECRET);
  } catch {
    return null;
  }
}

async function fetchActiveMembershipForTenant({ userId, tenantId = null }) {
  const pool = getPool();
  const params = [userId];
  let tenantClause = "";
  if (tenantId) {
    tenantClause = "AND m.tenant_id = ?";
    params.push(tenantId);
  }
  const [rows] = await pool.query(
    `SELECT m.tenant_id, m.role, m.status, t.display_name AS tenant_display_name
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
  const payload = req.auth?.mode === "user_jwt"
    ? req.auth
    : verifyUserJwt(req.headers.authorization);
  if (!payload || !payload.user_id) {
    return res.status(401).json({
      ok: false,
      error: { code: "user_jwt_required", message: "Sign in required." },
      secrets_included: false,
    });
  }
  const requestedTenantId = payload.tenant_id || req.headers["x-tenant-id"] || null;
  const membership = await fetchActiveMembershipForTenant({ userId: payload.user_id, tenantId: requestedTenantId });
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
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function normalizeRequestedPath(value = "") {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!normalized || normalized.includes("..") || path.isAbsolute(normalized)) return "";
  return TENANT_SAFE_DOC_ALLOWLIST.get(normalized) || "";
}

async function readTenantSafeDoc({ requestedPath, maxChars }) {
  const safePath = normalizeRequestedPath(requestedPath);
  if (!safePath) {
    const err = new Error("Document path is not tenant-safe or is not allowlisted.");
    err.status = 404;
    err.code = "tenant_doc_not_found";
    throw err;
  }
  const absolutePath = path.resolve(REPO_ROOT, safePath);
  if (!absolutePath.startsWith(`${REPO_ROOT}${path.sep}`)) {
    const err = new Error("Document path is outside repository root.");
    err.status = 403;
    err.code = "tenant_doc_path_blocked";
    throw err;
  }
  const content = await fs.readFile(absolutePath, "utf8");
  const limit = boundedInt(maxChars, MAX_DOC_CHARS, 500, MAX_DOC_CHARS);
  return {
    path: safePath,
    content: content.slice(0, limit),
    truncated: content.length > limit,
    size_chars: content.length,
    max_chars: limit,
  };
}

function publicCatalog() {
  return [...TENANT_SAFE_DOC_ALLOWLIST.keys()].map((doc_path) => ({ doc_path }));
}

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: { code: err.code || fallbackCode, message: err.message },
    tenant_facing: true,
    secrets_included: false,
  });
}

export function buildTenantDocsRoutes() {
  const router = Router();

  router.get("/tenant/docs", requireTenantUserJwt, async (req, res) => {
    return res.status(200).json({
      ok: true,
      docs: publicCatalog(),
      count: TENANT_SAFE_DOC_ALLOWLIST.size,
      tenant_facing: true,
      auth_context: {
        tenant_id: req.auth.tenant_id,
        user_id: req.auth.user_id,
        tenant_role: req.auth.tenant_role,
        source: "user_jwt",
      },
      secrets_included: false,
    });
  });

  router.get("/tenant/docs/read", requireTenantUserJwt, async (req, res) => {
    try {
      const doc = await readTenantSafeDoc({
        requestedPath: req.query.path,
        maxChars: req.query.max_chars,
      });
      return res.status(200).json({
        ok: true,
        ...doc,
        source_authority: "repo_live_allowlisted",
        tenant_facing: true,
        auth_context: {
          tenant_id: req.auth.tenant_id,
          user_id: req.auth.user_id,
          tenant_role: req.auth.tenant_role,
          source: "user_jwt",
        },
        secrets_included: false,
      });
    } catch (err) {
      return errorResponse(res, err, "tenant_doc_read_failed");
    }
  });

  return router;
}

export const _testingTenantDocsRoutes = {
  TENANT_SAFE_DOC_ALLOWLIST,
  normalizeRequestedPath,
  readTenantSafeDoc,
};
