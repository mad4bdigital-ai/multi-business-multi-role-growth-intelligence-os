import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  runGovernedGeneratedArtifactRefresh,
} from "./maintenance-tools/generated-artifact-refresh.mjs";

const CONTRACT = "mad4b.generated-artifact-refresh-maintenance-tool-test.v2";
const toolPath = "scripts/maintenance-tools/generated-artifact-refresh.mjs";
const exactSha = "1".repeat(40);
const checks = [];

function runCheck(id, check) {
  try {
    check();
    checks.push({ id, ok: true });
  } catch (error) {
    const diagnostic = {
      contract: CONTRACT,
      ok: false,
      first_failure: {
        check_id: id,
        name: error?.name || "Error",
        message: String(error?.message || error).slice(0, 2000),
        operator: error?.operator || null,
        actual: typeof error?.actual === "string" ? error.actual.slice(0, 1000) : error?.actual ?? null,
        expected: typeof error?.expected === "string" ? error.expected.slice(0, 1000) : error?.expected ?? null,
      },
      secrets_included: false,
    };
    console.error(JSON.stringify(diagnostic));
    throw error;
  }
}

function runRejectedCase(name, args, expectedCode) {
  runCheck(`reject-${name}`, () => {
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

    assert.equal(report.contract, "mad4b.governed-generated-artifact-refresh.v1");
    assert.equal(report.outcome, "blocked", `${name} must fail closed`);
    assert.equal(report.first_failure?.code, expectedCode);
    assert.equal(persistedReport.contract, report.contract);
    assert.equal(persistedReport.outcome, report.outcome);
    assert.equal(persistedReport.first_failure?.code, report.first_failure?.code);
    assert.equal(report.secrets_included, false);
    assert.equal(report.mutation.force_push, false);
  });
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
runCheck("tool-exact-head-contract", () => {
  assert.match(toolSource, /expected_head_sha/u);
  assert.match(toolSource, /"git", \["rev-parse", "HEAD"\]/u);
  assert.match(toolSource, /"git", \["push", "origin"/u);
  assert.match(toolSource, /"main"/u);
  assert.match(toolSource, /"Production"/u);
  assert.match(toolSource, /secrets_included:\s*false/u);
});
runCheck("tool-no-force-push", () => {
  const pushCalls = [...toolSource.matchAll(/run\([^\n]*"git",\s*\["push"[^\n]*/gu)].map((match) => match[0]);
  assert.ok(pushCalls.length >= 1, "expected at least one explicit git push call");
  for (const call of pushCalls) {
    assert.doesNotMatch(call, /["'](?:--force|-f)["']/u);
  }
});

const workflowSource = fs.readFileSync("../.github/workflows/governed-generated-artifact-refresh.yml", "utf8");
runCheck("governed-workflow-dispatch-only", () => {
  assert.match(workflowSource, /workflow_dispatch:/u);
  assert.doesNotMatch(workflowSource, /^\s*pull_request(?:_target)?:/mu);
  assert.match(workflowSource, /expected_head_sha:/u);
  assert.match(workflowSource, /actions:\s*write/u);
  assert.match(workflowSource, /contents:\s*write/u);
  assert.match(workflowSource, /pr-generated-artifact-refresh\.yml\/dispatches/u);
  assert.match(workflowSource, /generated-artifact-refresh-verification-dispatch\.json/u);
  assert.match(workflowSource, /remote_sha[\s\S]*result_sha/u);
});
runCheck("governed-workflow-context-availability", () => {
  assert.match(
    workflowSource,
    /OUTPUT_DIR:\s*\.ci-evidence\/governed-generated-artifact-refresh/u,
    "workflow must use one stable repository-relative evidence directory",
  );
  assert.doesNotMatch(
    workflowSource,
    /\$\{\{\s*runner\.temp\s*\}\}/u,
    "jobs-level environment must not reference the unavailable runner context",
  );
  assert.match(workflowSource, /path:\s*\$\{\{ env\.OUTPUT_DIR \}\}\//u);
  assert.match(workflowSource, /--output-dir "\$\{OUTPUT_DIR\}"/u);
});

const prWorkflowSource = fs.readFileSync("../.github/workflows/pr-generated-artifact-refresh.yml", "utf8");
runCheck("read-only-verification-workflow", () => {
  assert.match(prWorkflowSource, /pull_request:/u);
  assert.match(prWorkflowSource, /workflow_dispatch:/u);
  assert.match(prWorkflowSource, /target_ref:/u);
  assert.match(prWorkflowSource, /expected_head_sha:/u);
  assert.doesNotMatch(prWorkflowSource, /contents:\s*write/u);
  assert.doesNotMatch(prWorkflowSource, /git\s+push/u);
  assert.match(prWorkflowSource, /persist-credentials:\s*false/u);
  assert.match(prWorkflowSource, /Verify local and remote exact-head identity/u);
});

const publisherWorkflowSource = fs.readFileSync("../.github/workflows/ci-evidence-pr-publisher.yml", "utf8");
runCheck("trusted-publisher-dispatch-route", () => {
  assert.match(publisherWorkflowSource, /workflow_run\.event == 'workflow_dispatch'/u);
  assert.match(publisherWorkflowSource, /workflow_run\.name == 'PR Generated Artifact Refresh'/u);
  assert.match(publisherWorkflowSource, /generated-artifact-refresh-pr-publisher\.mjs/u);
});

const policy = JSON.parse(fs.readFileSync("../.github/repository-maintenance-tool-governance.json", "utf8"));
runCheck("maintenance-tool-registration", () => {
  const registration = policy.tools?.["generated-artifact-refresh"];
  assert.equal(registration?.mode, "mutating");
  assert.equal(registration?.entrypoint, "http-generic-api/scripts/maintenance-tools/generated-artifact-refresh.mjs");
  assert.ok(registration?.allowed_changed_path_patterns?.length >= 1);
  assert.equal(registration?.report_contract, "mad4b.governed-generated-artifact-refresh.v1");
});

console.log(JSON.stringify({
  contract: CONTRACT,
  ok: true,
  checks,
  exact_head_verification_dispatch: true,
  jobs_level_runner_context_used: false,
  secrets_included: false,
}));
