import assert from "node:assert/strict";
import {
  buildHostingerDeployReloadVerification,
  buildRemoteDeployScript,
  readHostingerSshDeployRunStatus,
} from "./hostingerSshDeployExecutor.js";

const SHA = "a".repeat(40);
const RUN_ID = "hostinger_ssh_deploy_123e4567-e89b-42d3-a456-426614174000";

const script = buildRemoteDeployScript({
  appPath: "/home/test/domains/auth.mad4b.com/nodejs",
  branch: "main",
  expectedCommitSha: SHA,
  forceClean: false,
  restart: true,
});
assert.match(script, /nohup sh -c 'sleep 5; touch tmp\/restart\.txt'/);
assert.match(script, /restart_signal=scheduled:tmp\/restart\.txt/);
assert.doesNotMatch(script, /&& touch tmp\/restart\.txt &&/);

const verification = buildHostingerDeployReloadVerification({
  restart: true,
  sshOk: true,
  parsed: { restart_signal: "scheduled:tmp/restart.txt", deploy_result: "ok" },
});
assert.equal(verification.restart_signal_ok, true);
assert.equal(verification.restart_signal_scheduled, true);
assert.equal(verification.runtime_health_readback_required, true);
assert.equal(verification.status, "restart_scheduled_pending_health_readback");

function poolWithRow(row) {
  return { async query() { return [[row]]; } };
}
const row = {
  execution_status: "success",
  execution_ready_status: "pending_health_readback",
  failure_reason: null,
  output_summary: JSON.stringify({
    expected_commit_sha: SHA,
    executed: true,
    reload_verification: verification,
  }),
  request_id: "req_deploy",
  created_at: "2026-06-15T00:00:00.000Z",
};

const accepted = await readHostingerSshDeployRunStatus(
  { deployment_run_id: RUN_ID },
  {
    pool: poolWithRow(row),
    getRuntimeParity: async () => ({ production_parity: "unknown", blocking_gap_count: 1 }),
  }
);
assert.equal(accepted.deployment_status, "accepted");
assert.equal(accepted.execution_ready_status, "pending_health_readback");
assert.equal(accepted.runtime_parity.matches_expected_commit, false);
assert.equal(accepted.secrets_included, false);

const completed = await readHostingerSshDeployRunStatus(
  { deployment_run_id: RUN_ID },
  {
    pool: poolWithRow(row),
    getRuntimeParity: async () => ({
      production_parity: "verified",
      blocking_gap_count: 0,
      expected_commit_sha: SHA,
      deployed_commit_sha: SHA,
      latest_run_id: "runtime-verification-1",
    }),
  }
);
assert.equal(completed.deployment_status, "completed");
assert.equal(completed.execution_ready_status, "complete");
assert.equal(completed.runtime_parity.matches_expected_commit, true);

await assert.rejects(
  () => readHostingerSshDeployRunStatus({ deployment_run_id: "invalid" }, { pool: poolWithRow(row) }),
  (error) => error.code === "hostinger_deployment_run_id_invalid" && error.status === 400,
);
await assert.rejects(
  () => readHostingerSshDeployRunStatus(
    { deployment_run_id: RUN_ID },
    { pool: { async query() { return [[]]; } } }
  ),
  (error) => error.code === "hostinger_deployment_run_not_found" && error.status === 404,
);

console.log("hostinger deploy accepted/readback tests passed");
