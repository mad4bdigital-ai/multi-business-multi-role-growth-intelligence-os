import { Router } from "express";
import { getPool } from "../db.js";
import { runGrowthIntelligencePilot } from "../growthIntelligencePilot.js";
import {
  decideGrowthIntelligenceAction,
  decideGrowthIntelligenceInsight,
  getGrowthIntelligenceMetrics,
  getGrowthIntelligenceReport,
  listGrowthIntelligenceReports,
  persistGrowthIntelligencePilot,
  persistGrowthIntelligenceReadinessAssessment,
} from "../growthIntelligenceRegistry.js";

function errorResponse(res, error) {
  return res.status(error.status || 500).json({
    ok: false,
    error: {
      code: error.code || "growth_intelligence_pilot_failed",
      message: String(error.message || "Growth intelligence pilot failed.").slice(0, 300),
    },
    secrets_included: false,
  });
}

export function buildGrowthIntelligenceRoutes({ requireBackendApiKey }) {
  const router = Router();

  router.post(
    "/tenants/:tenant_id/brands/:brand_key/growth-intelligence/pilot",
    requireBackendApiKey,
    async (req, res) => {
      try {
        const persistenceMode = String(req.body?.persistence_mode || "none").trim();
        if (!["none", "internal_registry"].includes(persistenceMode)) {
          const error = new Error("persistence_mode must be none or internal_registry.");
          error.status = 400;
          error.code = "growth_pilot_persistence_mode_invalid";
          throw error;
        }
        const result = runGrowthIntelligencePilot({
          ...(req.body || {}),
          tenant_id: req.params.tenant_id,
          brand_key: req.params.brand_key,
        });
        if (persistenceMode === "internal_registry") {
          result.registry = await persistGrowthIntelligencePilot(result, {
            pool: getPool(),
            requestedBy: req.body?.requested_by || null,
          });
          const approvalStage = result.workflow?.stages?.find((stage) => stage.stage === "approval_hold");
          if (approvalStage) {
            approvalStage.status = "pass";
            delete approvalStage.reason;
          }
          result.readback.approval_hold_count = result.registry.approval_holds.length;
          result.readback.executed_stage_count += 1;
          result.readback.planned_stage_count = Math.max(0, result.readback.planned_stage_count - 1);
          result.readback.all_stages_passed = result.workflow.stages.every((stage) => stage.status === "pass");
        } else {
          result.registry = {
            persistence_mode: "none",
            persisted: false,
            provider_writes: 0,
            external_sends: 0,
            secrets_included: false,
          };
        }
        return res.status(200).json(result);
      } catch (error) {
        return errorResponse(res, error);
      }
    }
  );

  router.get("/tenants/:tenant_id/growth-intelligence/reports", requireBackendApiKey, async (req, res) => {
    try {
      const reports = await listGrowthIntelligenceReports({
        pool: getPool(),
        tenantId: req.params.tenant_id,
        brandKey: req.query.brand_key || "",
        limit: req.query.limit,
      });
      return res.json({ ok: true, reports, count: reports.length, secrets_included: false });
    } catch (error) {
      return errorResponse(res, error);
    }
  });

  router.get("/tenants/:tenant_id/growth-intelligence/metrics", requireBackendApiKey, async (req, res) => {
    try {
      const metrics = await getGrowthIntelligenceMetrics({
        pool: getPool(),
        tenantId: req.params.tenant_id,
        brandKey: req.query.brand_key || "",
      });
      return res.json({ ok: true, metrics, secrets_included: false });
    } catch (error) {
      return errorResponse(res, error);
    }
  });

  router.get("/tenants/:tenant_id/growth-intelligence/reports/:report_id", requireBackendApiKey, async (req, res) => {
    try {
      const record = await getGrowthIntelligenceReport({
        pool: getPool(),
        tenantId: req.params.tenant_id,
        reportId: req.params.report_id,
      });
      if (!record) {
        return res.status(404).json({
          ok: false,
          error: { code: "growth_intelligence_report_not_found", message: "Growth Intelligence report not found." },
          secrets_included: false,
        });
      }
      return res.json({ ok: true, ...record, secrets_included: false });
    } catch (error) {
      return errorResponse(res, error);
    }
  });

  router.post(
    "/tenants/:tenant_id/growth-intelligence/reports/:report_id/actions/:action_id/decision",
    requireBackendApiKey,
    async (req, res) => {
      try {
        const decision = await decideGrowthIntelligenceAction({
          pool: getPool(),
          tenantId: req.params.tenant_id,
          reportId: req.params.report_id,
          actionId: req.params.action_id,
          decision: req.body?.decision,
          decisionBy: req.body?.decision_by || null,
          decisionNote: req.body?.decision_note || null,
        });
        return res.json({ ok: true, decision, secrets_included: false });
      } catch (error) {
        return errorResponse(res, error);
      }
    }
  );

  router.post(
    "/tenants/:tenant_id/growth-intelligence/reports/:report_id/insights/:insight_id/decision",
    requireBackendApiKey,
    async (req, res) => {
      try {
        const decision = await decideGrowthIntelligenceInsight({
          pool: getPool(),
          tenantId: req.params.tenant_id,
          reportId: req.params.report_id,
          insightId: req.params.insight_id,
          decision: req.body?.decision,
          decisionBy: req.body?.decision_by || null,
          decisionNote: req.body?.decision_note || null,
        });
        return res.json({ ok: true, decision, secrets_included: false });
      } catch (error) {
        return errorResponse(res, error);
      }
    }
  );

  router.post(
    "/tenants/:tenant_id/growth-intelligence/reports/:report_id/readiness-assessments",
    requireBackendApiKey,
    async (req, res) => {
      try {
        const assessment = await persistGrowthIntelligenceReadinessAssessment({
          pool: getPool(),
          tenantId: req.params.tenant_id,
          reportId: req.params.report_id,
          assessedBy: req.body?.assessed_by || null,
        });
        return res.status(201).json({ ok: true, assessment, secrets_included: false });
      } catch (error) {
        return errorResponse(res, error);
      }
    }
  );

  return router;
}
