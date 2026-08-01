import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  runGovernedGeneratedArtifactRefresh,
} from "./maintenance-tools/generated-artifact-refresh.mjs";

const toolPath = "scripts/maintenance-tools/generated-artifact-refresh.mjs";
const exactSha = "1".repeat(40);
const rejectedCases = [];

function runRejectedCase(name, args, expectedCode) {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), `generated-artifact-${name}-`));
  const report = runGovernedGeneratedArtifactRefresh([
    process.execPath,
    toolPath,
    ...args,
    "--output-dir",
    outputDir,
  ]);
  const persistedReport = JSON.parse(
    fs.readFileSync(path.join(outputDir, "generated-artifact-refresh-report.json"), "utf8"),
  );

  assert.equal(report.outcome, "blocked", `${name} must fail closed`);
  assert.equal(report.contract, "mad4b.governed-generated-artifact-refresh.v1");
  assert.equal(report.first_failure?.code, expectedCode);
  assert.deepEqual(persistedReport, report);
  assert.equal(report.secrets_included, false);
  assert.equal(report.mutation.force_push, false);
  rejectedCases.push({ name, code: report.first_failure.code });
}

runRejectedCase("main", [
  "--target-ref", "main",
  "--expected-head-sha", exactSha,
  "--confirmation", "APPLY_GENERATED_ARTIFACT_REFRESH",
], "target_ref_invalid");

runRejectedCase("production", [
  "--target-ref", "Production",
  "--expected-head-sha", exactSha,
  "--confirmation", "APPLY_GENERATED_ARTIFACT_REFRESH",
], "target_ref_invalid");

runRejectedCase("invalid-sha", [
  "--target-ref", "gpt/example",
  "--expected-head-sha", "abc",
  "--confirmation", "APPLY_GENERATED_ARTIFACT_REFRESH",
], "expected_head_sha_invalid");

runRejectedCase("confirmation", [
  "--target-ref", "gpt/example",
  "--expected-head-sha", exactSha,
  "--confirmation", "NO",
], "typed_confirmation_required");

const toolSource = fs.readFileSync(toolPath, "utf8");
assert.match(toolSource, /expected_head_sha/u);
assert.match(toolSource, /git", \["rev-parse", "HEAD"\]/u);
assert.match(toolSource, /git", \["push", "origin"/u);
assert.doesNotMatch(toolSource, /--force|-f\b/u);
assert.match(toolSource, /"main"/u);
assert.match(toolSource, /"Production"/u);
assert.match(toolSource, /secrets_included:\s*false/u);

const workflowSource = fs.readFileSync("../.github/workflows/governed-generated-artifact-refresh.yml", "utf8");
assert.match(workflowSource, /workflow_dispatch:/u);
assert.doesNotMatch(workflowSource, /^\s*pull_request(?:_target)?:/mu);
assert.match(workflowSource, /expected_head_sha:/u);
assert.match(workflowSource, /actions:\s*write/u);
assert.match(workflowSource, /contents:\s*write/u);
assert.match(workflowSource, /pr-generated-artifact-refresh\.yml\/dispatches/u);
assert.match(workflowSource, /generated-artifact-refresh-verification-dispatch\.json/u);
assert.match(workflowSource, /remote_sha.*result_sha/su);

const prWorkflowSource = fs.readFileSync("../.github/workflows/pr-generated-artifact-refresh.yml", "utf8");
assert.match(prWorkflowSource, /pull_request:/u);
assert.match(prWorkflowSource, /workflow_dispatch:/u);
assert.match(prWorkflowSource, /target_ref:/u);
assert.match(prWorkflowSource, /expected_head_sha:/u);
assert.doesNotMatch(prWorkflowSource, /contents:\s*write/u);
assert.doesNotMatch(prWorkflowSource, /git\s+push/u);
assert.match(prWorkflowSource, /persist-credentials:\s*false/u);
assert.match(prWorkflowSource, /Verify local and remote exact-head identity/u);

const publisherWorkflowSource = fs.readFileSync("../.github/workflows/ci-evidence-pr-publisher.yml", "utf8");
assert.match(publisherWorkflowSource, /workflow_run\.event == 'workflow_dispatch'/u);
assert.match(publisherWorkflowSource, /workflow_run\.name == 'PR Generated Artifact Refresh'/u);
assert.match(publisherWorkflowSource, /generated-artifact-refresh-pr-publisher\.mjs/u);

const policy = JSON.parse(fs.readFileSync("../.github/repository-maintenance-tool-governance.json", "utf8"));
const registration = policy.tools?.["generated-artifact-refresh"];
assert.equal(registration?.mode, "mutating");
assert.equal(registration?.entrypoint, "http-generic-api/scripts/maintenance-tools/generated-artifact-refresh.mjs");
assert.ok(registration?.allowed_changed_path_patterns?.length >= 1);
assert.equal(registration?.report_contract, "mad4b.governed-generated-artifact-refresh.v1");

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.generated-artifact-refresh-maintenance-tool-test.v1",
  rejected_cases: rejectedCases,
  exact_head_verification_dispatch: true,
  secrets_included: false,
}));
