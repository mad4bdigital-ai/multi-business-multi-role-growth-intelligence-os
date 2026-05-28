import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import jwt from "jsonwebtoken";
import { getPool } from "../db.js";

const JWT_SECRET = process.env.JWT_SECRET || "development_fallback_secret_only";
const MAX_DOC_CHARS = 20000;
const DEFAULT_DOC_CHARS = 12000;

const TENANT_SAFE_DOCS = Object.freeze({
  "GPT_Tenant_Connector_Instructions.md": {
    title: "Tenant GPT compact instructions",
    category: "tenant_instructions",
  },
  "GPT_Tenant_Connector_Knowledge.md": {
    title: "Tenant GPT detailed connector knowledge",
    category: "tenant_knowledge",
  },
  "docs/live-repo-knowledge-loading-governance.md": {
    title: "Live repo knowledge loading governance",
    category: "governance",
  },
  "docs/tenant-platform-plugin-self-serve.md": {
    title: "Tenant Platform Plugin self-serve guidance",
    category: "platform_plugins",
  },
  "docs/platform-plugin-contribution-intake.md": {
    title: "Platform Plugin contribution intake",
    category: "platform_plugins",
  },
  "docs/platform-plugin-private-runtime.md": {
    title: "Platform Plugin private runtime",
    category: "platform_plugins",
  },
  "docs/platform-plugin-private-rest-dispatch.md": {
    title: "Platform Plugin private REST dispatch",
    category: "platform_plugins",
  },
  "docs/platform-plugin-shared-tool-bindings.md": {
    title: "Platform Plugin shared tool bindings",
    category: "platform_plugins",
  },
  "docs/platform-plugin-tenant-install.md": {
    title: "Platform Plugin tenant install",
    category: "platform_plugins",
  },
  "docs/local-manager-n8n-runtime-governance.md": {
    title: "Local Manager n8n runtime governance",
    category: "local_manager",
  },
});

const BLOCKED_PATHS = new Set([
  "AI_Agent_Knowledge_Guide.md",
  "GPT_Admin_Assistant_Knowledge_Guide.md",
  "Top Level Instructions.md",
  "memory_schema.json",
  "http-generic-api/openapi.yaml",
]);

const SECRET_REDACTION_PATTERNS = [
  /(Authorization\s*:\s*Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi,
  /(x-api-key\s*[:=]\s*)[A-Za-z0-9._~+/=-]{12,}/gi,
  /(connector_secret\s*[:=]\s*)[A-Za-z0-9._~+/=-]{8,}/gi,
  /(BACKEND_API_KEY\s*[:=]\s*)[^\s`"']+/gi,
  /(CONNECTOR_SECRET\s*[:=]\s*)[^\s`"']+/gi,
];

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
    return res.status(401).json({ ok: false, error: { code: "user_jwt_required", message: "Sign in required." }, secrets_included: false });
  }
  const requestedTenantId = payload.tenant_id || req.headers["x-tenant-id"] || null;
  const membership = await fetchActiveMembershipForTenant({ userId: payload.user_id, tenantId: requestedTenantId });
  if (!membership) {
    return res.status(403).json({ ok: false, error: { code: "active_tenant_membership_required", message: "No active tenant membership found for this user." }, secrets_included: false });
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

function repoRoot() {
  const cwd = path.resolve(process.cwd());
  return path.basename(cwd) === "http-generic-api" ? path.dirname(cwd) : cwd;
}

function normalizeDocPath(value = "") {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

function boundedInt(value, fallback = DEFAULT_DOC_CHARS, min = 1000, max = MAX_DOC_CHARS) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function redactPotentialSecrets(content) {
  return SECRET_REDACTION_PATTERNS.reduce((text, pattern) => text.replace(pattern, "$1[redacted]"), String(content || ""));
}

function allowedDocsList() {
  return Object.entries(TENANT_SAFE_DOCS).map(([docPath, meta]) => ({
    path: docPath,
    title: meta.title,
    category: meta.category,
  }));
}

async function readTenantSafeRepoDoc(input = {}) {
  const docPath = normalizeDocPath(input.path || input.doc_path || input.docPath);
  const maxChars = boundedInt(input.max_chars || input.maxChars);
  if (!docPath) {
    return {
      action: "list",
      count: allowedDocsList().length,
      allowed_docs: allowedDocsList(),
      policy: {
        source: "tenant_safe_repo_doc_allowlist",
        admin_repo_tools_allowed: false,
        raw_github_allowed: false,
        secrets_included: false,
      },
      secrets_included: false,
    };
  }

  if (BLOCKED_PATHS.has(docPath) || docPath.includes("..") || !TENANT_SAFE_DOCS[docPath]) {
    const err = new Error(`Document '${docPath}' is not tenant-safe or is not allowlisted.`);
    err.status = 403;
    err.code = "tenant_repo_doc_not_allowlisted";
    throw err;
  }

  const root = repoRoot();
  const resolved = path.resolve(root, docPath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    const err = new Error("Document path must stay inside repository root.");
    err.status = 400;
    err.code = "tenant_repo_doc_path_outside_root";
    throw err;
  }

  const stat = await fs.stat(resolved);
  if (!stat.isFile() || path.extname(resolved).toLowerCase() !== ".md") {
    const err = new Error("Tenant repo doc reader supports allowlisted Markdown files only.");
    err.status = 403;
    err.code = "tenant_repo_doc_file_type_blocked";
    throw err;
  }

  const raw = await fs.readFile(resolved, "utf8");
  if (raw.includes("\u0000")) {
    const err = new Error("Binary-looking document content is blocked.");
    err.status = 403;
    err.code = "tenant_repo_doc_binary_blocked";
    throw err;
  }
  const content = redactPotentialSecrets(raw);
  return {
    action: "read",
    path: docPath,
    title: TENANT_SAFE_DOCS[docPath].title,
    category: TENANT_SAFE_DOCS[docPath].category,
    size: stat.size,
    max_chars: maxChars,
    truncated: content.length > maxChars,
    content: content.slice(0, maxChars),
    policy: {
      source: "tenant_safe_repo_doc_allowlist",
      admin_repo_tools_allowed: false,
      raw_github_allowed: false,
      blocked_admin_docs: Array.from(BLOCKED_PATHS),
      secrets_included: false,
    },
    secrets_included: false,
  };
}

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: { code: err.code || fallbackCode, message: err.message },
    secrets_included: false,
  });
}

export function buildTenantRepoDocRoutes() {
  const router = Router();

  router.post("/tenant/repo-docs/read", requireTenantUserJwt, async (req, res) => {
    try {
      const result = await readTenantSafeRepoDoc(req.body || {});
      return res.status(200).json({
        ok: true,
        ...result,
        auth_context: {
          tenant_id: req.auth.tenant_id,
          user_id: req.auth.user_id,
          tenant_role: req.auth.tenant_role,
          source: "user_jwt",
        },
        tenant_facing: true,
        secrets_included: false,
      });
    } catch (err) { return errorResponse(res, err, "tenant_repo_doc_read_failed"); }
  });

  return router;
}

export const _testingTenantRepoDocRoutes = {
  TENANT_SAFE_DOCS,
  BLOCKED_PATHS,
  normalizeDocPath,
  redactPotentialSecrets,
  readTenantSafeRepoDoc,
};
