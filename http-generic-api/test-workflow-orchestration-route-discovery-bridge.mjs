import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const wrapper = readFileSync("routes/workflowOrchestrationRoutes.js", "utf8");
const legacy = readFileSync("routes/workflowOrchestrationLegacyRoutes.js", "utf8");
const routes = [
  'router.post("/workflow-runs"',
  'router.get("/workflow-runs/:id"',
  'router.get("/tenants/:id/workflow-runs"',
  'router.patch("/workflow-runs/:id/status"',
  'router.post("/workflow-runs/:id/steps"',
  'router.post("/approval-holds/:id/decide"',
  'router.get("/approval-holds"',
];

assert(wrapper.includes("legacyRouteDiscoveryBridge"));
assert(wrapper.includes("void legacyRouteDiscoveryBridge"));
assert(wrapper.includes("buildWorkflowOrchestrationLegacyRoutes(deps)"));
for (const route of routes) {
  assert(wrapper.includes(route), `discovery bridge missing ${route}`);
  assert(legacy.includes(route), `runtime legacy router missing ${route}`);
}
assert.equal((wrapper.match(/legacyRouteDiscoveryBridge\s*\(/g) || []).length, 1);

console.log("workflow orchestration discovery bridge tests passed");
