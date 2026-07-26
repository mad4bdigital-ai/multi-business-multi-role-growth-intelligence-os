/**
 * Unit tests for jobRunner queue behavior
 * Run: node test-job-runner.mjs
 */

import {
  configureJobRunner,
  executeJobThroughHttpEndpoint
} from "./jobRunner.js";
import { DATABASE_LIFECYCLE_SCHEDULER_SNAPSHOT_JOB_TYPE } from "./databaseTableLifecycle.js";
import { HOSTINGER_SSH_TARGET_PROBE_JOB_TYPE } from "./hostingerSshDeployExecutor.js";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n── ${name}`);
}

function createJobRepository(seedJob) {
  const store = new Map([[seedJob.job_id, { ...seedJob }]]);
  return {
    get(jobId) {
      return store.get(String(jobId || "").trim()) || null;
    },
    set(job) {
      store.set(job.job_id, job);
      return job;
    }
  };
}

const baseJob = {
  job_id: "job_123",
  status: "queued",
  attempt_count: 0,
  max_attempts: 1,
  request_payload: {},
  parent_action_key: "site_migration_controller",
  endpoint_key: "site_migrate"
};

section("jobRunner — enqueueJob");

{
  const calls = [];
  const runner = configureJobRunner(
    {
      jobRepository: createJobRepository(baseJob),
      async executeSiteMigrationJob() {
        return { success: true, statusCode: 200, payload: { ok: true } };
      },
      async performUniversalServerWriteback() {},
      async logRetryWriteback() {}
    },
    {
      queueApi: {
        async add(name, job, opts) {
          calls.push({ name, job, opts });
          return { id: "bull_1" };
        }
      }
    }
  );

  const result = await runner.enqueueJob(baseJob.job_id);
  assert("enqueueJob reports success", result?.ok === true, JSON.stringify(result));
  assert("enqueueJob calls queue with execute job name", calls[0]?.name === "execute", JSON.stringify(calls[0]));
  assert("enqueueJob forwards stable BullMQ options", calls[0]?.opts?.jobId === baseJob.job_id && calls[0]?.opts?.attempts === 1, JSON.stringify(calls[0]?.opts));
}

{
  const err = new Error("Redis unavailable");
  err.code = "ECONNREFUSED";

  const runner = configureJobRunner(
    {
      jobRepository: createJobRepository(baseJob),
      async executeSiteMigrationJob() {
        return { success: true, statusCode: 200, payload: { ok: true } };
      },
      async performUniversalServerWriteback() {},
      async logRetryWriteback() {}
    },
    {
      queueApi: {
        async add() {
          throw err;
        }
      }
    }
  );

  const result = await runner.enqueueJob(baseJob.job_id);
  assert("enqueueJob reports queue failure", result?.ok === false, JSON.stringify(result));
  assert("enqueueJob preserves queue error code", result?.error?.code === "ECONNREFUSED", JSON.stringify(result));
  assert("enqueueJob preserves queue error message", result?.error?.message === "Redis unavailable", JSON.stringify(result));
}

section("jobRunner — Hostinger SSH probe job dispatch");

{
  const probeJob = {
    job_id: "job_hostinger_probe_1",
    job_type: HOSTINGER_SSH_TARGET_PROBE_JOB_TYPE,
    status: "queued",
    attempt_count: 0,
    max_attempts: 1,
    request_payload: {
      target_id: "target-hostinger",
      app_key: "auth.mad4b.com",
      app_path: "/home/u338416126/domains/auth.mad4b.com/nodejs",
      expected_commit_sha: "8b86c9498b5d327ca51025dbe60a28c85c8dea39",
      ssh_auth_mode: "password",
      activate_on_success: true,
      approval_reason: "approved read-only Hostinger SSH probe queue worker test",
      timeout_ms: 120000,
      secrets_included: false,
    },
    parent_action_key: "remote_runtime_hostinger_ssh_probe_worker",
    endpoint_key: "remote_runtime_hostinger_ssh_probe",
    target_key: "target-hostinger",
    route_id: "remote_runtime_hostinger_ssh_probe_queue_worker",
    target_module: "remote_runtime",
    target_workflow: "wf_hostinger_ssh_target_probe_queue_worker",
    brand_name: "",
    execution_trace_id: "",
  };
  const calls = [];
  const runner = configureJobRunner(
    {
      jobRepository: createJobRepository(probeJob),
      async executeSiteMigrationJob() { return { success: false, statusCode: 500, payload: { ok: false } }; },
      async performUniversalServerWriteback(payload) { calls.push({ type: "writeback", payload }); },
      async logRetryWriteback() {}
    },
    {
      async runHostingerSshTargetProbeJob(payload) {
        calls.push({ type: "probe", payload });
        return { ok: true, probe: { ok: true }, execution: { executed: true, readonly_probe_only: true, target_activated: true }, secrets_included: false };
      }
    }
  );
  await runner.executeSingleQueuedJob(probeJob);
  assert("Hostinger probe job invokes worker runner", calls.some(call => call.type === "probe"), JSON.stringify(calls));
  assert("Hostinger probe job succeeds", probeJob.status === "succeeded", probeJob.status);
  assert("Hostinger probe job returns no secrets", probeJob.result_payload?.secrets_included === false, JSON.stringify(probeJob.result_payload));
}

section("jobRunner — stuck Hostinger probe job times out and fails safely");

{
  const stuckProbeJob = {
    job_id: "job_hostinger_probe_stuck",
    job_type: HOSTINGER_SSH_TARGET_PROBE_JOB_TYPE,
    status: "queued",
    attempt_count: 0,
    max_attempts: 1,
    request_payload: {
      target_id: "target-hostinger",
      app_key: "auth.mad4b.com",
      app_path: "/home/u338416126/domains/auth.mad4b.com/nodejs",
      expected_commit_sha: "8b86c9498b5d327ca51025dbe60a28c85c8dea39",
      ssh_auth_mode: "password",
      activate_on_success: true,
      approval_reason: "approved read-only Hostinger SSH probe timeout guard test",
      timeout_ms: 120000,
      secrets_included: false,
    },
    parent_action_key: "remote_runtime_hostinger_ssh_probe_worker",
    endpoint_key: "remote_runtime_hostinger_ssh_probe",
    target_key: "target-hostinger",
    route_id: "remote_runtime_hostinger_ssh_probe_queue_worker",
    target_module: "remote_runtime",
    target_workflow: "wf_hostinger_ssh_target_probe_queue_worker",
    brand_name: "",
    execution_trace_id: "",
  };
  const calls = [];
  const runner = configureJobRunner(
    {
      jobRepository: createJobRepository(stuckProbeJob),
      async executeSiteMigrationJob() { return { success: false, statusCode: 500, payload: { ok: false } }; },
      async performUniversalServerWriteback(payload) { calls.push({ type: "writeback", payload }); },
      async logRetryWriteback() {}
    },
    {
      jobExecutionTimeoutMs: 25,
      async runHostingerSshTargetProbeJob() {
        return await new Promise(() => {});
      }
    }
  );
  await runner.executeSingleQueuedJob(stuckProbeJob);
  assert("stuck Hostinger probe job fails", stuckProbeJob.status === "failed", stuckProbeJob.status);
  assert("stuck Hostinger probe job has stale timeout code", stuckProbeJob.error_payload?.error?.code === "job_execution_stale_timeout", JSON.stringify(stuckProbeJob.error_payload));
  assert("stuck Hostinger probe job returns no secrets", stuckProbeJob.error_payload?.secrets_included === false, JSON.stringify(stuckProbeJob.error_payload));
  assert("stuck Hostinger probe writes async failure evidence", calls.some(call => call.type === "writeback"), JSON.stringify(calls));
}

section("jobRunner — solver with null sheetsClient fails fast (no retries)");

{
  const lifecycleJob = {
    job_id: "job_lifecycle_snapshot",
    job_type: DATABASE_LIFECYCLE_SCHEDULER_SNAPSHOT_JOB_TYPE,
    status: "queued",
    attempt_count: 0,
    max_attempts: 1,
    request_payload: { schedule_key: "database_lifecycle_retention_plan_weekly", summary_only: true },
    parent_action_key: "database_lifecycle_scheduler",
    endpoint_key: "database_lifecycle_report_snapshot",
    target_key: "database_lifecycle_retention_plan_weekly",
    route_id: "database_lifecycle_scheduler_snapshot_runner",
    target_module: "database_lifecycle",
    target_workflow: "wf_database_lifecycle_report_snapshot",
    brand_name: "",
    execution_trace_id: ""
  };
  const lifecycleCalls = [];
  const lifecycleRunner = configureJobRunner(
    {
      jobRepository: createJobRepository(lifecycleJob),
      async executeSiteMigrationJob() {
        return { success: false, statusCode: 500, payload: { ok: false } };
      },
      async performUniversalServerWriteback(payload) {
        lifecycleCalls.push({ type: "writeback", payload });
      },
      async logRetryWriteback() {}
    },
    {
      async runDatabaseLifecycleSchedulerSnapshot(payload) {
        lifecycleCalls.push({ type: "runner", payload });
        return { ok: true, mode: "dry_run", dry_run: true, will_write: false, secrets_included: false };
      }
    }
  );
  await lifecycleRunner.executeSingleQueuedJob(lifecycleJob);
  assert("lifecycle snapshot job invokes governed runner", lifecycleCalls.some(call => call.type === "runner"), JSON.stringify(lifecycleCalls));
  assert("lifecycle snapshot job succeeds", lifecycleJob.status === "succeeded", JSON.stringify(lifecycleJob));
  assert("lifecycle snapshot job writes async evidence", lifecycleCalls.some(call => call.type === "writeback"), JSON.stringify(lifecycleCalls));
}

section("jobRunner - solver with null sheetsClient fails fast (no retries)");

{
  const solverJob0 = {
    job_id: "job_solver_0",
    job_type: "registry_validation_async_solver",
    status: "queued",
    attempt_count: 0,
    max_attempts: 3,
    request_payload: { job_type: "registry_validation_async_solver", validation_context: { activation_id: "act_000", pending_reads: [], completed_stages: [] } },
    parent_action_key: "registry_validation_solver",
    endpoint_key: "resume_validation",
    target_key: "", route_id: "", target_module: "", target_workflow: "", brand_name: "", execution_trace_id: ""
  };

  const runner0 = configureJobRunner(
    {
      jobRepository: createJobRepository(solverJob0),
      async executeSiteMigrationJob() { return { success: false, statusCode: 500, payload: { ok: false } }; },
      async performUniversalServerWriteback() {},
      async logRetryWriteback() {}
    },
    {
      queueApi: { async add() { return { id: "bull_0" }; } }
      // No resumeValidationJob → uses base; no sheetsClient → null
    }
  );

  await runner0.executeSingleQueuedJob(solverJob0);
  assert("null sheetsClient → job failed (not retrying)", solverJob0.status === "failed", solverJob0.status);
  assert("null sheetsClient → error code is actionable", solverJob0.error_payload?.error?.code === "solver_sheets_client_not_configured", JSON.stringify(solverJob0.error_payload?.error?.code));
}

section("jobRunner — solver dispatch → alignment pass → active");

{
  const solverJob = {
    job_id: "job_solver_1",
    job_type: "registry_validation_async_solver",
    status: "queued",
    attempt_count: 0,
    max_attempts: 3,
    request_payload: {
      job_type: "registry_validation_async_solver",
      validation_context: {
        activation_id: "act_123",
        spreadsheet_id: "sheet_abc",
        auth: {},
        pending_reads: ["Sheet1!A1:D10"],
        completed_stages: ["drive_validation"],
        retry_count: 0
      }
    },
    parent_action_key: "registry_validation_solver",
    endpoint_key: "resume_validation",
    target_key: "", route_id: "", target_module: "", target_workflow: "", brand_name: "", execution_trace_id: ""
  };

  let capturedPayload = null;
  const runner = configureJobRunner(
    {
      jobRepository: createJobRepository(solverJob),
      async executeSiteMigrationJob() { return { success: false, statusCode: 500, payload: { ok: false } }; },
      async performUniversalServerWriteback() {},
      async logRetryWriteback() {}
    },
    {
      queueApi: { async add() { return { id: "bull_2" }; } },
      sheetsClient: {},
      resumeValidationJob: async (jobPayload) => {
        capturedPayload = jobPayload;
        return {
          status: "active",
          runtime_classification: { activation_status: "active", reason_code: "provider_chain_complete" },
          alignment_audit: {},
          alignment_validation: { valid: true },
          activation_id: "act_123",
          completed_stages: ["drive_validation", "sheets_validation"]
        };
      }
    }
  );

  await runner.executeSingleQueuedJob(solverJob);
  assert("solver dispatch — resumeValidationJob called with request_payload", capturedPayload?.validation_context?.activation_id === "act_123", JSON.stringify(capturedPayload));
  assert("solver dispatch — alignment pass → job succeeded", solverJob.status === "succeeded", solverJob.status);
  assert("solver dispatch — runtime_classification hoisted to job", solverJob.runtime_classification?.activation_status === "active", JSON.stringify(solverJob.runtime_classification));
}

section("jobRunner — solver alignment failure → degraded");

{
  const solverJob2 = {
    job_id: "job_solver_2",
    job_type: "registry_validation_async_solver",
    status: "queued",
    attempt_count: 0,
    max_attempts: 3,
    request_payload: {
      job_type: "registry_validation_async_solver",
      validation_context: {
        activation_id: "act_456",
        spreadsheet_id: "sheet_def",
        auth: {},
        pending_reads: ["Sheet1!A1:D10"],
        completed_stages: [],
        retry_count: 0
      }
    },
    parent_action_key: "registry_validation_solver",
    endpoint_key: "resume_validation",
    target_key: "", route_id: "", target_module: "", target_workflow: "", brand_name: "", execution_trace_id: ""
  };

  const runner2 = configureJobRunner(
    {
      jobRepository: createJobRepository(solverJob2),
      async executeSiteMigrationJob() { return { success: false, statusCode: 500, payload: { ok: false } }; },
      async performUniversalServerWriteback() {},
      async logRetryWriteback() {}
    },
    {
      queueApi: { async add() { return { id: "bull_3" }; } },
      sheetsClient: {},
      resumeValidationJob: async () => ({
        status: "degraded",
        runtime_classification: { activation_status: "degraded", reason_code: "executable_binding_mismatch" },
        alignment_audit: {},
        alignment_validation: { valid: false },
        activation_id: "act_456",
        completed_stages: []
      })
    }
  );

  await runner2.executeSingleQueuedJob(solverJob2);
  assert("solver alignment fail → job succeeded (non-error return)", solverJob2.status === "succeeded", solverJob2.status);
  assert("solver alignment fail → runtime_classification degraded", solverJob2.runtime_classification?.activation_status === "degraded", JSON.stringify(solverJob2.runtime_classification));
}

section("jobRunner — solver Sheets 429 → retry with resumable context preserved");

{
  const resumableCtx = {
    activation_id: "act_789",
    spreadsheet_id: "sheet_ghi",
    auth: {},
    pending_reads: ["Sheet2!A1:B5"],
    completed_stages: [],
    retry_count: 1
  };

  const solverJob3 = {
    job_id: "job_solver_3",
    job_type: "registry_validation_async_solver",
    status: "queued",
    attempt_count: 0,
    max_attempts: 3,
    request_payload: {
      job_type: "registry_validation_async_solver",
      validation_context: {
        activation_id: "act_789",
        spreadsheet_id: "sheet_ghi",
        auth: {},
        pending_reads: ["Sheet1!A1:D10", "Sheet2!A1:B5"],
        completed_stages: [],
        retry_count: 0
      }
    },
    parent_action_key: "registry_validation_solver",
    endpoint_key: "resume_validation",
    target_key: "", route_id: "", target_module: "", target_workflow: "", brand_name: "", execution_trace_id: ""
  };

  const retryAdds = [];
  const runner3 = configureJobRunner(
    {
      jobRepository: createJobRepository(solverJob3),
      async executeSiteMigrationJob() { return { success: false, statusCode: 500, payload: { ok: false } }; },
      async performUniversalServerWriteback() {},
      async logRetryWriteback() {}
    },
    {
      queueApi: { async add(name, job, opts) { retryAdds.push({ name, job, opts }); return { id: "bull_4" }; } },
      sheetsClient: {},
      resumeValidationJob: async () => {
        const err = new Error("Sheets rate limited");
        err.code = 429;
        err.resumableContext = resumableCtx;
        throw err;
      }
    }
  );

  await runner3.executeSingleQueuedJob(solverJob3);
  assert("solver 429 → job status retrying", solverJob3.status === "retrying", solverJob3.status);
  assert("solver 429 → retry enqueued", retryAdds.length >= 1, JSON.stringify(retryAdds.map(r => r.name)));
  assert("solver 429 → request_payload updated with resumable pending_reads", solverJob3.request_payload?.validation_context?.pending_reads?.[0] === "Sheet2!A1:B5", JSON.stringify(solverJob3.request_payload?.validation_context));
  assert("solver 429 → resumable retry_count preserved", solverJob3.request_payload?.validation_context?.retry_count === 1, JSON.stringify(solverJob3.request_payload?.validation_context?.retry_count));
}

console.log(`\n${"─".repeat(50)}`);
section("jobRunner - worker timeout includes diagnostic details");

{
  const originalFetch = globalThis.fetch;
  const abortErr = new Error("This operation was aborted");
  abortErr.name = "AbortError";
  globalThis.fetch = async () => {
    throw abortErr;
  };

  try {
    const result = await executeJobThroughHttpEndpoint({
      job_id: "job_timeout_1",
      parent_action_key: "google_sheets_api",
      endpoint_key: "getSheetValues",
      target_key: "activation_bootstrap",
      request_payload: { timeout_seconds: 12 }
    });

    assert("worker timeout returns 504", result.statusCode === 504, JSON.stringify(result));
    assert("worker timeout code preserved", result.payload?.error?.code === "worker_timeout", JSON.stringify(result.payload));
    assert("worker timeout has job id detail", result.payload?.error?.details?.job_id === "job_timeout_1", JSON.stringify(result.payload?.error?.details));
    assert("worker timeout has endpoint detail", result.payload?.error?.details?.endpoint_key === "getSheetValues", JSON.stringify(result.payload?.error?.details));
    assert("worker timeout has timeout seconds", result.payload?.error?.details?.timeout_seconds === 12, JSON.stringify(result.payload?.error?.details));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log("ALL JOB RUNNER TESTS PASS ✓");
  process.exit(0);
} else {
  console.error(`${failed} TEST(S) FAILED`);
  process.exit(1);
}
