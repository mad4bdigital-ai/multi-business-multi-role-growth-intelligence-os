import { Router } from "express";
import { buildManagedExecutionRouteAuthorization } from "./managedExecutionRouteAuthorization.js";
import { buildManagedExecutionRoutes } from "./managedExecutionRoutes.js";
import { buildWorkflowOrchestrationRoutes as buildWorkflowOrchestrationLegacyRoutes } from "./workflowOrchestrationLegacyRoutes.js";

export function buildWorkflowOrchestrationRoutes(deps) {
  const router = Router();
  router.use(buildManagedExecutionRouteAuthorization(deps));
  router.use(buildManagedExecutionRoutes(deps));
  router.use(buildWorkflowOrchestrationLegacyRoutes(deps));
  return router;
}
