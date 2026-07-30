import assert from "node:assert/strict";
import fs from "node:fs";

function read(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const cleanupWorkflow = read(".github/workflows/platform-completion-cleanup-readback.yml");
const scorecardWorkflow = read(".github/workflows/platform-remaining-scope-scorecard.yml");
const cleanupAudit = read("http-generic-api/scripts/platform-completion-cleanup-readback-audit.mjs");
const scorecard = read("http-generic-api/scripts/platform-remaining-scope-scorecard.mjs");

for (const [name, workflow] of [
  ["cleanup", cleanupWorkflow],
  ["scorecard", scorecardWorkflow],
]) {
  assert.match(workflow, /set -euo pipefail/, `${name} workflow must preserve piped command exit codes`);
  assert.match(workflow, /test -s /, `${name} workflow must reject empty evidence`);
  assert.match(workflow, /JSON\.parse/, `${name} workflow must parse generated JSON`);
  assert.match(workflow, /if-no-files-found: error/, `${name} workflow must fail when evidence is missing`);
  assert.match(workflow, /branches: \[main, Production\]/, `${name} workflow must run for main and Production`);
}

assert.match(cleanupAudit, /excludedFiles:/, "cleanup audit must exclude its guard sources from forbidden scans");
assert.match(cleanupAudit, /Release readiness remains the authority/, "cleanup audit must preserve release-readiness authority");
assert.ok(
  cleanupAudit.includes('pathValue === "/system/tools/call"'),
  "cleanup audit must validate the concrete recursion guard",
);
assert.doesNotMatch(cleanupAudit, /live_provider_dispatch_disabled_by_policy/, "cleanup audit must not require an invented migration marker");

assert.match(scorecard, /function isFile\(/, "scorecard must distinguish files from directories");
assert.match(scorecard, /function directoryIncludes\(/, "scorecard must scan directories explicitly");
assert.doesNotMatch(scorecard, /includes\("http-generic-api",\s*"resolveToolDescriptor"\)/, "scorecard must not read a directory as a file");
assert.match(scorecard, /excludedFiles:/, "scorecard must exclude its guard sources from forbidden scans");

console.log("platform static readback fail-closed contract tests passed");
