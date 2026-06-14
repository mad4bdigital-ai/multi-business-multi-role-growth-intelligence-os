import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as v2Runtime from "./repositoryTenantIntelligenceV2.js";
import { TENANT_REPOSITORY_INTELLIGENCE_V2_SYSTEM_TOOLS } from "./repositoryTenantIntelligenceV2.js";

const routes = readFileSync("routes/systemLayerRoutes.js", "utf8");
const v2 = readFileSync("repositoryTenantIntelligenceV2.js", "utf8");
const releaseReadiness = readFileSync("releaseReadiness.js", "utf8");
const v5 = readFileSync("repositoryTenantAdvisoryCommentsV5.js", "utf8");
const migration = readFileSync("migrations/293_sprint68_system_layer_descriptor_auto_wiring.sql", "utf8");

for (const token of [
  "SYSTEM_LAYER_DESCRIPTOR_SOURCES",
  "descriptorHandlerRegistry",
  "callDescriptorSystemToolIfAvailable",
  "snakeToolNameToCamelHandlerName",
  "system_layer_descriptor_readiness",
]) {
  assert(routes.includes(token), `systemLayerRoutes must include ${token}`);
}

for (const token of [
  "TENANT_REPOSITORY_INTELLIGENCE_V2_SYSTEM_TOOLS",
  "TENANT_REPOSITORY_ADVISORY_COMMENT_V5_SYSTEM_TOOLS",
  "RepositoryTenantIntelligenceV2Runtime",
  "RepositoryTenantAdvisoryCommentV5Runtime",
]) {
  assert(routes.includes(token), `systemLayerRoutes must load descriptor source ${token}`);
}

for (const tool of [
  "tenant_repository_intelligence_report",
  "tenant_repository_action_planner_dry_run",
  "tenant_repository_intelligence_v3_v4_readiness_smoke",
]) {
  assert(v2.includes(tool), `V2 module must declare ${tool}`);
  assert(routes.includes(tool), `systemLayerRoutes must list ${tool}`);
}

for (const [tool, handler] of [
  ["tenant_repository_advisory_comment_preview", "tenantRepositoryAdvisoryCommentPreview"],
  ["tenant_repository_advisory_comment_apply", "tenantRepositoryAdvisoryCommentApply"],
  ["tenant_repository_advisory_comment_readback", "tenantRepositoryAdvisoryCommentReadback"],
  ["tenant_repository_advisory_comment_v5_readiness_smoke", "tenantRepositoryAdvisoryCommentV5ReadinessSmoke"],
]) {
  assert(v5.includes(tool), `V5 module must declare descriptor ${tool}`);
  assert(v5.includes(handler), `V5 module must export handler ${handler}`);
  assert(routes.includes(tool), `systemLayerRoutes must list ${tool}`);
  assert(routes.includes(handler), `systemLayerRoutes must contain handler token ${handler}`);
  assert(migration.includes(tool), `migration must seed tenant tool ${tool}`);
}

assert(routes.includes("const descriptorSystemTool = await callDescriptorSystemToolIfAvailable(name, args, auth, deps);"), "descriptor dispatch must happen before static switch fallback");
assert(routes.includes("system_layer_descriptor_handler_missing"), "descriptor dispatch must fail closed on missing handlers");
assert(migration.includes("system_layer_tool_descriptor_source_registry"), "migration must add descriptor source registry");
assert(migration.includes("system_layer_descriptor_auto_wiring_policy_v1"), "migration must seed descriptor auto-wiring policy");
assert(migration.includes("future_source_contract"), "migration must document the future descriptor source contract");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "descriptor auto-wiring migration must not be destructive");
assert(!/secret\s*=\s*['\"][^'\"]+/i.test(migration), "migration must not contain inline secrets");

console.log("system-layer descriptor auto-wiring guard passed");
