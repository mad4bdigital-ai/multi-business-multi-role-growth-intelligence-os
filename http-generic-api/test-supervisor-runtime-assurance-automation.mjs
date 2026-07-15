import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const docsAgent = readFileSync("../.github/workflows/docs-agent.yml", "utf8");
const assurance = readFileSync("../.github/workflows/supervisor-runtime-assurance.yml", "utf8");
const runbook = readFileSync("../docs/runbooks/supervisor-runtime-assurance.md", "utf8");
const testManifest = readFileSync("scripts/test-manifest.mjs", "utf8");

for (const marker of [
  "skip-docs-agent",
  "docs-agent-write",
  "docs-agent-automerge",
  "Upload generated documentation preview",
  "actions/upload-artifact@v4",
  "Report non-mutating default",
]) {
  assert.ok(docsAgent.includes(marker), `docs-agent workflow missing ${marker}`);
}
const commitStep = docsAgent.indexOf("Commit generated documentation to PR branch");
const writeLabelGate = docsAgent.indexOf("contains(github.event.pull_request.labels.*.name, 'docs-agent-write')");
assert.ok(writeLabelGate >= 0 && writeLabelGate < commitStep, "docs branch mutation must be gated by docs-agent-write");
assert.match(docsAgent, /!contains\(github\.event\.pull_request\.labels\.\*\.name, 'skip-docs-agent'\)/);

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
