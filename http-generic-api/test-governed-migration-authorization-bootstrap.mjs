import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  bootstrapGovernedMigrationAuthorization,
  governedMigrationAuthorizationConfirmation,
  inspectGovernedMigrationAuthorizationCandidate,
} from "./governedMigrationAuthorizationBootstrap.js";
import { splitSqlStatements } from "./releaseReadiness.js";

const MIGRATION = "1020_sprint69_multi_surface_tenant_agent_runtime.sql";
const SQL = readFileSync(`migrations/${MIGRATION}`, "utf8");
const CHECKSUM = createHash("sha256").update(SQL, "utf8").digest("hex");
const STATEMENT_COUNT = splitSqlStatements(SQL).length;
const MERGE_SHA = "9c091abb332f92995fdc44cfee8f6f2dd168df88";
const ENVELOPE_ID = "11111111-2222-4333-8444-555555555555";

function baseInput() {
  return {
    migration: MIGRATION,
    expected_checksum_sha256: CHECKSUM,
    expected_statement_count: STATEMENT_COUNT,
    pull_request: 1824,
    merge_sha: MERGE_SHA,
    confirm: governedMigrationAuthorizationConfirmation(MIGRATION),
    capability_envelope_id: ENVELOPE_ID,
    decision_note: "Authorize the checksum-bound additive multi-surface migration after governed review.",
  };
}

function createFakePool() {
  const authorizations = new Map();
  const ledger = new Map();
  return {
    authorizations,
    ledger,
    async query(sql, params = []) {
      if (sql.includes("FROM governed_migration_authorization_registry")) {
        const row = authorizations.get(params[0]);
        return [[...(row ? [{ ...row }] : [])]];
      }
      if (sql.includes("FROM governed_migration_ledger")) {
        const row = ledger.get(`${params[0]}:${params[1]}`);
        return [[...(row ? [{ ...row }] : [])]];
      }
      if (sql.includes("INSERT INTO governed_migration_authorization_registry")) {
        const [migration, source, policyKey, notes, metadataJson] = params;
        if (authorizations.has(migration)) {
          const error = new Error("duplicate");
          error.code = "ER_DUP_ENTRY";
          throw error;
        }
        authorizations.set(migration, {
          migration_file: migration,
          authorization_status: "authorized",
          authorization_source: source,
          policy_key: policyKey,
          risk_tier: "medium",
          requires_preflight: 1,
          requires_confirmation: 1,
          allow_record_only: 0,
          allow_apply: 1,
          notes,
          metadata_json: metadataJson,
          created_at: new Date("2026-06-21T02:30:00.000Z"),
          updated_at: new Date("2026-06-21T02:30:00.000Z"),
        });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql.slice(0, 120)}`);
    },
  };
}

const resolvedEnvelope = async () => ({
  ok: true,
  envelope_id: ENVELOPE_ID,
  apply_allowed: true,
  dispatch_allowed: true,
  secrets_included: false,
});

async function main() {
  assert.equal(
    governedMigrationAuthorizationConfirmation(MIGRATION),
    "AUTHORIZE_GOVERNED_MIGRATION_1020_SPRINT69_MULTI_SURFACE_TENANT_AGENT_RUNTIME"
  );

  await assert.rejects(
    () => inspectGovernedMigrationAuthorizationCandidate({ ...baseInput(), migration: "../escape.sql" }),
    (error) => error?.code === "governed_migration_authorization_invalid_migration"
  );
  await assert.rejects(
    () => inspectGovernedMigrationAuthorizationCandidate({ ...baseInput(), confirm: "WRONG" }),
    (error) => error?.code === "governed_migration_authorization_confirmation_required"
  );
  await assert.rejects(
    () => inspectGovernedMigrationAuthorizationCandidate({ ...baseInput(), expected_checksum_sha256: "0".repeat(64) }),
    (error) => error?.code === "governed_migration_authorization_checksum_mismatch"
  );
  await assert.rejects(
    () => inspectGovernedMigrationAuthorizationCandidate({ ...baseInput(), expected_statement_count: STATEMENT_COUNT + 1 }),
    (error) => error?.code === "governed_migration_authorization_statement_count_mismatch"
  );

  const candidate = await inspectGovernedMigrationAuthorizationCandidate(baseInput());
  assert.equal(candidate.migration_checksum_sha256, CHECKSUM);
  assert.equal(candidate.statement_count, STATEMENT_COUNT);
  assert.equal(candidate.preflight.status, "pass");
  assert.equal(Number(candidate.preflight.risk_count || 0), 0);
  assert.deepEqual(candidate.destructive_findings, []);
  assert.equal(candidate.secrets_included, false);

  const pool = createFakePool();
  const referenced = [];
  const deps = {
    pool,
    auth: { tenant_id: "00000000-0000-0000-0000-000000000000", user_id: "0e76b224-7671-47dd-ad68-014fb042df80" },
    resolveEnvelope: resolvedEnvelope,
    markReferenced: async (value) => { referenced.push(value); return { ok: true }; },
  };
  const created = await bootstrapGovernedMigrationAuthorization(baseInput(), deps);
  assert.equal(created.ok, true);
  assert.equal(created.authorization_created, true);
  assert.equal(created.idempotent, false);
  assert.equal(created.authorization.authorization_source, "governed_admin_bootstrap_tool");
  assert.equal(created.authorization.risk_tier, "medium");
  assert.equal(created.authorization.allow_apply, 1);
  assert.equal(created.authorization.allow_record_only, 0);
  assert.equal(created.migration_sql_executed, false);
  assert.equal(created.applies_migration, false);
  assert.equal(referenced.length, 1);
  const metadata = typeof created.authorization.metadata_json === "string"
    ? JSON.parse(created.authorization.metadata_json)
    : created.authorization.metadata_json;
  assert.equal(metadata.migration_checksum_sha256, CHECKSUM);
  assert.equal(metadata.preflight_risk_count, 0);
  assert.equal(metadata.destructive_operations, 0);
  assert.equal(metadata.provider_write, false);
  assert.equal(metadata.external_send, false);
  assert.equal(metadata.secrets_included, false);

  const second = await bootstrapGovernedMigrationAuthorization(baseInput(), deps);
  assert.equal(second.authorization_created, false);
  assert.equal(second.idempotent, true);
  assert.equal(second.migration_sql_executed, false);

  await assert.rejects(
    () => bootstrapGovernedMigrationAuthorization(baseInput(), {
      ...deps,
      pool: createFakePool(),
      resolveEnvelope: async () => ({ ok: true, envelope_id: ENVELOPE_ID, apply_allowed: false }),
    }),
    (error) => error?.code === "capability_resolution_envelope_apply_not_allowed"
  );

  const routeSource = readFileSync("routes/gptToolsRoutes.js", "utf8");
  const manifestSource = readFileSync("scripts/test-manifest.mjs", "utf8");
  assert.ok(routeSource.includes("governed_migration_authorization_bootstrap"));
  assert.ok(routeSource.includes("bootstrapGovernedMigrationAuthorization"));
  assert.ok(manifestSource.includes("test-governed-migration-authorization-bootstrap.mjs"));

  console.log("governed migration authorization bootstrap tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
