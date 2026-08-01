import { Router } from "express";
import {
  attachModeChoiceSubmissionEvidence,
  governHostingerSshProbeJobSubmission,
} from "../hostingerSshProbeModeChoiceBoundary.js";

export function buildJobRoutes(deps) {
  const {
    requireBackendApiKey,
    requireAdminPrincipal = (_req, _res, next) => next(),
    executionFacade,
    resolveRequestedBy,
    jobRepository,
    executeSingleQueuedJob,
    normalizeJobStatus,
    toJobSummary,
    governJobSubmission = governHostingerSshProbeJobSubmission,
    attachJobSubmissionEvidence = attachModeChoiceSubmissionEvidence,
  } = deps;

  const router = Router();

  router.post("/site-migrate", requireBackendApiKey, async (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const requestedBy = resolveRequestedBy(req);
    const idempotencyKey = String(
      body.idempotency_key || req.header("Idempotency-Key") || ""
    ).trim();
    const { status, body: responseBody } = await executionFacade.submitSiteMigration(body, requestedBy, idempotencyKey);
    return res.status(status).json(responseBody);
  });

  router.post("/jobs", requireBackendApiKey, async (req, res) => {
    const requestedBy = resolveRequestedBy(req);
    const idempotencyKey = String(
      (req.body?.idempotency_key) || req.header("Idempotency-Key") || ""
    ).trim();
    const governance = await governJobSubmission({
      body: req.body,
      requestedBy,
      idempotencyKey,
      requestContext: {
        request_id: req.id || req.header("X-Request-Id") || null,
        actor_id: requestedBy,
        actor_type: "backend_api",
        tenant_id: req.body?.tenant_id || req.body?.request_payload?.tenant_id || null,
        user_id: req.body?.user_id || req.body?.request_payload?.user_id || null,
        session_id: req.body?.session_id || req.body?.request_payload?.session_id || null,
        conversation_id: req.body?.conversation_id || req.body?.request_payload?.conversation_id || null,
      },
    });
    if (!governance.proceed) {
      return res.status(governance.status || 409).json(governance.body);
    }
    const { status, body } = await executionFacade.submitJob(
      governance.request_body,
      requestedBy,
      idempotencyKey,
    );
    return res.status(status).json(attachJobSubmissionEvidence(body, governance));
  });

  router.get("/jobs/:jobId", requireBackendApiKey, async (req, res) => {
    const { status, body } = await executionFacade.getJob(req.params.jobId);
    return res.status(status).json(body);
  });

  router.get("/jobs/:jobId/result", requireBackendApiKey, async (req, res) => {
    const { status, body } = await executionFacade.pollJobResult(req.params.jobId);
    return res.status(status).json(body);
  });

  router.post("/jobs/:jobId/tick", requireBackendApiKey, requireAdminPrincipal, async (req, res) => {
    try {
      const jobId = String(req.params.jobId || "").trim();
      if (!jobId) {
        return res.status(400).json({ ok: false, error: { code: "job_id_required", message: "jobId is required." }, secrets_included: false });
      }
      if (!jobRepository || typeof jobRepository.getWithFallback !== "function" || typeof executeSingleQueuedJob !== "function") {
        return res.status(503).json({ ok: false, error: { code: "job_tick_unavailable", message: "Manual job tick dependencies are unavailable." }, secrets_included: false });
      }
      const job = await jobRepository.getWithFallback(jobId);
      if (!job) {
        return res.status(404).json({ ok: false, error: { code: "job_not_found", message: "Job not found." }, secrets_included: false });
      }
      const beforeStatus = normalizeJobStatus(job.status);
      if (beforeStatus !== "queued") {
        return res.status(409).json({ ok: false, error: { code: "job_not_queued", message: "Only queued jobs can be ticked manually.", details: { job_id: job.job_id, current_status: beforeStatus } }, secrets_included: false });
      }
      await executeSingleQueuedJob(job);
      const refreshedJob = await jobRepository.getWithFallback(jobId) || job;
      return res.status(200).json({
        ok: true,
        ticked: true,
        before_status: beforeStatus,
        job: typeof toJobSummary === "function" ? toJobSummary(refreshedJob) : { job_id: refreshedJob.job_id, status: refreshedJob.status },
        result: refreshedJob.result_payload || null,
        error: refreshedJob.error_payload || null,
        secrets_included: false,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "job_tick_failed", message: err?.message || String(err) }, secrets_included: false });
    }
  });

  return router;
}
