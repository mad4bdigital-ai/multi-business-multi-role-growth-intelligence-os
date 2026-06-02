import { Router } from "express";
import {
  assertDatabaseLifecycleReportSnapshotAllowed,
  assessDatabaseLifecycleReportSnapshotScheduleReadiness,
  assessDatabaseLifecycleSchedulerBindingReadiness,
  applyDatabaseLifecycleSchedulerApproval,
  buildDatabaseLifecycleReportSnapshot,
  assertDatabaseLifecycleSchedulerApprovalAllowed,
  listDatabaseLifecycleReportSnapshotSchedules,
  listDatabaseLifecycleReportSnapshots,
  listDatabaseLifecycleSchedulerBindings,
  planDatabaseLifecycleSchedulerApproval,
  planDatabaseTableLifecycleRegistryUpsert,
  planDatabaseLifecycleRetentionReview,
  runDatabaseTableLifecycleCensus,
  writeDatabaseLifecycleReportSnapshot,
} from "../databaseTableLifecycle.js";
import {
  buildPlatformEngineDecisionBrief,
  checkPlatformEngineCapability,
  createPlatformEngineExecutionEnvelope,
  listPlatformEngineRuns,
  listPlatformEngineValidatorResults,
  listPlatformEngines,
  planPlatformEngineTask,
  resolvePlatformEngineTaskIntent,
  summarizePlatformEngineFeedback,
  writePlatformEngineRun,
  writePlatformEngineValidatorResult,
} from "../platformEngineRegistry.js";

function requireString(value, field) {
  const text = String(value || "").trim();
  if (!text) {
    const err = new Error(`${field} is required.`);
    err.status = 400;
    err.code = `${field}_required`;
    throw err;
  }
  return text;
}

function normalizeMode(value = "dry_run") {
  const mode = String(value || "dry_run").trim();
  if (!["diagnose_only", "dry_run", "apply_allowed"].includes(mode)) {
    const err = new Error("mode must be diagnose_only, dry_run, or apply_allowed.");
    err.status = 400;
    err.code = "platform_engine_mode_invalid";
    throw err;
  }
  return mode;
}

function normalizePlanInput(body = {}) {
  const resource = body.resource && typeof body.resource === "object" ? body.resource : {};
  return {
    engine_key: requireString(body.engine_key, "engine_key"),
    task_class: requireString(body.task_class, "task_class"),
    mode: normalizeMode(body.mode || body.requested_mode || "dry_run"),
    resource: {
      ...resource,
      path: body.resource_key || resource.path || resource.key || resource.id || "*",
      kind: body.resource_kind || resource.kind || "generic",
      scope_id: body.scope_id || resource.scope_id || "",
    },
    scope_guard_passed: body.scope_guard_passed === true || body.scope_guard?.passed === true,
    approval_granted: body.approval_granted === true || body.approval?.granted === true,
    resource_authority_required: body.resource_authority_required === true || body.resource_authority?.required === true,
    resource_authority_passed: body.resource_authority_passed === true || body.resource_authority?.passed === true,
    audit_evidence: body.audit_evidence || body.audit || null,
    validator_results_required: body.validator_results_required === true || body.validators?.results_required === true,
    validator_results: Array.isArray(body.validator_results) ? body.validator_results : Array.isArray(body.validators?.results) ? body.validators.results : undefined,
    validator_result_run_id: body.validator_result_run_id || body.validators?.run_id || body.run_id || "",
    validator_result_run_key: body.validator_result_run_key || body.validators?.run_key || body.run_key || "",
    run_id: body.run_id || "",
    run_key: body.run_key || "",
    actor_id: body.actor_id || body.requested_by || "",
    tenant_id: body.tenant_id || "",
    trace_id: body.trace_id || "",
  };
}

export function buildPlatformEngineRoutes(deps = {}) {
  const router = Router();
  const requireBackendApiKey = deps.requireBackendApiKey || ((_req, _res, next) => next());
  const requireAdminPrincipal = deps.requireAdminPrincipal || ((_req, _res, next) => next());
  const requireAdmin = [requireBackendApiKey, requireAdminPrincipal];

  router.get("/platform/engines", ...requireAdmin, async (req, res) => {
    try {
      const rows = await listPlatformEngines({
        status: req.query.status,
        engine_type: req.query.engine_type,
        limit: req.query.limit,
      }, deps);
      res.json({ ok: true, engines: rows });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: { code: error.code || "platform_engine_list_failed", message: error.message } });
    }
  });

  router.post("/platform/engines/task-plan", ...requireAdmin, async (req, res) => {
    try {
      const input = normalizePlanInput(req.body || {});
      const plan = await planPlatformEngineTask(input, deps);
      let audit = null;
      if (req.body?.write_audit === true) {
        audit = await writePlatformEngineRun(plan, input, deps);
      }
      res.json({ ok: true, dry_run_only: plan.mode !== "apply_allowed", plan, audit });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: { code: error.code || "platform_engine_task_plan_failed", message: error.message } });
    }
  });

  router.post("/platform/engines/resolve-intent", ...requireAdmin, async (req, res) => {
    try {
      const result = resolvePlatformEngineTaskIntent(req.body || {});
      res.json({ ok: true, intent: result });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: { code: error.code || "platform_engine_intent_resolve_failed", message: error.message } });
    }
  });

  router.post("/platform/engines/decision-brief", ...requireAdmin, async (req, res) => {
    try {
      const brief = await buildPlatformEngineDecisionBrief(req.body || {}, deps);
      res.json({ ok: true, brief });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: { code: error.code || "platform_engine_decision_brief_failed", message: error.message } });
    }
  });

  router.post("/platform/engines/database-table-lifecycle/decision-brief", ...requireAdmin, async (req, res) => {
    try {
      const brief = await runDatabaseTableLifecycleCensus({ limit: req.body?.limit }, deps);
      res.json({ ok: true, brief });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: { code: error.code || "database_table_lifecycle_decision_brief_failed", message: error.message } });
    }
  });

  router.post("/platform/engines/database-table-lifecycle/register-plan", ...requireAdmin, async (req, res) => {
    try {
      const plan = await planDatabaseTableLifecycleRegistryUpsert({ limit: req.body?.limit }, deps);
      res.json({ ok: true, plan });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: { code: error.code || "database_table_lifecycle_register_plan_failed", message: error.message } });
    }
  });

  router.get("/platform/engines/database-lifecycle/report-snapshots", ...requireAdmin, async (req, res) => {
    try {
      const snapshots = await listDatabaseLifecycleReportSnapshots({
        report_type: req.query.report_type,
        limit: req.query.limit,
      }, deps);
      res.json({ ok: true, snapshots });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: { code: error.code || "database_lifecycle_report_snapshots_failed", message: error.message } });
    }
  });

  router.post("/platform/engines/database-lifecycle/report-snapshots", ...requireAdmin, async (req, res) => {
    try {
      const input = req.body || {};
      const gate = assertDatabaseLifecycleReportSnapshotAllowed({
        apply: input.apply === true,
        confirm: input.confirm,
      });
      const reportType = String(input.report_type || "retention_plan").trim();
      if (reportType !== "retention_plan") {
        const err = new Error("Only report_type=retention_plan is supported.");
        err.status = 400;
        err.code = "database_lifecycle_report_type_unsupported";
        throw err;
      }
      const report = await planDatabaseLifecycleRetentionReview({ limit: input.limit }, deps);
      const snapshot = buildDatabaseLifecycleReportSnapshot(report, {
        report_type: reportType,
        limit: input.limit,
        apply: gate.allowed,
        actor_id: input.actor_id || input.requested_by || "",
        trace_id: input.trace_id || "",
        tenant_id: input.tenant_id || "",
        notes: input.notes || "",
      });
      const writeResult = gate.allowed ? await writeDatabaseLifecycleReportSnapshot(snapshot, deps) : null;
      res.json({
        ok: true,
        mode: gate.mode,
        dry_run: !gate.allowed,
        will_write: gate.allowed,
        no_drop: true,
        no_delete: true,
        no_archive_execution: true,
        no_compaction_execution: true,
        secrets_included: false,
        snapshot,
        write_result: writeResult,
      });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: { code: error.code || "database_lifecycle_report_snapshot_failed", message: error.message } });
    }
  });

  router.get("/platform/engines/database-lifecycle/report-snapshot-schedules", ...requireAdmin, async (req, res) => {
    try {
      const schedules = await listDatabaseLifecycleReportSnapshotSchedules({
        report_type: req.query.report_type,
        status: req.query.status,
        limit: req.query.limit,
      }, deps);
      res.json({
        ok: true,
        dry_run: true,
        will_execute: false,
        no_drop: true,
        no_delete: true,
        no_archive_execution: true,
        no_compaction_execution: true,
        secrets_included: false,
        schedules,
      });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: { code: error.code || "database_lifecycle_report_snapshot_schedules_failed", message: error.message } });
    }
  });

  router.post("/platform/engines/database-lifecycle/report-snapshot-schedule-readiness", ...requireAdmin, async (req, res) => {
    try {
      const input = req.body || {};
      const reportType = String(input.report_type || "").trim();
      if (reportType && reportType !== "retention_plan") {
        const err = new Error("Only report_type=retention_plan is supported.");
        err.status = 400;
        err.code = "database_lifecycle_report_type_unsupported";
        throw err;
      }
      const readiness = await assessDatabaseLifecycleReportSnapshotScheduleReadiness({
        schedule_key: input.schedule_key,
        report_type: reportType,
        limit: input.limit,
      }, deps);
      res.json({ ok: true, readiness });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: { code: error.code || "database_lifecycle_report_snapshot_schedule_readiness_failed", message: error.message } });
    }
  });

  router.get("/platform/engines/database-lifecycle/scheduler-bindings", ...requireAdmin, async (req, res) => {
    try {
      const bindings = await listDatabaseLifecycleSchedulerBindings({
        schedule_key: req.query.schedule_key,
        status: req.query.status,
        limit: req.query.limit,
      }, deps);
      res.json({
        ok: true,
        dry_run: true,
        will_execute: false,
        no_drop: true,
        no_delete: true,
        no_archive_execution: true,
        no_compaction_execution: true,
        secrets_included: false,
        bindings,
      });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: { code: error.code || "database_lifecycle_scheduler_bindings_failed", message: error.message } });
    }
  });

  router.post("/platform/engines/database-lifecycle/scheduler-binding-readiness", ...requireAdmin, async (req, res) => {
    try {
      const input = req.body || {};
      const readiness = await assessDatabaseLifecycleSchedulerBindingReadiness({
        binding_key: input.binding_key,
        schedule_key: input.schedule_key,
        limit: input.limit,
      }, deps);
      res.json({ ok: true, readiness });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: { code: error.code || "database_lifecycle_scheduler_binding_readiness_failed", message: error.message } });
    }
  });

  router.post("/platform/engines/database-lifecycle/scheduler-approval-metadata", ...requireAdmin, async (req, res) => {
    try {
      const input = req.body || {};
      const gate = assertDatabaseLifecycleSchedulerApprovalAllowed({
        apply: input.apply === true,
        confirm: input.confirm,
      });
      const plan = await planDatabaseLifecycleSchedulerApproval({ ...input, apply: gate.allowed }, deps);
      const writeResult = gate.allowed ? await applyDatabaseLifecycleSchedulerApproval(plan, deps) : null;
      res.json({
        ok: true,
        mode: gate.mode,
        dry_run: !gate.allowed,
        will_write: gate.allowed,
        will_execute: false,
        no_drop: true,
        no_delete: true,
        no_archive_execution: true,
        no_compaction_execution: true,
        secrets_included: false,
        plan,
        write_result: writeResult,
      });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: { code: error.code || "database_lifecycle_scheduler_approval_metadata_failed", message: error.message } });
    }
  });

  router.post("/platform/engines/capability-check", ...requireAdmin, async (req, res) => {
    try {
      const input = {
        engine_key: requireString(req.body?.engine_key, "engine_key"),
        task_class: req.body?.task_class ? String(req.body.task_class).trim() : "",
      };
      const capability = await checkPlatformEngineCapability(input, deps);
      res.json({ ok: true, capability });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: { code: error.code || "platform_engine_capability_check_failed", message: error.message } });
    }
  });

  router.get("/platform/engines/runs", ...requireAdmin, async (req, res) => {
    try {
      const runs = await listPlatformEngineRuns({
        engine_key: req.query.engine_key,
        task_class: req.query.task_class,
        limit: req.query.limit,
      }, deps);
      res.json({ ok: true, runs });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: { code: error.code || "platform_engine_runs_failed", message: error.message } });
    }
  });

  router.get("/platform/engines/feedback-summary", ...requireAdmin, async (req, res) => {
    try {
      const feedback = await summarizePlatformEngineFeedback({
        engine_key: req.query.engine_key,
        task_class: req.query.task_class,
        limit: req.query.limit,
      }, deps);
      res.json({ ok: true, feedback });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: { code: error.code || "platform_engine_feedback_summary_failed", message: error.message } });
    }
  });

  router.get("/platform/engines/validator-results", ...requireAdmin, async (req, res) => {
    try {
      const results = await listPlatformEngineValidatorResults({
        engine_key: req.query.engine_key,
        task_class: req.query.task_class,
        run_id: req.query.run_id,
        status: req.query.status,
        limit: req.query.limit,
      }, deps);
      res.json({ ok: true, results });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: { code: error.code || "platform_engine_validator_results_failed", message: error.message } });
    }
  });

  router.post("/platform/engines/validator-results", ...requireAdmin, async (req, res) => {
    try {
      const result = await writePlatformEngineValidatorResult(req.body || {}, deps);
      res.json({ ok: true, result, evidence_only: true, validators_executed_by_route: false, apply_executed: false });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: { code: error.code || "platform_engine_validator_result_log_failed", message: error.message } });
    }
  });

  router.post("/platform/engines/execution-envelope", ...requireAdmin, async (req, res) => {
    try {
      const input = normalizePlanInput({ ...(req.body || {}), mode: req.body?.mode || "apply_allowed" });
      const envelope = await createPlatformEngineExecutionEnvelope(input, deps);
      res.json({ ok: true, envelope });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: { code: error.code || "platform_engine_execution_envelope_failed", message: error.message } });
    }
  });

  return router;
}
