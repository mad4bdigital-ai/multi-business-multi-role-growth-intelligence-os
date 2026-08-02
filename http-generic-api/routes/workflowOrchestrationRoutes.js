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

export function buildWorkflowOrchestrationRoutes(deps) {
  const router = Router();
  router.use(buildManagedExecutionRouteAuthorization(deps));
  router.use(buildManagedExecutionRoutes(deps));
  router.use(buildWorkflowOrchestrationLegacyRoutes(deps));
  return router;
}

void legacyRouteDiscoveryBridge;
