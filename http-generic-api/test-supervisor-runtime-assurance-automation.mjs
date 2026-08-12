import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const docsAgent = readFileSync("../.github/workflows/docs-agent.yml", "utf8");
const docsAgentMainFollowup = readFileSync("../.github/workflows/docs-agent-main-followup.yml", "utf8");
const workMapAutofix = readFileSync("../.github/workflows/spec-kit-work-map-autofix.yml", "utf8");
const workMapIntegration = readFileSync("../.github/workflows/spec-kit-work-map-integration.yml", "utf8");
const workMapRecoveryBridge = readFileSync("../.github/workflows/spec-kit-work-map-autofix-recovery-dispatch.yml", "utf8");
const pipelineContract = JSON.parse(readFileSync("../.specify/pipeline-connectivity-contract.json", "utf8"));
const assurance = readFileSync("../.github/workflows/supervisor-runtime-assurance.yml", "utf8");
const assuranceAlert = readFileSync("../.github/workflows/supervisor-runtime-assurance-alert.yml", "utf8");
const runbook = readFileSync("../docs/runbooks/supervisor-runtime-assurance.md", "utf8");
const testManifest = readFileSync("scripts/test-manifest.mjs", "utf8");

for (const marker of [
  "skip-docs-agent",
  "Upload generated documentation preview",
  "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4",
  "Report preview-only PR mode",
  "never commit, push, merge, or authorize Work Map writes",
  "docs/auto-docs-agent/",
  "Review is required",
]) {
  assert.ok(docsAgent.includes(marker), `docs-agent workflow missing ${marker}`);
}

assert.match(docsAgent, /!contains\(github\.event\.pull_request\.labels\.\*\.name, 'skip-docs-agent'\)/);
assert.match(docsAgent, /github\.event\.pull_request\.head\.sha/);
assert.match(docsAgent, /concurrency:\s+[\s\S]*group: repository-generated-artifacts-\$\{\{ github\.repository \}\}-\$\{\{ github\.ref \}\}[\s\S]*cancel-in-progress: false[\s\S]*queue: max/);
assert.doesNotMatch(docsAgent, /docs-agent-write/);
assert.doesNotMatch(docsAgent, /docs-agent-automerge/);
assert.doesNotMatch(docsAgent, /Governed exact-head Work Map write/);
assert.doesNotMatch(docsAgent, /git add docs\/work-maps/);
assert.doesNotMatch(docsAgent, /git push origin/);
assert.doesNotMatch(docsAgent, /gh pr merge/);
assert.doesNotMatch(docsAgent, /--force(?:-with-lease)?/);

const previewStart = docsAgent.indexOf("pr-impact-note:");
assert.ok(previewStart >= 0, "Docs Agent preview job is required");
const previewJob = docsAgent.slice(previewStart);
assert.match(previewJob, /Upload generated documentation preview/);
assert.match(previewJob, /Report preview-only PR mode/);
assert.doesNotMatch(previewJob, /git push/);
assert.doesNotMatch(previewJob, /git commit/);

for (const marker of [
  "push:",
  "workflow_dispatch:",
  "expected_head_sha:",
  "Resolve live main and dispatch exact writer",
  "Pin exact main source and safe target branch",
  "EXPECTED_HEAD_SHA",
  "TARGET_BRANCH=\"docs-agent/${EXPECTED_HEAD_SHA}\"",
  "peter-evans/create-pull-request@c5a7806660adbe173f04e3e038b0ccdcd758773c # v6",
  "docs/auto-docs-agent/**",
  "Review is required",
  "queue: max",
]) {
  assert.ok(docsAgentMainFollowup.includes(marker), `Docs Agent main follow-up workflow missing ${marker}`);
}
assert.match(docsAgentMainFollowup, /permissions:\s+[\s\S]*contents: write/);
assert.match(docsAgentMainFollowup, /test "\$\(git rev-parse HEAD\)" = "\$\{EXPECTED_HEAD_SHA\}"/);
assert.match(docsAgentMainFollowup, /test "\$\{current_head_sha\}" = "\$\{EXPECTED_HEAD_SHA\}"/);
assert.match(docsAgentMainFollowup, /main\|Production\)/);
assert.doesNotMatch(docsAgentMainFollowup, /docs\/work-maps/);
assert.doesNotMatch(docsAgentMainFollowup, /gh pr merge/);
assert.doesNotMatch(docsAgentMainFollowup, /--force(?:-with-lease)?/);

for (const marker of [
  "workflow_dispatch:",
  "pr_number:",
  "Existing same-repository pull-request branch to update",
  "expected_head_sha:",
  "recovery_run_id:",
  "delegation_comment_id:",
  "Initialize diagnostics and validate inputs",
  "Checkout exact authorized head",
  "Pin branch and pull request identity",
  "Verify and consume Recovery-issued writer delegation",
  "Validate generator and governance contracts",
  "Regenerate and prove idempotency",
  "Commit and push governed Work Maps",
  "Dispatch exact-head verification",
  "Finalize diagnostic evidence",
  "${RUNNER_TEMP}/work-map-autofix-diagnostics-${GITHUB_RUN_ID}",
  "mad4b.spec-kit-work-map-autofix.v3",
  "WORK_MAP_AUTOFIX_V3",
  "WORK_MAP_WRITER_DELEGATION contract=mad4b.work-map-writer-delegation.v1 state=issued",
  "state=consumed recovery_run_id=${RECOVERY_RUN_ID}",
  "work-map-autofix-diagnostics-",
  "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4",
  "git check-ref-format --branch",
  "git add -- docs/work-maps",
  "git push origin",
  "git rev-parse HEAD",
  "gh api --method PATCH",
  "gh api --method POST",
  "actions/workflows/ci.yml/dispatches",
  "actions/workflows/spec-kit-work-map-integration.yml/dispatches",
  "ci_dispatch_exit_code",
  "integration_dispatch_exit_code",
  "ci_run_id",
  "integration_run_id",
  "RESULT_HEAD_SHA",
]) {
  assert.ok(workMapAutofix.includes(marker), `Work Map Autofix v3 missing ${marker}`);
}
assert.match(workMapAutofix, /group: work-map-writer-delegation-\$\{\{ github\.repository \}\}-pr-\$\{\{ inputs\.pr_number \}\}/);
assert.match(workMapAutofix, /cancel-in-progress: false/);
assert.match(workMapAutofix, /queue: max/);
assert.match(workMapAutofix, /REQUESTED_PR_NUMBER: \$\{\{ inputs\.pr_number \}\}/);
assert.match(workMapAutofix, /TARGET_BRANCH: \$\{\{ inputs\.branch \}\}/);
assert.match(workMapAutofix, /EXPECTED_HEAD_SHA: \$\{\{ inputs\.expected_head_sha \}\}/);
assert.match(workMapAutofix, /RECOVERY_RUN_ID: \$\{\{ inputs\.recovery_run_id \}\}/);
assert.match(workMapAutofix, /DELEGATION_COMMENT_ID: \$\{\{ inputs\.delegation_comment_id \}\}/);
assert.match(workMapAutofix, /\[\[ "\$\{TARGET_BRANCH\}" != "main" && "\$\{TARGET_BRANCH\}" != "Production" \]\]/);
assert.match(workMapAutofix, /-f state=open/);
assert.match(workMapAutofix, /-f base=main/);
assert.match(workMapAutofix, /head="\$\{GITHUB_REPOSITORY_OWNER\}:\$\{TARGET_BRANCH\}"/);
assert.doesNotMatch(workMapAutofix, /types: \[reopened\]/);
assert.doesNotMatch(workMapAutofix, /work-map-autofix:authorized/);
assert.doesNotMatch(workMapAutofix, /gh workflow run ci\.yml/);
assert.doesNotMatch(workMapAutofix, /gh workflow run spec-kit-work-map-integration\.yml/);
assert.doesNotMatch(workMapAutofix, /mad4b\.spec-kit-work-map-autofix\.v2/);
assert.doesNotMatch(workMapAutofix, /WORK_MAP_AUTOFIX_V2/);
assert.doesNotMatch(workMapAutofix, /--force(?:-with-lease)?/);

for (const marker of [
  "Generate exact-head Work Map repair candidate",
  "generated_from_exact_checked_out_head",
  "remote_write_executed: false",
  "Upload exact-head Work Map repair candidate",
  "Fail closed on stale generated Work Maps",
]) {
  assert.ok(workMapIntegration.includes(marker), `Work Map Integration missing ${marker}`);
}
assert.doesNotMatch(workMapIntegration, /git push origin/);
assert.doesNotMatch(workMapIntegration, /git commit/);

const writerPolicy = pipelineContract.artifact_writer_policies.find(
  (policy) => policy.artifact_group === "platform_work_maps",
);
assert.ok(writerPolicy, "platform Work Map writer policy is required");
assert.equal(writerPolicy.writer_pipeline, "spec-kit-work-map-autofix");
assert.deepEqual(
  writerPolicy.non_writer_pipelines.map((row) => row.pipeline).sort(),
  ["docs-agent", "openapi-auto-sync", "spec-kit-work-map-integration", "work-map-recovery-bridge"].sort(),
);
assert.ok(writerPolicy.required_writer_commands.includes("WORK_MAP_AUTOFIX_V3"));
assert.ok(writerPolicy.required_writer_commands.includes("Verify and consume Recovery-issued writer delegation"));
assert.ok(writerPolicy.required_writer_commands.includes("WORK_MAP_WRITER_DELEGATION contract=mad4b.work-map-writer-delegation.v1 state=issued"));
assert.ok(writerPolicy.required_writer_commands.includes("gh api --method PATCH"));
assert.ok(writerPolicy.required_writer_commands.includes("actions/workflows/ci.yml/dispatches"));
assert.ok(writerPolicy.required_writer_commands.includes("actions/workflows/spec-kit-work-map-integration.yml/dispatches"));
assert.ok(writerPolicy.forbidden_writer_commands.includes("WORK_MAP_AUTOFIX_V2"));
assert.ok(writerPolicy.forbidden_writer_commands.includes("gh workflow run ci.yml"));
assert.ok(writerPolicy.forbidden_writer_commands.includes("gh workflow run spec-kit-work-map-integration.yml"));

const recoveryBridgePolicy = writerPolicy.non_writer_pipelines.find(
  (row) => row.pipeline === "work-map-recovery-bridge",
);
assert.ok(recoveryBridgePolicy, "Work Map recovery bridge must remain a governed non-writer");
for (const marker of [
  "Resolve and validate exact same-repository target",
  "work-map-autofix:authorized",
  "consumed=true",
  "Issue exact one-time writer delegation grant",
  "authorization_consumed=true",
  "spec-kit-work-map-autofix.yml/dispatches",
  "direct_repository_mutation:false",
  "protected_branch_mutation:false",
  "force_push:false",
]) {
  assert.ok(
    recoveryBridgePolicy.required_commands.includes(marker),
    `Work Map recovery bridge policy missing ${marker}`,
  );
  assert.ok(workMapRecoveryBridge.includes(marker), `Work Map recovery bridge workflow missing ${marker}`);
}
assert.match(workMapRecoveryBridge, /group: work-map-writer-delegation-\$\{\{ github\.repository \}\}-pr-\$\{\{ inputs\.pr_number \|\| github\.run_id \}\}/);
assert.match(workMapRecoveryBridge, /cancel-in-progress: false/);
assert.match(workMapRecoveryBridge, /queue: max/);
for (const marker of [
  "platform-work-map-generator.mjs --write",
  "git add docs/work-maps",
  "git push origin",
  "git commit",
]) {
  assert.ok(
    recoveryBridgePolicy.forbidden_commands.includes(marker),
    `Work Map recovery bridge policy must forbid ${marker}`,
  );
  assert.ok(!workMapRecoveryBridge.includes(marker), `Work Map recovery bridge must not contain ${marker}`);
}

for (const marker of [
  "pull_request:",
  "supervisor-runtime-readiness.mjs",
  "supervisor-behavioral-certification.mjs",
  "check-supervisor-admin-tool-export-sync.mjs",
  "Install locked runtime dependencies",
  "working-directory: http-generic-api",
  "npm ci --ignore-scripts",
  "cache-dependency-path: http-generic-api/package-lock.json",
  "behavioral-dry-run.json",
  "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4",
  "supervisor-runtime-assurance",
]) {
  assert.ok(assurance.includes(marker), `read-only assurance workflow missing ${marker}`);
}
assert.match(assurance, /permissions:\s+[\s\S]*contents: read/);
assert.doesNotMatch(assurance, /issues: write/);
assert.doesNotMatch(assurance, /schedule:/);
assert.doesNotMatch(assurance, /gh issue (?:create|close|comment)/);
assert.doesNotMatch(assurance, /--live|--apply|APPLY_SUPERVISOR_BEHAVIORAL_CERTIFICATION/);
assert.doesNotMatch(assurance, /secrets\.[A-Z0-9_]+/);
assert.match(assurance, /applies_provider_calls, false/);
assert.match(assurance, /persistent_fixture_writes, false/);
assert.match(assurance, /transaction_rollback_required, true/);

for (const marker of [
  "schedule:",
  "cron: '23 4 * * *'",
  "supervisor-runtime-readiness.mjs",
  "supervisor-behavioral-certification.mjs",
  "check-supervisor-admin-tool-export-sync.mjs",
  "issues: write",
  "gh issue create",
  "gh issue close",
]) {
  assert.ok(assuranceAlert.includes(marker), `supervisor alert workflow missing ${marker}`);
}
assert.doesNotMatch(assuranceAlert, /\n\s*pull_request(?:_target)?:/);
assert.doesNotMatch(assuranceAlert, /--live|--apply|APPLY_SUPERVISOR_BEHAVIORAL_CERTIFICATION/);
assert.doesNotMatch(assuranceAlert, /secrets\.[A-Z0-9_]+/);

for (const marker of [
  "supervisor_runtime_readiness",
  "supervisor_behavioral_certification",
  "APPLY_SUPERVISOR_BEHAVIORAL_CERTIFICATION",
  "skip-docs-agent",
  "Spec Kit Work Map Autofix",
  "workflow_dispatch",
  "expected_head_sha",
  "same-repository pull-request branch",
  "provider_calls=0",
  "transaction_rolled_back=true",
  "same-cycle",
  "one remote branch writer",
  "supervisor-runtime-assurance-alert.yml",
]) {
  assert.ok(runbook.includes(marker), `runbook missing ${marker}`);
}
assert.doesNotMatch(runbook, /docs-agent-write|docs-agent-automerge/);
assert.ok(testManifest.includes("node test-supervisor-runtime-assurance-automation.mjs"));

console.log("supervisor runtime assurance automation contract OK");
