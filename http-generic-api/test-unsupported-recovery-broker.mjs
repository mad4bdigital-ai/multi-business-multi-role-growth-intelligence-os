import assert from "node:assert/strict";
import test from "node:test";
import {
  SSH_CAPABILITY_LEVELS,
  SSH_DENYLIST,
  SQL_CAPABILITY_LEVELS,
  classifySshProfile,
  classifySqlProfile,
  createEphemeralCapability,
  executeUnsupportedCapability,
  previewSshSession,
  previewSqlSession,
} from "./unsupportedRecoveryBroker.js";

const SHA = "a".repeat(40);
const ADMIN = { verified: true, binding: "test_admin_guard" };
const BASE = { incident_id: "incident:unsupported-contract-001", expected_sha: SHA, target_key: "production-runtime" };

test("SSH and SQL profiles are bounded levels with static denylist", () => {
  assert.equal(SSH_CAPABILITY_LEVELS.S1, "read_only_shell");
  assert.equal(SQL_CAPABILITY_LEVELS.Q0, "metadata_only");
  assert.ok(SSH_DENYLIST.includes("printenv"));
  assert.ok(SSH_DENYLIST.includes("cat .env"));
  assert.equal(classifySshProfile({ profile: "S1", command_sha256: "b".repeat(64) }).raw_command_received, false);
  assert.equal(classifySqlProfile({ profile: "Q0", query_sha256: "c".repeat(64) }).raw_sql_received, false);
});

test("SSH preview accepts hashes only and never opens a session", async () => {
  const preview = await previewSshSession({ ...BASE, profile: "S1", command_sha256: "b".repeat(64), host_fingerprint: "f".repeat(64), risk_class: "read_only" }, { adminPrincipal: ADMIN });
  assert.equal(preview.session_opened, false);
  assert.equal(preview.execution_allowed, false);
  assert.equal(preview.broker_required, true);
  assert.equal(preview.host_identity_pinned, true);
  assert.equal(preview.pty_allowed, false);
  assert.equal(preview.secrets_included, false);
  await assert.rejects(() => previewSshSession({ ...BASE, command: "printenv" }, { adminPrincipal: ADMIN }), (error) => error?.code === "UNSUPPORTED_INPUT_FIELD_FORBIDDEN");
});

test("SQL preview is role-bound metadata-only and rejects raw SQL/connection fields", async () => {
  const preview = await previewSqlSession({ ...BASE, target_role: "governance", profile: "Q0", query_sha256: "c".repeat(64), risk_class: "read_only" }, { adminPrincipal: ADMIN });
  assert.equal(preview.session_opened, false);
  assert.equal(preview.role_bound, true);
  assert.equal(preview.target_role, "governance");
  assert.equal(preview.role_resolved, true);
  assert.equal(preview.classification.profile_name, "metadata_only");
  await assert.rejects(() => previewSqlSession({ ...BASE, query: "SELECT 1" }, { adminPrincipal: ADMIN }), (error) => error?.code === "UNSUPPORTED_INPUT_FIELD_FORBIDDEN");
  await assert.rejects(() => previewSqlSession({ ...BASE, database: "hidden" }, { adminPrincipal: ADMIN }), (error) => error?.code === "UNSUPPORTED_INPUT_FIELD_FORBIDDEN");
});

test("ephemeral capability is expiring, hash-bound, and content-free", async () => {
  const capability = await createEphemeralCapability({
    ...BASE,
    transport: "ssh",
    target_role: "server_resolved",
    host_fingerprint: "f".repeat(64),
    capability_type: "diagnostic_bundle",
    artifact_sha256: "d".repeat(64),
    scope_ref: "scope:read-only",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    single_use: true,
    risk_class: "unknown",
  }, { adminPrincipal: ADMIN });
  assert.equal(capability.content_received, false);
  assert.equal(capability.execution_allowed, false);
  assert.equal(capability.single_use, true);
  assert.equal(capability.host_fingerprint.length, 64);
  assert.equal(capability.capability_hash.length, 64);
  await assert.rejects(() => createEphemeralCapability({ ...BASE, transport: "sql", capability_type: "short_scope", artifact_sha256: "d".repeat(64), scope_ref: "scope:read-only", expires_at: new Date(Date.now() + 31 * 60_000).toISOString() }, { adminPrincipal: ADMIN }), (error) => error?.code === "UNSUPPORTED_CAPABILITY_TTL_INVALID");
});

test("unsupported execution is disabled without a managed broker, even with a reference-only request", async () => {
  const input = { ...BASE, capability_id: "ephemeral:unsupported-001", capability_hash: "e".repeat(64), approval_id: "approval:unsupported-001", idempotency_key: "idempotency:unsupported-001" };
  await assert.rejects(() => executeUnsupportedCapability(input, { env: {}, adminPrincipal: ADMIN }), (error) => error?.code === "RECOVERY_MUTATIONS_DISABLED");
  await assert.rejects(() => executeUnsupportedCapability(input, { env: { RECOVERY_MUTATIONS_ENABLED: "true" }, adminPrincipal: ADMIN }), (error) => error?.code === "UNSUPPORTED_BROKER_UNAVAILABLE");
  await assert.rejects(() => executeUnsupportedCapability(input, { env: { RECOVERY_MUTATIONS_ENABLED: "true" }, adminPrincipal: { verified: false } }), (error) => error?.code === "UNSUPPORTED_ADMIN_PRINCIPAL_REQUIRED");
});
