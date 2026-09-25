import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlatformRecoveryConvergencePlan,
  runPlatformRecoveryConvergence,
} from "./platformRecoveryConvergence.js";

const SHA = "a".repeat(40);

async function happyApprovalResolver(ctx) {
  return {
    verified: true,
    approval_id: `approval:${ctx.step_id.replace(/[^A-Za-z0-9._:-]/gu, "_")}`,
    expected_sha: ctx.expected_sha,
    run_id: ctx.run_id,
    plan_hash: ctx.plan_hash,
    step_id: ctx.step_id,
    idempotency_key: ctx.idempotency_key,
    single_use: true,
    secrets_included: false,
  };
}

function clone(value) {
  return structuredClone(value);
}

function makeStore() {
  const runs = new Map();
  const idempotency = new Map();
  const events = [];
  return {
    independent_of_target_databases: true,
    events,
    async putRun(run) {
      runs.set(run.run_id, clone(run));
      if (run.idempotency_key) idempotency.set(run.idempotency_key, run.run_id);
    },
    async getRun(runId) {
      return runs.has(runId) ? clone(runs.get(runId)) : null;
    },
    async getRunByIdempotency(key) {
      const runId = idempotency.get(key);
      return runId && runs.has(runId) ? clone(runs.get(runId)) : null;
    },
    async appendEvidenceEvent(runId, event) {
      events.push(clone({ run_id: runId, ...event }));
    },
    async putIdempotencyReceipt(key, receipt) {
      idempotency.set(key, receipt.run_id);
    },
  };
}

function pass(ctx, extra = {}) {
  return {
    ok: true,
    status: "pass",
    expected_sha: ctx.expected_sha,
    run_id: ctx.run_id,
    plan_hash: ctx.plan_hash,
    step_id: ctx.step_id,
    idempotency_key: ctx.idempotency_key,
    mutation_performed: false,
    readback_verified: true,
    secrets_included: false,
    ...extra,
  };
}

function mutationPass(ctx, extra = {}) {
  return pass(ctx, {
    mutation_performed: true,
    authority_verified: true,
    readback_verified: true,
    ...extra,
  });
}

function happyExecutors({ zeroGovernance = true, zeroPersistence = true, calls = [] } = {}) {
  const wrap = (key, fn) => async (ctx) => {
    calls.push(key);
    return fn(ctx);
  };
  return {
    production_identity: wrap("production_identity", (ctx) => pass(ctx, { exact_sha_parity: true, version_readback: true, deployment_info_readback: true })),
    backup_evidence: wrap("backup_evidence", (ctx) => pass(ctx, {
      backup_verified: true,
      roles: ["runtime", "governance", "runtime_persistence"],
      evidence_sha256: "b".repeat(64),
    })),
    database_full_inspection: wrap("database_full_inspection", (ctx) => pass(ctx, {
      durable: true,
      roles: {
        runtime: { zero_object: false },
        governance: { zero_object: zeroGovernance },
        runtime_persistence: { zero_object: zeroPersistence },
      },
    })),
    governance_baseline_rebuild: wrap("governance_baseline_rebuild", (ctx) => mutationPass(ctx)),
    governance_baseline_verify: wrap("governance_baseline_verify", (ctx) => pass(ctx, { baseline_ready: true })),
    runtime_persistence_baseline_rebuild: wrap("runtime_persistence_baseline_rebuild", (ctx) => mutationPass(ctx)),
    runtime_persistence_baseline_verify: wrap("runtime_persistence_baseline_verify", (ctx) => pass(ctx, { baseline_ready: true })),
    canonical_grants_apply: wrap("canonical_grants_apply", (ctx) => mutationPass(ctx)),
    canonical_grants_verify: wrap("canonical_grants_verify", (ctx) => pass(ctx, { grants_ready: true })),
    mcp_catalog_migration_apply: wrap("mcp_catalog_migration_apply", (ctx) => mutationPass(ctx)),
    mcp_catalog_verify: wrap("mcp_catalog_verify", (ctx) => pass(ctx, { mcp_catalog_level_ready: true })),
    response_chunk_storage_smoke: wrap("response_chunk_storage_smoke", (ctx) => mutationPass(ctx, { write_read_verified: true })),
    admin_tools_functional_readback: wrap("admin_tools_functional_readback", (ctx) => pass(ctx, {
      listAdminTools: true,
      repo_inspect: true,
      schema_contract_not_ready: false,
    })),
    device_tools_functional_readback: wrap("device_tools_functional_readback", (ctx) => pass(ctx, {
      listDeviceTools: true,
      schema_contract_not_ready: false,
    })),
    production_activation_readiness: wrap("production_activation_readiness", (ctx) => pass(ctx, { ready: true })),
    connector_auth_probe: wrap("connector_auth_probe", (ctx) => pass(ctx, {
      auth_ready: true,
      authenticated_operation_http_status: 200,
      failure_kind: null,
    })),
    connector_two_phase_rebind: wrap("connector_two_phase_rebind", (ctx) => mutationPass(ctx, {
      fresh_device_authorization_verified: true,
      pending_credential_created: true,
      local_atomic_install_verified: true,
      new_credential_probe_verified: true,
      old_credential_revoked_after_probe: true,
      old_credential_revoked_before_probe: false,
      credential_material_returned_to_orchestrator: false,
    })),
    connector_auth_verify: wrap("connector_auth_verify", (ctx) => pass(ctx, {
      auth_ready: true,
      authenticated_operation_http_status: 200,
    })),
    local_manager_e2e_round_trip: wrap("local_manager_e2e_round_trip", (ctx) => mutationPass(ctx, {
      command_created: true,
      command_claimed: true,
      command_completed: true,
    })),
    deployment_parity: wrap("deployment_parity", (ctx) => pass(ctx, { exact_sha_parity: true })),
  };
}

async function advanceUntilBoundary({ store, executors, runId = null, approvalResolver = happyApprovalResolver, maxCycles = 32 }) {
  let currentRunId = runId;
  let result = null;
  for (let cycle = 0; cycle < maxCycles; cycle += 1) {
    result = await runPlatformRecoveryConvergence(
      { expected_sha: SHA, ...(currentRunId ? { run_id: currentRunId } : {}) },
      { recoveryStore: store, executors, approvalResolver },
    );
    currentRunId = result.run_id;
    if (result.status !== "pending") return result;
  }
  throw new Error("convergence did not reach a boundary within maxCycles");
}

test("convergence reaches active only after every required gate passes", async () => {
  const store = makeStore();
  const calls = [];
  const result = await advanceUntilBoundary({
    store,
    executors: happyExecutors({ calls }),
  });

  assert.equal(result.status, "active");
  assert.equal(result.active, true);
  assert.equal(result.blocking_stage, null);
  assert.equal(result.next_safe_action, "none");
  assert.equal(result.steps.at(-1).key, "final_gate");
  assert.equal(result.steps.at(-1).status, "pass");
  assert.equal(result.steps.find((step) => step.key === "connector_two_phase_rebind").status, "skipped_not_required");
  assert.equal(result.steps.find((step) => step.key === "local_manager_rate_limit_recovery").status, "skipped_not_required");
  assert.equal(calls.includes("connector_two_phase_rebind"), false);
  assert.equal(result.secrets_included, false);
  assert.ok(store.events.some((event) => event.event_type === "run_activated"));
});

test("nonzero database roles are never rebuilt and are verified instead", async () => {
  const store = makeStore();
  const calls = [];
  const result = await advanceUntilBoundary({
    store,
    executors: happyExecutors({ zeroGovernance: false, zeroPersistence: false, calls }),
  });

  assert.equal(result.status, "active");
  assert.equal(calls.includes("governance_baseline_rebuild"), false);
  assert.equal(calls.includes("runtime_persistence_baseline_rebuild"), false);
  assert.equal(result.steps.find((step) => step.key === "governance_baseline_rebuild").status, "skipped_not_required");
  assert.equal(result.steps.find((step) => step.key === "runtime_persistence_baseline_rebuild").status, "skipped_not_required");
});

test("completed steps are not replayed when a later stage waits for authority", async () => {
  const store = makeStore();
  const calls = [];
  const executors = happyExecutors({ calls });
  delete executors.canonical_grants_apply;

  const first = await runPlatformRecoveryConvergence(
    { expected_sha: SHA },
    { recoveryStore: store, executors, approvalResolver: happyApprovalResolver },
  );
  assert.equal(first.status, "awaiting_approval");
  assert.equal(first.blocking_stage, "canonical_grants_apply");
  const identityCalls = calls.filter((key) => key === "production_identity").length;

  executors.canonical_grants_apply = async (ctx) => {
    calls.push("canonical_grants_apply");
    return mutationPass(ctx);
  };

  const second = await runPlatformRecoveryConvergence(
    { expected_sha: SHA, run_id: first.run_id },
    { recoveryStore: store, executors, approvalResolver: happyApprovalResolver },
  );
  assert.equal(second.status, "active");
  assert.equal(calls.filter((key) => key === "production_identity").length, identityCalls);
  assert.equal(calls.filter((key) => key === "canonical_grants_apply").length, 1);
});

test("unknown mutation outcome blocks blind retry and requires explicit reconciliation", async () => {
  const store = makeStore();
  const calls = [];
  const executors = happyExecutors({ calls });
  let executeCount = 0;
  executors.canonical_grants_apply = {
    execute: async (ctx) => {
      executeCount += 1;
      return {
        ok: false,
        status: "unknown_outcome",
        expected_sha: ctx.expected_sha,
        run_id: ctx.run_id,
        plan_hash: ctx.plan_hash,
        step_id: ctx.step_id,
        idempotency_key: ctx.idempotency_key,
        mutation_performed: true,
        request_id: "req-unknown-grants",
        error_code: "provider_outcome_unknown",
        secrets_included: false,
      };
    },
    reconcile: async (ctx) => pass(ctx, { reconciled: true, authority_verified: true, readback_verified: true }),
  };

  const first = await runPlatformRecoveryConvergence(
    { expected_sha: SHA },
    { recoveryStore: store, executors, approvalResolver: happyApprovalResolver },
  );
  assert.equal(first.status, "unknown_outcome");
  assert.equal(first.next_safe_action, "reconcile_same_operation_before_retry");
  assert.equal(executeCount, 1);

  const blindRetry = await runPlatformRecoveryConvergence(
    { expected_sha: SHA, run_id: first.run_id, action: "advance" },
    { recoveryStore: store, executors, approvalResolver: happyApprovalResolver },
  );
  assert.equal(blindRetry.status, "unknown_outcome");
  assert.equal(executeCount, 1);

  const reconciled = await runPlatformRecoveryConvergence(
    { expected_sha: SHA, run_id: first.run_id, action: "reconcile" },
    { recoveryStore: store, executors, approvalResolver: happyApprovalResolver },
  );
  assert.equal(reconciled.status, "pending");
  assert.equal(reconciled.steps.find((step) => step.key === "canonical_grants_apply").status, "pass");

  const final = await runPlatformRecoveryConvergence(
    { expected_sha: SHA, run_id: first.run_id, action: "advance" },
    { recoveryStore: store, executors, approvalResolver: happyApprovalResolver },
  );
  assert.equal(final.status, "active");
  assert.equal(executeCount, 1);
});

test("credential-invalid connector probe invokes two-phase rebind before authenticated verification", async () => {
  const store = makeStore();
  const calls = [];
  const executors = happyExecutors({ calls });
  executors.connector_auth_probe = async (ctx) => {
    calls.push("connector_auth_probe");
    return pass(ctx, { auth_ready: false, failure_kind: "credential_invalid", authenticated_operation_http_status: 401 });
  };

  const result = await runPlatformRecoveryConvergence(
    { expected_sha: SHA },
    { recoveryStore: store, executors, approvalResolver: happyApprovalResolver },
  );

  assert.equal(result.status, "active");
  assert.equal(result.steps.find((step) => step.key === "connector_two_phase_rebind").status, "pass");
  assert.ok(calls.indexOf("connector_two_phase_rebind") < calls.indexOf("connector_auth_verify"));
});

test("rate limited connector recovery honors the rate-limit contract and never triggers credential rebind", async () => {
  const store = makeStore();
  const calls = [];
  const executors = happyExecutors({ calls });
  executors.connector_auth_probe = async (ctx) => {
    calls.push("connector_auth_probe");
    return pass(ctx, { auth_ready: false, failure_kind: "edge_rate_limited", authenticated_operation_http_status: 429 });
  };
  executors.local_manager_rate_limit_recovery = async (ctx) => {
    calls.push("local_manager_rate_limit_recovery");
    return pass(ctx, {
      http_status_checked_before_json: true,
      retry_after_respected: true,
      backoff_persisted: true,
      rate_limit_source_attributed: true,
      post_recovery_auth_failure_kind: null,
    });
  };

  const result = await runPlatformRecoveryConvergence(
    { expected_sha: SHA },
    { recoveryStore: store, executors, approvalResolver: happyApprovalResolver },
  );

  assert.equal(result.status, "active");
  assert.equal(result.steps.find((step) => step.key === "local_manager_rate_limit_recovery").status, "pass");
  assert.equal(result.steps.find((step) => step.key === "connector_two_phase_rebind").status, "skipped_not_required");
  assert.equal(calls.includes("connector_two_phase_rebind"), false);
});

test("two-phase rebind rejects revoking the old credential before the new credential probe", async () => {
  const store = makeStore();
  const executors = happyExecutors();
  executors.connector_auth_probe = async (ctx) => pass(ctx, {
    auth_ready: false,
    failure_kind: "credential_invalid",
    authenticated_operation_http_status: 401,
  });
  executors.connector_two_phase_rebind = async (ctx) => mutationPass(ctx, {
    fresh_device_authorization_verified: true,
    pending_credential_created: true,
    local_atomic_install_verified: true,
    new_credential_probe_verified: true,
    old_credential_revoked_after_probe: false,
    old_credential_revoked_before_probe: true,
    credential_material_returned_to_orchestrator: false,
  });

  await assert.rejects(
    runPlatformRecoveryConvergence(
      { expected_sha: SHA },
      { recoveryStore: store, executors, approvalResolver: happyApprovalResolver },
    ),
    (error) => error.code === "PLATFORM_RECOVERY_CONNECTOR_REBIND_INCOMPLETE"
      || error.code === "PLATFORM_RECOVERY_CONNECTOR_REBIND_ORDER_INVALID",
  );
});

test("status action is read-only and does not execute pending stages", async () => {
  const store = makeStore();
  const plan = buildPlatformRecoveryConvergencePlan(SHA);
  const first = await runPlatformRecoveryConvergence(
    { expected_sha: SHA },
    { recoveryStore: store, executors: {} },
  );
  assert.equal(first.status, "awaiting_approval");

  const status = await runPlatformRecoveryConvergence(
    { expected_sha: SHA, run_id: first.run_id, action: "status" },
    { recoveryStore: store, executors: {
      production_identity: async () => {
        throw new Error("status must not execute");
      },
    } },
  );
  assert.equal(status.run_id, first.run_id);
  assert.equal(status.plan_hash, plan.plan_hash);
  assert.equal(status.status, "awaiting_approval");
});


test("server approval resolver is required before any mutation executor is invoked", async () => {
  const store = makeStore();
  const calls = [];
  const executors = happyExecutors({ calls });

  const result = await runPlatformRecoveryConvergence(
    { expected_sha: SHA },
    { recoveryStore: store, executors },
  );

  assert.equal(result.status, "awaiting_approval");
  assert.equal(result.blocking_stage, "governance_baseline_rebuild");
  assert.equal(result.error_code, "platform_recovery_step_approval_required");
  assert.equal(calls.includes("governance_baseline_rebuild"), false);
  assert.equal(result.next_safe_action, "obtain_server_verified_step_bound_approval");
});

test("caller supplied approval is forbidden", async () => {
  const store = makeStore();
  await assert.rejects(
    runPlatformRecoveryConvergence(
      {
        expected_sha: SHA,
        approval: { approval_id: "approval:caller", typed_confirmation: "DO_IT" },
      },
      { recoveryStore: store, executors: happyExecutors(), approvalResolver: happyApprovalResolver },
    ),
    (error) => error.code === "PLATFORM_RECOVERY_INPUT_FIELD_FORBIDDEN",
  );
});

test("server approval must bind exact SHA run plan step and idempotency key", async () => {
  const store = makeStore();
  const calls = [];
  const executors = happyExecutors({ calls });
  const badResolver = async (ctx) => ({
    ...(await happyApprovalResolver(ctx)),
    step_id: "platform-recovery:99:wrong-step",
  });

  await assert.rejects(
    runPlatformRecoveryConvergence(
      { expected_sha: SHA },
      { recoveryStore: store, executors, approvalResolver: badResolver },
    ),
    (error) => error.code === "PLATFORM_RECOVERY_APPROVAL_BINDING_INVALID",
  );
  assert.equal(calls.includes("governance_baseline_rebuild"), false);
});

test("unknown-outcome reconciliation cannot perform a second mutation", async () => {
  const store = makeStore();
  const executors = happyExecutors();
  executors.canonical_grants_apply = {
    execute: async (ctx) => ({
      ...mutationPass(ctx),
      ok: false,
      status: "unknown_outcome",
      request_id: "req-unknown-reconcile-guard",
      error_code: "provider_outcome_unknown",
    }),
    reconcile: async (ctx) => mutationPass(ctx, { reconciled: true }),
  };

  const first = await runPlatformRecoveryConvergence(
    { expected_sha: SHA },
    { recoveryStore: store, executors, approvalResolver: happyApprovalResolver },
  );
  assert.equal(first.status, "unknown_outcome");

  await assert.rejects(
    runPlatformRecoveryConvergence(
      { expected_sha: SHA, run_id: first.run_id, action: "reconcile" },
      { recoveryStore: store, executors, approvalResolver: happyApprovalResolver },
    ),
    (error) => error.code === "PLATFORM_RECOVERY_RECONCILIATION_MUTATION_FORBIDDEN",
  );
});
