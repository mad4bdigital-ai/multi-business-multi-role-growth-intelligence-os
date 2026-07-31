import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyCiCheckRun,
  classifyCommitParity,
  readCheckoutCommitSha,
  resolveDeployedCommitEvidence,
} from "./runtimeVerificationService.js";

const root = path.dirname(fileURLToPath(import.meta.url));
async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

const [routesIndex, runtimeRoutes, service] = await Promise.all([
  read("routes/index.js"),
  read("routes/runtimeVerificationRoutes.js"),
  read("runtimeVerificationService.js"),
]);
const mutationPolicyMigration = await read("migrations/1028_sprint69_runtime_verification_and_session_smoke_mutation_policy.sql");

assert.match(routesIndex, /buildRuntimeVerificationRoutes/, "runtime verification routes must be imported and mounted");
assert.match(runtimeRoutes, /POST \/runtime\/verification-runs|\/runtime\/verification-runs/, "runtime verification create route must exist");
assert.match(runtimeRoutes, /\/runtime\/verification-runs\/:runId\/evidence/, "runtime evidence pagination route must exist");
assert.match(runtimeRoutes, /\/runtime\/parity\/:environmentKey\?/, "runtime parity read route must exist");
assert.match(runtimeRoutes, /\/activation\/hard-run\/summary/, "activation hard-run summary route must exist");
assert.match(service, /runtime_verification_runs/, "service must write runtime verification runs");
assert.match(service, /runtime_deployment_parity_status/, "service must write runtime parity ledger");
assert.match(service, /runtime_verification_evidence_chunks/, "service must write paginated evidence chunks");
assert.match(service, /runtime_gap_remediation_registry/, "service must attach remediation runbook metadata to gaps");
assert.match(service, /deployed_commit_mismatch/, "service must block verified parity on deployed commit mismatch");
assert.match(service, /deployment_commit_parity/, "service must record deployment commit parity as a step");
assert.match(service, /max_response_bytes/, "service must enforce response budget metadata");
assert.match(service, /secrets_included: false/, "service must declare secret-safe output");
assert.match(mutationPolicyMigration, /runtime_verification_run_create_api/, "runtime verification mutation policy must target the create tool");
assert.match(mutationPolicyMigration, /state_changing,readback,same_cycle_readback/, "runtime verification create must declare same-cycle readback mutation policy");
assert.match(mutationPolicyMigration, /release_session_archive_smoke/, "session archive smoke mutation policy must target the registered tool");
assert.match(mutationPolicyMigration, /read_write,readback,same_cycle_readback,cleanup_default_true/, "session archive smoke must declare bounded readback and cleanup mutation policy");
assert.doesNotMatch(mutationPolicyMigration, /DELETE\s+FROM|DROP\s+TABLE|TRUNCATE\s+TABLE/i, "mutation policy migration must remain additive and non-destructive");

assert.deepEqual(classifyCiCheckRun({ status: "completed", conclusion: "success" }), {
  classification: "success",
  gate_status: "pass",
  blocks_production_parity: false,
});
assert.deepEqual(classifyCiCheckRun({ status: "completed", conclusion: "cancelled" }), {
  classification: "cancelled_unknown",
  gate_status: "blocked",
  blocks_production_parity: true,
});
assert.deepEqual(classifyCiCheckRun({ status: "completed", conclusion: "cancelled" }, true), {
  classification: "cancelled_superseded_success",
  gate_status: "pass",
  blocks_production_parity: false,
});
assert.deepEqual(classifyCommitParity("abc123", "abc123"), {
  matches: true,
  classification: "deployed_commit_matches_expected",
});
assert.deepEqual(classifyCommitParity("abc123", "def456"), {
  matches: false,
  classification: "deployed_commit_mismatch",
});
assert.deepEqual(classifyCommitParity("unknown", "abc123"), {
  matches: false,
  classification: "deployment_commit_unknown",
});
assert.deepEqual(classifyCommitParity("abc123", "unknown"), {
  matches: false,
  classification: "deployment_commit_unknown",
});

const checkoutSha = "a".repeat(40);
const environmentSha = "b".repeat(40);
const temporaryRepo = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-parity-checkout-"));
try {
  await fs.mkdir(path.join(temporaryRepo, ".git"));
  await fs.writeFile(path.join(temporaryRepo, ".git", "HEAD"), `${checkoutSha}\n`, "utf8");
  assert.equal(readCheckoutCommitSha({ repoRoot: temporaryRepo }), checkoutSha);
  assert.deepEqual(
    resolveDeployedCommitEvidence({ env: {}, checkoutCommitReader: () => checkoutSha }),
    { sha: checkoutSha, source: "checkout_git_head" }
  );
  assert.deepEqual(
    resolveDeployedCommitEvidence({ env: { GIT_COMMIT: environmentSha }, checkoutCommitReader: () => checkoutSha }),
    { sha: environmentSha, source: "env:GIT_COMMIT" }
  );
  assert.deepEqual(
    resolveDeployedCommitEvidence({ env: { GIT_COMMIT: "invalid" }, checkoutCommitReader: () => checkoutSha }),
    { sha: checkoutSha, source: "checkout_git_head" }
  );
} finally {
  await fs.rm(temporaryRepo, { recursive: true, force: true });
}

assert.doesNotMatch(service, /input\.(?:deployed_commit_sha|runtime_commit_sha)/, "deployed parity evidence must not trust caller-supplied commit fields");
assert.match(service, /checkout_git_head/, "runtime verification must disclose checkout Git HEAD as the deployed commit source");

await import("./test-activation-deployment-observation-service.mjs");
await import("./test-activation-deployment-projection-service.mjs");

console.log("runtime verification contract tests passed");
