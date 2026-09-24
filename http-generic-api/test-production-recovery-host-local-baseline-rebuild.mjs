import assert from "node:assert/strict";
import { buildRoleBundleBinding } from "./recoveryExecutionBinding.js";
import { computeRoleSelectionProofHash } from "./roleSelectionProof.js";
import {
  createProductionRecoveryHostLocalBaselineRebuildExecutor,
  createProductionRecoveryIndependentBaselineReadback,
} from "./productionRecoveryHostLocalBaselineRebuild.js";

const SHA = "a".repeat(40);
const PLAN = "b".repeat(64);
const STEP = "c".repeat(64);
const TARGET = "d".repeat(64);
const TICKET = "e".repeat(64);
const MANIFEST = "1".repeat(64);
const BUNDLE = "2".repeat(64);
const STATEMENT = "3".repeat(64);
const INSPECTION = "4".repeat(64);
const OBJECTS = "5".repeat(64);

const roleBundle = buildRoleBundleBinding({
  role: "governance",
  bundleManifestSha256: MANIFEST,
  roleBundleSha256: BUNDLE,
  statementCount: 1,
  statementFingerprints: [STATEMENT],
});

const proofBase = {
  source: "durable_full_inspection",
  expected_sha: SHA,
  selected_roles: ["governance"],
  inspection_run_id: "run:github:35946122811",
  inspection_evidence_hash: INSPECTION,
  finding_ids: ["finding:1234567890abcdef"],
  role_object_count_fingerprints: { governance: OBJECTS },
  composite_target_fingerprint: TARGET,
};
const proof = { ...proofBase, selection_hash: computeRoleSelectionProofHash(proofBase) };

function input() {
  return {
    plan_id: "plan:1234567890abcdef",
    plan_hash: PLAN,
    step_id: "step:1234567890abcdef",
    step_hash: STEP,
    capability_key: "governance.baseline.rebuild_empty",
    operation: "database.rebuild_empty",
    authority_ref: "governance.baseline.rebuild_empty",
    expected_sha: SHA,
    target_key: "production-runtime",
    target_fingerprint: TARGET,
    target_role: "governance",
    idempotency_key: "recovery-baseline-governance-001",
    execution_ticket_id: "ticket:1234567890abcdef",
    execution_ticket_hash: TICKET,
    lease_id: "lease:1234567890abcdef",
    fencing_token: "fence:1234567890abcdef",
    role_selection_proof_hash: proof.selection_hash,
    role_selection_proof: proof,
    selected_roles: ["governance"],
    deployment_attestation_hash: "6".repeat(64),
    role_bundle_binding: roleBundle,
    role_bundle_bindings: { governance: roleBundle },
    grant_binding_hash: null,
    secrets_included: false,
  };
}

{
  let invocation = null;
  const executor = createProductionRecoveryHostLocalBaselineRebuildExecutor({
    env: {
      DEPLOYMENT_ENVIRONMENT: "production_hostinger_autodeploy",
      DB_HOST: "db.internal",
      DB_NAME: "runtime_db",
      DB_USER: "runtime_user",
      DB_PASSWORD: "runtime_password",
      GOVERNANCE_DB_HOST: "db.internal",
      GOVERNANCE_DB_NAME: "governance_db",
      GOVERNANCE_DB_USER: "governance_user",
      GOVERNANCE_DB_PASSWORD: "governance_password",
      RUNTIME_PERSISTENCE_DB_HOST: "db.internal",
      RUNTIME_PERSISTENCE_DB_NAME: "persistence_db",
      RUNTIME_PERSISTENCE_DB_USER: "persistence_user",
      RUNTIME_PERSISTENCE_DB_PASSWORD: "persistence_password",
    },
    recoveryStore: { getExecutionTicket: async () => null },
    executionTicketVerifier: { verify: async () => true },
    partialReceiptStore: { putImmutablePartialRebuildReceipt: async () => ({ persisted: true, durable: true }) },
    contractReader: () => ({ synthetic: true }),
    bootstrapRunner: async (options) => {
      invocation = options;
      return {
        ok: true,
        status: "baseline_rebuild_complete",
        operation: "database.rebuild_empty",
        selected_rebuild_roles: ["governance"],
        role_rebuild_results: [{
          role: "governance",
          verification: { required_tables_present: true, object_count_nonzero: true },
        }],
        database_connection_performed: true,
        database_mutation_performed: true,
        migration_apply_performed: false,
        grant_mutation_performed: false,
        secrets_included: false,
      };
    },
  });
  const result = await executor(input());
  assert.equal(result.ok, true);
  assert.equal(result.target_role, "governance");
  assert.equal(result.database_mutation_performed, true);
  assert.equal(result.migration_apply_performed, false);
  assert.equal(result.grant_mutation_performed, false);
  assert.equal(invocation.env.BOOTSTRAP_MODE, "apply_migration");
  assert.equal(invocation.env.BOOTSTRAP_TARGET_SOURCE, "host_local_role_env");
  assert.equal(invocation.env.BOOTSTRAP_ROLE_SELECTION, "governance");
  assert.equal(invocation.env.BOOTSTRAP_ROLE_SELECTION_HASH, proof.selection_hash);
  assert.equal(invocation.env.BOOTSTRAP_REBUILD_CONFIRMATION, `APPLY_HOSTINGER_RUNTIME_BASELINE_REBUILD:${SHA}:production-runtime:governance`);
  assert.deepEqual(JSON.parse(invocation.env.BOOTSTRAP_ROLE_BUNDLE_BINDINGS_JSON), { governance: roleBundle });
  assert.equal(invocation.env.BOOTSTRAP_MIGRATION, "");
}

{
  const executor = createProductionRecoveryHostLocalBaselineRebuildExecutor({
    recoveryStore: { getExecutionTicket: async () => null },
    executionTicketVerifier: { verify: async () => true },
    partialReceiptStore: { putImmutablePartialRebuildReceipt: async () => ({ persisted: true, durable: true }) },
    bootstrapRunner: async () => { throw new Error("must not reach bootstrap"); },
  });
  await assert.rejects(
    () => executor({ ...input(), selected_roles: ["governance", "runtime_persistence"] }),
    (error) => error?.code === "RECOVERY_PRODUCTION_BASELINE_ROLE_SET_INVALID",
  );
  await assert.rejects(
    () => executor({ ...input(), operation: "apply_migration" }),
    (error) => error?.code === "RECOVERY_PRODUCTION_BASELINE_BINDING_INVALID",
  );
  await assert.rejects(
    () => executor({ ...input(), role_bundle_binding: { ...roleBundle, role_bundle_sha256: "f".repeat(64) } }),
    (error) => error?.code === "RECOVERY_PRODUCTION_ROLE_BUNDLE_BINDING_INVALID",
  );
}

{
  const readback = createProductionRecoveryIndependentBaselineReadback({
    inspectionRunner: async () => ({
      ok: true,
      role_database_object_classifications: { governance: "nonempty_objects" },
      role_database_object_counts: { governance: { tables: 12, views: 0, triggers: 0, routines: 0, events: 0, total: 12 } },
      role_table_evidence: { governance: [{ table: "governed_migration_ledger", present: true }] },
      selected_rebuild_roles: ["runtime_persistence"],
      target_binding: { target_fingerprint: TARGET },
      database_connection_performed: true,
      database_mutation_performed: false,
      migration_apply_performed: false,
      grant_mutation_performed: false,
      secrets_included: false,
    }),
  });
  const result = await readback({
    plan: { expected_sha: SHA, target_fingerprint: TARGET, role_selection_proof: { composite_target_fingerprint: TARGET } },
    step: { capability_key: "governance.baseline.rebuild_empty", target_role: "governance" },
    target_role: "governance",
    expected_sha: SHA,
  });
  assert.equal(result.verified, true);
  assert.equal(result.postconditions_passed, true);
  assert.equal(result.mutation_authority, false);
}

{
  const readback = createProductionRecoveryIndependentBaselineReadback({
    inspectionRunner: async () => ({
      role_database_object_classifications: { governance: "zero_objects" },
      role_database_object_counts: { governance: { tables: 0, views: 0, triggers: 0, routines: 0, events: 0, total: 0 } },
      role_table_evidence: { governance: [] },
      selected_rebuild_roles: ["governance"],
      target_binding: { target_fingerprint: TARGET },
      database_mutation_performed: false,
      migration_apply_performed: false,
      grant_mutation_performed: false,
      secrets_included: false,
    }),
  });
  await assert.rejects(
    () => readback({
      plan: { expected_sha: SHA, target_fingerprint: TARGET, role_selection_proof: { composite_target_fingerprint: TARGET } },
      step: { capability_key: "governance.baseline.rebuild_empty", target_role: "governance" },
      target_role: "governance",
      expected_sha: SHA,
    }),
    (error) => error?.code === "RECOVERY_PRODUCTION_READBACK_FAILED",
  );
}

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.production-recovery-host-local-baseline-rebuild-regression.v1",
  single_role_only: true,
  ticket_bound: true,
  role_bundle_bound: true,
  same_cycle_readback_required: true,
  grants_included: false,
  ordinary_migrations_included: false,
  secrets_included: false,
}));
