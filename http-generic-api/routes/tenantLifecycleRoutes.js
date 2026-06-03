import { Router } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { getPool } from "../db.js";

const JWT_SECRET = process.env.JWT_SECRET || "development_fallback_secret_only";
const OWNER_ROLES = new Set(["owner", "admin"]);
const VALID_MEMBER_ROLES = new Set(["owner", "admin", "editor", "viewer", "operator", "member"]);

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

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeRole(value = "member", fallback = "member") {
  const role = String(value || fallback).trim().toLowerCase();
  if (!VALID_MEMBER_ROLES.has(role)) return fallback;
  return role === "owner" ? fallback : role;
}

function jsonMeta(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return JSON.stringify(value);
}

async function fetchUser(userId) {
  const [rows] = await getPool().query(
    "SELECT user_id, email, display_name, status FROM `users` WHERE user_id = ? LIMIT 1",
    [userId]
  );
  return rows[0] || null;
}

async function fetchMembership(userId, tenantId) {
  const [rows] = await getPool().query(
    `SELECT m.user_id, m.tenant_id, m.role, m.status, t.display_name AS tenant_display_name, t.status AS tenant_status
       FROM memberships m
       JOIN tenants t ON t.tenant_id = m.tenant_id
      WHERE m.user_id = ? AND m.tenant_id = ?
      LIMIT 1`,
    [userId, tenantId]
  );
  return rows[0] || null;
}

async function requireActiveMembership(req, res, tenantId) {
  const membership = await fetchMembership(req.auth.user_id, tenantId);
  if (!membership || membership.status !== "active" || membership.tenant_status !== "active") {
    res.status(403).json({ ok: false, error: { code: "active_membership_required", message: "Active workspace membership required." }, secrets_included: false });
    return null;
  }
  return membership;
}

async function requireWorkspaceOwner(req, res, tenantId) {
  const membership = await requireActiveMembership(req, res, tenantId);
  if (!membership) return null;
  if (!OWNER_ROLES.has(String(membership.role || "").toLowerCase())) {
    res.status(403).json({ ok: false, error: { code: "workspace_owner_required", message: "Workspace owner/admin role required." }, secrets_included: false });
    return null;
  }
  return membership;
}

function publicMembership(row) {
  return {
    user_id: row.user_id,
    email: row.email || null,
    display_name: row.display_name || null,
    role: row.role,
    status: row.status,
    granted_at: row.granted_at || null,
  };
}

export function buildTenantLifecycleRoutes() {
  const router = Router();

  router.get("/me/workspaces/:tenant_id/members", requireUserJwt, async (req, res) => {
    try {
      const membership = await requireActiveMembership(req, res, req.params.tenant_id);
      if (!membership) return;
      const [rows] = await getPool().query(
        `SELECT m.user_id, u.email, u.display_name, m.role, m.status, m.granted_at
           FROM memberships m
           LEFT JOIN users u ON u.user_id = m.user_id
          WHERE m.tenant_id = ?
          ORDER BY FIELD(m.role, 'owner','admin','editor','operator','viewer','member'), m.granted_at ASC`,
        [req.params.tenant_id]
      );
      return res.json({ ok: true, tenant_id: req.params.tenant_id, members: rows.map(publicMembership), count: rows.length, secrets_included: false });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "workspace_members_list_failed", message: err.message }, secrets_included: false });
    }
  });

  router.post("/me/workspaces/:tenant_id/invitations", requireUserJwt, async (req, res) => {
    try {
      const owner = await requireWorkspaceOwner(req, res, req.params.tenant_id);
      if (!owner) return;
      const email = normalizeEmail(req.body?.email);
      const role = normalizeRole(req.body?.role || "member");
      if (!email || !email.includes("@")) return res.status(400).json({ ok: false, error: { code: "invalid_email", message: "Valid invite email required." }, secrets_included: false });
      const token = randomBytes(32).toString("hex");
      const invitationId = randomUUID();
      await getPool().query(
        `INSERT INTO invitations (invitation_id, tenant_id, email, role, token, status, created_by, expires_at, metadata_json)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, DATE_ADD(NOW(), INTERVAL 14 DAY), ?)
         ON DUPLICATE KEY UPDATE role = VALUES(role), status = 'pending', created_by = VALUES(created_by), expires_at = VALUES(expires_at), metadata_json = VALUES(metadata_json)`,
        [invitationId, req.params.tenant_id, email, role, token, req.auth.user_id, jsonMeta(req.body?.metadata_json)]
      );
      return res.status(201).json({ ok: true, tenant_id: req.params.tenant_id, invitation: { invitation_id: invitationId, email, role, status: "pending", expires_in_days: 14 }, token, secrets_included: false });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "workspace_invitation_create_failed", message: err.message }, secrets_included: false });
    }
  });

  router.get("/me/workspaces/:tenant_id/invitations", requireUserJwt, async (req, res) => {
    try {
      const owner = await requireWorkspaceOwner(req, res, req.params.tenant_id);
      if (!owner) return;
      const status = String(req.query.status || "pending");
      const [rows] = await getPool().query(
        `SELECT invitation_id, tenant_id, email, role, status, created_by, accepted_by, revoked_by, accepted_at, revoked_at, expires_at, created_at
           FROM invitations
          WHERE tenant_id = ? AND (? = 'all' OR status = ?)
          ORDER BY created_at DESC LIMIT 100`,
        [req.params.tenant_id, status, status]
      );
      return res.json({ ok: true, tenant_id: req.params.tenant_id, invitations: rows, count: rows.length, secrets_included: false });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "workspace_invitations_list_failed", message: err.message }, secrets_included: false });
    }
  });

  router.post("/me/invitations/accept", requireUserJwt, async (req, res) => {
    const token = String(req.body?.token || "").trim();
    if (!token) return res.status(400).json({ ok: false, error: { code: "invitation_token_required", message: "Invitation token required." }, secrets_included: false });
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [userRows] = await connection.query("SELECT user_id, email FROM users WHERE user_id = ? AND status = 'active' LIMIT 1", [req.auth.user_id]);
      const user = userRows[0];
      if (!user) throw Object.assign(new Error("User not found."), { status: 404, code: "user_not_found" });
      const [invRows] = await connection.query("SELECT * FROM invitations WHERE token = ? LIMIT 1 FOR UPDATE", [token]);
      const invitation = invRows[0];
      if (!invitation || invitation.status !== "pending") throw Object.assign(new Error("Invitation is not pending."), { status: 404, code: "invitation_not_pending" });
      if (new Date(invitation.expires_at).getTime() < Date.now()) throw Object.assign(new Error("Invitation expired."), { status: 410, code: "invitation_expired" });
      if (normalizeEmail(invitation.email) !== normalizeEmail(user.email)) throw Object.assign(new Error("Invitation email does not match signed-in user."), { status: 403, code: "invitation_email_mismatch" });
      await connection.query(
        `INSERT INTO memberships (user_id, tenant_id, role, status)
         VALUES (?, ?, ?, 'active')
         ON DUPLICATE KEY UPDATE role = VALUES(role), status = 'active', updated_at = NOW()`,
        [req.auth.user_id, invitation.tenant_id, normalizeRole(invitation.role)]
      );
      await connection.query("UPDATE invitations SET status='accepted', accepted_by=?, accepted_at=NOW() WHERE invitation_id=?", [req.auth.user_id, invitation.invitation_id]);
      await connection.commit();
      return res.json({ ok: true, tenant_id: invitation.tenant_id, role: normalizeRole(invitation.role), invitation_id: invitation.invitation_id, status: "accepted", secrets_included: false });
    } catch (err) {
      await connection.rollback();
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "invitation_accept_failed", message: err.message }, secrets_included: false });
    } finally {
      connection.release();
    }
  });

  router.post("/me/workspaces/:tenant_id/access-requests", requireUserJwt, async (req, res) => {
    try {
      const user = await fetchUser(req.auth.user_id);
      if (!user || user.status !== "active") return res.status(404).json({ ok: false, error: { code: "user_not_found", message: "User not found." }, secrets_included: false });
      const existing = await fetchMembership(req.auth.user_id, req.params.tenant_id);
      if (existing?.status === "active") return res.status(409).json({ ok: false, error: { code: "already_member", message: "User is already an active member." }, secrets_included: false });
      const requestId = randomUUID();
      const requestedRole = normalizeRole(req.body?.requested_role || "member");
      await getPool().query(
        `INSERT INTO workspace_access_requests (request_id, tenant_id, requester_user_id, requester_email, requested_role, status, reason, metadata_json)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
         ON DUPLICATE KEY UPDATE requested_role=VALUES(requested_role), reason=VALUES(reason), metadata_json=VALUES(metadata_json), updated_at=NOW()`,
        [requestId, req.params.tenant_id, req.auth.user_id, normalizeEmail(user.email), requestedRole, req.body?.reason || null, jsonMeta(req.body?.metadata_json)]
      );
      return res.status(201).json({ ok: true, request_id: requestId, tenant_id: req.params.tenant_id, requested_role: requestedRole, status: "pending", secrets_included: false });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "workspace_access_request_create_failed", message: err.message }, secrets_included: false });
    }
  });

  router.get("/me/workspaces/:tenant_id/access-requests", requireUserJwt, async (req, res) => {
    try {
      const owner = await requireWorkspaceOwner(req, res, req.params.tenant_id);
      if (!owner) return;
      const status = String(req.query.status || "pending");
      const [rows] = await getPool().query(
        `SELECT request_id, tenant_id, requester_user_id, requester_email, requested_role, status, reason, reviewed_by, reviewed_at, created_at, updated_at
           FROM workspace_access_requests
          WHERE tenant_id = ? AND (? = 'all' OR status = ?)
          ORDER BY created_at DESC LIMIT 100`,
        [req.params.tenant_id, status, status]
      );
      return res.json({ ok: true, tenant_id: req.params.tenant_id, access_requests: rows, count: rows.length, secrets_included: false });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "workspace_access_requests_list_failed", message: err.message }, secrets_included: false });
    }
  });

  router.post("/me/workspaces/:tenant_id/access-requests/:request_id/approve", requireUserJwt, async (req, res) => {
    const connection = await getPool().getConnection();
    try {
      const owner = await requireWorkspaceOwner(req, res, req.params.tenant_id);
      if (!owner) return;
      await connection.beginTransaction();
      const [rows] = await connection.query("SELECT * FROM workspace_access_requests WHERE request_id=? AND tenant_id=? LIMIT 1 FOR UPDATE", [req.params.request_id, req.params.tenant_id]);
      const request = rows[0];
      if (!request || request.status !== "pending") throw Object.assign(new Error("Access request is not pending."), { status: 404, code: "access_request_not_pending" });
      const role = normalizeRole(req.body?.role || request.requested_role);
      await connection.query(
        `INSERT INTO memberships (user_id, tenant_id, role, status)
         VALUES (?, ?, ?, 'active')
         ON DUPLICATE KEY UPDATE role=VALUES(role), status='active', updated_at=NOW()`,
        [request.requester_user_id, req.params.tenant_id, role]
      );
      await connection.query("UPDATE workspace_access_requests SET status='approved', reviewed_by=?, reviewed_at=NOW() WHERE request_id=?", [req.auth.user_id, req.params.request_id]);
      await connection.commit();
      return res.json({ ok: true, request_id: req.params.request_id, tenant_id: req.params.tenant_id, user_id: request.requester_user_id, role, status: "approved", secrets_included: false });
    } catch (err) {
      await connection.rollback();
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "workspace_access_request_approve_failed", message: err.message }, secrets_included: false });
    } finally {
      connection.release();
    }
  });

  router.post("/me/workspaces/:tenant_id/access-requests/:request_id/reject", requireUserJwt, async (req, res) => {
    try {
      const owner = await requireWorkspaceOwner(req, res, req.params.tenant_id);
      if (!owner) return;
      const [result] = await getPool().query(
        "UPDATE workspace_access_requests SET status='rejected', reviewed_by=?, reviewed_at=NOW(), reason=COALESCE(?, reason) WHERE request_id=? AND tenant_id=? AND status='pending'",
        [req.auth.user_id, req.body?.reason || null, req.params.request_id, req.params.tenant_id]
      );
      return res.status(result.affectedRows ? 200 : 404).json({ ok: Boolean(result.affectedRows), request_id: req.params.request_id, tenant_id: req.params.tenant_id, status: result.affectedRows ? "rejected" : "not_found", secrets_included: false });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "workspace_access_request_reject_failed", message: err.message }, secrets_included: false });
    }
  });

  return router;
}

export const _testingTenantLifecycleRoutes = {
  OWNER_ROLES,
  VALID_MEMBER_ROLES,
  normalizeEmail,
  normalizeRole,
};
