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

function normalizeManagedRole(value = "member", fallback = "member") {
  const role = String(value || fallback).trim().toLowerCase();
  if (!VALID_MEMBER_ROLES.has(role)) return fallback;
  return role;
}

async function countActiveOwners(connection, tenantId) {
  const [rows] = await connection.query(
    "SELECT COUNT(*) AS owner_count FROM memberships WHERE tenant_id=? AND role='owner' AND status='active'",
    [tenantId]
  );
  return Number(rows?.[0]?.owner_count || 0);
}

async function assertNotLastOwnerChange(connection, { tenantId, targetUserId, nextRole = null, nextStatus = "active" }) {
  const [rows] = await connection.query(
    "SELECT role, status FROM memberships WHERE tenant_id=? AND user_id=? LIMIT 1",
    [tenantId, targetUserId]
  );
  const current = rows[0] || null;
  if (!current || current.role !== "owner" || current.status !== "active") return;
  const removesOwner = nextStatus !== "active" || (nextRole && nextRole !== "owner");
  if (!removesOwner) return;
  const ownerCount = await countActiveOwners(connection, tenantId);
  if (ownerCount <= 1) {
    throw Object.assign(new Error("Cannot remove or demote the last active workspace owner."), { status: 409, code: "last_workspace_owner_required" });
  }
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

function defaultWorkspacePermissionForRole(role = "member") {
  const normalized = normalizeRole(role, "member");
  if (normalized === "admin") return "admin";
  if (normalized === "editor" || normalized === "operator") return "operate";
  if (normalized === "viewer") return "view";
  return "view";
}

async function ensureWorkspaceMembershipDefaultGrant(connection, { tenantId, userId, role, source, grantedBy }) {
  const grantId = randomUUID();
  const permission = defaultWorkspacePermissionForRole(role);
  await connection.query(
    `INSERT INTO workspace_resource_grants (grant_id, tenant_id, grantee_user_id, resource_type, resource_ref, permission, status, source, granted_by, metadata_json)
     VALUES (?, ?, ?, 'workspace', ?, ?, 'active', ?, ?, JSON_OBJECT('default_workspace_membership_grant', true, 'role', ?))
     ON DUPLICATE KEY UPDATE status='active', permission=VALUES(permission), source=VALUES(source), granted_by=VALUES(granted_by), metadata_json=VALUES(metadata_json), updated_at=NOW()`,
    [grantId, tenantId, userId, tenantId, permission, source, grantedBy || null, role]
  );
  return { grant_id: grantId, permission };
}

function fieldCountFromCredentialSchema(value) {
  const parsed = typeof value === "object" ? value : (() => { try { return JSON.parse(value || "{}"); } catch { return {}; } })();
  if (Array.isArray(parsed?.fields)) return parsed.fields.length;
  if (parsed?.properties && typeof parsed.properties === "object") return Object.keys(parsed.properties).length;
  return 0;
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function intakePromotionSummary(connection = {}, intake = {}) {
  const validationStatus = String(connection.validation_status || "").trim();
  const metadata = parseJsonObject(connection.account_metadata);
  const promoted = validationStatus === "promoted_to_platform_secrets";
  return {
    status: intake?.status || null,
    session_id: intake?.session_id || metadata.intake_session_id || null,
    used_at: intake?.used_at || null,
    expires_at: intake?.expires_at || null,
    field_count: fieldCountFromCredentialSchema(intake?.credential_schema_json),
    auto_promotion_status: promoted ? "completed" : validationStatus === "pending_validation" ? "pending_validation" : validationStatus || "unknown",
    promoted_count: promoted ? fieldCountFromCredentialSchema(intake?.credential_schema_json) : 0,
    secrets_included: false,
  };
}

export function buildTenantLifecycleRoutes() {
  const router = Router();

  router.get("/me/connections/:connection_id/credential-intake-status", requireUserJwt, async (req, res) => {
    try {
      const connectionId = String(req.params.connection_id || "").trim();
      if (!connectionId) return res.status(400).json({ ok: false, error: { code: "connection_id_required", message: "connection_id is required." }, secrets_included: false });
      if (!req.auth.tenant_id) return res.status(401).json({ ok: false, error: { code: "tenant_auth_required", message: "A tenant-scoped user JWT is required." }, secrets_included: false });

      const [rows] = await getPool().query(
        `SELECT c.connection_id, c.user_id, c.tenant_id, c.app_key, c.auth_type,
                c.display_label, c.account_label, c.account_metadata, c.status,
                c.validation_status, c.connected_at, c.last_validated_at, c.last_used_at,
                s.session_id, s.status AS intake_status, s.used_at, s.expires_at,
                s.credential_schema_json
           FROM user_app_connections c
           LEFT JOIN credential_intake_sessions s
             ON s.connection_id COLLATE utf8mb4_unicode_ci = c.connection_id COLLATE utf8mb4_unicode_ci
          WHERE c.connection_id COLLATE utf8mb4_unicode_ci = ?
            AND c.tenant_id = ?
            AND c.user_id = ?
          ORDER BY s.used_at DESC, s.expires_at DESC
          LIMIT 1`,
        [connectionId, req.auth.tenant_id, req.auth.user_id]
      );
      const row = rows[0];
      if (!row) return res.status(404).json({ ok: false, error: { code: "connection_not_found", message: "Connection was not found for this caller." }, secrets_included: false });

      const intake = {
        session_id: row.session_id || null,
        status: row.intake_status || null,
        used_at: row.used_at || null,
        expires_at: row.expires_at || null,
        credential_schema_json: row.credential_schema_json || null,
      };
      const connection = {
        connection_id: row.connection_id,
        tenant_id: row.tenant_id,
        user_id: row.user_id,
        app_key: row.app_key,
        auth_type: row.auth_type,
        display_label: row.display_label,
        account_label: row.account_label,
        status: row.status,
        validation_status: row.validation_status,
        connected_at: row.connected_at,
        last_validated_at: row.last_validated_at,
        last_used_at: row.last_used_at,
        account_metadata: row.account_metadata,
      };

      return res.json({
        ok: true,
        connection_id: row.connection_id,
        app_key: row.app_key,
        auth_type: row.auth_type,
        status: row.status,
        validation_status: row.validation_status,
        connection: {
          connection_id: row.connection_id,
          tenant_id: row.tenant_id,
          user_id: row.user_id,
          app_key: row.app_key,
          auth_type: row.auth_type,
          display_label: row.display_label,
          account_label: row.account_label,
          status: row.status,
          validation_status: row.validation_status,
          connected_at: row.connected_at,
          last_validated_at: row.last_validated_at,
          last_used_at: row.last_used_at,
        },
        intake: intakePromotionSummary(connection, intake),
        secrets_included: false,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "credential_intake_connection_status_failed", message: err.message }, secrets_included: false });
    }
  });

  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_members_list
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

  router.patch("/me/workspaces/:tenant_id/members/:user_id", requireUserJwt, async (req, res) => {
    const connection = await getPool().getConnection();
    try {
      const owner = await requireWorkspaceOwner(req, res, req.params.tenant_id);
      if (!owner) return;
      const role = normalizeManagedRole(req.body?.role || "member");
      await connection.beginTransaction();
      await assertNotLastOwnerChange(connection, { tenantId: req.params.tenant_id, targetUserId: req.params.user_id, nextRole: role, nextStatus: "active" });
      const [result] = await connection.query(
        "UPDATE memberships SET role=?, status='active', updated_at=NOW() WHERE tenant_id=? AND user_id=? AND status='active'",
        [role, req.params.tenant_id, req.params.user_id]
      );
      if (!result.affectedRows) throw Object.assign(new Error("Workspace member was not found."), { status: 404, code: "workspace_member_not_found" });
      const defaultGrant = await ensureWorkspaceMembershipDefaultGrant(connection, {
        tenantId: req.params.tenant_id,
        userId: req.params.user_id,
        role,
        source: "owner_assignment",
        grantedBy: req.auth.user_id,
      });
      await connection.commit();
      return res.json({ ok: true, tenant_id: req.params.tenant_id, user_id: req.params.user_id, role, status: "active", default_workspace_grant: defaultGrant, secrets_included: false });
    } catch (err) {
      await connection.rollback();
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "workspace_member_update_failed", message: err.message }, secrets_included: false });
    } finally {
      connection.release();
    }
  });

  router.post("/me/workspaces/:tenant_id/members/:user_id/remove", requireUserJwt, async (req, res) => {
    const connection = await getPool().getConnection();
    try {
      const owner = await requireWorkspaceOwner(req, res, req.params.tenant_id);
      if (!owner) return;
      await connection.beginTransaction();
      await assertNotLastOwnerChange(connection, { tenantId: req.params.tenant_id, targetUserId: req.params.user_id, nextStatus: "revoked" });
      const [result] = await connection.query(
        "UPDATE memberships SET status='revoked', updated_at=NOW() WHERE tenant_id=? AND user_id=? AND status='active'",
        [req.params.tenant_id, req.params.user_id]
      );
      if (!result.affectedRows) throw Object.assign(new Error("Workspace member was not found."), { status: 404, code: "workspace_member_not_found" });
      await connection.query(
        "UPDATE workspace_resource_grants SET status='revoked', revoked_by=?, revoked_at=NOW(), updated_at=NOW() WHERE tenant_id=? AND grantee_user_id=? AND status='active'",
        [req.auth.user_id, req.params.tenant_id, req.params.user_id]
      );
      await connection.commit();
      return res.json({ ok: true, tenant_id: req.params.tenant_id, user_id: req.params.user_id, status: "revoked", secrets_included: false });
    } catch (err) {
      await connection.rollback();
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "workspace_member_remove_failed", message: err.message }, secrets_included: false });
    } finally {
      connection.release();
    }
  });

  router.post("/me/workspaces/:tenant_id/ownership/transfer", requireUserJwt, async (req, res) => {
    const connection = await getPool().getConnection();
    try {
      const owner = await requireWorkspaceOwner(req, res, req.params.tenant_id);
      if (!owner) return;
      const targetUserId = String(req.body?.target_user_id || "").trim();
      if (!targetUserId) return res.status(400).json({ ok: false, error: { code: "target_user_id_required", message: "target_user_id is required." }, secrets_included: false });
      await connection.beginTransaction();
      const [targetRows] = await connection.query("SELECT user_id, role, status FROM memberships WHERE tenant_id=? AND user_id=? AND status='active' LIMIT 1", [req.params.tenant_id, targetUserId]);
      if (!targetRows[0]) throw Object.assign(new Error("Target user must be an active workspace member."), { status: 404, code: "target_member_not_found" });
      await connection.query("UPDATE memberships SET role='owner', updated_at=NOW() WHERE tenant_id=? AND user_id=?", [req.params.tenant_id, targetUserId]);
      await ensureWorkspaceMembershipDefaultGrant(connection, { tenantId: req.params.tenant_id, userId: targetUserId, role: "owner", source: "owner_assignment", grantedBy: req.auth.user_id });
      if (req.body?.demote_current_owner !== false && targetUserId !== req.auth.user_id) {
        await assertNotLastOwnerChange(connection, { tenantId: req.params.tenant_id, targetUserId: req.auth.user_id, nextRole: "admin", nextStatus: "active" });
        await connection.query("UPDATE memberships SET role='admin', updated_at=NOW() WHERE tenant_id=? AND user_id=? AND role='owner'", [req.params.tenant_id, req.auth.user_id]);
        await ensureWorkspaceMembershipDefaultGrant(connection, { tenantId: req.params.tenant_id, userId: req.auth.user_id, role: "admin", source: "owner_assignment", grantedBy: req.auth.user_id });
      }
      await connection.commit();
      return res.json({ ok: true, tenant_id: req.params.tenant_id, previous_owner_user_id: req.auth.user_id, new_owner_user_id: targetUserId, demoted_previous_owner: req.body?.demote_current_owner !== false && targetUserId !== req.auth.user_id, secrets_included: false });
    } catch (err) {
      await connection.rollback();
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "workspace_ownership_transfer_failed", message: err.message }, secrets_included: false });
    } finally {
      connection.release();
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

  router.post("/me/workspaces/:tenant_id/invitations/:invitation_id/revoke", requireUserJwt, async (req, res) => {
    try {
      const owner = await requireWorkspaceOwner(req, res, req.params.tenant_id);
      if (!owner) return;
      const [result] = await getPool().query(
        "UPDATE invitations SET status='revoked', revoked_by=?, revoked_at=NOW() WHERE tenant_id=? AND invitation_id=? AND status='pending'",
        [req.auth.user_id, req.params.tenant_id, req.params.invitation_id]
      );
      return res.status(result.affectedRows ? 200 : 404).json({ ok: Boolean(result.affectedRows), tenant_id: req.params.tenant_id, invitation_id: req.params.invitation_id, status: result.affectedRows ? "revoked" : "not_found", secrets_included: false });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "workspace_invitation_revoke_failed", message: err.message }, secrets_included: false });
    }
  });

  router.post("/me/workspaces/:tenant_id/invitations/:invitation_id/resend", requireUserJwt, async (req, res) => {
    try {
      const owner = await requireWorkspaceOwner(req, res, req.params.tenant_id);
      if (!owner) return;
      const token = randomBytes(32).toString("hex");
      const [result] = await getPool().query(
        "UPDATE invitations SET token=?, status='pending', created_by=?, expires_at=DATE_ADD(NOW(), INTERVAL 14 DAY), revoked_by=NULL, revoked_at=NULL WHERE tenant_id=? AND invitation_id=? AND status IN ('pending','expired','revoked')",
        [token, req.auth.user_id, req.params.tenant_id, req.params.invitation_id]
      );
      return res.status(result.affectedRows ? 200 : 404).json({ ok: Boolean(result.affectedRows), tenant_id: req.params.tenant_id, invitation_id: req.params.invitation_id, status: result.affectedRows ? "pending" : "not_found", token: result.affectedRows ? token : null, expires_in_days: result.affectedRows ? 14 : null, secrets_included: false });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "workspace_invitation_resend_failed", message: err.message }, secrets_included: false });
    }
  });

  router.post("/me/workspaces/:tenant_id/invitations/expire-stale", requireUserJwt, async (req, res) => {
    try {
      const owner = await requireWorkspaceOwner(req, res, req.params.tenant_id);
      if (!owner) return;
      const [result] = await getPool().query(
        "UPDATE invitations SET status='expired' WHERE tenant_id=? AND status='pending' AND expires_at < NOW()",
        [req.params.tenant_id]
      );
      return res.json({ ok: true, tenant_id: req.params.tenant_id, expired_count: result.affectedRows || 0, secrets_included: false });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "workspace_invitations_expire_failed", message: err.message }, secrets_included: false });
    }
  });

  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_invitations_list
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
      const acceptedRole = normalizeRole(invitation.role);
      const defaultGrant = await ensureWorkspaceMembershipDefaultGrant(connection, {
        tenantId: invitation.tenant_id,
        userId: req.auth.user_id,
        role: acceptedRole,
        source: "invitation_accept",
        grantedBy: invitation.created_by || null,
      });
      await connection.query("UPDATE invitations SET status='accepted', accepted_by=?, accepted_at=NOW() WHERE invitation_id=?", [req.auth.user_id, invitation.invitation_id]);
      await connection.commit();
      return res.json({ ok: true, tenant_id: invitation.tenant_id, role: acceptedRole, invitation_id: invitation.invitation_id, status: "accepted", default_workspace_grant: defaultGrant, secrets_included: false });
    } catch (err) {
      await connection.rollback();
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "invitation_accept_failed", message: err.message }, secrets_included: false });
    } finally {
      connection.release();
    }
  });

  router.get("/me/access-requests", requireUserJwt, async (req, res) => {
    try {
      const status = String(req.query.status || "all");
      const [rows] = await getPool().query(
        `SELECT r.request_id, r.tenant_id, t.display_name AS tenant_display_name, r.requester_user_id, r.requester_email, r.requested_role, r.status, r.reason, r.reviewed_by, r.reviewed_at, r.created_at, r.updated_at
           FROM workspace_access_requests r
           LEFT JOIN tenants t ON t.tenant_id = r.tenant_id
          WHERE r.requester_user_id = ? AND (? = 'all' OR r.status = ?)
          ORDER BY r.created_at DESC LIMIT 100`,
        [req.auth.user_id, status, status]
      );
      return res.json({ ok: true, access_requests: rows, count: rows.length, secrets_included: false });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "workspace_my_access_requests_list_failed", message: err.message }, secrets_included: false });
    }
  });

  router.post("/me/workspaces/:tenant_id/access-requests/:request_id/cancel", requireUserJwt, async (req, res) => {
    try {
      const [result] = await getPool().query(
        "UPDATE workspace_access_requests SET status='cancelled', updated_at=NOW() WHERE request_id=? AND tenant_id=? AND requester_user_id=? AND status='pending'",
        [req.params.request_id, req.params.tenant_id, req.auth.user_id]
      );
      return res.status(result.affectedRows ? 200 : 404).json({ ok: Boolean(result.affectedRows), request_id: req.params.request_id, tenant_id: req.params.tenant_id, status: result.affectedRows ? "cancelled" : "not_found", secrets_included: false });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "workspace_access_request_cancel_failed", message: err.message }, secrets_included: false });
    }
  });

  router.get("/me/access-requests", requireUserJwt, async (req, res) => {
    try {
      const status = String(req.query.status || "all");
      const [rows] = await getPool().query(
        `SELECT r.request_id, r.tenant_id, t.display_name AS tenant_display_name, r.requester_user_id, r.requester_email, r.requested_role, r.status, r.reason, r.reviewed_by, r.reviewed_at, r.created_at, r.updated_at
           FROM workspace_access_requests r
           LEFT JOIN tenants t ON t.tenant_id = r.tenant_id
          WHERE r.requester_user_id = ? AND (? = 'all' OR r.status = ?)
          ORDER BY r.created_at DESC LIMIT 100`,
        [req.auth.user_id, status, status]
      );
      return res.json({ ok: true, access_requests: rows, count: rows.length, secrets_included: false });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "workspace_my_access_requests_list_failed", message: err.message }, secrets_included: false });
    }
  });

  router.post("/me/workspaces/:tenant_id/access-requests/:request_id/cancel", requireUserJwt, async (req, res) => {
    try {
      const [result] = await getPool().query(
        "UPDATE workspace_access_requests SET status='cancelled', updated_at=NOW() WHERE request_id=? AND tenant_id=? AND requester_user_id=? AND status='pending'",
        [req.params.request_id, req.params.tenant_id, req.auth.user_id]
      );
      return res.status(result.affectedRows ? 200 : 404).json({ ok: Boolean(result.affectedRows), request_id: req.params.request_id, tenant_id: req.params.tenant_id, status: result.affectedRows ? "cancelled" : "not_found", secrets_included: false });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "workspace_access_request_cancel_failed", message: err.message }, secrets_included: false });
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

  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_access_requests_list
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
      const defaultGrant = await ensureWorkspaceMembershipDefaultGrant(connection, {
        tenantId: req.params.tenant_id,
        userId: request.requester_user_id,
        role,
        source: "access_request_approval",
        grantedBy: req.auth.user_id,
      });
      await connection.query("UPDATE workspace_access_requests SET status='approved', reviewed_by=?, reviewed_at=NOW() WHERE request_id=?", [req.auth.user_id, req.params.request_id]);
      await connection.commit();
      return res.json({ ok: true, request_id: req.params.request_id, tenant_id: req.params.tenant_id, user_id: request.requester_user_id, role, status: "approved", default_workspace_grant: defaultGrant, secrets_included: false });
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
  normalizeManagedRole,
  defaultWorkspacePermissionForRole,
};
