import assert from "node:assert/strict";
import { createActAsUserDurableRepositories } from "./actAsUserDurableRepositories.js";

const now = () => new Date("2026-08-16T12:00:00.000Z");
const sessions = new Map();
const auditEvents = [];
const readbacks = [];
const pool = {
  async query(sql, params = []) {
    const compact = String(sql).replace(/\s+/g, " ").trim();
    if (compact.startsWith("SELECT session_id, request_hash")) {
      const [environment, tenantId, actorId, targetId, operation, tool, idempotencyKey] = params;
      const row = [...sessions.values()].find((candidate) => candidate.environment === environment && candidate.tenant_id === tenantId && candidate.actor_principal_id === actorId && candidate.target_user_id === targetId && candidate.requested_operation === operation && candidate.requested_tool === tool && candidate.idempotency_key === idempotencyKey);
      return [[row].filter(Boolean)];
    }
    if (compact.startsWith("INSERT INTO act_as_user_sessions")) {
      const [sessionId, tenantId, actorId, targetId, actorRole, targetRole, delegationId, tool, operation, capabilities, idempotencyKey, requestHash, rolePolicyVersion, catalogVersion, issuedAt, expiresAt, environment] = params;
      sessions.set(sessionId, { session_id: sessionId, tenant_id: tenantId, actor_principal_id: actorId, target_user_id: targetId, actor_role: actorRole, target_role: targetRole, delegation_id: delegationId, requested_tool: tool, requested_operation: operation, effective_capabilities_json: capabilities, idempotency_key: idempotencyKey, request_hash: requestHash, role_policy_version: rolePolicyVersion, catalog_version: catalogVersion, status: "active", issued_at: issuedAt, expires_at: expiresAt, version: 1, environment, secrets_included: 0, last_readback_id: null });
      return [{ affectedRows: 1 }];
    }
    if (compact.startsWith("SELECT session_id,")) {
      return [[sessions.get(params[0])].filter((row) => row?.environment === params[1])];
    }
    if (compact.startsWith("SELECT status, expires_at")) {
      const row = sessions.get(params[0]);
      return [[row && row.environment === params[1] ? row : undefined].filter(Boolean)];
    }
    if (compact.startsWith("UPDATE act_as_user_sessions") && compact.includes("last_readback_id")) {
      const [readbackId, sessionId, environment, actorId, targetId] = params;
      const row = sessions.get(sessionId);
      if (!row || row.environment !== environment || row.actor_principal_id !== actorId || row.target_user_id !== targetId || row.status !== "active") return [{ affectedRows: 0 }];
      row.last_readback_id = readbackId;
      return [{ affectedRows: 1 }];
    }
    if (compact.startsWith("UPDATE act_as_user_sessions")) {
      const [revokedAt, reason, sessionId, environment, expectedVersion] = params;
      const row = sessions.get(sessionId);
      if (!row || row.status !== "active" || environment !== "staging" || (expectedVersion !== undefined && row.version !== expectedVersion)) return [{ affectedRows: 0 }];
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

const repos = createActAsUserDurableRepositories({ pool, now, environment: "staging" });
const sessionInput = {
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
  idempotencyKey: "idempotency-12345678",
  requestHash: "hash-1",
  rolePolicyVersion: "policy-v1",
  catalogVersion: "catalog-v1",
  expiresAt: "2026-08-16T12:10:00.000Z",
};

const created = await repos.sessionRepository.create(sessionInput);
assert.deepEqual(created, { sessionId: "session-1", version: 1, status: "active", replayed: false });
const replay = await repos.sessionRepository.create(sessionInput);
assert.deepEqual(replay, { sessionId: "session-1", version: 1, status: "active", replayed: true });
await assert.rejects(
  () => repos.sessionRepository.create({ ...sessionInput, requestHash: "hash-2" }),
  (error) => error.code === "act_as_user_replay_mismatch",
);

const row = await repos.sessionRepository.read("session-1");
assert.equal(row.context.mode, "act_as_user");
assert.equal(row.context.actorId, "owner-1");
assert.equal(row.context.targetId, "member-1");
assert.equal(row.context.tenantId, "tenant-1");
assert.equal(row.context.requestedOperation, "call_tool");
assert.deepEqual(row.context.effectiveCapabilities, ["call_tool"]);
assert.equal(row.context.requestHash, "hash-1");
assert.equal(await repos.revocationRepository.isRevoked("session-1"), false);

const readback = await repos.readbackRepository.record({ sessionId: "session-1", tenantId: "tenant-1", actorId: "owner-1", targetId: "member-1", readback: { status: "shadow_ok" } });
assert.equal(readback.linked, true);
assert.equal(sessions.get("session-1").last_readback_id, readback.readbackId);
await repos.auditRepository.append({ event: "safe", sessionId: "session-1", secretsIncluded: false });
assert.equal(auditEvents.length, 1);
assert.equal(readbacks.length, 1);

await repos.sessionRepository.revoke("session-1", "operator_request", 1);
assert.equal(await repos.revocationRepository.isRevoked("session-1"), true);
await assert.rejects(() => repos.sessionRepository.revoke("session-1", "stale", 1), (error) => error.code === "act_as_user_revoke_conflict");
await assert.rejects(() => repos.auditRepository.append({ event: "bad", nested: { access_token: "secret" } }), (error) => error.code === "act_as_user_audit_secret_denied");
await assert.rejects(() => repos.readbackRepository.record({ sessionId: "session-1", readback: { payload: { refresh_token: "secret" } } }), (error) => error.code === "act_as_user_readback_secret_denied");
console.log("act-as-user durable repository tests passed");
