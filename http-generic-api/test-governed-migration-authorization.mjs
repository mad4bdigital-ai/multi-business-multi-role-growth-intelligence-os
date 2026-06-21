import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runGovernedMigrationAuthorization } from "./scripts/governed-migration-authorization.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = await readFile(path.join(__dirname, "scripts", "governed-migration-authorization.mjs"), "utf8");
const resolver = await readFile(path.join(__dirname, "scripts", "capability-resolution-dry-run.mjs"), "utf8");
const adminCli = await readFile(path.join(__dirname, "routes", "adminCliRoutes.js"), "utf8");

for (const token of [
  "governed_migration_authorization_registry",
  "mysql_resource_governance_apply_block_v1",
  "mysql.resource.governance_apply",
  "migration_checksum_sha256",
  "migration_authorization_readback_failed",
  "no_credential_payload_read",
  "applies_migration_sql: false",
  "AUTHORIZE_MIGRATION_",
]) assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.doesNotMatch(source, /child_process|spawn\(|exec\(|fetch\(|axios|decrypt/i);
assert.match(resolver, /APP_KEY_LOOKUP_ALIASES/);
assert.match(resolver, /mysql:\s*"remote_mysql_database"/);
assert.match(resolver, /allow_no_credential_binding/);
assert.match(resolver, /allow_external_write/);
assert.match(resolver, /platformNoCredentialAllowed/);
assert.match(adminCli, /migration_authorization_dry_run/);
assert.match(adminCli, /migration_authorization_apply/);

function envelopeRow(overrides = {}) {
  return {
    envelope_id: "11111111-1111-4111-8111-111111111111",
    app_key: "mysql",
    capability_key: "mysql_resource_governance",
    operation_intent: "mysql.resource.governance_apply",
    selected_runtime_surface: "governed_resource_run",
    envelope_status: "ready_for_dispatch",
    decision: "ready_for_dispatch",
    dispatch_allowed: 1,
    apply_allowed: 1,
    blocking_gap_count: 0,
    execution_status: "not_executed",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    secrets_included: 0,
    envelope_json: JSON.stringify({
      request_context: {
        resource_uri: "mysql://platform-schema/governed_migration_authorization_registry",
      },
      apply_authorization: {
        policy_key: "mysql_resource_governance_apply_block_v1",
        status: "apply_authorized",
        allow_external_write: false,
        no_external_write: true,
        no_provider_call: true,
        no_credential_payload_read: true,
        requires_readback: true,
      },
      secrets_included: false,
    }),
    ...overrides,
  };
}

function fakePool({ envelope = envelopeRow() } = {}) {
  const calls = [];
  let authorization = null;
  const pool = {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM capability_apply_authorization_policy_registry")) {
        return [[{
          policy_key: "mysql_resource_governance_apply_block_v1",
          app_key: "mysql",
          capability_key: "mysql_resource_governance",
          operation_intent: "mysql.resource.governance_apply",
          runtime_surface: "governed_resource_run",
          status: "active",
          allow_external_write: 0,
          allow_no_credential_binding: 1,
          requires_ready_for_dispatch: 1,
          requires_dispatch_allowed: 1,
          requires_zero_blocking_gaps: 1,
          requires_audit_evidence: 1,
          requires_readback: 1,
          requires_typed_confirmation: 1,
          requires_same_cycle_dry_run: 1,
        }]];
      }
      if (sql.includes("FROM capability_resolution_envelope_ledger")) return [[envelope]];
      if (sql.includes("INSERT INTO governed_migration_authorization_registry")) {
        const [migration, policyKey, riskTier, reason, metadataJson] = params;
        authorization = {
          migration_file: migration,
          authorization_status: "authorized",
          authorization_source: "platform_admin_review",
          policy_key: policyKey,
          risk_tier: riskTier,
          requires_preflight: 1,
          requires_confirmation: 1,
          allow_record_only: 1,
          allow_apply: 1,
          notes: reason,
          metadata_json: metadataJson,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("UPDATE capability_resolution_envelope_ledger")) return [{ affectedRows: 1 }];
      if (sql.includes("FROM governed_migration_authorization_registry")) return [[authorization].filter(Boolean)];
      throw new Error(`Unexpected SQL in fake pool: ${sql.slice(0, 120)}`);
    },
    async getConnection() { return this; },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
  };
  return pool;
}

const tempDir = await mkdtemp(path.join(os.tmpdir(), "migration-auth-test-"));
try {
  const migration = "9999_test_safe_authorization.sql";
  const migrationSql = "CREATE TABLE IF NOT EXISTS migration_auth_test (id INT NOT NULL PRIMARY KEY);\n";
  await writeFile(path.join(tempDir, migration), migrationSql, "utf8");

  const dryPool = fakePool();
  const dryRun = await runGovernedMigrationAuthorization({
    mode: "dry_run",
    migration,
    expectedChecksum: "",
    riskTier: "medium",
    confirm: "",
    capabilityEnvelopeId: "",
    authorizedBy: "platform_admin",
    reason: "",
  }, { pool: dryPool, migrationsDir: tempDir });
  assert.equal(dryRun.ok, true);
  assert.equal(dryRun.mode, "dry_run");
  assert.equal(dryRun.authorization_write, false);
  assert.equal(dryRun.applies_migration_sql, false);
  assert.match(dryRun.checksum, /^[0-9a-f]{64}$/);
  assert.match(dryRun.required_confirmation, /^AUTHORIZE_MIGRATION_9999_TEST_SAFE_AUTHORIZATION_[0-9A-F]{12}$/);

  await assert.rejects(
    runGovernedMigrationAuthorization({
      mode: "dry_run",
      migration: "../escape.sql",
      expectedChecksum: "",
      riskTier: "medium",
      confirm: "",
      capabilityEnvelopeId: "",
      authorizedBy: "platform_admin",
      reason: "",
    }, { pool: fakePool(), migrationsDir: tempDir }),
    (error) => error.code === "invalid_migration_file"
  );

  await assert.rejects(
    runGovernedMigrationAuthorization({
      mode: "apply",
      migration,
      expectedChecksum: "0".repeat(64),
      riskTier: "medium",
      confirm: dryRun.required_confirmation,
      capabilityEnvelopeId: envelopeRow().envelope_id,
      authorizedBy: "platform_admin",
      reason: "Authorize safe additive test migration after review.",
    }, { pool: fakePool(), migrationsDir: tempDir }),
    (error) => error.code === "migration_checksum_mismatch"
  );

  await assert.rejects(
    runGovernedMigrationAuthorization({
      mode: "apply",
      migration,
      expectedChecksum: dryRun.checksum,
      riskTier: "medium",
      confirm: dryRun.required_confirmation,
      capabilityEnvelopeId: envelopeRow().envelope_id,
      authorizedBy: "platform_admin",
      reason: "Authorize safe additive test migration after review.",
    }, { pool: fakePool({ envelope: envelopeRow({ app_key: "github" }) }), migrationsDir: tempDir }),
    (error) => error.code === "capability_envelope_scope_mismatch"
  );

  const applyPool = fakePool();
  const applied = await runGovernedMigrationAuthorization({
    mode: "apply",
    migration,
    expectedChecksum: dryRun.checksum,
    riskTier: "medium",
    confirm: dryRun.required_confirmation,
    capabilityEnvelopeId: envelopeRow().envelope_id,
    authorizedBy: "platform_admin",
    reason: "Authorize safe additive test migration after review.",
  }, { pool: applyPool, migrationsDir: tempDir });
  assert.equal(applied.ok, true);
  assert.equal(applied.mode, "apply");
  assert.equal(applied.authorization_write, true);
  assert.equal(applied.readback_verified, true);
  assert.equal(applied.authorization.metadata.migration_checksum_sha256, dryRun.checksum);
  assert.equal(applied.authorization.metadata.applies_migration_sql, false);
  assert.equal(applied.authorization.metadata.secrets_included, false);
  assert.equal(applyPool.calls.some(({ sql }) => sql.includes("CREATE TABLE IF NOT EXISTS migration_auth_test")), false);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log("Governed migration authorization contracts passed");
