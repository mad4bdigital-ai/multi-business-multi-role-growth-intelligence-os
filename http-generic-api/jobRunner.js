import crypto from "node:crypto";
import { jobQueue } from "./queue.js";
import {
  normalizeJobId,
  normalizeJobStatus,
  normalizeWebhookUrl,
  normalizeMaxAttempts,
  nextRetryDelayMs,
  nowIso,
  buildJobId
} from "./jobUtils.js";
import {
  JOB_WEBHOOK_TIMEOUT_MS,
  MAX_TIMEOUT_SECONDS,
  PORT as port
} from "./config.js";
import { githubGitBlobChunkRead } from "./github.js";
import { hostingerSshRuntimeRead as hostingerSshRuntimeReadBase } from "./hostinger.js";
import { resumeValidationJob as resumeValidationJobBase, SOLVER_JOB_TYPE } from "./registryValidationAsyncSolver.js";

function createExecutionTraceId() {
  return `trace_${crypto.randomUUID().replace(/-/g, "")}`;
}

function debugLog(...args) {
  if (String(process.env.EXECUTION_DEBUG || "").trim().toLowerCase() === "true") {
    console.log(...args);
  }
}

// ─── Pure exports (no runtime deps) ─────────────────────────────────────────

export function toJobSummary(job) {
  return {
    job_id: job.job_id,
    job_type: job.job_type,
    status: job.status,
    created_at: job.created_at,
    updated_at: job.updated_at,
    requested_by: job.requested_by,
    target_key: job.target_key,
    parent_action_key: job.parent_action_key,
    endpoint_key: job.endpoint_key,
    route_id: job.route_id || "",
    target_module: job.target_module || "",
    target_workflow: job.target_workflow || "",
    brand_name: job.brand_name || "",
    execution_trace_id: job.execution_trace_id || "",
    attempt_count: job.attempt_count,
    max_attempts: job.max_attempts,
    next_retry_at: job.next_retry_at || null,
    runtime_classification: job.runtime_classification || null,
    recovery: job.recovery || null,
    operator_view: job.operator_view || null,
    activation_status: job.runtime_classification?.activation_status || "",
    status_url: `/jobs/${job.job_id}`,
    result_url: `/jobs/${job.job_id}/result`
  };
}

export function buildWebhookPayload(job) {
  return {
    job_id: job.job_id,
    execution_trace_id: job.execution_trace_id || "",
    status: job.status,
    attempt_count: job.attempt_count,
    max_attempts: job.max_attempts,
    created_at: job.created_at,
    updated_at: job.updated_at,
    completed_at: job.completed_at || null,
    result: job.result_payload || null,
    runtime_classification: job.runtime_classification || null,
    recovery: job.recovery || null,
    operator_view: job.operator_view || null,
    activation_status: job.runtime_classification?.activation_status || "",
    error: job.error_payload || null
  };
}

export function shouldRetryJobFailure(statusCode, payload) {
  const code = String(payload?.error?.code || "").trim().toLowerCase();
  // Misconfiguration errors cannot self-heal through retries.
  if (code === "solver_sheets_client_not_configured") return false;
  if (statusCode === 429) return true;
  if (statusCode >= 500) return true;
  if (code.includes("timeout")) return true;
  if (code === "worker_transport_error") return true;
  return false;
}

export function inferLocalDispatchHttpStatus(result = {}) {
  const explicit = Number(result?.statusCode);
  if (Number.isInteger(explicit) && explicit >= 100 && explicit <= 599) return explicit;
  const code = String(result?.error?.code || "").trim().toLowerCase();
  if (code === "range_not_satisfiable") return 416;
  if (code === "github_blob_not_found") return 404;
  if (code === "missing_github_token") return 500;
  if (code === "github_blob_fetch_failed") return 502;
  if (code === "github_blob_encoding_unsupported") return 502;
  return result?.ok ? 200 : 400;
}

export function createSiteMigrationJobRecord({
  payload, requestedBy, executionTraceId, maxAttempts, webhookUrl, callbackSecret, idempotencyKey
}) {
  const createdAt = nowIso();
  return {
    job_id: buildJobId(),
    job_type: "site_migration",
    status: "queued",
    created_at: createdAt,
    updated_at: createdAt,
    completed_at: "",
    requested_by: requestedBy,
    target_key: String(payload?.destination?.target_key || payload?.source?.target_key || "").trim(),
    parent_action_key: "site_migration_controller",
    endpoint_key: "site_migrate",
    route_id: "site_migration",
    target_module: "wordpress_site_migration",
    target_workflow: "wf_wordpress_site_migration",
    brand_name: String(payload?.destination?.brand || payload?.source?.brand || "").trim(),
    execution_trace_id: executionTraceId,
    request_payload: payload,
    attempt_count: 0,
    max_attempts: normalizeMaxAttempts(maxAttempts),
    result_payload: null,
    error_payload: null,
    next_retry_at: "",
    webhook_url: normalizeWebhookUrl(webhookUrl),
    callback_secret: String(callbackSecret || "").trim(),
    idempotency_key: String(idempotencyKey || "").trim()
  };
}

export async function sendJobWebhook(job) {
  const webhookUrl = normalizeWebhookUrl(job.webhook_url || "");
  if (!webhookUrl) return;

  const payloadObj = buildWebhookPayload(job);
  const payload = JSON.stringify(payloadObj);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const secret = String(job.callback_secret || "").trim();
  const signature = secret
    ? crypto.createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex")
    : "";

  const headers = {
    "Content-Type": "application/json",
    "X-Job-Id": job.job_id,
    "X-Job-Status": job.status,
    "X-Job-Timestamp": timestamp
  };
  if (signature) headers["X-Signature"] = signature;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JOB_WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: payload,
      signal: controller.signal
    });

    if (!response.ok) {
      debugLog("JOB_WEBHOOK_FAILED:", { job_id: job.job_id, webhook_url: webhookUrl, status: response.status });
      return;
    }
    debugLog("JOB_WEBHOOK_SENT:", { job_id: job.job_id, webhook_url: webhookUrl, status: response.status });
  } catch (err) {
    debugLog("JOB_WEBHOOK_FAILED:", { job_id: job.job_id, webhook_url: webhookUrl, message: err?.message || String(err) });
  } finally {
    clearTimeout(timer);
  }
}

export async function executeSameServiceNativeEndpoint({
  method,
  path: relativePath,
  body,
  timeoutSeconds,
  expectJson = true
}) {
  const headers = { "Content-Type": "application/json" };
  if (process.env.BACKEND_API_KEY) headers.Authorization = `Bearer ${process.env.BACKEND_API_KEY}`;

  const bounded = Math.min(Number(timeoutSeconds || MAX_TIMEOUT_SECONDS), MAX_TIMEOUT_SECONDS);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    (Number.isFinite(bounded) && bounded > 0 ? bounded : MAX_TIMEOUT_SECONDS) * 1000 + 5000
  );

  try {
    const response = await fetch(`http://127.0.0.1:${port}${relativePath}`, {
      method,
      headers,
      body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(body ?? {}),
      signal: controller.signal
    });
    const raw = await response.text();
    let parsed;
    if (!raw) {
      parsed = {};
    } else if (expectJson !== false) {
      try { parsed = JSON.parse(raw); }
      catch { parsed = { ok: false, error: { code: "upstream_unparseable_response", message: raw } }; }
    } else {
      parsed = { ok: response.ok, raw };
    }
    return { success: response.ok && (parsed?.ok !== false), statusCode: response.status, payload: parsed };
  } catch (err) {
    const aborted = err?.name === "AbortError";
    return {
      success: false,
      statusCode: aborted ? 504 : 502,
      payload: { ok: false, error: { code: aborted ? "worker_timeout" : "worker_transport_error", message: err?.message || String(err) } }
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function executeJobThroughHttpEndpoint(job) {
  const headers = { "Content-Type": "application/json" };
  if (process.env.BACKEND_API_KEY) headers.Authorization = `Bearer ${process.env.BACKEND_API_KEY}`;

  const timeoutSeconds = Math.min(Number(job.request_payload?.timeout_seconds || 300), MAX_TIMEOUT_SECONDS);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    (Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds : 300) * 1000 + 5000
  );

  try {
    const response = await fetch(`http://127.0.0.1:${port}/http-execute`, {
      method: "POST",
      headers,
      body: JSON.stringify(job.request_payload || {}),
      signal: controller.signal
    });
    const raw = await response.text();
    let parsed = {};
    if (raw) {
      try { parsed = JSON.parse(raw); }
      catch { parsed = { ok: false, error: { code: "upstream_unparseable_response", message: raw } }; }
    }
    return { success: response.ok && parsed?.ok === true, statusCode: response.status, payload: parsed };
  } catch (err) {
    const aborted = err?.name === "AbortError";
    return {
      success: false,
      statusCode: aborted ? 504 : 502,
      payload: { ok: false, error: { code: aborted ? "worker_timeout" : "worker_transport_error", message: err?.message || String(err) } }
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function dispatchEndpointKeyExecution({ endpoint_key, requestPayload }, deps = {}) {
  switch (String(endpoint_key || "").trim()) {
    case "hostinger_ssh_runtime_read":
      return await (deps.hostingerSshRuntimeRead || hostingerSshRuntimeReadBase)({ input: requestPayload || {} });
    case "github_git_blob_chunk_read":
      return await githubGitBlobChunkRead({ input: requestPayload || {} });
    default:
      return null;
  }
}

// ─── Runtime-bound factory ────────────────────────────────────────────────────

export function configureJobRunner(
  { jobRepository, executeSiteMigrationJob, performUniversalServerWriteback, logRetryWriteback },
  deps = {}
) {
  const queueApi = deps.queueApi || jobQueue;
  const resumeValidationJob = deps.resumeValidationJob || resumeValidationJobBase;
  const sheetsClient = deps.sheetsClient || null;

  function getJob(jobId) {
    const id = normalizeJobId(jobId);
    return id ? jobRepository.get(id) : null;
  }

  function updateJob(job, patch = {}) {
    Object.assign(job, patch);
    job.updated_at = nowIso();
    jobRepository.set(job);
    return job;
  }

  async function enqueueJob(jobId) {
    const job = jobRepository.get(jobId);
    if (!job) return;
    try {
      await queueApi.add("execute", job, { jobId: job.job_id, attempts: 1 });
      return { ok: true };
    } catch (err) {
      console.error("ENQUEUE_FAILED:", { job_id: jobId, err: err?.message });
      return {
        ok: false,
        error: {
          code: err?.code || "queue_unavailable",
          message: err?.message || String(err)
        }
      };
    }
  }

  function scheduleJobRetry(job, delayMs) {
    updateJob(job, {
      status: "retrying",
      next_retry_at: new Date(Date.now() + delayMs).toISOString()
    });
    debugLog("JOB_RETRY_SCHEDULED:", {
      job_id: job.job_id, delay_ms: delayMs,
      attempt_count: job.attempt_count, next_retry_at: job.next_retry_at
    });
    const retryData = { ...job, status: "queued", next_retry_at: "" };
    if (!queueApi) {
      console.error("RETRY_ENQUEUE_FAILED:", { job_id: job.job_id, err: "queue_disabled" });
      return;
    }
    queueApi.add("execute", retryData, { delay: delayMs, attempts: 1 })
      .catch(err => console.error("RETRY_ENQUEUE_FAILED:", { job_id: job.job_id, err: err?.message }));
  }

  async function executeQueuedJobByType(job) {
    const jobType = String(job?.job_type || "http_execute").trim();
    if (jobType === "site_migration") return await executeSiteMigrationJob(job);
    if (jobType === SOLVER_JOB_TYPE) {
      if (!sheetsClient) {
        return {
          success: false,
          statusCode: 500,
          payload: { ok: false, error: { code: "solver_sheets_client_not_configured", message: "No Sheets client is configured for this worker. Solver jobs cannot run until a sheetsClient dep is provided to configureJobRunner." } }
        };
      }
      try {
        const result = await resumeValidationJob(job.request_payload, sheetsClient);
        return { success: true, statusCode: 200, payload: result };
      } catch (err) {
        const is429 = err?.code === 429 || err?.status === 429;
        if (is429 && err.resumableContext) {
          return {
            success: false,
            statusCode: 429,
            payload: {
              ok: false,
              resumable_context: err.resumableContext,
              error: { code: "sheets_rate_limited_resumable", message: err?.message || String(err) }
            }
          };
        }
        return {
          success: false,
          statusCode: 500,
          payload: { ok: false, error: { code: "solver_execution_failed", message: err?.message || String(err) } }
        };
      }
    }
    return await executeJobThroughHttpEndpoint(job);
  }

  async function executeSingleQueuedJob(job) {
    if (normalizeJobStatus(job.status) !== "queued") return;
    const queuedExecutionStartedAt = nowIso();
    const execution_trace_id =
      String(job.execution_trace_id || "").trim() || createExecutionTraceId();

    updateJob(job, {
      execution_trace_id,
      status: "running",
      attempt_count: Number(job.attempt_count || 0) + 1,
      next_retry_at: ""
    });

    debugLog("JOB_EXECUTION_STARTED:", {
      job_id: job.job_id, attempt_count: job.attempt_count,
      parent_action_key: job.parent_action_key, endpoint_key: job.endpoint_key
    });

    const outcome = await executeQueuedJobByType(job);
    const success = outcome.success === true;

    if (success) {
      const successPatch = { status: "succeeded", result_payload: outcome.payload || null, error_payload: null, completed_at: nowIso() };
      if (String(job.job_type || "").trim() === SOLVER_JOB_TYPE && outcome.payload?.runtime_classification) {
        successPatch.runtime_classification = outcome.payload.runtime_classification;
      }
      updateJob(job, successPatch);
      await performUniversalServerWriteback({
        mode: "async", job_id: job.job_id, target_key: job.target_key,
        parent_action_key: job.parent_action_key, endpoint_key: job.endpoint_key,
        route_id: job.route_id, target_module: job.target_module, target_workflow: job.target_workflow,
        source_layer: "http_client_backend", entry_type: "async_job", execution_class: "async",
        attempt_count: job.attempt_count, status_source: job.status, responseBody: job.result_payload,
        error_code: job.result_payload?.error?.code, error_message_short: job.result_payload?.error?.message,
        http_status: outcome.statusCode, brand_name: job.brand_name, execution_trace_id,
        started_at: queuedExecutionStartedAt
      });
      await sendJobWebhook(job);
      return;
    }

    updateJob(job, {
      result_payload: null,
      error_payload: outcome.payload || { ok: false, error: { code: "job_execution_failed", message: "Background execution failed." } }
    });

    const retryable = shouldRetryJobFailure(outcome.statusCode, job.error_payload);
    const canRetry = retryable && Number(job.attempt_count || 0) < Number(job.max_attempts || 1);

    if (canRetry) {
      if (String(job.job_type || "").trim() === SOLVER_JOB_TYPE && job.error_payload?.resumable_context) {
        job.request_payload = { ...job.request_payload, validation_context: job.error_payload.resumable_context };
      }
      await logRetryWriteback({
        job_id: job.job_id, target_key: job.target_key,
        parent_action_key: job.parent_action_key, endpoint_key: job.endpoint_key,
        route_id: job.route_id, target_module: job.target_module, target_workflow: job.target_workflow,
        attempt_count: job.attempt_count, responseBody: job.error_payload,
        error_code: job.error_payload?.error?.code, error_message_short: job.error_payload?.error?.message,
        http_status: outcome.statusCode, brand_name: job.brand_name, execution_trace_id,
        started_at: queuedExecutionStartedAt
      });
      scheduleJobRetry(job, nextRetryDelayMs(job.attempt_count));
      return;
    }

    updateJob(job, { status: "failed", completed_at: nowIso() });
    await performUniversalServerWriteback({
      mode: "async", job_id: job.job_id, target_key: job.target_key,
      parent_action_key: job.parent_action_key, endpoint_key: job.endpoint_key,
      route_id: job.route_id, target_module: job.target_module, target_workflow: job.target_workflow,
      source_layer: "http_client_backend", entry_type: "async_job", execution_class: "async",
      attempt_count: job.attempt_count, status_source: job.status, responseBody: job.error_payload,
      error_code: job.error_payload?.error?.code, error_message_short: job.error_payload?.error?.message,
      http_status: outcome.statusCode, brand_name: job.brand_name, execution_trace_id,
      started_at: queuedExecutionStartedAt
    });
    await sendJobWebhook(job);
  }

  return { getJob, updateJob, enqueueJob, scheduleJobRetry, executeQueuedJobByType, executeSingleQueuedJob };
}
