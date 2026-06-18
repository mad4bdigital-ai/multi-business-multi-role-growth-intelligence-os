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

console.log("runtime verification contract tests passed");
