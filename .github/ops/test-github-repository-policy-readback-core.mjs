import assert from "node:assert/strict";
import { buildBranchReadbackEvidence, buildTwoBranchReadbackEvidence } from "./github-repository-policy-readback-core.mjs";

const passingReadback = (branch, sha) => ({
  target: { owner: "mad4bdigital-ai", repo: "growth", default_branch: branch },
  branch_sha: sha,
  branch_protected: true,
  required_checks: branch === "main" ? ["Derived State Closure"] : ["Governed Production Promotion"],
  observed_required_checks: branch === "main" ? ["Derived State Closure"] : ["Governed Production Promotion"],
  ruleset_details: [],
  finalizer_identity: { app_id: 123, installation_id: 456, resolved: true },
  findings: [],
  proof: {
    server_policy_gate_complete: true,
    required_status_check_producer_bound: true,
    required_status_checks_proven: true,
    direct_push_block_proven: true,
    force_push_block_proven: true,
    finalizer_not_bypass_proven: true,
  },
});

const mainSha = "a".repeat(40);
const productionSha = "b".repeat(40);
const main = buildBranchReadbackEvidence({ branch: "main", expectedSha: mainSha, readback: passingReadback("main", mainSha) });
const production = buildBranchReadbackEvidence({ branch: "Production", expectedSha: productionSha, readback: passingReadback("Production", productionSha) });
const converged = buildTwoBranchReadbackEvidence({ branches: [main, production], generatedAt: "2026-08-19T00:00:00.000Z" });
assert.equal(converged.server_policy_drift_count, 0);
assert.deepEqual(converged.drifted_branches, []);
assert.equal(converged.reason, null);
assert.equal(converged.mutation_executed, false);

const driftedProduction = buildBranchReadbackEvidence({
  branch: "Production",
  expectedSha: productionSha,
  readback: { ...passingReadback("Production", productionSha), branch_sha: "c".repeat(40), proof: { ...passingReadback("Production", productionSha).proof, server_policy_gate_complete: false } },
});
const driftReport = buildTwoBranchReadbackEvidence({ branches: [main, driftedProduction] });
assert.equal(driftReport.server_policy_drift_count, 1);
assert.deepEqual(driftReport.drifted_branches, ["Production"]);
assert.equal(driftReport.reason, "GOVERNANCE_SERVER_POLICY_DRIFT");
assert.deepEqual(driftedProduction.drift_reasons, ["branch_sha_drift", "server_policy_gate_incomplete"]);

console.log(JSON.stringify({
  ok: true,
  contract: "github_repository_policy_two_branch_readback.v1",
  converged_drift_count: converged.server_policy_drift_count,
  drifted_drift_count: driftReport.server_policy_drift_count,
  read_only: converged.mutation_executed === false,
  secrets_included: false,
}));
