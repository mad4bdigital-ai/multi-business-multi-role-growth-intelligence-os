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

function id(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function normalizeRow(row) {
  if (!row) return null;
  return {
    ...row,
    effectiveCapabilities: typeof row.effective_capabilities_json === "string"
      ? JSON.parse(row.effective_capabilities_json)
      : row.effective_capabilities_json,
    expiresAt: row.expires_at,
    issuedAt: row.issued_at,
    revokedAt: row.revoked_at,
    idempotencyKey: row.idempotency_key,
    actorPrincipalId: row.actor_principal_id,
    targetUserId: row.target_user_id,
    requestedTool: row.requested_tool,
    requestedOperation: row.requested_operation,
    delegationId: row.delegation_id,
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
      const [result] = await db.query(
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
      if (!result || result.affectedRows !== 1) throw repositoryError("act_as_user_session_create_failed", "Act-as-User session was not created.");
      return { sessionId, version: 1, status: "active" };
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
      if (event.secretsIncluded === true || event.client_secret || event.access_token || event.refresh_token) {
        throw repositoryError("act_as_user_audit_secret_denied", "Secrets are forbidden in Act-as-User audit events.");
      }
      const eventId = text(event.eventId) || id("act-as-user-audit");
      const eventJson = { ...event };
      delete eventJson.client_secret;
      delete eventJson.access_token;
      delete eventJson.refresh_token;
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
      if (readback.secretsIncluded === true) throw repositoryError("act_as_user_readback_secret_denied", "Secrets are forbidden in Act-as-User readback.");
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
      return { readbackId, payloadHash };
    },
  };

  return Object.freeze({ sessionRepository, revocationRepository, auditRepository, readbackRepository });
}
