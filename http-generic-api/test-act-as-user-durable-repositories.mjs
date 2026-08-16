import assert from "node:assert/strict";
import { createActAsUserDurableRepositories } from "./actAsUserDurableRepositories.js";

const now = () => new Date("2026-08-16T12:00:00.000Z");
const sessions = new Map();
const auditEvents = [];
const readbacks = [];
const pool = {
  async query(sql, params = []) {
    const compact = String(sql).replace(/\s+/g, " ").trim();
    if (compact.startsWith("INSERT INTO act_as_user_sessions")) {
      const [sessionId, tenantId, actorId, targetId, actorRole, targetRole, delegationId, tool, operation, capabilities, idempotencyKey, issuedAt, expiresAt] = params;
      sessions.set(sessionId, { session_id: sessionId, tenant_id: tenantId, actor_principal_id: actorId, target_user_id: targetId, actor_role: actorRole, target_role: targetRole, delegation_id: delegationId, requested_tool: tool, requested_operation: operation, effective_capabilities_json: capabilities, idempotency_key: idempotencyKey, status: "active", issued_at: issuedAt, expires_at: expiresAt, version: 1, secrets_included: 0 });
      return [{ affectedRows: 1 }];
    }
    if (compact.startsWith("SELECT session_id")) {
      return [[sessions.get(params[0])].filter(Boolean)];
    }
    if (compact.startsWith("SELECT status, expires_at")) {
      return [[sessions.get(params[0])].filter(Boolean)];
    }
    if (compact.startsWith("UPDATE act_as_user_sessions")) {
      const [revokedAt, reason, sessionId, expectedVersion] = params;
      const row = sessions.get(sessionId);
      if (!row || row.status !== "active" || (expectedVersion !== undefined && row.version !== expectedVersion)) return [{ affectedRows: 0 }];
      row.status = "revoked";
      row.revoked_at = revokedAt;
      row.revoked_reason = reason;
      row.version += 1;
      return [{ affectedRows: 1 }];
    }
    if (compact.startsWith("INSERT INTO act_as_user_audit_events")) {
      auditEvents.push(params);
      return [{ affectedRows: 1 }];
    }
    if (compact.startsWith("INSERT INTO act_as_user_readbacks")) {
      readbacks.push(params);
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${compact}`);
  },
};

const repos = createActAsUserDurableRepositories({ pool, now });
const created = await repos.sessionRepository.create({
  sessionId: "session-1",
  tenantId: "tenant-1",
  actorId: "owner-1",
  targetId: "member-1",
  actorRole: "owner",
  targetRole: "member",
  delegationId: "delegation-1",
  requestedTool: "tenant.read",
  requestedOperation: "call_tool",
  effectiveCapabilities: ["call_tool"],
  idempotencyKey: "idempotency-1",
  expiresAt: "2026-08-16T12:10:00.000Z",
});
assert.equal(created.version, 1);
const row = await repos.sessionRepository.read("session-1");
assert.equal(row.targetUserId, "member-1");
assert.equal(await repos.revocationRepository.isRevoked("session-1"), false);
await assert.rejects(
  () => repos.sessionRepository.revoke("session-1", "stale", 99),
  (error) => error.code === "act_as_user_revoke_conflict",
);
await repos.sessionRepository.revoke("session-1", "operator_request", 1);
assert.equal(await repos.revocationRepository.isRevoked("session-1"), true);
await assert.rejects(
  () => repos.auditRepository.append({ event: "bad", access_token: "secret" }),
  (error) => error.code === "act_as_user_audit_secret_denied",
);
await assert.rejects(
  () => repos.readbackRepository.record({ sessionId: "session-1", readback: { status: "ok" }, secretsIncluded: true }),
  (error) => error.code === "act_as_user_readback_secret_denied",
);
await repos.auditRepository.append({ event: "safe", sessionId: "session-1", secretsIncluded: false });
await repos.readbackRepository.record({ sessionId: "session-1", tenantId: "tenant-1", actorId: "owner-1", targetId: "member-1", readback: { status: "shadow_ok" } });
assert.equal(auditEvents.length, 1);
assert.equal(readbacks.length, 1);
console.log("act-as-user durable repository tests passed");
