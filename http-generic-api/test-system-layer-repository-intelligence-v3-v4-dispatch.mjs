import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = readFileSync("routes/systemLayerRoutes.js", "utf8");
const moduleSource = readFileSync("repositoryTenantIntelligenceV2.js", "utf8");

const requiredTools = [
  "tenant_repository_intelligence_report",
  "tenant_repository_action_planner_dry_run",
  "tenant_repository_intelligence_v3_v4_readiness_smoke",
];

for (const tool of requiredTools) {
  assert(routes.includes(tool), `systemLayerRoutes must expose ${tool}`);
  assert(moduleSource.includes(tool), `repositoryTenantIntelligenceV2 module must declare ${tool}`);
}

assert(routes.includes("tenantRepositoryIntelligenceReport(args, { auth, runGovernedResource })"), "tenant_repository_intelligence_report must dispatch to tenantRepositoryIntelligenceReport");
assert(routes.includes("tenantRepositoryActionPlannerDryRun(args, { auth, runGovernedResource })"), "tenant_repository_action_planner_dry_run must dispatch to tenantRepositoryActionPlannerDryRun");
assert(routes.includes("tenantRepositoryIntelligenceV3V4ReadinessSmoke(args, { auth, runGovernedResource })"), "tenant_repository_intelligence_v3_v4_readiness_smoke must dispatch to tenantRepositoryIntelligenceV3V4ReadinessSmoke");
assert(routes.includes("tenantRepositoryIntelligenceV2ReadinessSmoke(args, { auth, runGovernedResource })"), "existing V2 readiness smoke dispatch must remain wired");

assert(!routes.includes("tenant_repository_intelligence_report\": false"), "report tool must not be explicitly disabled");
assert(!routes.includes("tenant_repository_action_planner_dry_run\": false"), "planner tool must not be explicitly disabled");

console.log("system-layer Repository Intelligence V3/V4 dispatch guard passed");
