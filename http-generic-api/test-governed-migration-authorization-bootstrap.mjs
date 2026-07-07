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
const PREVIOUS_CHECKSUM = "a".repeat(64);

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
  const applyPolicies = new Map();
  const certifications = new Map();
  const applyPolicyKey = "platform_orchestration:governed_migration_execute:auth_host";
  const certificationKey = "governed_migration_execute";
  return {
    authorizations,
    ledger,
    applyPolicies,
    certifications,
    async query(sql, params = []) {
      if (sql.includes("FROM runtime_dispatch_certification_registry")) {
        const row = certifications.get(certificationKey);
        return [[...(row ? [{ ...row }] : [])]];
      }
      if (sql.includes("INSERT INTO runtime_dispatch_certification_registry")) {
        const [key, surfaceKey, surfaceFamily, toolOrActionKey, riskClass, certificationStatus, smokeStrategy, lastEvidenceRef, notes] = params;
        certifications.set(certificationKey, {
          certification_key: key,
          surface_key: surfaceKey,
          surface_family: surfaceFamily,
          tool_or_action_key: toolOrActionKey,
          risk_class: riskClass,
          certification_status: certificationStatus,
          smoke_strategy: smokeStrategy,
          dispatch_allowed: 1,
          apply_allowed: 0,
          requires_resource_authority: 0,
          requires_dry_run: 1,
          requires_audit_evidence: 1,
          requires_readback: 1,
          last_evidence_ref: lastEvidenceRef,
          last_certified_at: new Date("2026-06-30T15:20:00.000Z"),
          expires_at: null,
          notes,
        });
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("FROM capability_apply_authorization_policy_registry")) {
        const row = applyPolicies.get(applyPolicyKey);
        return [[...(row ? [{ ...row }] : [])]];
      }
      if (sql.includes("INSERT INTO capability_apply_authorization_policy_registry")) {
        const [policyKey, appKey, capabilityKey, operationIntent, runtimeSurface, allowedSourceTiersJson, policyJson, notes] = params;
        applyPolicies.set(applyPolicyKey, {
          policy_key: policyKey,
          app_key: appKey,
          capability_key: capabilityKey,
          operation_intent: operationIntent,
          runtime_surface: runtimeSurface,
          status: "active",
          allow_external_write: 0,
          allow_credential_binding: 0,
          allow_no_credential_binding: 1,
          requires_ready_for_dispatch: 1,
          requires_dispatch_allowed: 1,
          requires_zero_blocking_gaps: 1,
          requires_audit_evidence: 1,
          requires_readback: 1,
          requires_typed_confirmation: 1,
          requires_same_cycle_dry_run: 1,
          allowed_source_tiers_json: allowedSourceTiersJson,
          policy_json: policyJson,
          notes,
        });
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("FROM governed_migration_authorization_registry")) {
        const row = authorizations.get(params[0]);
        return [[...(row ? [{ ...row }] : [])]];
      }
      if (sql.includes("FROM governed_migration_ledger")) {
        const row = params.length > 1
          ? ledger.get(`${params[0]}:${params[1]}`)
          : [...ledger.entries()].find(([key]) => key.startsWith(`${params[0]}:`))?.[1];
        return [[...(row ? [{ ...row }] : [])]];
      }
      if (sql.includes("UPDATE governed_migration_authorization_registry")) {
        const [notes, metadataJson, migration, previousChecksum] = params;
        const row = authorizations.get(migration);
        const metadata = row
          ? (typeof row.metadata_json === "string" ? JSON.parse(row.metadata_json) : row.metadata_json)
          : {};
        const recordedChecksum = String(metadata?.migration_checksum_sha256 || metadata?.checksum_sha256 || "").toLowerCase();
        if (
          !row ||
          row.authorization_status !== "authorized" ||
          Number(row.allow_apply || 0) !== 1 ||
          recordedChecksum !== previousChecksum
        ) {
          return [{ affectedRows: 0 }];
        }
        authorizations.set(migration, {
          ...row,
          notes,
          metadata_json: metadataJson,
          updated_at: new Date("2026-07-01T10:15:00.000Z"),
        });
        return [{ affectedRows: 1 }];
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

function seedAuthorization(pool, checksum) {
  pool.authorizations.set(MIGRATION, {
    migration_file: MIGRATION,
    authorization_status: "authorized",
    authorization_source: "governed_admin_bootstrap_tool",
    policy_key: "governed_migration_runner_authorization_v1",
    risk_tier: "medium",
    requires_preflight: 1,
    requires_confirmation: 1,
    allow_record_only: 0,
    allow_apply: 1,
    notes: "Previously reviewed checksum-bound authorization.",
    metadata_json: JSON.stringify({
      migration_checksum_sha256: checksum,
      expected_statement_count: STATEMENT_COUNT,
      preflight_status: "pass",
      preflight_risk_count: 0,
      destructive_operations: 0,
      provider_write: false,
      external_send: false,
      migration_sql_executed: false,
      secrets_included: false,
    }),
    created_at: new Date("2026-06-21T02:30:00.000Z"),
    updated_at: new Date("2026-06-21T02:30:00.000Z"),
  });
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
  assert.equal(created.migration_executor_apply_policy.app_key, "platform_orchestration");
  assert.equal(created.migration_executor_apply_policy.capability_key, "governed_migration_execute");
  assert.equal(created.migration_executor_apply_policy.operation_intent, "governed_migration_apply");
  assert.equal(created.migration_executor_apply_policy.runtime_surface, "governed_migration_execute");
  assert.equal(created.migration_executor_apply_policy.allow_external_write, 0);
  assert.equal(created.migration_executor_apply_policy.requires_same_cycle_dry_run, 1);
  assert.equal(created.migration_executor_apply_policy.policy_json.checksum_bound, true);
  assert.equal(created.migration_executor_apply_policy.policy_json.governed_ledger_required, true);
  assert.equal(created.migration_executor_apply_policy.secrets_included, false);
  assert.equal(created.migration_executor_dispatch_certification.certification_key, "governed_migration_execute");
  assert.equal(created.migration_executor_dispatch_certification.dispatch_allowed, 1);
  assert.equal(created.migration_executor_dispatch_certification.apply_allowed, 0);
  assert.equal(created.migration_executor_dispatch_certification.requires_dry_run, 1);
  assert.equal(created.migration_executor_dispatch_certification.requires_readback, 1);
  assert.equal(created.migration_executor_dispatch_certification.expires_at, null);
  assert.equal(created.migration_executor_dispatch_certification.secrets_included, false);
  assert.equal(pool.applyPolicies.size, 1);
  assert.equal(pool.certifications.size, 1);
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

  const storedPolicy = pool.applyPolicies.get("platform_orchestration:governed_migration_execute:governed_migration_execute");
  storedPolicy.requires_readback = 0;
  storedPolicy.policy_json = JSON.stringify({ provider_call_allowed: true, secrets_included: false });
  const storedCertification = pool.certifications.get("governed_migration_execute");
  storedCertification.dispatch_allowed = 0;
  storedCertification.apply_allowed = 1;
  storedCertification.requires_readback = 0;

  const second = await bootstrapGovernedMigrationAuthorization(baseInput(), deps);
  assert.equal(second.authorization_created, false);
  assert.equal(second.idempotent, true);
  assert.equal(second.migration_sql_executed, false);
  assert.equal(second.migration_executor_apply_policy.requires_readback, 1);
  assert.equal(second.migration_executor_apply_policy.policy_json.provider_call_allowed, false);
  assert.equal(second.migration_executor_apply_policy.policy_json.same_cycle_schema_readback_required, true);
  assert.equal(second.migration_executor_dispatch_certification.dispatch_allowed, 1);
  assert.equal(second.migration_executor_dispatch_certification.apply_allowed, 0);
  assert.equal(second.migration_executor_dispatch_certification.requires_readback, 1);
  assert.equal(pool.applyPolicies.size, 1);
  assert.equal(pool.certifications.size, 1);

  const rotationPool = createFakePool();
  seedAuthorization(rotationPool, PREVIOUS_CHECKSUM);
  const rotationReferenced = [];
  const rotated = await bootstrapGovernedMigrationAuthorization({
    ...baseInput(),
    previous_checksum_sha256: PREVIOUS_CHECKSUM,
    decision_note: "Rotate the unapplied authorization after a reviewed migration repair and checksum change.",
  }, {
    ...deps,
    pool: rotationPool,
    markReferenced: async (value) => { rotationReferenced.push(value); return { ok: true }; },
  });
  assert.equal(rotated.authorization_created, false);
  assert.equal(rotated.authorization_updated, true);
  assert.equal(rotated.reauthorized, true);
  assert.equal(rotated.idempotent, false);
  assert.equal(rotated.previous_checksum_sha256, PREVIOUS_CHECKSUM);
  assert.equal(rotated.authorization.recorded_checksum_sha256, CHECKSUM);
  const rotatedMetadata = typeof rotated.authorization.metadata_json === "string"
    ? JSON.parse(rotated.authorization.metadata_json)
    : rotated.authorization.metadata_json;
  assert.equal(rotatedMetadata.migration_checksum_sha256, CHECKSUM);
  assert.equal(rotatedMetadata.previous_checksum_sha256, PREVIOUS_CHECKSUM);
  assert.equal(rotatedMetadata.reauthorized, true);
  assert.equal(rotatedMetadata.migration_sql_executed, false);
  assert.equal(rotationPool.applyPolicies.size, 1);
  assert.equal(rotationPool.certifications.size, 1);
  assert.equal(rotationReferenced.length, 1);

  const missingPreviousPool = createFakePool();
  seedAuthorization(missingPreviousPool, PREVIOUS_CHECKSUM);
  await assert.rejects(
    () => bootstrapGovernedMigrationAuthorization(baseInput(), {
      ...deps,
      pool: missingPreviousPool,
    }),
    (error) => error?.code === "governed_migration_authorization_previous_checksum_required"
  );

  const mismatchedPreviousPool = createFakePool();
  seedAuthorization(mismatchedPreviousPool, PREVIOUS_CHECKSUM);
  await assert.rejects(
    () => bootstrapGovernedMigrationAuthorization({
      ...baseInput(),
      previous_checksum_sha256: "b".repeat(64),
    }, {
      ...deps,
      pool: mismatchedPreviousPool,
    }),
    (error) => error?.code === "governed_migration_authorization_previous_checksum_mismatch"
  );

  const appliedPool = createFakePool();
  seedAuthorization(appliedPool, PREVIOUS_CHECKSUM);
  appliedPool.ledger.set(`${MIGRATION}:${PREVIOUS_CHECKSUM}`, {
    run_id: "migration-run-already-applied",
    mode: "apply",
    migration_checksum_sha256: PREVIOUS_CHECKSUM,
    applied_at: new Date("2026-07-01T10:20:00.000Z"),
  });
  await assert.rejects(
    () => bootstrapGovernedMigrationAuthorization({
      ...baseInput(),
      previous_checksum_sha256: PREVIOUS_CHECKSUM,
    }, {
      ...deps,
      pool: appliedPool,
    }),
    (error) => error?.code === "governed_migration_authorization_already_recorded"
  );

  const dispatchOnly = await bootstrapGovernedMigrationAuthorization(baseInput(), {
    ...deps,
    pool: createFakePool(),
    resolveEnvelope: async () => ({
      ok: true,
      envelope_id: ENVELOPE_ID,
      envelope_status: "ready_for_dispatch",
      decision: "ready_for_dispatch",
      dispatch_allowed: true,
      apply_allowed: false,
      blocking_gap_count: 0,
      secrets_included: false,
    }),
  });
  assert.equal(dispatchOnly.authorization_created, true);
  assert.equal(dispatchOnly.migration_sql_executed, false);

  await assert.rejects(
    () => bootstrapGovernedMigrationAuthorization(baseInput(), {
      ...deps,
      pool: createFakePool(),
      resolveEnvelope: async () => ({
        ok: false,
        status: "capability_resolution_envelope_not_dispatch_ready",
        secrets_included: false,
      }),
    }),
    (error) => error?.code === "capability_resolution_envelope_not_dispatch_ready"
  );

  const routeSource = readFileSync("routes/gptToolsRoutes.js", "utf8");
  const manifestSource = readFileSync("scripts/test-manifest.mjs", "utf8");
  assert.ok(routeSource.includes("governed_migration_authorization_bootstrap"));
  assert.ok(routeSource.includes("bootstrapGovernedMigrationAuthorization"));
  assert.ok(routeSource.includes("previous_checksum_sha256"));
  assert.ok(manifestSource.includes("test-governed-migration-authorization-bootstrap.mjs"));

  console.log("governed migration authorization bootstrap tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
