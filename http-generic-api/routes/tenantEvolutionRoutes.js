import { Router } from "express";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { getPool } from "../db.js";

const JWT_SECRET = process.env.JWT_SECRET || "development_fallback_secret_only";

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

function nonEmptyString(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function boundedInt(value, fallback, min = 1, max = 100) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function safeJson(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function safeSummary(value) {
  const text = String(value ?? "").trim();
  return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
}

function scopeKeyComparisonSql(columnName = "scope_key") {
  return `${columnName} = CAST(? AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_bin`;
}

function hasTenantCheckpointWriteRole(scope = {}) {
  const roles = [scope.membership_role, scope.assigned_role]
    .filter(Boolean)
    .map((role) => String(role).trim().toLowerCase());
  return roles.some((role) => [
    "owner",
    "admin",
    "tenant_admin",
    "brand_admin",
    "brand_owner",
    "manager",
    "editor",
    "operator",
  ].includes(role));
}

function normalizeTenantCheckpointType(value) {
  const checkpointType = String(value || "operation").trim().toLowerCase();
  if (["operation", "manual", "rollup"].includes(checkpointType)) return checkpointType;
  const err = new Error("Tenant checkpoint_type must be one of: operation, manual, rollup.");
  err.status = 400;
  err.code = "tenant_evolution_checkpoint_type_invalid";
  throw err;
}

async function resolveAllowedEvolutionScope(req) {
  const pool = getPool();
  const input = req.method === "POST" ? (req.body || {}) : (req.query || {});
  const explicitScope = nonEmptyString(input.scope_key || input.scopeKey);
  const brandKey = nonEmptyString(input.brand_key || input.brandKey);
  const params = [req.auth.tenant_id, req.auth.user_id];
  const where = ["tenant_id = ?", "user_id = ?", "access_state = 'allowed'"];

  if (explicitScope) {
    where.push("scope_key = ?");
    params.push(explicitScope);
  } else if (brandKey) {
    where.push("brand_key = ?");
    params.push(brandKey);
  }

  const [rows] = await pool.query(
    `SELECT scope_key, tenant_id, brand_key, user_id, email, membership_role, assigned_role, access_state
       FROM v_platform_evolution_scope_access
      WHERE ${where.join(" AND ")}
      ORDER BY brand_key ASC
      LIMIT 1`,
    params
  );

  const scope = rows[0] || null;
  if (!scope) {
    const err = new Error("No allowed Platform Evolution checkpoint scope found for this tenant user.");
    err.status = 403;
    err.code = "platform_evolution_scope_not_granted";
    throw err;
  }
  return scope;
}

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: { code: err.code || fallbackCode, message: err.message },
    secrets_included: false,
  });
}

export function buildTenantEvolutionRoutes() {
  const router = Router();

  router.get("/tenant/evolution/switch-options", requireTenantUserJwt, async (req, res) => {
    try {
      const brandKey = nonEmptyString(req.query.brand_key || req.query.brandKey);
      const limit = boundedInt(req.query.limit, 50, 1, 100);
      const where = ["user_id = ?", "access_state = 'allowed'"];
      const params = [req.auth.user_id];
      if (brandKey) { where.push("brand_key = ?"); params.push(brandKey); }
      params.push(limit);
      const [rows] = await getPool().query(
        `SELECT scope_key, tenant_id, brand_key, user_id, email, user_display_name, membership_role, assigned_role, tenant_type, tenant_display_name, business_type_key, knowledge_profile_key, brand_path_status, access_state
           FROM v_platform_evolution_scope_access
          WHERE ${where.join(" AND ")}
          ORDER BY tenant_display_name ASC, brand_key ASC
          LIMIT ?`,
        params
      );
      return res.status(200).json({
        ok: true,
        count: rows.length,
        switch_options: rows,
        auth_context: {
          tenant_id: req.auth.tenant_id,
          user_id: req.auth.user_id,
          tenant_role: req.auth.tenant_role,
          source: "user_jwt",
        },
        switch_policy: {
          mode: "tenant_user_scope_selection",
          selected_scope_parameter: "scope_key",
          requires_allowed_scope: true,
          checkpoint_write_enabled: false,
        },
        tenant_facing: true,
        secrets_included: false,
      });
    } catch (err) { return errorResponse(res, err, "tenant_evolution_switch_options_failed"); }
  });

  router.post("/tenant/evolution/checkpoints", requireTenantUserJwt, async (req, res) => {
    try {
      const body = req.body || {};
      const scope = await resolveAllowedEvolutionScope(req);
      if (!hasTenantCheckpointWriteRole(scope)) {
        return res.status(403).json({
          ok: false,
          error: {
            code: "tenant_evolution_checkpoint_write_role_required",
            message: "Tenant checkpoint write requires owner, admin, manager, editor, operator, or brand_owner role.",
          },
          secrets_included: false,
        });
      }
      const summaryText = safeSummary(body.summary_text || body.summaryText);
      if (!summaryText) {
        return res.status(400).json({
          ok: false,
          error: { code: "tenant_evolution_checkpoint_summary_required", message: "summary_text is required." },
          secrets_included: false,
        });
      }
      const checkpointType = normalizeTenantCheckpointType(body.checkpoint_type || body.checkpointType);
      const checkpointId = body.checkpoint_id || randomUUID();
      const createdBy = `tenant_user:${req.auth.user_id}`;
      const threadSnapshotJson = JSON.stringify(safeJson(body.thread_snapshot_json || body.threadSnapshotJson || body.thread_snapshot || body.threadSnapshot, null));
      const deltaJson = JSON.stringify(safeJson(body.delta_json || body.deltaJson || body.delta, null));
      const evidenceJson = JSON.stringify({
        ...(safeJson(body.evidence_json || body.evidenceJson || body.evidence, {}) || {}),
        tenant_checkpoint_policy: {
          created_by_user_id: req.auth.user_id,
          tenant_id: req.auth.tenant_id,
          scope_key: scope.scope_key,
          membership_role: scope.membership_role || null,
          assigned_role: scope.assigned_role || null,
          platform_commit_fields_accepted: false,
          token_returned: false,
          secrets_included: false,
        },
      });
      const nextActionsJson = JSON.stringify(safeJson(body.next_actions_json || body.nextActionsJson || body.next_actions || body.nextActions, []));

      await getPool().query(
        `INSERT INTO platform_evolution_checkpoints (
          checkpoint_id, scope_key, tenant_id, user_id, brand_key, checkpoint_type,
          activation_session_id, main_commit_sha, deployed_commit_sha, activation_status, release_readiness_status,
          summary_text, thread_snapshot_json, delta_json, evidence_json, next_actions_json, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          checkpointId,
          scope.scope_key,
          scope.tenant_id,
          req.auth.user_id,
          scope.brand_key,
          checkpointType,
          null,
          null,
          null,
          "tenant_checkpoint_created",
          "tenant_scope_write_policy_v1",
          summaryText,
          threadSnapshotJson,
          deltaJson,
          evidenceJson,
          nextActionsJson,
          createdBy,
        ]
      );
      await getPool().query(
        `UPDATE platform_evolution_threads SET last_checkpoint_id = ?, updated_by = ? WHERE ${scopeKeyComparisonSql("scope_key")}`,
        [checkpointId, createdBy, scope.scope_key]
      );
      await getPool().query(
        `INSERT INTO platform_evolution_thread_events (
          event_id, scope_key, tenant_id, user_id, brand_key, thread_key, event_type, event_title,
          event_summary, source_surface, source_ref, classification, checkpoint_id, evidence_json, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          scope.scope_key,
          scope.tenant_id,
          req.auth.user_id,
          scope.brand_key,
          "activation_checkpoint_loop",
          "tenant_checkpoint_created",
          "Tenant checkpoint created",
          summaryText.slice(0, 500),
          "tenant_evolution_checkpoint_create",
          checkpointId,
          "tenant_scope_write_policy_v1",
          checkpointId,
          JSON.stringify({ token_returned: false, secrets_included: false, checkpoint_type: checkpointType }),
          createdBy,
        ]
      );

      return res.status(201).json({
        ok: true,
        checkpoint_id: checkpointId,
        scope_key: scope.scope_key,
        checkpoint_type: checkpointType,
        tenant_facing: true,
        write_policy: {
          mode: "tenant_scope_write_policy_v1",
          platform_commit_fields_accepted: false,
          allowed_roles: ["owner", "admin", "tenant_admin", "brand_admin", "brand_owner", "manager", "editor", "operator"],
        },
        secrets_included: false,
      });
    } catch (err) { return errorResponse(res, err, "tenant_evolution_checkpoint_create_failed"); }
  });

  router.get("/tenant/evolution/activation-card", requireTenantUserJwt, async (req, res) => {
    try {
      const scope = await resolveAllowedEvolutionScope(req);
      const [rows] = await getPool().query(
        `SELECT * FROM v_platform_evolution_activation_card WHERE scope_key = ? LIMIT 1`,
        [scope.scope_key]
      );
      return res.status(200).json({
        ok: true,
        scope_key: scope.scope_key,
        card: rows[0] || null,
        auth_context: {
          tenant_id: req.auth.tenant_id,
          user_id: req.auth.user_id,
          tenant_role: req.auth.tenant_role,
          source: "user_jwt",
        },
        access: scope,
        tenant_facing: true,
        secrets_included: false,
      });
    } catch (err) { return errorResponse(res, err, "tenant_evolution_activation_card_failed"); }
  });

  router.get("/tenant/evolution/thread-map", requireTenantUserJwt, async (req, res) => {
    try {
      const scope = await resolveAllowedEvolutionScope(req);
      const status = nonEmptyString(req.query.status);
      const priority = nonEmptyString(req.query.priority);
      const limit = boundedInt(req.query.limit, 50, 1, 100);
      const where = ["scope_key = ?"];
      const params = [scope.scope_key];
      if (status) { where.push("status = ?"); params.push(status); }
      if (priority) { where.push("priority = ?"); params.push(priority); }
      params.push(limit);
      const [rows] = await getPool().query(
        `SELECT * FROM v_platform_evolution_thread_map WHERE ${where.join(" AND ")} ORDER BY FIELD(priority,'critical','high','medium','low'), thread_key LIMIT ?`,
        params
      );
      return res.status(200).json({
        ok: true,
        scope_key: scope.scope_key,
        count: rows.length,
        threads: rows,
        auth_context: {
          tenant_id: req.auth.tenant_id,
          user_id: req.auth.user_id,
          tenant_role: req.auth.tenant_role,
          source: "user_jwt",
        },
        tenant_facing: true,
        secrets_included: false,
      });
    } catch (err) { return errorResponse(res, err, "tenant_evolution_thread_map_failed"); }
  });

  router.get("/tenant/evolution/open-evidence", requireTenantUserJwt, async (req, res) => {
    try {
      const scope = await resolveAllowedEvolutionScope(req);
      const threadKey = nonEmptyString(req.query.thread_key || req.query.threadKey);
      const linkedSurface = nonEmptyString(req.query.linked_surface || req.query.linkedSurface);
      const limit = boundedInt(req.query.limit, 50, 1, 100);
      const where = ["scope_key = ?"];
      const params = [scope.scope_key];
      if (threadKey) { where.push("thread_key = ?"); params.push(threadKey); }
      if (linkedSurface) { where.push("linked_surface = ?"); params.push(linkedSurface); }
      params.push(limit);
      const [rows] = await getPool().query(
        `SELECT * FROM v_platform_evolution_open_evidence WHERE ${where.join(" AND ")} ORDER BY FIELD(linked_priority,'critical','high','medium','low'), linked_updated_at DESC LIMIT ?`,
        params
      );
      return res.status(200).json({
        ok: true,
        scope_key: scope.scope_key,
        count: rows.length,
        evidence: rows,
        auth_context: {
          tenant_id: req.auth.tenant_id,
          user_id: req.auth.user_id,
          tenant_role: req.auth.tenant_role,
          source: "user_jwt",
        },
        tenant_facing: true,
        secrets_included: false,
      });
    } catch (err) { return errorResponse(res, err, "tenant_evolution_open_evidence_failed"); }
  });

  return router;
}

export const _testingTenantEvolutionRoutes = {
  verifyUserJwt,
  boundedInt,
  nonEmptyString,
};
