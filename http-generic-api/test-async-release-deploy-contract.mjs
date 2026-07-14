import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HOSTINGER_ASYNC_DEPLOY_JOB_TYPE,
  classifyAsyncDeployOutcome,
  classifyAsyncDeployReadback,
  normalizeHostingerAsyncDeployPayload,
  validateHostingerAsyncDeployPayload,
} from "./asyncReleaseDeployContract.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
assert.equal(HOSTINGER_ASYNC_DEPLOY_JOB_TYPE, "hostinger_ssh_deploy_release_async");

const payload = normalizeHostingerAsyncDeployPayload({
  async_deployment_id: "11111111-1111-4111-8111-111111111111",
  operation_id: "22222222-2222-4222-8222-222222222222",
  gate_id: "33333333-3333-4333-8333-333333333333",
  target_id: "44444444-4444-4444-8444-444444444444",
  expected_commit_sha: "a".repeat(40),
  capability_envelope_id: "55555555-5555-4555-8555-555555555555",
  approval_reason: "Approved bounded async deploy regression test.",
  dry_run: false,
});
assert.deepEqual(validateHostingerAsyncDeployPayload(payload), []);
assert.equal(payload.branch, "main");

const transient503 = classifyAsyncDeployOutcome({ error: { status: 503, code: "runtime_restarting" } });
assert.equal(transient503.status, "restart_in_progress");
assert.equal(transient503.job_success, true);
assert.equal(transient503.http_status, 202);

const pending = classifyAsyncDeployOutcome({ result: {
  ok: true,
  deployment_run_id: "hostinger_ssh_deploy_11111111-1111-4111-8111-111111111111",
  reload_verification: { files_updated: true, runtime_health_readback_required: true },
} });
assert.equal(pending.status, "readback_pending");
assert.equal(pending.job_success, true);

const rollback = classifyAsyncDeployOutcome({ result: {
  ok: false,
  reload_verification: { files_updated: true },
} });
assert.equal(rollback.status, "rollback_required");

const verified = classifyAsyncDeployReadback({ deployment: {
  deployment_status: "completed",
  runtime_parity: { matches_expected_commit: true },
} });
assert.equal(verified.status, "verified");

const migration = fs.readFileSync(path.join(__dirname, "migrations", "20260714_async_release_deploy_contract.sql"), "utf8");
assert.match(migration, /CREATE TABLE IF NOT EXISTS release_async_deployments/);
for (const tool of ["release_async_deploy_apply", "release_async_deploy_get", "release_async_deploy_readback"]) assert.match(migration, new RegExp(tool));
assert.match(migration, /async_release_deploy_contract_v1/);
assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE TABLE|DELETE FROM/i);

const openapi = fs.readFileSync(path.join(__dirname, "openapi", "async-release-deploy.yaml"), "utf8");
assert.match(openapi, /openapi: 3\.1\.0/);
assert.match(openapi, /'202'/);
assert.match(openapi, /operationId: acceptAsyncReleaseDeploy/);
assert.match(openapi, /operationId: reconcileAsyncReleaseDeploy/);

console.log("async release deploy contract tests passed");
