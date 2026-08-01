import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const docsAgent = readFileSync("../.github/workflows/docs-agent.yml", "utf8");
const assurance = readFileSync("../.github/workflows/supervisor-runtime-assurance.yml", "utf8");
const runbook = readFileSync("../docs/runbooks/supervisor-runtime-assurance.md", "utf8");
const testManifest = readFileSync("scripts/test-manifest.mjs", "utf8");

for (const marker of [
  "skip-docs-agent",
  "docs-agent-write",
  "Upload generated documentation preview",
  "actions/upload-artifact@v4",
  "Report preview-only PR mode",
  "Governed exact-head Work Map write",
  "Bootstrap Work Map diagnostic envelope",
  "work-map-autofix-diagnostics.mjs",
  "regenerate-and-verify-idempotency",
  "commit-and-push-work-maps",
  "Consume one-time write label",
  "work-map-autofix-diagnostic-report",
  "GITHUB_STEP_SUMMARY",
]) {
  assert.ok(docsAgent.includes(marker), `docs-agent workflow missing ${marker}`);
}

assert.match(docsAgent, /!contains\(github\.event\.pull_request\.labels\.\*\.name, 'skip-docs-agent'\)/);
assert.match(docsAgent, /github\.event\.pull_request\.head\.sha/);
assert.match(docsAgent, /EXPECTED_HEAD_SHA/);
assert.match(docsAgent, /concurrency:\s+[\s\S]*group: repository-generated-artifacts-\$\{\{ github\.repository \}\}-\$\{\{ github\.ref \}\}[\s\S]*cancel-in-progress: false/);
assert.match(docsAgent, /github\.event\.action == 'reopened'/);
assert.match(docsAgent, /contains\(github\.event\.pull_request\.labels\.\*\.name, 'docs-agent-write'\)/);
assert.match(docsAgent, /issues\/\$\{PR_NUMBER\}\/labels\/docs-agent-write/);
assert.match(docsAgent, /git add docs\/work-maps/);
assert.match(docsAgent, /git diff --name-only \| grep -v '\^docs\/work-maps\/'/);
assert.match(docsAgent, /Refusing stale generated push/);
assert.match(docsAgent, /Generated push readback mismatch/);
assert.doesNotMatch(docsAgent, /--force(?:-with-lease)?/);
assert.doesNotMatch(docsAgent, /docs-agent-automerge/);
assert.doesNotMatch(docsAgent, /Commit generated documentation to PR branch/);

const governedStart = docsAgent.indexOf("governed-work-map-write:");
const followupStart = docsAgent.indexOf("main-followup-pr:");
assert.ok(governedStart >= 0, "governed Work Map write job is required");
assert.ok(followupStart > governedStart, "main follow-up job must follow the governed Work Map write job");
const governedJob = docsAgent.slice(governedStart, followupStart);
assert.match(governedJob, /permissions:\s+[\s\S]*contents: write/);
assert.match(governedJob, /pull-requests: write/);
assert.match(governedJob, /git add docs\/work-maps/);
assert.doesNotMatch(governedJob, /git add docs\/auto-docs-agent/);
assert.doesNotMatch(governedJob, /gh pr merge/);
assert.ok(
  governedJob.indexOf("Pin authorized branch head") < governedJob.indexOf("Regenerate Work Maps and verify idempotency"),
  "exact-head pinning must precede generation",
);
assert.ok(
  governedJob.indexOf("Consume one-time write label") < governedJob.indexOf("Regenerate Work Maps and verify idempotency"),
  "one-time authorization must be consumed before generation",
);
assert.ok(
  governedJob.indexOf("Finalize Work Map diagnostic report") < governedJob.indexOf("Upload Work Map diagnostic report"),
  "diagnostic report must be finalized before artifact upload",
);
assert.ok(
  governedJob.indexOf("Upload Work Map diagnostic report") < governedJob.indexOf("Publish sticky Work Map diagnostic report"),
  "diagnostic artifact must be available before sticky PR publication",
);

const previewStart = docsAgent.indexOf("pr-impact-note:");
assert.ok(previewStart >= 0 && previewStart < governedStart, "preview job must remain distinct from governed mutation");
const previewJob = docsAgent.slice(previewStart, governedStart);
assert.match(previewJob, /Upload generated documentation preview/);
assert.match(previewJob, /Report preview-only PR mode/);
assert.doesNotMatch(previewJob, /git push/);
assert.doesNotMatch(previewJob, /git commit/);

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
  "docs-agent-write",
  "provider_calls=0",
  "transaction_rolled_back=true",
  "same-cycle",
]) {
  assert.ok(runbook.includes(marker), `runbook missing ${marker}`);
}
assert.ok(testManifest.includes("node test-supervisor-runtime-assurance-automation.mjs"));

console.log("supervisor runtime assurance automation contract OK");
