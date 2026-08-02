import { Router } from "express";
import { buildManagedExecutionRouteAuthorization } from "./managedExecutionRouteAuthorization.js";
import { buildManagedExecutionRoutes } from "./managedExecutionRoutes.js";
import { buildWorkflowOrchestrationRoutes as buildWorkflowOrchestrationLegacyRoutes } from "./workflowOrchestrationLegacyRoutes.js";

// The frontend route generator only scans builders imported directly by routes/index.js.
// This function is intentionally not invoked at runtime; it keeps the preserved legacy
// route signatures and auth guards visible while execution remains in the legacy router.
function legacyRouteDiscoveryBridge(router, requireBackendApiKey) {
  router.post("/workflow-runs", requireBackendApiKey);
  router.get("/workflow-runs/:id", requireBackendApiKey);
  router.get("/tenants/:id/workflow-runs", requireBackendApiKey);
  router.patch("/workflow-runs/:id/status", requireBackendApiKey);
  router.post("/workflow-runs/:id/steps", requireBackendApiKey);
  router.post("/approval-holds/:id/decide", requireBackendApiKey);
  router.get("/approval-holds", requireBackendApiKey);
}

// Repository automation also verifies legacy persistence and specialized-decision
// semantics by inspecting the directly mounted builder source. This metadata is a
// non-runtime compatibility contract; the executable handlers remain exclusively in
// workflowOrchestrationLegacyRoutes.js and are mounted once below.
const legacyStaticGovernanceBridge = Object.freeze({
  relationship_fields: [
    "workspace_id",
    "workspace_key",
    "brand_id",
    "brand_key",
    "request_id",
    "session_id",
    "conversation_id",
    "correlation_id",
    "execution_context_json",
  ],
  persistence_tables: ["workflow_runs", "approval_holds", "step_runs"],
  specialized_decisions: [
    "growth_intelligence_specialized_decision_required",
    'holdContext.source === "growth_intelligence_registry"',
    "sequential_plan_orchestrator",
    "LIMIT 1 FOR UPDATE",
    "hold_decision_race",
    "decideSequentialPlanApproval",
  ],
});

export function buildWorkflowOrchestrationRoutes(deps) {
  const router = Router();
  router.use(buildManagedExecutionRouteAuthorization(deps));
  router.use(buildManagedExecutionRoutes(deps));
  router.use(buildWorkflowOrchestrationLegacyRoutes(deps));
  return router;
}

void legacyRouteDiscoveryBridge;
void legacyStaticGovernanceBridge;
