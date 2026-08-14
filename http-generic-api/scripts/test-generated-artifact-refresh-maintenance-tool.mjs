import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  runGovernedGeneratedArtifactRefresh,
} from "./maintenance-tools/generated-artifact-refresh.mjs";

const CONTRACT = "mad4b.generated-artifact-refresh-maintenance-tool-test.v3";
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

runRejectedCase("recipe", [
  "--target-ref", "gpt/example",
  "--expected-head-sha", exactSha,
  "--recipe", "arbitrary_writer",
  "--confirmation", "APPLY_GENERATED_ARTIFACT_REFRESH",
], "recipe_invalid");

const toolSource = fs.readFileSync(toolPath, "utf8");
runCheck("tool-exact-head-contract", () => {
  assert.match(toolSource, /expected_head_sha/u);
  assert.match(toolSource, /"git", \["rev-parse", "HEAD"\]/u);
  assert.match(toolSource, /"git", \["push", "origin"/u);
  assert.match(toolSource, /"main"/u);
  assert.match(toolSource, /"Production"/u);
  assert.match(toolSource, /postpush_exact_head_readback/u);
  assert.match(toolSource, /result_head_sha/u);
  assert.match(toolSource, /secrets_included:\s*false/u);
});
runCheck("tool-no-force-push", () => {
  const pushCalls = [...toolSource.matchAll(/run\([^\n]*"git",\s*\["push"[^\n]*/gu)].map((match) => match[0]);
  assert.ok(pushCalls.length >= 1, "expected at least one explicit git push call");
  for (const call of pushCalls) {
    assert.doesNotMatch(call, /["'](?:--force|-f)["']/u);
  }
});
runCheck("tool-canonical-auth-repair", () => {
  assert.match(toolSource, /"git", \["branch", "-f", "main", "origin\/main"\]/u);
  assert.match(toolSource, /scripts\/openapi-runtime-auth-sync\.mjs", "--write"/u);
  assert.match(toolSource, /scripts\/test-openapi-runtime-auth-sync-operation-insertion\.mjs/u);
  assert.match(toolSource, /http-generic-api\/openapi\/support-tickets\.yaml/u);
  const authSyncIndex = toolSource.indexOf("sync_openapi_runtime_auth");
  const dispatchIndex = toolSource.indexOf("generate_frontend_dispatch");
  assert.ok(authSyncIndex >= 0 && dispatchIndex > authSyncIndex, "auth repair must precede frontend projection generation");
});
runCheck("tool-work-map-self-hosting-bootstrap", () => {
  assert.match(toolSource, /work_map_self_hosting_bootstrap/u);
  assert.match(toolSource, /work_map_self_hosting_scope_violation/u);
  assert.match(toolSource, /"git", \["diff", "--name-only", "main", "HEAD"\]/u);
  assert.match(toolSource, /\.github\/workflows\/spec-kit-work-map-autofix\.yml/u);
  assert.match(toolSource, /scripts\/platform-work-map-generator\.mjs", "--write"/u);
  assert.match(toolSource, /scripts\/spec014-refresh-final-work-map-binding\.mjs/u);
  assert.match(toolSource, /014-retail-commerce-operations-growth-os/u);
  assert.match(toolSource, /capture_first_work_map_bootstrap_diff/u);
  assert.match(toolSource, /capture_second_work_map_bootstrap_diff/u);
  assert.match(toolSource, /work_map_self_hosting_not_idempotent/u);
  assert.match(toolSource, /verify_work_maps_current/u);
  assert.match(toolSource, /verify_hostinger_spec014_binding_current/u);
  assert.match(toolSource, /verify_retail_spec014_binding_current/u);
  assert.match(toolSource, /docs\/work-maps/u);
  assert.match(toolSource, /ci-evidence-routing\\\.md/u);
  assert.match(toolSource, /test-spec014-refresh-final-work-map-binding/u);
  const firstConvergenceIndex = toolSource.indexOf("converge();");
  const workMapsCurrentIndex = toolSource.indexOf("verify_work_maps_current");
  const hostingerCurrentIndex = toolSource.indexOf("verify_hostinger_spec014_binding_current");
  const retailCurrentIndex = toolSource.indexOf("verify_retail_spec014_binding_current");
  const bindingRegressionIndex = toolSource.indexOf("verify_spec014_binding_regression");
  assert.ok(
    firstConvergenceIndex >= 0
      && workMapsCurrentIndex > firstConvergenceIndex
      && hostingerCurrentIndex > workMapsCurrentIndex
      && retailCurrentIndex > hostingerCurrentIndex
      && bindingRegressionIndex > retailCurrentIndex,
    "Spec014 regression must run only after Work Map and both Spec014 bindings have converged and passed currentness checks",
  );
  assert.match(toolSource, /self_hosting_scope_bounded/u);
});
runCheck("tool-repository-inventory-refresh", () => {
  assert.match(toolSource, /repository_inventory_refresh/u);
  for (const output of [
    "docs/repository-inventory.json",
    "docs/repository-inventory-summary.json",
    "docs/repository-inventory.md",
  ]) {
    assert.ok(toolSource.includes(`"${output}"`), `inventory output must be explicitly bounded: ${output}`);
  }
  assert.match(toolSource, /"npm", \["ci", "--ignore-scripts"\]/u);
  assert.match(toolSource, /generate_repository_inventory_first_pass/u);
  assert.match(toolSource, /generate_repository_inventory_second_pass/u);
  assert.match(toolSource, /repository_inventory_not_deterministic/u);
  assert.match(toolSource, /"npm", \["run", "inventory:check"\]/u);
  assert.match(toolSource, /"npm", \["run", "inventory:test"\]/u);
  assert.match(toolSource, /docs\(inventory\): regenerate repository inventory/u);
  assert.match(toolSource, /inventory_already_current/u);
  assert.match(toolSource, /REPOSITORY_INVENTORY_OUTPUTS\.has\(file\)/u);
});

const workflowSource = fs.readFileSync("../.github/workflows/governed-generated-artifact-refresh.yml", "utf8");
runCheck("governed-workflow-dispatch-only", () => {
  assert.match(workflowSource, /workflow_dispatch:/u);
  assert.doesNotMatch(workflowSource, /^\s*pull_request(?:_target)?:/mu);
  assert.match(workflowSource, /expected_head_sha:/u);
  assert.match(workflowSource, /recipe:/u);
  assert.match(workflowSource, /repository_inventory_refresh/u);
  assert.match(workflowSource, /actions:\s*write/u);
  assert.match(workflowSource, /contents:\s*write/u);
  assert.match(workflowSource, /pr-generated-artifact-refresh\.yml/u);
  assert.match(workflowSource, /repository-inventory\.yml/u);
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
  assert.doesNotMatch(prWorkflowSource, /actions:\s*write/u);
  assert.doesNotMatch(prWorkflowSource, /issues:\s*write/u);
  assert.doesNotMatch(prWorkflowSource, /pull-requests:\s*write/u);
  assert.doesNotMatch(prWorkflowSource, /contents:\s*write/u);
  assert.doesNotMatch(prWorkflowSource, /git\s+push/u);
  assert.doesNotMatch(prWorkflowSource, /work-map-recovery-activation/u);
  assert.doesNotMatch(prWorkflowSource, /WORK_MAP_RECOVERY_ACTIVATION_BRIDGE/u);
  assert.doesNotMatch(prWorkflowSource, /spec-kit-work-map-autofix-recovery-dispatch\.yml\/dispatches/u);
  assert.match(prWorkflowSource, /persist-credentials:\s*false/u);
  assert.match(prWorkflowSource, /Verify local and remote exact-head identity/u);
});

runCheck("pr-workflow-runner-context-availability", () => {
  assert.doesNotMatch(
    prWorkflowSource,
    /\$\{\{\s*runner\.temp\s*\}\}/u,
    "PR workflow must not evaluate runner.temp before runner allocation",
  );
  assert.match(prWorkflowSource, /Initialize bounded refresh report paths after runner allocation/u);
  assert.match(prWorkflowSource, /report_dir="\$\{RUNNER_TEMP\}\/pr-generated-artifact-refresh"/u);
  assert.match(
    prWorkflowSource,
    /echo "REPORT_PATH=\$\{report_dir\}\/pr-generated-artifact-refresh-summary\.json" >> "\$\{GITHUB_ENV\}"/u,
  );
  assert.match(
    prWorkflowSource,
    /echo "REPORT_MARKDOWN_PATH=\$\{report_dir\}\/pr-generated-artifact-refresh-summary\.md" >> "\$\{GITHUB_ENV\}"/u,
  );
  assert.match(prWorkflowSource, /path:\s*\|[\s\S]*\$\{\{ env\.REPORT_PATH \}\}/u);
});

const inventoryWorkflowSource = fs.readFileSync("../.github/workflows/repository-inventory.yml", "utf8");
const inventoryGateSource = fs.readFileSync("../scripts/repository-inventory-verification-gate.mjs", "utf8");
const workMapIntegrationWorkflowSource = fs.readFileSync("../.github/workflows/spec-kit-work-map-integration.yml", "utf8");
runCheck("work-map-integration-trigger-scope", () => {
  assert.doesNotMatch(workMapIntegrationWorkflowSource, /^\s*-\s*"\.github\/workflows\/\*\*"/mu);
  for (const workflow of [
    ".github/workflows/spec-kit-work-map-integration.yml",
    ".github/workflows/spec-kit-work-map-autofix.yml",
    ".github/workflows/spec-kit-work-map-autofix-recovery-dispatch.yml",
    ".github/workflows/spec-kit-work-map-recovery-bootstrap.yml",
  ]) {
    assert.match(workMapIntegrationWorkflowSource, new RegExp(workflow.replaceAll("/", "\\/"), "u"));
  }
});

runCheck("repository-inventory-exact-head-verifier", () => {
  assert.match(inventoryWorkflowSource, /workflow_dispatch:/u);
  assert.match(inventoryWorkflowSource, /target_ref:/u);
  assert.match(inventoryWorkflowSource, /expected_head_sha:/u);
  assert.match(inventoryWorkflowSource, /contents:\s*read/u);
  assert.doesNotMatch(inventoryWorkflowSource, /contents:\s*write/u);
  assert.doesNotMatch(inventoryWorkflowSource, /git\s+push/u);
  assert.match(inventoryWorkflowSource, /scripts\/repository-inventory-verification-gate\.mjs/u);
  assert.match(inventoryWorkflowSource, /npm ci --ignore-scripts/u);
  assert.match(inventoryGateSource, /git\(\["ls-remote", "--exit-code", "origin"/u);
  assert.match(inventoryGateSource, /scripts\/repository-inventory\.mjs/u);
  assert.match(inventoryGateSource, /"npm", \["run", "inventory:check"\]/u);
  assert.match(inventoryGateSource, /"npm", \["run", "inventory:test"\]/u);
  assert.match(inventoryGateSource, /firstHashes = outputHashes\(\)/u);
  assert.match(inventoryGateSource, /secondHashes = outputHashes\(\)/u);
  assert.match(inventoryGateSource, /sameHashes\(firstHashes, secondHashes\)/u);
  assert.match(inventoryGateSource, /mad4b\.repository-inventory-verification-gate\.v1/u);
  assert.match(inventoryGateSource, /remote_head_sha_mismatch/u);
  assert.match(inventoryGateSource, /bootstrap_pending/u);
  assert.match(inventoryGateSource, /repository_mutation:\s*false/u);
  assert.match(inventoryGateSource, /force_push:\s*false/u);
});

const autofixWorkflowSource = fs.readFileSync("../.github/workflows/repository-inventory-autofix-dispatch.yml", "utf8");
runCheck("repository-inventory-autofix-dispatcher", () => {
  assert.match(autofixWorkflowSource, /workflow_run:/u);
  assert.match(autofixWorkflowSource, /Repository Inventory/u);
  assert.match(autofixWorkflowSource, /SOURCE_CONCLUSION/u);
  assert.match(autofixWorkflowSource, /SOURCE_EVENT/u);
  assert.match(autofixWorkflowSource, /source_push_not_main/u);
  assert.match(autofixWorkflowSource, /source_main_head_is_stale/u);
  assert.match(autofixWorkflowSource, /main_convergence/u);
  assert.match(autofixWorkflowSource, /MANUAL_MODE/u);
  assert.match(autofixWorkflowSource, /source_main_sha_mismatch/u);
  assert.match(autofixWorkflowSource, /fork_pr_not_eligible/u);
  assert.match(autofixWorkflowSource, /branch_requires_reconciliation/u);
  assert.match(autofixWorkflowSource, /governance_surface_changed_requires_manual_regeneration/u);
  assert.match(autofixWorkflowSource, /repository_inventory_stale_only/u);
  assert.match(autofixWorkflowSource, /dirty_set_exceeds_inventory_outputs/u);
  assert.match(autofixWorkflowSource, /repository-inventory-regeneration-/u);
  assert.match(autofixWorkflowSource, /actions:\s*write/u);
  assert.match(autofixWorkflowSource, /contents:\s*read/u);
  assert.match(autofixWorkflowSource, /pull-requests:\s*read/u);
  assert.doesNotMatch(autofixWorkflowSource, /contents:\s*write/u);
  assert.doesNotMatch(autofixWorkflowSource, /git\s+push/u);
  assert.match(autofixWorkflowSource, /governed-generated-artifact-refresh\.yml\/dispatches/u);
  assert.match(autofixWorkflowSource, /recipe:"repository_inventory_refresh"/u);
  assert.match(autofixWorkflowSource, /confirmation:"APPLY_GENERATED_ARTIFACT_REFRESH"/u);
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
  assert.ok(
    registration?.allowed_changed_path_patterns?.includes("^http-generic-api/openapi/support-tickets\\.yaml$"),
    "canonical support-ticket auth repair must be explicitly governed",
  );
  for (const requiredPattern of [
    "^docs/work-maps/.*$",
    "^specs/014-governed-hostinger-storage-orchestration/work-map-integration\\.json$",
    "^specs/014-governed-hostinger-storage-orchestration/tasks\\.md$",
    "^specs/014-retail-commerce-operations-growth-os/work-map-integration\\.json$",
    "^docs/repository-inventory\\.json$",
    "^docs/repository-inventory-summary\\.json$",
    "^docs/repository-inventory\\.md$",
  ]) {
    assert.ok(
      registration?.allowed_changed_path_patterns?.includes(requiredPattern),
      `generated-artifact output must be registered: ${requiredPattern}`,
    );
  }
  assert.equal(registration?.report_contract, "mad4b.governed-generated-artifact-refresh.v1");
});

console.log(JSON.stringify({
  contract: CONTRACT,
  ok: true,
  checks,
  exact_head_verification_dispatch: true,
  canonical_auth_repair_registered: true,
  work_map_self_hosting_bootstrap_registered: true,
  repository_inventory_refresh_registered: true,
  repository_inventory_autofix_dispatch_registered: true,
  main_convergence_recovery_registered: true,
  work_map_trigger_scope_bounded: true,
  pull_request_write_authority: false,
  jobs_level_runner_context_used: false,
  secrets_included: false,
}));