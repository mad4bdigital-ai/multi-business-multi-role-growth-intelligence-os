import { Router } from "express";
import jwt from "jsonwebtoken";
import { getPool } from "../db.js";
import {
  DataManagementError,
  archiveRow,
  createRow,
  getRow,
  listRows,
  listTableRegistrations,
  patchRow,
} from "../registryDataManagementService.js";

const JWT_SECRET = process.env.JWT_SECRET || "development_fallback_secret_only";
const WRITE_ROLES = new Set(["owner", "admin", "operator", "editor", "manage", "operate", "edit"]);
const ARCHIVE_ROLES = new Set(["owner", "admin"]);

function verifyUserJwt(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  try { return jwt.verify(authHeader.slice(7), JWT_SECRET); } catch { return null; }
}

function requireUserJwt(req, res, next) {
  const payload = req.auth?.mode === "user_jwt" ? req.auth : verifyUserJwt(req.headers.authorization);
  if (!payload || !payload.user_id) {
    return res.status(401).json({ ok: false, error: { code: "user_jwt_required", message: "Sign in required." }, secrets_included: false });
  }
  req.auth = { mode: "user_jwt", user_id: payload.user_id, tenant_id: payload.tenant_id || null, is_admin: false };
  return next();
}

async function requireActiveMembership(req, res, tenantId) {
  const [rows] = await getPool().query(
    `SELECT m.user_id, m.tenant_id, m.role, m.status, t.status AS tenant_status
       FROM memberships m
       JOIN tenants t ON t.tenant_id = m.tenant_id
      WHERE m.user_id = ? AND m.tenant_id = ?
      LIMIT 1`,
    [req.auth.user_id, tenantId]
  );
  const membership = rows[0] || null;
  if (!membership || membership.status !== "active" || membership.tenant_status !== "active") {
    res.status(403).json({ ok: false, error: { code: "active_membership_required", message: "Active workspace membership required." }, secrets_included: false });
    return null;
  }
  return membership;
}

function requireRole(res, membership, allowed, code) {
  const role = String(membership?.role || "").toLowerCase();
  if (!allowed.has(role)) {
    res.status(403).json({ ok: false, error: { code, message: "The active membership role is not allowed for this data operation." }, secrets_included: false });
    return false;
  }
  return true;
}

function rowBody(req) {
  if (req.body?.row && typeof req.body.row === "object" && !Array.isArray(req.body.row)) return req.body.row;
  return req.body || {};
}

function sendError(res, error, fallbackCode = "registry_data_management_failed") {
  if (error instanceof DataManagementError) {
    return res.status(error.status || 400).json({
      ok: false,
      error: { code: error.code, message: error.message, details: error.details || {} },
      secrets_included: false,
    });
  }
  return res.status(500).json({
    ok: false,
    error: { code: fallbackCode, message: error?.message || "Registry data management failed." },
    secrets_included: false,
  });
}

export function buildRegistryDataManagementRoutes({ requireBackendApiKey, requireAdminPrincipal } = {}) {
  const router = Router();
  const adminGuard = [requireBackendApiKey, requireAdminPrincipal].filter((fn) => typeof fn === "function");

  router.get("/admin/data-tables", ...adminGuard, async (_req, res) => {
    try {
      const tables = await listTableRegistrations({ surface: "admin" });
      return res.json({ ok: true, tables, count: tables.length, secrets_included: false });
    } catch (error) {
      return sendError(res, error, "admin_data_table_catalog_failed");
    }
  });

  router.get("/admin/data-tables/:table_key/rows", ...adminGuard, async (req, res) => {
    try {
      return res.json(await listRows({ tableKey: req.params.table_key, surface: "admin", query: req.query }));
    } catch (error) {
      return sendError(res, error, "admin_data_table_rows_list_failed");
    }
  });

  router.get("/admin/data-tables/:table_key/rows/:row_id", ...adminGuard, async (req, res) => {
    try {
      return res.json(await getRow({ tableKey: req.params.table_key, rowId: req.params.row_id, surface: "admin" }));
    } catch (error) {
      return sendError(res, error, "admin_data_table_row_get_failed");
    }
  });

  router.post("/admin/data-tables/:table_key/rows", ...adminGuard, async (req, res) => {
    try {
      return res.status(201).json(await createRow({ tableKey: req.params.table_key, surface: "admin", userId: req.auth?.user_id || req.auth?.admin_id, row: rowBody(req) }));
    } catch (error) {
      return sendError(res, error, "admin_data_table_row_create_failed");
    }
  });

  router.patch("/admin/data-tables/:table_key/rows/:row_id", ...adminGuard, async (req, res) => {
    try {
      return res.json(await patchRow({ tableKey: req.params.table_key, rowId: req.params.row_id, surface: "admin", userId: req.auth?.user_id || req.auth?.admin_id, row: rowBody(req) }));
    } catch (error) {
      return sendError(res, error, "admin_data_table_row_patch_failed");
    }
  });

  router.delete("/admin/data-tables/:table_key/rows/:row_id", ...adminGuard, async (req, res) => {
    try {
      return res.json(await archiveRow({ tableKey: req.params.table_key, rowId: req.params.row_id, surface: "admin", userId: req.auth?.user_id || req.auth?.admin_id }));
    } catch (error) {
      return sendError(res, error, "admin_data_table_row_archive_failed");
    }
  });

  router.get("/me/workspaces/:tenant_id/data-tables", requireUserJwt, async (req, res) => {
    try {
      const membership = await requireActiveMembership(req, res, req.params.tenant_id);
      if (!membership) return;
      const tables = await listTableRegistrations({ surface: "tenant" });
      return res.json({ ok: true, tenant_id: req.params.tenant_id, membership: { role: membership.role }, tables, count: tables.length, secrets_included: false });
    } catch (error) {
      return sendError(res, error, "tenant_data_table_catalog_failed");
    }
  });

  router.get("/me/workspaces/:tenant_id/data-tables/:table_key/rows", requireUserJwt, async (req, res) => {
    try {
      const membership = await requireActiveMembership(req, res, req.params.tenant_id);
      if (!membership) return;
      return res.json(await listRows({ tableKey: req.params.table_key, surface: "tenant", tenantId: req.params.tenant_id, userId: req.auth.user_id, query: req.query }));
    } catch (error) {
      return sendError(res, error, "tenant_data_table_rows_list_failed");
    }
  });

  router.get("/me/workspaces/:tenant_id/data-tables/:table_key/rows/:row_id", requireUserJwt, async (req, res) => {
    try {
      const membership = await requireActiveMembership(req, res, req.params.tenant_id);
      if (!membership) return;
      return res.json(await getRow({ tableKey: req.params.table_key, rowId: req.params.row_id, surface: "tenant", tenantId: req.params.tenant_id, userId: req.auth.user_id }));
    } catch (error) {
      return sendError(res, error, "tenant_data_table_row_get_failed");
    }
  });

  router.post("/me/workspaces/:tenant_id/data-tables/:table_key/rows", requireUserJwt, async (req, res) => {
    try {
      const membership = await requireActiveMembership(req, res, req.params.tenant_id);
      if (!membership || !requireRole(res, membership, WRITE_ROLES, "tenant_data_table_write_role_required")) return;
      return res.status(201).json(await createRow({ tableKey: req.params.table_key, surface: "tenant", tenantId: req.params.tenant_id, userId: req.auth.user_id, row: rowBody(req) }));
    } catch (error) {
      return sendError(res, error, "tenant_data_table_row_create_failed");
    }
  });

  router.patch("/me/workspaces/:tenant_id/data-tables/:table_key/rows/:row_id", requireUserJwt, async (req, res) => {
    try {
      const membership = await requireActiveMembership(req, res, req.params.tenant_id);
      if (!membership || !requireRole(res, membership, WRITE_ROLES, "tenant_data_table_write_role_required")) return;
      return res.json(await patchRow({ tableKey: req.params.table_key, rowId: req.params.row_id, surface: "tenant", tenantId: req.params.tenant_id, userId: req.auth.user_id, row: rowBody(req) }));
    } catch (error) {
      return sendError(res, error, "tenant_data_table_row_patch_failed");
    }
  });

  router.delete("/me/workspaces/:tenant_id/data-tables/:table_key/rows/:row_id", requireUserJwt, async (req, res) => {
    try {
      const membership = await requireActiveMembership(req, res, req.params.tenant_id);
      if (!membership || !requireRole(res, membership, ARCHIVE_ROLES, "tenant_data_table_archive_role_required")) return;
      return res.json(await archiveRow({ tableKey: req.params.table_key, rowId: req.params.row_id, surface: "tenant", tenantId: req.params.tenant_id, userId: req.auth.user_id }));
    } catch (error) {
      return sendError(res, error, "tenant_data_table_row_archive_failed");
    }
  });

  return router;
}

export const _testingRegistryDataManagementRoutes = {
  WRITE_ROLES,
  ARCHIVE_ROLES,
};
