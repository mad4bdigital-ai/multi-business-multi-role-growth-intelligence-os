import { Router } from "express";
import { buildManagedExecutionRoutes } from "./managedExecutionRoutes.js";
import { buildWorkflowOrchestrationRoutes as buildWorkflowOrchestrationBaseRoutes } from "./workflowOrchestrationRoutesBase.js";

export function buildWorkflowOrchestrationRoutes(deps) {
  const router = Router();
  router.use(buildManagedExecutionRoutes(deps));
  router.use(buildWorkflowOrchestrationBaseRoutes(deps));
  return router;
}
