import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function runRunner(args) {
  return spawnSync(process.execPath, ["scripts/platform-engine-validator-runner.mjs", ...args], {
    cwd: new URL(".", import.meta.url),
    encoding: "utf8",
    shell: false,
  });
}

const success = runRunner([
  "--engine-key",
  "repo_conflict_resolution_engine",
  "--task-class",
  "validator_runner_contract",
  "--validator-key",
  "test_manifest_runner_guard",
  "--command",
  "node test-test-manifest-runner.mjs",
]);

assert.equal(success.status, 0, success.stderr);
const successPayload = JSON.parse(success.stdout);
assert.equal(successPayload.ok, true);
assert.equal(successPayload.apply_executed, false);
assert.equal(successPayload.validators_executed_by_runner, true);
assert.equal(successPayload.log_result, null);
assert.equal(successPayload.validator_result.status, "passed");
assert.equal(successPayload.validator_result.exit_code, 0);
assert.equal(successPayload.validator_result.evidence.shell, false);
assert.equal(successPayload.validator_result.evidence.no_apply, true);
assert.equal(successPayload.validator_result.evidence.no_secret_read, true);

const blocked = runRunner([
  "--engine-key",
  "repo_conflict_resolution_engine",
  "--task-class",
  "validator_runner_contract",
  "--command",
  "powershell Get-ChildItem",
]);

assert.equal(blocked.status, 1);
const blockedPayload = JSON.parse(blocked.stderr);
assert.equal(blockedPayload.ok, false);
assert.match(blockedPayload.error.message, /not allowlisted/);

console.log("platform engine validator runner tests passed");
