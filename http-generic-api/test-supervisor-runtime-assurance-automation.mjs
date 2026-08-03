import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const docsAgent = readFileSync("../.github/workflows/docs-agent.yml", "utf8");
const workMapAutofix = readFileSync("../.github/workflows/spec-kit-work-map-autofix.yml", "utf8");
const workMapIntegration = readFileSync("../.github/workflows/spec-kit-work-map-integration.yml", "utf8");
const workMapRecoveryBridge = readFileSync("../.github/workflows/e2e-contract-reference-integrity.yml", "utf8");
const pipelineContract = JSON.parse(readFileSync("../.specify/pipeline-connectivity-contract.json", "utf8"));
const assurance = readFileSync("../.github/workflows/supervisor-runtime-assurance.yml", "utf8");
const runbook = readFileSync("../docs/runbooks/supervisor-runtime-assurance.md", "utf8");
const testManifest = readFileSync("scripts/test-manifest.mjs", "utf8");

for (const marker of [
  "skip-docs-agent",
  "Upload generated documentation preview",
  "actions/upload-artifact@v4",
  "Report preview-only PR mode",
  "never commit, push, merge, or authorize Work Map writes",
  "docs/auto-docs-agent/**",
  "Review is required",
]) {
  assert.ok(docsAgent.includes(marker), `docs-agent workflow missing ${marker}`);
}

assert.match(docsAgent, /!contains\(github\.event\.pull_request\.labels\.\*\.name, 'skip-docs-agent'\)/);
assert.match(docsAgent, /github\.event\.pull_request\.head\.sha/);
assert.match(docsAgent, /concurrency:\s+[\s\S]*group: repository-generated-artifacts-\$\{\{ github\.repository \}\}-\$\{\{ github\.ref \}\}[\s\S]*cancel-in-progress: false/);
assert.doesNotMatch(docsAgent, /docs-agent-write/);
assert.doesNotMatch(docsAgent, /docs-agent-automerge/);
assert.doesNotMatch(docsAgent, /Governed exact-head Work Map write/);
assert.doesNotMatch(docsAgent, /git add docs\/work-maps/);
assert.doesNotMatch(docsAgent, /git push origin/);
assert.doesNotMatch(docsAgent, /gh pr merge/);
assert.doesNotMatch(docsAgent, /--force(?:-with-lease)?/);

const previewStart = docsAgent.indexOf("pr-impact-note:");
const followupStart = docsAgent.indexOf("main-followup-pr:");
assert.ok(previewStart >= 0, "Docs Agent preview job is required");
assert.ok(followupStart > previewStart, "reviewed main follow-up must remain separate from PR preview");
const previewJob = docsAgent.slice(previewStart, followupStart);
assert.match(previewJob, /Upload generated documentation preview/);
assert.match(previewJob, /Report preview-only PR mode/);
assert.doesNotMatch(previewJob, /git push/);
assert.doesNotMatch(previewJob, /git commit/);

const followupJob = docsAgent.slice(followupStart);
assert.match(followupJob, /permissions:\s+[\s\S]*contents: write/);
assert.match(followupJob, /peter-evans\/create-pull-request@v6/);
assert.match(followupJob, /docs\/auto-docs-agent\/\*\*/);
assert.match(followupJob, /Review is required/);
assert.doesNotMatch(followupJob, /docs\/work-maps/);
assert.doesNotMatch(followupJob, /gh pr merge/);

for (const marker of [
  "workflow_dispatch:",
  "Existing same-repository pull-request branch to update",
  "expected_head_sha:",
  "Initialize diagnostics and validate inputs",
  "Checkout exact authorized head",
  "Pin branch and pull request identity",
  "Validate generator and governance contracts",
  "Regenerate and prove idempotency",
  "Commit and push governed Work Maps",
  "Dispatch exact-head verification",
  "Finalize diagnostic evidence",
  'diagnostic_root="${RUNNER_TEMP}/work-map-autofix-diagnostics-${GITHUB_RUN_ID}"',
  "mad4b.spec-kit-work-map-autofix.v2",
  "WORK_MAP_AUTOFIX_V2",
  "work-map-autofix-diagnostics-",
  "actions/upload-artifact@v4",
  'path: ${{ runner.temp }}/work-map-autofix-diagnostics-${{ github.run_id }}',
  "if-no-files-found: error",
  "git check-ref-format --branch",
  "git add docs/work-maps",
  "git push origin",
  "git rev-parse HEAD",
  "gh workflow run ci.yml",
  "gh workflow run spec-kit-work-map-integration.yml",
]) {
  assert.ok(workMapAutofix.includes(marker), `Work Map Autofix v2 missing ${marker}`);
}
assert.doesNotMatch(workMapAutofix, /GITHUB_WORKSPACE.*work-map-autofix-diagnostics/);
assert.match(workMapAutofix, /group: spec-kit-work-map-artifacts-\$\{\{ github\.repository \}\}-\$\{\{ inputs\.branch \}\}/);
assert.match(workMapAutofix, /cancel-in-progress: false/);
assert.match(workMapAutofix, /TARGET_BRANCH: \$\{\{ inputs\.branch \}\}/);
assert.match(workMapAutofix, /EXPECTED_HEAD_SHA: \$\{\{ inputs\.expected_head_sha \}\}/);
assert.match(workMapAutofix, /\[\[ "\$\{TARGET_BRANCH\}" != "main" && "\$\{TARGET_BRANCH\}" != "Production" \]\]/);
assert.match(workMapAutofix, /-f state=open/);
assert.match(workMapAutofix, /-f base=main/);
assert.match(workMapAutofix, /head="\$\{GITHUB_REPOSITORY_OWNER\}:\$\{TARGET_BRANCH\}"/);
assert.doesNotMatch(workMapAutofix, /types: \[reopened\]/);
assert.doesNotMatch(workMapAutofix, /work-map-autofix:authorized/);
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

const recoveryBridgePolicy = writerPolicy.non_writer_pipelines.find(
  (row) => row.pipeline === "work-map-recovery-bridge",
);
assert.ok(recoveryBridgePolicy, "Work Map recovery bridge must remain a governed non-writer");
for (const marker of [
  "Validate immutable PR snapshot and dispatch sole writer",
  "work-map-autofix:authorized",
  "authorization_consumed=true",
  "spec-kit-work-map-autofix.yml/dispatches",
  "direct_repository_content_mutation=false",
  "protected_branch_mutation=false",
  "force_push=false",
]) {
  assert.ok(
    recoveryBridgePolicy.required_commands.includes(marker),
    `Work Map recovery bridge policy missing ${marker}`,
  );
  assert.ok(workMapRecoveryBridge.includes(marker), `Work Map recovery bridge workflow missing ${marker}`);
}
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
  "schedule:",
  "cron: '23 4 * * *'",
  "supervisor-runtime-readiness.mjs",
  "supervisor-behavioral-certification.mjs",
  "check-supervisor-admin-tool-export-sync.mjs",
  "Install locked runtime dependencies",
  "working-directory: http-generic-api",
  "npm ci --ignore-scripts",
  "cache-dependency-path: http-generic-api/package-lock.json",
  "behavioral-dry-run.json",
  "actions/upload-artifact@v4",
  "supervisor-runtime-assurance",
  "gh issue create",
  "gh issue close",
]) {
  assert.ok(assurance.includes(marker), `assurance workflow missing ${marker}`);
}
assert.doesNotMatch(assurance, /--live|--apply|APPLY_SUPERVISOR_BEHAVIORAL_CERTIFICATION/);
assert.doesNotMatch(assurance, /secrets\.[A-Z0-9_]+/);
assert.match(assurance, /applies_provider_calls, false/);
assert.match(assurance, /persistent_fixture_writes, false/);
assert.match(assurance, /transaction_rollback_required, true/);

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
]) {
  assert.ok(runbook.includes(marker), `runbook missing ${marker}`);
}
assert.doesNotMatch(runbook, /work-map-autofix:authorized/);
assert.doesNotMatch(runbook, /docs-agent-write|docs-agent-automerge/);
assert.ok(testManifest.includes("node test-supervisor-runtime-assurance-automation.mjs"));

console.log("supervisor runtime assurance automation contract OK");
