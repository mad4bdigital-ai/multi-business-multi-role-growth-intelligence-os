import {
  DATABASE_LIFECYCLE_SCHEDULER_SNAPSHOT_JOB_TYPE,
  DEFAULT_DATABASE_LIFECYCLE_SNAPSHOT_BINDING_KEY,
  DEFAULT_DATABASE_LIFECYCLE_SNAPSHOT_SCHEDULE_KEY,
} from "./databaseTableLifecycle.js";
import { CONNECTED_EXECUTION_RESUME_ACTION_JOB_TYPE } from "./connectedExecutionWorker.js";
import { TENANT_SSH_CLI_EXECUTE_JOB_TYPE } from "./tenantSshCliExecutionWorker.js";
import { buildStaleJobTimeoutPayload, isRunningJobStale } from "./jobUtils.js";
import {
  HOSTINGER_SSH_TARGET_PROBE_JOB_TYPE,
  normalizeHostingerSshTargetProbeJobPayload,
  validateHostingerSshTargetProbeJobPayload,
} from "./hostingerSshDeployExecutor.js";
import {
  HOSTINGER_SSH_PROBE_RUNNER_MODES,
  describeHostingerSshProbeRunnerMode,
  normalizeHostingerSshProbeRunnerMode,
  startDetachedHostingerSshProbeRunner,
} from "./hostingerSshProbeRunnerModes.js";

export async function submitSiteMigrationJob(reqBody, requestedBy, idempotencyKey, deps = {}) {
  const {
    normalizeSiteMigrationPayload,
    validateSiteMigrationPayload,
    makeIdempotencyLookupKey,
    idempotencyRepository,
    getJob,
    getJobFromRedis,
    toJobSummary,
    createExecutionTraceId,
    createSiteMigrationJobRecord,
    jobRepository,
    enqueueJob,
    failAsyncSubmission
  } = deps;

  const body = reqBody && typeof reqBody === "object" ? reqBody : {};
  const payload = normalizeSiteMigrationPayload(body);
  const validation = validateSiteMigrationPayload(payload);

  if (validation.errors.length) {
    return {
      status: 400,
      body: {
        ok: false,
        error: {
          code: "invalid_site_migration_request",
          message: "Invalid site migration payload.",
          details: { errors: validation.errors }
        }
      }
    };
  }

  const idempotencyLookupKey = makeIdempotencyLookupKey(requestedBy, idempotencyKey);

  if (idempotencyLookupKey && await idempotencyRepository.has(idempotencyLookupKey)) {
    const existingJobId = await idempotencyRepository.get(idempotencyLookupKey);
    const existingJob = getJob(existingJobId) || await getJobFromRedis(existingJobId);
    if (existingJob) {
      return { status: 200, body: { ...toJobSummary(existingJob), deduplicated: true } };
    }
    await idempotencyRepository.delete(idempotencyLookupKey);
  }

  const execution_trace_id =
    String(body.execution_trace_id || "").trim() || createExecutionTraceId();

  const job = createSiteMigrationJobRecord({
    payload: {
      ...payload,
      execution_trace_id
    },
    requestedBy,
    executionTraceId: execution_trace_id,
    maxAttempts: body.max_attempts,
    webhookUrl: body.webhook_url,
    callbackSecret: body.callback_secret,
    idempotencyKey
  });

  await jobRepository.set(job);
  if (idempotencyLookupKey) {
    await idempotencyRepository.set(idempotencyLookupKey, job.job_id);
  }

  const enqueueResult = await enqueueJob(job.job_id);
  if (!enqueueResult?.ok) {
    const failure = await failAsyncSubmission(jobRepository, idempotencyRepository, job, enqueueResult?.error, idempotencyLookupKey);
    return { status: 503, body: failure };
  }

  return {
    status: 202,
    body: {
      ...toJobSummary(job),
      runtime_classification: job.runtime_classification || null,
      recovery: job.recovery || null,
      operator_view: job.operator_view || null,
      route: "/site-migrate",
      execution_class: "migration"
    }
  };
}

export async function submitGenericExecutionJob(reqBody, requestedBy, idempotencyKey, deps = {}) {
  const {
    normalizeSiteMigrationPayload,
    validateSiteMigrationPayload,
    buildExecutionPayloadFromJobRequest,
    validateAsyncJobRequest,
    normalizeWebhookUrl,
    makeIdempotencyLookupKey,
    idempotencyRepository,
    getJob,
    getJobFromRedis,
    toJobSummary,
    nowIso,
    createExecutionTraceId,
    buildJobId,
    normalizeMaxAttempts,
    jobRepository,
    debugLog,
    enqueueJob,
    failAsyncSubmission
  } = deps;

  const body = reqBody && typeof reqBody === "object" ? reqBody : {};
  const hasNestedRequestPayload =
    body.request_payload &&
    typeof body.request_payload === "object" &&
    !Array.isArray(body.request_payload);

  const topLevelExecutionFields = [
    "target_key",
    "brand",
    "brand_domain",
    "provider_domain",
    "parent_action_key",
    "endpoint_key",
    "method",
    "path",
    "path_params",
    "query",
    "headers",
    "body",
    "expect_json",
    "timeout_seconds",
    "readback",
    "force_refresh"
  ];

  const hasTopLevelExecutionFields = topLevelExecutionFields.some(
    key => body[key] !== undefined
  );

  if (hasNestedRequestPayload && hasTopLevelExecutionFields) {
    return {
      status: 400,
      body: {
        ok: false,
        error: {
          code: "invalid_job_request",
          message: "Job request is invalid.",
          details: {
            errors: [
              "Provide either request_payload or top-level execution fields, not both."
            ]
          }
        }
      }
    };
  }

  const requestPayload = buildExecutionPayloadFromJobRequest(body);
  const requestedJobType = String(body.job_type || "http_execute").trim() || "http_execute";
  const validationErrors =
    requestedJobType === "site_migration"
      ? validateSiteMigrationPayload(normalizeSiteMigrationPayload(requestPayload)).errors
      : requestedJobType === DATABASE_LIFECYCLE_SCHEDULER_SNAPSHOT_JOB_TYPE
      ? []
      : requestedJobType === CONNECTED_EXECUTION_RESUME_ACTION_JOB_TYPE
      ? []
      : requestedJobType === TENANT_SSH_CLI_EXECUTE_JOB_TYPE
      ? []
      : requestedJobType === HOSTINGER_SSH_TARGET_PROBE_JOB_TYPE
      ? validateHostingerSshTargetProbeJobPayload(requestPayload)
      : validateAsyncJobRequest(requestPayload);

  if (body.max_attempts !== undefined) {
    const maxAttempts = Number(body.max_attempts);
    if (!Number.isFinite(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
      validationErrors.push("max_attempts must be an integer between 1 and 10 when provided.");
    }
  }

  if (body.webhook_url !== undefined) {
    const normalizedWebhookUrl = normalizeWebhookUrl(body.webhook_url);
    if (String(body.webhook_url || "").trim() && !normalizedWebhookUrl) {
      validationErrors.push("webhook_url must be a valid http or https URL when provided.");
    }
    // GAP 13: webhook domain governance — reject if domain is not on the allowlist.
    if (normalizedWebhookUrl && Array.isArray(deps.webhookAllowedDomains) && deps.webhookAllowedDomains.length) {
      try {
        const { hostname } = new URL(normalizedWebhookUrl);
        const allowed = deps.webhookAllowedDomains.some(
          pattern => hostname === pattern || hostname.endsWith(`.${pattern}`)
        );
        if (!allowed) {
          validationErrors.push(`webhook_url domain '${hostname}' is not on the governed webhook domain allowlist.`);
        }
      } catch {
        validationErrors.push("webhook_url could not be parsed for domain governance check.");
      }
    }
  }

  if (body.callback_secret !== undefined && typeof body.callback_secret !== "string") {
    validationErrors.push("callback_secret must be a string when provided.");
  }

  if (body.idempotency_key !== undefined && typeof body.idempotency_key !== "string") {
    validationErrors.push("idempotency_key must be a string when provided.");
  }

  if (body.job_type !== undefined && typeof body.job_type !== "string") {
    validationErrors.push("job_type must be a string when provided.");
  }

  if (validationErrors.length) {
    return {
      status: 400,
      body: {
        ok: false,
        error: {
          code: "invalid_job_request",
          message: "Job request is invalid.",
          details: { errors: validationErrors }
        }
      }
    };
  }

  const idempotencyLookupKey = makeIdempotencyLookupKey(requestedBy, idempotencyKey);

  if (idempotencyLookupKey && await idempotencyRepository.has(idempotencyLookupKey)) {
    const existingJobId = await idempotencyRepository.get(idempotencyLookupKey);
    const existingJob = getJob(existingJobId) || await getJobFromRedis(existingJobId);
    if (existingJob) {
      return { status: 200, body: { ...toJobSummary(existingJob), deduplicated: true } };
    }
    await idempotencyRepository.delete(idempotencyLookupKey);
  }

  const createdAt = nowIso();
  const inboundExecutionTraceId = String(
    requestPayload.execution_trace_id || body.execution_trace_id || ""
  ).trim();
  const execution_trace_id = inboundExecutionTraceId || createExecutionTraceId();
  requestPayload.execution_trace_id = execution_trace_id;
  const normalizedJobType = String(body.job_type || "http_execute").trim() || "http_execute";
  const normalizedSiteMigrationPayload =
    normalizedJobType === "site_migration"
      ? normalizeSiteMigrationPayload(requestPayload)
      : null;
  const isDatabaseLifecycleSnapshotJob = normalizedJobType === DATABASE_LIFECYCLE_SCHEDULER_SNAPSHOT_JOB_TYPE;
  const isConnectedExecutionResumeActionJob = normalizedJobType === CONNECTED_EXECUTION_RESUME_ACTION_JOB_TYPE;
  const isTenantSshCliExecuteJob = normalizedJobType === TENANT_SSH_CLI_EXECUTE_JOB_TYPE;
  const isHostingerSshTargetProbeJob = normalizedJobType === HOSTINGER_SSH_TARGET_PROBE_JOB_TYPE;
  const databaseLifecycleSnapshotPayload = isDatabaseLifecycleSnapshotJob
    ? {
        ...requestPayload,
        schedule_key: String(requestPayload.schedule_key || DEFAULT_DATABASE_LIFECYCLE_SNAPSHOT_SCHEDULE_KEY).trim(),
        binding_key: String(requestPayload.binding_key || DEFAULT_DATABASE_LIFECYCLE_SNAPSHOT_BINDING_KEY).trim(),
        summary_only: requestPayload.summary_only !== false,
      }
    : null;
  const connectedExecutionResumeActionPayload = isConnectedExecutionResumeActionJob
    ? {
        ...requestPayload,
        connected_session_id: String(requestPayload.connected_session_id || "").trim(),
        resume_action_id: String(requestPayload.resume_action_id || "").trim(),
        dry_run: true,
      }
    : null;
  const tenantSshCliExecutePayload = isTenantSshCliExecuteJob
    ? {
        connection_id: String(requestPayload.connection_id || "").trim(),
        approval_request_id: String(requestPayload.approval_request_id || "").trim(),
        command_key: String(requestPayload.command_key || "").trim(),
        tenant_id: String(requestPayload.tenant_id || "").trim(),
        user_id: String(requestPayload.user_id || "").trim(),
        timeout_ms: requestPayload.timeout_ms,
        secrets_included: false,
      }
    : null;
  const hostingerSshTargetProbePayload = isHostingerSshTargetProbeJob
    ? normalizeHostingerSshTargetProbeJobPayload(requestPayload)
    : null;

  const job = {
    job_id: buildJobId(),
    job_type: normalizedJobType,
    status: "queued",
    created_at: createdAt,
    updated_at: createdAt,
    completed_at: "",
    requested_by: requestedBy,
    target_key:
      normalizedJobType === "site_migration"
        ? String(
            normalizedSiteMigrationPayload?.destination?.target_key ||
              normalizedSiteMigrationPayload?.source?.target_key ||
              ""
          ).trim()
        : isDatabaseLifecycleSnapshotJob
        ? String(databaseLifecycleSnapshotPayload.schedule_key || DEFAULT_DATABASE_LIFECYCLE_SNAPSHOT_SCHEDULE_KEY).trim()
        : isConnectedExecutionResumeActionJob
        ? String(connectedExecutionResumeActionPayload.connected_session_id || "").trim()
        : isTenantSshCliExecuteJob
        ? String(tenantSshCliExecutePayload.connection_id || "").trim()
        : isHostingerSshTargetProbeJob
        ? String(hostingerSshTargetProbePayload.target_id || "").trim()
        : String(requestPayload.target_key || "").trim(),
    parent_action_key:
      normalizedJobType === "site_migration"
        ? "site_migration_controller"
        : isDatabaseLifecycleSnapshotJob
        ? "database_lifecycle_scheduler"
        : isConnectedExecutionResumeActionJob
        ? "connected_execution_worker"
        : isTenantSshCliExecuteJob
        ? "tenant_ssh_cli_worker"
        : isHostingerSshTargetProbeJob
        ? "remote_runtime_hostinger_ssh_probe_worker"
        : String(requestPayload.parent_action_key || "").trim(),
    endpoint_key:
      normalizedJobType === "site_migration"
        ? "site_migrate"
        : isDatabaseLifecycleSnapshotJob
        ? "database_lifecycle_report_snapshot"
        : isConnectedExecutionResumeActionJob
        ? "connected_execution_resume_action"
        : isTenantSshCliExecuteJob
        ? "tenant_ssh_cli_allowlisted_execute"
        : isHostingerSshTargetProbeJob
        ? "remote_runtime_hostinger_ssh_probe"
        : String(requestPayload.endpoint_key || "").trim(),
    route_id:
      normalizedJobType === "site_migration"
        ? "site_migration"
        : isDatabaseLifecycleSnapshotJob
        ? "database_lifecycle_scheduler_snapshot_runner"
        : isConnectedExecutionResumeActionJob
        ? "connected_execution_resume_action_worker_bridge"
        : isTenantSshCliExecuteJob
        ? "tenant_ssh_cli_dedicated_worker_runtime"
        : isHostingerSshTargetProbeJob
        ? "remote_runtime_hostinger_ssh_probe_queue_worker"
        : String(requestPayload.route_id || "").trim(),
    target_module:
      normalizedJobType === "site_migration"
        ? "wordpress_site_migration"
        : isDatabaseLifecycleSnapshotJob
        ? "database_lifecycle"
        : isConnectedExecutionResumeActionJob
        ? "connected_execution"
        : isTenantSshCliExecuteJob
        ? "tenant_infrastructure"
        : isHostingerSshTargetProbeJob
        ? "remote_runtime"
        : String(requestPayload.target_module || "").trim(),
    target_workflow:
      normalizedJobType === "site_migration"
        ? "wf_wordpress_site_migration"
        : isDatabaseLifecycleSnapshotJob
        ? "wf_database_lifecycle_report_snapshot"
        : isConnectedExecutionResumeActionJob
        ? "wf_connected_execution_resume_action"
        : isTenantSshCliExecuteJob
        ? "wf_tenant_ssh_cli_allowlisted_execute"
        : isHostingerSshTargetProbeJob
        ? "wf_hostinger_ssh_target_probe_queue_worker"
        : String(requestPayload.target_workflow || "").trim(),
    brand_name:
      normalizedJobType === "site_migration"
        ? String(
            normalizedSiteMigrationPayload?.destination?.brand ||
              normalizedSiteMigrationPayload?.source?.brand ||
              ""
          ).trim()
        : String(requestPayload.brand_name || requestPayload.brand || "").trim(),
    execution_trace_id,
    request_payload: normalizedJobType === "site_migration"
      ? normalizedSiteMigrationPayload
      : isDatabaseLifecycleSnapshotJob
      ? databaseLifecycleSnapshotPayload
      : isConnectedExecutionResumeActionJob
      ? connectedExecutionResumeActionPayload
      : isTenantSshCliExecuteJob
      ? tenantSshCliExecutePayload
      : isHostingerSshTargetProbeJob
      ? hostingerSshTargetProbePayload
      : requestPayload,
    runner_mode: isHostingerSshTargetProbeJob ? normalizeHostingerSshProbeRunnerMode(hostingerSshTargetProbePayload.runner_mode) : "",
    runner_mode_evidence: isHostingerSshTargetProbeJob ? describeHostingerSshProbeRunnerMode(hostingerSshTargetProbePayload.runner_mode) : null,
    attempt_count: 0,
    max_attempts: normalizeMaxAttempts(body.max_attempts),
    result_payload: null,
    error_payload: null,
    next_retry_at: "",
    webhook_url: normalizeWebhookUrl(body.webhook_url),
    callback_secret: String(body.callback_secret || "").trim(),
    idempotency_key: idempotencyKey
  };

  // GAP 14: endpoint readiness probe — block submission if the target endpoint
  // is not in a ready state (e.g., schema not validated, blocked, inventory-only).
  if (!isDatabaseLifecycleSnapshotJob && typeof deps.checkEndpointReadiness === "function" && job.parent_action_key && job.endpoint_key) {
    try {
      const readiness = await deps.checkEndpointReadiness({
        parent_action_key: job.parent_action_key,
        endpoint_key: job.endpoint_key
      });
      if (readiness && readiness.execution_readiness && readiness.execution_readiness !== "ready") {
        return {
          status: 422,
          body: {
            ok: false,
            error: {
              code: "endpoint_not_ready",
              message: `Endpoint '${job.endpoint_key}' is not ready for async execution.`,
              details: { execution_readiness: readiness.execution_readiness, parent_action_key: job.parent_action_key }
            }
          }
        };
      }
    } catch {
      // Readiness probe failure is non-blocking — let the job proceed.
    }
  }

  jobRepository.set(job);
  if (idempotencyLookupKey) {
    await idempotencyRepository.set(idempotencyLookupKey, job.job_id);
  }

  debugLog("JOB_CREATED:", {
    job_id: job.job_id,
    requested_by: job.requested_by,
    parent_action_key: job.parent_action_key,
    endpoint_key: job.endpoint_key
  });

  if (isHostingerSshTargetProbeJob) {
    const runnerMode = normalizeHostingerSshProbeRunnerMode(job.runner_mode || hostingerSshTargetProbePayload.runner_mode);
    if (runnerMode === HOSTINGER_SSH_PROBE_RUNNER_MODES.DETACHED_PROCESS) {
      const detached = startDetachedHostingerSshProbeRunner({ jobId: job.job_id, mode: runnerMode, reason: hostingerSshTargetProbePayload.approval_reason });
      if (!detached?.ok) {
        const failure = await failAsyncSubmission(jobRepository, idempotencyRepository, job, detached?.error, idempotencyLookupKey);
        return { status: 503, body: failure };
      }
      return { status: 202, body: { ...toJobSummary(job), runner: detached, runner_mode: runnerMode, runner_mode_evidence: job.runner_mode_evidence, queued_in_bullmq: false, secrets_included: false } };
    }
    if (runnerMode === HOSTINGER_SSH_PROBE_RUNNER_MODES.CRON_WORKER) {
      return { status: 202, body: { ...toJobSummary(job), runner_mode: runnerMode, runner_mode_evidence: job.runner_mode_evidence, cron_claim_required: true, cron_command: "node scripts/hostingerSshProbeDetachedRunner.mjs --mode cron_worker --limit 5", queued_in_bullmq: false, secrets_included: false } };
    }
    if (runnerMode === HOSTINGER_SSH_PROBE_RUNNER_MODES.EXTERNAL_RUNNER) {
      return { status: 202, body: { ...toJobSummary(job), runner_mode: runnerMode, runner_mode_evidence: job.runner_mode_evidence, external_claim_required: true, external_runner_contract: { job_type: HOSTINGER_SSH_TARGET_PROBE_JOB_TYPE, claim_by_job_id: job.job_id, status_url: `/jobs/${job.job_id}`, result_url: `/jobs/${job.job_id}/result`, no_secret_response: true }, queued_in_bullmq: false, secrets_included: false } };
    }
  }

  const enqueueResult = await enqueueJob(job.job_id);
  if (!enqueueResult?.ok) {
    const failure = await failAsyncSubmission(jobRepository, idempotencyRepository, job, enqueueResult?.error, idempotencyLookupKey);
    return { status: 503, body: failure };
  }

  return { status: 202, body: { ...toJobSummary(job), runner_mode: job.runner_mode || null, runner_mode_evidence: job.runner_mode_evidence || null } };
}

export async function getExecutionJob(jobId, deps = {}) {
  const {
    resolveJob,
    toJobSummary,
    TERMINAL_JOB_STATUSES,
    ACTIVE_JOB_STATUSES,
    normalizeJobStatus,
    updateJob,
    nowIso
  } = deps;

  const job = await resolveJob(jobId);
  if (!job) {
    return {
      status: 404,
      body: {
        ok: false,
        error: {
          code: "job_not_found",
          message: "Job not found."
        }
      }
    };
  }

  if (typeof updateJob === "function" && isRunningJobStale(job)) {
    updateJob(job, {
      status: "failed",
      completed_at: typeof nowIso === "function" ? nowIso() : new Date().toISOString(),
      result_payload: null,
      error_payload: buildStaleJobTimeoutPayload(job),
    });
  }

  const summary = toJobSummary(job);
  return {
    status: 200,
    body: {
      ...summary,
      terminal: TERMINAL_JOB_STATUSES.has(normalizeJobStatus(job.status)),
      active: ACTIVE_JOB_STATUSES.has(normalizeJobStatus(job.status))
    }
  };
}

export async function tickExecutionJob(jobId, deps = {}) {
  const {
    resolveJob,
    executeSingleQueuedJob,
    toJobSummary,
    normalizeJobStatus,
  } = deps;

  const job = await resolveJob(jobId);
  if (!job) {
    return {
      status: 404,
      body: {
        ok: false,
        error: { code: "job_not_found", message: "Job not found." },
        secrets_included: false,
      },
    };
  }

  const currentStatus = normalizeJobStatus(job.status);
  if (currentStatus !== "queued") {
    return {
      status: 409,
      body: {
        ok: false,
        error: {
          code: "job_not_queued",
          message: "Only queued jobs can be ticked manually.",
          details: { job_id: job.job_id, current_status: currentStatus },
        },
        secrets_included: false,
      },
    };
  }

  await executeSingleQueuedJob(job);
  return {
    status: 200,
    body: {
      ok: true,
      ticked: true,
      before_status: currentStatus,
      job: toJobSummary(job),
      result: job.result_payload || null,
      error: job.error_payload || null,
      secrets_included: false,
    },
  };
}

export async function createJob({ type, payload, delaySeconds } = {}) {
  const id = `solver_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  return { id };
}

export async function pollExecutionJobResult(jobId, deps = {}) {
  const {
    resolveJob,
    nowIso,
    createExecutionTraceId,
    updateJob,
    normalizeJobStatus,
    performUniversalServerWriteback
  } = deps;

  try {
    const job = await resolveJob(jobId);
    if (!job) {
      return {
        status: 404,
        body: {
          ok: false,
          error: {
            code: "job_not_found",
            message: "Job not found."
          }
        }
      };
    }

    const poll_started_at = nowIso();
    const execution_trace_id =
      String(job.execution_trace_id || "").trim() || createExecutionTraceId();
    if (job.execution_trace_id !== execution_trace_id) {
      updateJob(job, { execution_trace_id });
    }

    if (isRunningJobStale(job)) {
      updateJob(job, {
        status: "failed",
        completed_at: nowIso(),
        result_payload: null,
        error_payload: buildStaleJobTimeoutPayload(job),
      });
    }

    const status = normalizeJobStatus(job.status);
    if (status === "succeeded") {
      const responsePayload = {
        job_id: job.job_id,
        status: job.status,
        result: job.result_payload || null
      };

      await performUniversalServerWriteback({
        mode: "poll",
        job_id: job.job_id,
        target_key: job.target_key,
        parent_action_key: job.parent_action_key,
        endpoint_key: job.endpoint_key,
        route_id: job.route_id,
        target_module: job.target_module,
        target_workflow: job.target_workflow,
        source_layer: "http_client_backend",
        entry_type: "poll_read",
        execution_class: "poll",
        attempt_count: job.attempt_count,
        status_source: status,
        responseBody: job.result_payload,
        error_code: job.result_payload?.error?.code,
        error_message_short: job.result_payload?.error?.message,
        http_status: 200,
        brand_name: job.brand_name,
        execution_trace_id,
        started_at: poll_started_at
      });

      return { status: 200, body: responsePayload };
    }

    if (status === "failed" || status === "cancelled") {
      const responsePayload = {
        job_id: job.job_id,
        status: job.status,
        error: job.error_payload || null
      };

      await performUniversalServerWriteback({
        mode: "poll",
        job_id: job.job_id,
        target_key: job.target_key,
        parent_action_key: job.parent_action_key,
        endpoint_key: job.endpoint_key,
        route_id: job.route_id,
        target_module: job.target_module,
        target_workflow: job.target_workflow,
        source_layer: "http_client_backend",
        entry_type: "poll_read",
        execution_class: "poll",
        attempt_count: job.attempt_count,
        status_source: status,
        responseBody: job.error_payload,
        error_code: job.error_payload?.error?.code,
        error_message_short: job.error_payload?.error?.message,
        http_status: 200,
        brand_name: job.brand_name,
        execution_trace_id,
        started_at: poll_started_at
      });

      return { status: 200, body: responsePayload };
    }

    const pendingPayload = {
      job_id: job.job_id,
      status: job.status,
      message: "Job is not complete yet.",
      status_url: `/jobs/${job.job_id}`
    };

    await performUniversalServerWriteback({
      mode: "poll",
      job_id: job.job_id,
      target_key: job.target_key,
      parent_action_key: job.parent_action_key,
      endpoint_key: job.endpoint_key,
      route_id: job.route_id,
      target_module: job.target_module,
      target_workflow: job.target_workflow,
      source_layer: "http_client_backend",
      entry_type: "poll_read",
      execution_class: "poll",
      attempt_count: job.attempt_count,
      status_source: status,
      responseBody: pendingPayload,
      error_code: "",
      error_message_short: "",
      http_status: 202,
      brand_name: job.brand_name,
      execution_trace_id,
      started_at: poll_started_at
    });

    return { status: 202, body: pendingPayload };
  } catch (err) {
    return {
      status: 500,
      body: {
        ok: false,
        error: {
          code: "poll_read_failed",
          message: err?.message || "Poll read failed."
        }
      }
    };
  }
}
