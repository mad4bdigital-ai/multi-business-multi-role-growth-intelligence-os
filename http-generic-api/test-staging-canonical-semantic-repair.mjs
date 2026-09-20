import assert from "node:assert/strict";
import {
  applyStagingCanonicalSemanticRepair,
  inspectStagingCanonicalSemanticRepair,
  planStagingCanonicalSemanticRepair,
  STAGING_CANONICAL_SEMANTIC_REPAIR_ARTIFACT,
} from "./stagingCanonicalSemanticRepair.js";

const commit = "a".repeat(40);
const canonical = {
  workspace_id: "b50db01b-617e-4b7a-8bda-6bf4876f754f",
  tenant_id: "00000000-0000-0000-0000-000000000000",
  workspace_key: "platform_repo_governance_zero",
  display_name: "Platform Admin",
  workspace_type: "brand",
  bootstrap_status: "ready",
  config_json: JSON.stringify({ authority_scope_key: "platform:root", platform_admin_workspace: true }),
};

function executorFor(state) {
  return {
    async query(sql) {
      if (String(sql).includes("information_schema.tables")) return [[{ count: state.tableExists ? 1 : 0 }]];
      if (String(sql).includes("FROM workspace_registry")) return [state.rows];
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

assert.equal(STAGING_CANONICAL_SEMANTIC_REPAIR_ARTIFACT.seed_sha256, "4fb41955ae3ab5a6748c795c6f3291a49c58cf62bf2f84c411cd559059e66e4e");
assert.equal(STAGING_CANONICAL_SEMANTIC_REPAIR_ARTIFACT.statement_count, 2);

const missingState = { tableExists: true, rows: [] };
const executor = executorFor(missingState);
const inspection = await inspectStagingCanonicalSemanticRepair({ executor });
assert.equal(inspection.status, "missing");
assert.equal(inspection.repair_allowed, true);
const plan = await planStagingCanonicalSemanticRepair({ executor, expected_commit: commit, actual_commit: commit });
assert.equal(plan.repair_allowed, true);
assert.equal(plan.artifact.target_role, "runtime");
assert.equal(plan.caller_sql_forbidden, true);
assert.equal(plan.caller_target_forbidden, true);
let appliedArtifact = null;
const result = await applyStagingCanonicalSemanticRepair({
  executor,
  plan,
  confirmation: plan.required_confirmation,
  async apply_artifact(artifact) {
    appliedArtifact = artifact;
    missingState.rows = [canonical];
  },
});
assert.equal(appliedArtifact.sha256, STAGING_CANONICAL_SEMANTIC_REPAIR_ARTIFACT.seed_sha256);
assert.equal(result.status, "repaired");
assert.equal(result.exact_row_count, 1);
assert.equal(result.resolver_candidate_count, 1);
assert.equal(result.provider_mutation_performed, false);
assert.equal(result.production_mutation_performed, false);

for (const rows of [
  [{ ...canonical, workspace_key: "wrong-key" }],
  [{ ...canonical, workspace_id: "11111111-1111-4111-8111-111111111111" }],
  [{ ...canonical, bootstrap_status: "pending" }],
  [canonical, { ...canonical, workspace_id: "22222222-2222-4222-8222-222222222222", workspace_key: "platform_admin_workspace" }],
]) {
  const hostile = await inspectStagingCanonicalSemanticRepair({ executor: executorFor({ tableExists: true, rows }) });
  assert.equal(hostile.repair_allowed, false);
  assert.ok(["identity_conflict", "ambiguous", "not_ready"].includes(hostile.status));
}

const missingTable = await inspectStagingCanonicalSemanticRepair({ executor: executorFor({ tableExists: false, rows: [] }) });
assert.equal(missingTable.status, "workspace_registry_missing");
assert.equal(missingTable.repair_allowed, false);

await assert.rejects(
  planStagingCanonicalSemanticRepair({ executor, expected_commit: commit, actual_commit: "b".repeat(40) }),
  (error) => error?.code === "STAGING_CANONICAL_REPAIR_COMMIT_MISMATCH",
);

console.log("Staging canonical semantic repair lifecycle tests passed");
