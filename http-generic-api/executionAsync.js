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

  jobRepository.set(job);
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
        : String(requestPayload.target_key || "").trim(),
    parent_action_key:
      normalizedJobType === "site_migration"
        ? "site_migration_controller"
        : String(requestPayload.parent_action_key || "").trim(),
    endpoint_key:
      normalizedJobType === "site_migration"
        ? "site_migrate"
        : String(requestPayload.endpoint_key || "").trim(),
    route_id:
      normalizedJobType === "site_migration"
        ? "site_migration"
        : String(requestPayload.route_id || "").trim(),
    target_module:
      normalizedJobType === "site_migration"
        ? "wordpress_site_migration"
        : String(requestPayload.target_module || "").trim(),
    target_workflow:
      normalizedJobType === "site_migration"
        ? "wf_wordpress_site_migration"
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
    request_payload: normalizedJobType === "site_migration" ? normalizedSiteMigrationPayload : requestPayload,
    attempt_count: 0,
    max_attempts: normalizeMaxAttempts(body.max_attempts),
    result_payload: null,
    error_payload: null,
    next_retry_at: "",
    webhook_url: normalizeWebhookUrl(body.webhook_url),
    callback_secret: String(body.callback_secret || "").trim(),
    idempotency_key: idempotencyKey
  };

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

  const enqueueResult = await enqueueJob(job.job_id);
  if (!enqueueResult?.ok) {
    const failure = await failAsyncSubmission(jobRepository, idempotencyRepository, job, enqueueResult?.error, idempotencyLookupKey);
    return { status: 503, body: failure };
  }

  return { status: 202, body: toJobSummary(job) };
}

export async function getExecutionJob(jobId, deps = {}) {
  const {
    resolveJob,
    toJobSummary,
    TERMINAL_JOB_STATUSES,
    ACTIVE_JOB_STATUSES,
    normalizeJobStatus
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
