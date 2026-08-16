import crypto from "node:crypto";

function repositoryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function text(value) {
  return String(value ?? "").trim();
}

function json(value) {
  return JSON.stringify(value && typeof value === "object" ? value : {});
}

const FORBIDDEN_SECRET_KEYS = new Set([
  "access_token",
  "refresh_token",
  "client_secret",
  "authorization",
  "password",
  "private_key",
  "api_key",
  "bearer_token",
  "secret",
  "secret_value",
]);

function containsForbiddenSecret(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => containsForbiddenSecret(item, seen));
  return Object.entries(value).some(([key, nested]) => {
    const normalizedKey = String(key).toLowerCase().replace(/[-\s]/g, "_");
    return FORBIDDEN_SECRET_KEYS.has(normalizedKey) || containsForbiddenSecret(nested, seen);
  });
}

function id(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function isoDate(value, field) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw repositoryError("act_as_user_invalid_persisted_date", `${field} is not a valid persisted date.`);
  return parsed.toISOString();
}

function normalizeRow(row) {
  if (!row) return null;
  const effectiveCapabilities = typeof row.effective_capabilities_json === "string"
    ? JSON.parse(row.effective_capabilities_json)
    : (row.effective_capabilities_json || []);
  const context = Object.freeze({
    mode: "act_as_user",
    actorId: text(row.actor_principal_id),
    targetId: text(row.target_user_id),
    tenantId: text(row.tenant_id),
    actorRole: text(row.actor_role).toLowerCase(),
    targetRole: text(row.target_role).toLowerCase(),
    requestedTool: text(row.requested_tool) || null,
    requestedOperation: text(row.requested_operation),
    effectiveCapabilities: Array.isArray(effectiveCapabilities) ? effectiveCapabilities : [],
    delegationId: text(row.delegation_id) || null,
    idempotencyKey: text(row.idempotency_key),
    requestHash: text(row.request_hash) || null,
    rolePolicyVersion: text(row.role_policy_version) || "unknown",
    catalogVersion: text(row.catalog_version) || "unknown",
    expiresAt: isoDate(row.expires_at, "expires_at"),
    audit: Object.freeze({
      actorId: text(row.actor_principal_id),
      targetId: text(row.target_user_id),
      tenantId: text(row.tenant_id),
      delegationId: text(row.delegation_id) || null,
    }),
  });
  return {
    ...row,
    context,
    mode: context.mode,
    actorId: context.actorId,
    targetId: context.targetId,
    tenantId: context.tenantId,
    actorRole: context.actorRole,
    targetRole: context.targetRole,
    effectiveCapabilities: context.effectiveCapabilities,
    expiresAt: context.expiresAt,
    issuedAt: row.issued_at,
    revokedAt: row.revoked_at,
    idempotencyKey: context.idempotencyKey,
    requestHash: context.requestHash,
    actorPrincipalId: context.actorId,
    targetUserId: context.targetId,
    requestedTool: context.requestedTool,
    requestedOperation: context.requestedOperation,
    delegationId: context.delegationId,
  };
}

function requirePool(pool) {
  if (!pool || typeof pool.query !== "function") throw repositoryError("act_as_user_pool_required", "A database pool is required.");
  return pool;
}

export function createActAsUserDurableRepositories({ pool, now = () => new Date(), environment = "staging" } = {}) {
  const db = requirePool(pool);
  const clock = () => {
    const value = now();
    return value instanceof Date ? value : new Date(value);
  };

  const sessionRepository = {
    async create(session) {
      const sessionId = text(session.sessionId) || id("act-as-user");
      const issuedAt = clock();
      const expiresAt = new Date(session.expiresAt);
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= issuedAt) throw repositoryError("act_as_user_session_window_invalid", "Session expiry must be in the future.");
      if (containsForbiddenSecret(session)) throw repositoryError("act_as_user_session_secret_denied", "Act-as-User session contains forbidden secret state.");

      const [existingRows] = await db.query(
        `SELECT session_id, request_hash, status, version, expires_at, secrets_included
           FROM act_as_user_sessions
          WHERE environment = ? AND tenant_id = ? AND actor_principal_id = ? AND target_user_id = ?
            AND requested_operation = ? AND requested_tool = ? AND idempotency_key = ?
          LIMIT 1`,
        [environment, session.tenantId, session.actorId, session.targetId, session.requestedOperation, session.requestedTool || "", session.idempotencyKey],
      );
      const existing = existingRows?.[0] || null;
      if (existing) {
        if (existing.secrets_included) throw repositoryError("act_as_user_secret_contamination", "Act-as-User session contains forbidden secret state.");
        const existingHash = text(existing.request_hash);
        const requestHash = text(session.requestHash);
        if (existingHash !== requestHash) {
          throw repositoryError("act_as_user_replay_mismatch", "Idempotency key was already used with a different request hash.");
        }
        return { sessionId: existing.session_id, version: Number(existing.version || 1), status: existing.status, replayed: true };
      }

      let result;
      try {
        [result] = await db.query(
          `INSERT INTO act_as_user_sessions
            (session_id, tenant_id, actor_principal_id, target_user_id, actor_role, target_role,
             delegation_id, requested_tool, requested_operation, effective_capabilities_json,
             idempotency_key, request_hash, role_policy_version, catalog_version, status,
             issued_at, expires_at, environment, secrets_included)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 0)`,
          [sessionId, session.tenantId, session.actorId, session.targetId, session.actorRole, session.targetRole,
            session.delegationId, session.requestedTool || "", session.requestedOperation,
            json(session.effectiveCapabilities), session.idempotencyKey, session.requestHash || null,
            session.rolePolicyVersion || "unknown", session.catalogVersion || "unknown", issuedAt, expiresAt, environment],
        );
      } catch (error) {
        if (error?.code === "ER_DUP_ENTRY" || error?.code === "ER_DUP_KEY") {
          throw repositoryError("act_as_user_idempotency_conflict", "Act-as-User idempotency key conflicts with an existing session.");
        }
        throw error;
      }
      if (!result || result.affectedRows !== 1) throw repositoryError("act_as_user_session_create_failed", "Act-as-User session was not created.");
      return { sessionId, version: 1, status: "active", replayed: false };
    },
    async read(sessionId) {
      const [rows] = await db.query(
        `SELECT session_id, tenant_id, actor_principal_id, target_user_id, actor_role, target_role,
                delegation_id, requested_tool, requested_operation, effective_capabilities_json,
                idempotency_key, request_hash, role_policy_version, catalog_version, status,
                issued_at, expires_at, revoked_at, revoked_reason, version, environment, secrets_included
           FROM act_as_user_sessions WHERE session_id = ? AND environment = ? LIMIT 1`,
        [sessionId, environment],
      );
      const row = rows?.[0] || null;
      if (row?.secrets_included) throw repositoryError("act_as_user_secret_contamination", "Act-as-User session contains forbidden secret state.");
      return normalizeRow(row);
    },
    async revoke(sessionId, reason, expectedVersion = null) {
      const where = expectedVersion === null
        ? "session_id = ? AND environment = ? AND status = 'active'"
        : "session_id = ? AND environment = ? AND status = 'active' AND version = ?";
      const params = expectedVersion === null ? [sessionId, environment] : [sessionId, environment, expectedVersion];
      const [result] = await db.query(
        `UPDATE act_as_user_sessions
            SET status = 'revoked', revoked_at = ?, revoked_reason = ?, version = version + 1
          WHERE ${where}`,
        [clock(), text(reason) || "revoked", ...params],
      );
      if (!result || result.affectedRows !== 1) throw repositoryError("act_as_user_revoke_conflict", "Session was already revoked, expired, or changed.");
      return { sessionId, revoked: true };
    },
  };

  const revocationRepository = {
    async isRevoked(sessionId) {
      const [rows] = await db.query(
        `SELECT status, expires_at, revoked_at, secrets_included FROM act_as_user_sessions WHERE session_id = ? AND environment = ? LIMIT 1`,
        [sessionId, environment],
      );
      const row = rows?.[0];
      if (!row) return true;
      if (row.secrets_included || row.status === "revoked") return true;
      if (row.expires_at && new Date(row.expires_at) <= clock()) return true;
      return false;
    },
  };

  const auditRepository = {
    async append(event) {
      if (event.secretsIncluded === true || containsForbiddenSecret(event)) {
        throw repositoryError("act_as_user_audit_secret_denied", "Secrets are forbidden in Act-as-User audit events.");
      }
      const eventId = text(event.eventId) || id("act-as-user-audit");
      const eventJson = { ...event };
      const [result] = await db.query(
        `INSERT INTO act_as_user_audit_events
          (event_id, session_id, event_type, tenant_id, actor_principal_id, target_user_id,
           requested_tool, requested_operation, correlation_id, request_hash, readback_id,
           event_json, secrets_included)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [eventId, event.sessionId || null, event.event || event.eventType || "unknown", event.tenantId || null,
          event.actorId || null, event.targetId || null, event.requestedTool || null, event.requestedOperation || null,
          event.correlationId || event.requestId || null, event.requestHash || null, event.readbackId || null, json(eventJson)],
      );
      if (!result || result.affectedRows !== 1) throw repositoryError("act_as_user_audit_write_failed", "Audit event was not recorded.");
      return { eventId };
    },
  };

  const readbackRepository = {
    async record(readback) {
      if (readback.secretsIncluded === true || containsForbiddenSecret(readback.readback)) throw repositoryError("act_as_user_readback_secret_denied", "Secrets are forbidden in Act-as-User readback.");
      const readbackId = text(readback.readbackId) || id("act-as-user-readback");
      const payload = json(readback.readback);
      const payloadHash = crypto.createHash("sha256").update(payload).digest("hex");
      const [result] = await db.query(
        `INSERT INTO act_as_user_readbacks
          (readback_id, session_id, tenant_id, actor_principal_id, target_user_id,
           status, payload_hash, evidence_json, secrets_included)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [readbackId, readback.sessionId, readback.tenantId, readback.actorId, readback.targetId,
          readback.readback?.status || "recorded", payloadHash, payload],
      );
      if (!result || result.affectedRows !== 1) throw repositoryError("act_as_user_readback_write_failed", "Readback was not recorded.");
      const [linkResult] = await db.query(
        `UPDATE act_as_user_sessions
            SET last_readback_id = ?, updated_at = updated_at
          WHERE session_id = ? AND environment = ? AND actor_principal_id = ? AND target_user_id = ?
            AND status = 'active'`,
        [readbackId, readback.sessionId, environment, readback.actorId, readback.targetId],
      );
      if (!linkResult || linkResult.affectedRows !== 1) throw repositoryError("act_as_user_readback_link_failed", "Readback was recorded but could not be linked to the active session.");
      return { readbackId, payloadHash, linked: true };
    },
  };

  return Object.freeze({ sessionRepository, revocationRepository, auditRepository, readbackRepository });
}
