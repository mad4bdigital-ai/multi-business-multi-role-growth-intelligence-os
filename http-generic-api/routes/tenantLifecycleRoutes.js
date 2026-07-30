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

function requireExactlyOneRow(rows, { code, message, status = 500 }) {
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw Object.assign(new Error(message), { status, code, row_count: Array.isArray(rows) ? rows.length : null });
  }
  const [row] = rows;
  return row;
}

async function ensureWorkspaceMembershipDefaultGrant(connection, { tenantId, userId, role, source, grantedBy }) {
  const candidateGrantId = randomUUID();
  const permission = defaultWorkspacePermissionForRole(role);
  await connection.query(
    `INSERT INTO workspace_resource_grants (grant_id, tenant_id, grantee_user_id, resource_type, resource_ref, permission, status, source, granted_by, metadata_json)
     VALUES (?, ?, ?, 'workspace', ?, ?, 'active', ?, ?, JSON_OBJECT('default_workspace_membership_grant', true, 'role', ?))
     ON DUPLICATE KEY UPDATE status='active', permission=VALUES(permission), source=VALUES(source), granted_by=VALUES(granted_by), metadata_json=VALUES(metadata_json), updated_at=NOW()`,
    [candidateGrantId, tenantId, userId, tenantId, permission, source, grantedBy || null, role]
  );
  const [grantRows] = await connection.query(
    `SELECT grant_id, permission, status
       FROM workspace_resource_grants
      WHERE tenant_id=? AND grantee_user_id=? AND resource_type='workspace' AND resource_ref=? AND status='active'
      ORDER BY updated_at DESC
      LIMIT 2`,
    [tenantId, userId, tenantId]
  );
  const grant = requireExactlyOneRow(grantRows, {
    code: 'workspace_default_grant_readback_invalid',
    message: 'Default workspace grant readback must resolve exactly one active grant.',
    status: 409,
  });
  return { grant_id: grant.grant_id, permission: grant.permission, status: grant.status };
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

  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_invitation_create
  router.post("/me/workspaces/:tenant_id/invitations", requireUserJwt, async (req, res) => {
    const connection = await getPool().getConnection();
    try {
      const owner = await requireWorkspaceOwner(req, res, req.params.tenant_id);
      if (!owner) return;
      const email = normalizeEmail(req.body?.email);
      const role = normalizeRole(req.body?.role || "member");
      if (!email || !email.includes("@")) return res.status(400).json({ ok: false, error: { code: "invalid_email", message: "Valid invite email required." }, secrets_included: false });
      const token = randomBytes(32).toString("hex");
      const candidateInvitationId = randomUUID();
      await connection.beginTransaction(); // MUTATION_TRANSACTION: workspace_invitation_create
      const [pendingRows] = await connection.query(
        "SELECT invitation_id FROM invitations WHERE tenant_id=? AND email=? AND status='pending' ORDER BY created_at DESC LIMIT 2 FOR UPDATE",
        [req.params.tenant_id, email]
      );
      if (pendingRows.length > 1) throw Object.assign(new Error("Multiple pending invitations exist for this workspace and email."), { status: 409, code: "workspace_invitation_ambiguous" });
      const [pendingInvitation] = pendingRows;
      const invitationId = pendingInvitation?.invitation_id || candidateInvitationId;
      const created = !pendingInvitation;
      if (created) {
        await connection.query(
          `INSERT INTO invitations (invitation_id, tenant_id, email, role, token, status, created_by, expires_at, metadata_json)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, DATE_ADD(NOW(), INTERVAL 14 DAY), ?)`,
          [invitationId, req.params.tenant_id, email, role, token, req.auth.user_id, jsonMeta(req.body?.metadata_json)]
        );
      } else {
        await connection.query(
          "UPDATE invitations SET role=?, token=?, created_by=?, expires_at=DATE_ADD(NOW(), INTERVAL 14 DAY), metadata_json=?, updated_at=NOW() WHERE invitation_id=? AND tenant_id=? AND status='pending'",
          [role, token, req.auth.user_id, jsonMeta(req.body?.metadata_json), invitationId, req.params.tenant_id]
        );
      }
      const [readbackRows] = await connection.query(
        "SELECT invitation_id, tenant_id, email, role, status, expires_at FROM invitations WHERE invitation_id=? AND tenant_id=? LIMIT 2",
        [invitationId, req.params.tenant_id]
      );
      const invitation = requireExactlyOneRow(readbackRows, { code: "workspace_invitation_create_readback_invalid", message: "Invitation creation readback must resolve exactly one invitation.", status: 409 }); // MUTATION_READBACK: workspace_invitation_create
      await connection.commit();
      return res.status(created ? 201 : 200).json({ ok: true, created, tenant_id: invitation.tenant_id, invitation: { invitation_id: invitation.invitation_id, email: invitation.email, role: invitation.role, status: invitation.status, expires_at: invitation.expires_at }, token_returned: false, delivery_required: true, secrets_included: false });
    } catch (err) {
      await connection.rollback();
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "workspace_invitation_create_failed", message: err.message }, secrets_included: false });
    } finally {
      connection.release();
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

  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_invitation_accept
  router.post("/me/invitations/accept", requireUserJwt, async (req, res) => {
    const token = String(req.body?.token || "").trim();
    if (!token) return res.status(400).json({ ok: false, error: { code: "invitation_token_required", message: "Invitation token required." }, secrets_included: false });
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction(); // MUTATION_TRANSACTION: workspace_invitation_accept
      const [userRows] = await connection.query("SELECT user_id, email FROM users WHERE user_id = ? AND status = 'active' LIMIT 2", [req.auth.user_id]);
      const user = requireExactlyOneRow(userRows, { code: "user_not_found", message: "Active user readback must resolve exactly one user.", status: 404 });
      const [invitationRows] = await connection.query("SELECT * FROM invitations WHERE token = ? LIMIT 2 FOR UPDATE", [token]);
      const invitation = requireExactlyOneRow(invitationRows, { code: "invitation_not_pending", message: "Invitation token must resolve exactly one invitation.", status: 404 });
      if (invitation.status !== "pending") throw Object.assign(new Error("Invitation is not pending."), { status: 404, code: "invitation_not_pending" });
      if (new Date(invitation.expires_at).getTime() < Date.now()) throw Object.assign(new Error("Invitation expired."), { status: 410, code: "invitation_expired" });
      if (normalizeEmail(invitation.email) !== normalizeEmail(user.email)) throw Object.assign(new Error("Invitation email does not match signed-in user."), { status: 403, code: "invitation_email_mismatch" });
      const acceptedRole = normalizeRole(invitation.role);
      await connection.query(
        `INSERT INTO memberships (user_id, tenant_id, role, status)
         VALUES (?, ?, ?, 'active')
         ON DUPLICATE KEY UPDATE role = VALUES(role), status = 'active', updated_at = NOW()`,
        [req.auth.user_id, invitation.tenant_id, acceptedRole]
      );
      const defaultGrant = await ensureWorkspaceMembershipDefaultGrant(connection, { tenantId: invitation.tenant_id, userId: req.auth.user_id, role: acceptedRole, source: "invitation_accept", grantedBy: invitation.created_by || null });
      const [updateResult] = await connection.query("UPDATE invitations SET status='accepted', accepted_by=?, accepted_at=NOW() WHERE invitation_id=? AND status='pending'", [req.auth.user_id, invitation.invitation_id]);
      if (updateResult.affectedRows !== 1) throw Object.assign(new Error("Invitation acceptance lost its pending state."), { status: 409, code: "invitation_state_changed" });
      const [acceptedRows] = await connection.query("SELECT invitation_id, tenant_id, role, status, accepted_by, accepted_at FROM invitations WHERE invitation_id=? LIMIT 2", [invitation.invitation_id]);
      const accepted = requireExactlyOneRow(acceptedRows, { code: "workspace_invitation_accept_readback_invalid", message: "Invitation acceptance readback must resolve exactly one invitation.", status: 409 }); // MUTATION_READBACK: workspace_invitation_accept
      await connection.commit();
      return res.json({ ok: true, tenant_id: accepted.tenant_id, role: acceptedRole, invitation_id: accepted.invitation_id, status: accepted.status, accepted_by: accepted.accepted_by, accepted_at: accepted.accepted_at, default_workspace_grant: defaultGrant, secrets_included: false });
    } catch (err) {
      await connection.rollback();
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "workspace_invitation_accept_failed", message: err.message }, secrets_included: false });
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

  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_access_request_create
  router.post("/me/workspaces/:tenant_id/access-requests", requireUserJwt, async (req, res) => {
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction(); // MUTATION_TRANSACTION: workspace_access_request_create
      const [userRows] = await connection.query("SELECT user_id, email, status FROM users WHERE user_id=? AND status='active' LIMIT 2", [req.auth.user_id]);
      const user = requireExactlyOneRow(userRows, { code: "user_not_found", message: "Active user readback must resolve exactly one user.", status: 404 });
      const [membershipRows] = await connection.query("SELECT user_id, status FROM memberships WHERE user_id=? AND tenant_id=? LIMIT 2 FOR UPDATE", [req.auth.user_id, req.params.tenant_id]);
      if (membershipRows.some((row) => row.status === "active")) throw Object.assign(new Error("User is already an active member."), { status: 409, code: "already_member" });
      const requestedRole = normalizeRole(req.body?.requested_role || "member");
      const [pendingRows] = await connection.query("SELECT request_id FROM workspace_access_requests WHERE tenant_id=? AND requester_user_id=? AND status='pending' ORDER BY created_at DESC LIMIT 2 FOR UPDATE", [req.params.tenant_id, req.auth.user_id]);
      if (pendingRows.length > 1) throw Object.assign(new Error("Multiple pending access requests exist for this workspace and user."), { status: 409, code: "workspace_access_request_ambiguous" });
      const [pendingRequest] = pendingRows;
      const requestId = pendingRequest?.request_id || randomUUID();
      const created = !pendingRequest;
      if (created) {
        await connection.query(
          `INSERT INTO workspace_access_requests (request_id, tenant_id, requester_user_id, requester_email, requested_role, status, reason, metadata_json)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
          [requestId, req.params.tenant_id, req.auth.user_id, normalizeEmail(user.email), requestedRole, req.body?.reason || null, jsonMeta(req.body?.metadata_json)]
        );
      } else {
        await connection.query("UPDATE workspace_access_requests SET requester_email=?, requested_role=?, reason=?, metadata_json=?, updated_at=NOW() WHERE request_id=? AND tenant_id=? AND requester_user_id=? AND status='pending'", [normalizeEmail(user.email), requestedRole, req.body?.reason || null, jsonMeta(req.body?.metadata_json), requestId, req.params.tenant_id, req.auth.user_id]);
      }
      const [readbackRows] = await connection.query("SELECT request_id, tenant_id, requester_user_id, requester_email, requested_role, status, reason, created_at, updated_at FROM workspace_access_requests WHERE request_id=? AND tenant_id=? LIMIT 2", [requestId, req.params.tenant_id]);
      const request = requireExactlyOneRow(readbackRows, { code: "workspace_access_request_create_readback_invalid", message: "Access request creation readback must resolve exactly one request.", status: 409 }); // MUTATION_READBACK: workspace_access_request_create
      await connection.commit();
      return res.status(created ? 201 : 200).json({ ok: true, created, request_id: request.request_id, tenant_id: request.tenant_id, requested_role: request.requested_role, status: request.status, secrets_included: false });
    } catch (err) {
      await connection.rollback();
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "workspace_access_request_create_failed", message: err.message }, secrets_included: false });
    } finally {
      connection.release();
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

  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_access_request_approve
  router.post("/me/workspaces/:tenant_id/access-requests/:request_id/approve", requireUserJwt, async (req, res) => {
    const connection = await getPool().getConnection();
    try {
      const owner = await requireWorkspaceOwner(req, res, req.params.tenant_id);
      if (!owner) return;
      await connection.beginTransaction(); // MUTATION_TRANSACTION: workspace_access_request_approve
      const [requestRows] = await connection.query("SELECT * FROM workspace_access_requests WHERE request_id=? AND tenant_id=? LIMIT 2 FOR UPDATE", [req.params.request_id, req.params.tenant_id]);
      const request = requireExactlyOneRow(requestRows, { code: "access_request_not_pending", message: "Access request must resolve exactly one row.", status: 404 });
      if (request.status !== "pending") throw Object.assign(new Error("Access request is not pending."), { status: 404, code: "access_request_not_pending" });
      const role = normalizeRole(req.body?.role || request.requested_role);
      await connection.query(
        `INSERT INTO memberships (user_id, tenant_id, role, status)
         VALUES (?, ?, ?, 'active')
         ON DUPLICATE KEY UPDATE role=VALUES(role), status='active', updated_at=NOW()`,
        [request.requester_user_id, req.params.tenant_id, role]
      );
      const defaultGrant = await ensureWorkspaceMembershipDefaultGrant(connection, { tenantId: req.params.tenant_id, userId: request.requester_user_id, role, source: "access_request_approval", grantedBy: req.auth.user_id });
      const [updateResult] = await connection.query("UPDATE workspace_access_requests SET status='approved', reviewed_by=?, reviewed_at=NOW() WHERE request_id=? AND tenant_id=? AND status='pending'", [req.auth.user_id, req.params.request_id, req.params.tenant_id]);
      if (updateResult.affectedRows !== 1) throw Object.assign(new Error("Access request approval lost its pending state."), { status: 409, code: "access_request_state_changed" });
      const [readbackRows] = await connection.query("SELECT request_id, tenant_id, requester_user_id, requested_role, status, reviewed_by, reviewed_at FROM workspace_access_requests WHERE request_id=? AND tenant_id=? LIMIT 2", [req.params.request_id, req.params.tenant_id]);
      const approved = requireExactlyOneRow(readbackRows, { code: "workspace_access_request_approve_readback_invalid", message: "Access request approval readback must resolve exactly one request.", status: 409 }); // MUTATION_READBACK: workspace_access_request_approve
      await connection.commit();
      return res.json({ ok: true, request_id: approved.request_id, tenant_id: approved.tenant_id, user_id: approved.requester_user_id, role, status: approved.status, reviewed_by: approved.reviewed_by, reviewed_at: approved.reviewed_at, default_workspace_grant: defaultGrant, secrets_included: false });
    } catch (err) {
      await connection.rollback();
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "workspace_access_request_approve_failed", message: err.message }, secrets_included: false });
    } finally {
      connection.release();
    }
  });

  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_access_request_reject
  router.post("/me/workspaces/:tenant_id/access-requests/:request_id/reject", requireUserJwt, async (req, res) => {
    const connection = await getPool().getConnection();
    try {
      const owner = await requireWorkspaceOwner(req, res, req.params.tenant_id);
      if (!owner) return;
      await connection.beginTransaction(); // MUTATION_TRANSACTION: workspace_access_request_reject
      const [requestRows] = await connection.query("SELECT request_id, tenant_id, status FROM workspace_access_requests WHERE request_id=? AND tenant_id=? LIMIT 2 FOR UPDATE", [req.params.request_id, req.params.tenant_id]);
      const request = requireExactlyOneRow(requestRows, { code: "access_request_not_pending", message: "Access request must resolve exactly one row.", status: 404 });
      if (request.status !== "pending") throw Object.assign(new Error("Access request is not pending."), { status: 404, code: "access_request_not_pending" });
      const [updateResult] = await connection.query("UPDATE workspace_access_requests SET status='rejected', reviewed_by=?, reviewed_at=NOW(), reason=COALESCE(?, reason) WHERE request_id=? AND tenant_id=? AND status='pending'", [req.auth.user_id, req.body?.reason || null, req.params.request_id, req.params.tenant_id]);
      if (updateResult.affectedRows !== 1) throw Object.assign(new Error("Access request rejection lost its pending state."), { status: 409, code: "access_request_state_changed" });
      const [readbackRows] = await connection.query("SELECT request_id, tenant_id, status, reason, reviewed_by, reviewed_at FROM workspace_access_requests WHERE request_id=? AND tenant_id=? LIMIT 2", [req.params.request_id, req.params.tenant_id]);
      const rejected = requireExactlyOneRow(readbackRows, { code: "workspace_access_request_reject_readback_invalid", message: "Access request rejection readback must resolve exactly one request.", status: 409 }); // MUTATION_READBACK: workspace_access_request_reject
      await connection.commit();
      return res.json({ ok: true, request_id: rejected.request_id, tenant_id: rejected.tenant_id, status: rejected.status, reason: rejected.reason, reviewed_by: rejected.reviewed_by, reviewed_at: rejected.reviewed_at, secrets_included: false });
    } catch (err) {
      await connection.rollback();
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "workspace_access_request_reject_failed", message: err.message }, secrets_included: false });
    } finally {
      connection.release();
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
