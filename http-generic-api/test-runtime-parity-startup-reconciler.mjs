import assert from "node:assert/strict";
import { reconcileRuntimeParityOnStartup } from "./runtimeParityStartupReconciler.js";

const SHA_OLD = "1111111111111111111111111111111111111111";
const SHA_NEW = "2222222222222222222222222222222222222222";
const REPOSITORY = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os";

function manifest(overrides = {}) {
  return {
    repository: REPOSITORY,
    branch: "Production",
    commit_sha: SHA_NEW,
    deployed_at: "2026-07-17T20:00:00.000Z",
    ...overrides,
  };
}

function poolWithParity(row) {
  return {
    query: async () => [[row].filter(Boolean)],
  };
}

{
  let poolRequested = false;
  const result = await reconcileRuntimeParityOnStartup({
    env: { NODE_ENV: "test" },
    getPool: () => {
      poolRequested = true;
      return poolWithParity(null);
    },
  });
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "non_production_environment");
  assert.equal(poolRequested, false);
}

{
  let triggerCalls = 0;
  const result = await reconcileRuntimeParityOnStartup({
    env: { NODE_ENV: "production", GITHUB_REPOSITORY: REPOSITORY },
    readManifest: async () => manifest(),
    getPool: () => poolWithParity({
      expected_commit_sha: SHA_NEW,
      deployed_commit_sha: SHA_NEW,
      production_parity: "verified",
    }),
    createTrigger: async () => {
      triggerCalls += 1;
      return {};
    },
  });
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "already_verified");
  assert.equal(triggerCalls, 0);
}

{
  const calls = [];
  const result = await reconcileRuntimeParityOnStartup({
    env: { NODE_ENV: "production", GITHUB_REPOSITORY: REPOSITORY },
    readManifest: async () => manifest(),
    getPool: () => poolWithParity({
      expected_commit_sha: SHA_OLD,
      deployed_commit_sha: SHA_OLD,
      production_parity: "not_verified",
    }),
    createTrigger: async (...args) => {
      calls.push(args);
      return {
        deduplicated: false,
        trigger_event: {
          trigger_event_id: "11111111-1111-4111-8111-111111111111",
          coordination_status: "no_action",
        },
      };
    },
  });
  assert.equal(result.status, "triggered");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].source_event_id, `runtime-startup:${SHA_NEW}`);
  assert.equal(calls[0][0].before_sha, SHA_OLD);
  assert.equal(calls[0][0].after_sha, SHA_NEW);
  assert.equal(calls[0][1].mode, "runtime_parity_startup_reconciler");
  assert.equal(calls[0][2].env.NODE_ENV, "production");
}

{
  const calls = [];
  const result = await reconcileRuntimeParityOnStartup({
    env: {
      NODE_ENV: "production",
      GITHUB_REPOSITORY: REPOSITORY,
      ACTIVATION_GITHUB_BRANCH: "Production",
    },
    readManifest: async () => manifest({ branch: "Production" }),
    getPool: () => poolWithParity({
      expected_commit_sha: SHA_OLD,
      deployed_commit_sha: SHA_OLD,
      production_parity: "not_verified",
    }),
    createTrigger: async (...args) => {
      calls.push(args);
      return {
        deduplicated: false,
        trigger_event: {
          trigger_event_id: "22222222-2222-4222-8222-222222222222",
          coordination_status: "no_action",
        },
      };
    },
  });
  assert.equal(result.status, "triggered");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].branch, "Production");
  assert.equal(calls[0][0].after_sha, SHA_NEW);
}

{
  let triggerCalls = 0;
  const result = await reconcileRuntimeParityOnStartup({
    env: {
      NODE_ENV: "production",
      GITHUB_REPOSITORY: REPOSITORY,
      ACTIVATION_GITHUB_BRANCH: "Production",
    },
    readManifest: async () => manifest({ branch: "main" }),
    getPool: () => poolWithParity(null),
    createTrigger: async () => {
      triggerCalls += 1;
      return {};
    },
  });
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "non_release_branch");
  assert.equal(result.branch, "main");
  assert.equal(result.expected_branch, "Production");
  assert.equal(triggerCalls, 0);
}

{
  let triggerCalls = 0;
  const result = await reconcileRuntimeParityOnStartup({
    env: { NODE_ENV: "production", GITHUB_REPOSITORY: REPOSITORY },
    readManifest: async () => manifest({ commit_sha: "invalid" }),
    getPool: () => poolWithParity(null),
    createTrigger: async () => {
      triggerCalls += 1;
      return {};
    },
  });
  assert.equal(result.status, "degraded");
  assert.equal(result.reason, "invalid_deployment_manifest");
  assert.equal(triggerCalls, 0);
}

{
  const result = await reconcileRuntimeParityOnStartup({
    env: { NODE_ENV: "production", GITHUB_REPOSITORY: REPOSITORY },
    readManifest: async () => manifest(),
    getPool: () => poolWithParity({
      expected_commit_sha: SHA_OLD,
      deployed_commit_sha: SHA_OLD,
      production_parity: "not_verified",
    }),
    createTrigger: async () => {
      const error = new Error("synthetic failure");
      error.code = "synthetic_reconciliation_failure";
      throw error;
    },
  });
  assert.equal(result.status, "degraded");
  assert.equal(result.reason, "startup_reconciliation_failed");
  assert.equal(result.error_code, "synthetic_reconciliation_failure");
}

console.log("runtime parity startup reconciler tests passed");
