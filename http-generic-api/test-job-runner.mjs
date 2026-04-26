/**
 * Unit tests for jobRunner queue behavior
 * Run: node test-job-runner.mjs
 */

import { configureJobRunner } from "./jobRunner.js";

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

section("jobRunner — solver with null sheetsClient fails fast (no retries)");

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
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log("ALL JOB RUNNER TESTS PASS ✓");
  process.exit(0);
} else {
  console.error(`${failed} TEST(S) FAILED`);
  process.exit(1);
}
