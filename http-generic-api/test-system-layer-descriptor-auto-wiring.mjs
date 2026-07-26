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

const expectedV2Handlers = new Map([
  ["platform_resource_authority_binding_create", "createRepositoryAuthorityBinding"],
  ["platform_resource_authority_binding_list", "listRepositoryAuthorityBindings"],
  ["platform_resource_authority_binding_revoke", "revokeRepositoryAuthorityBinding"],
  ["tenant_repo_pr_reconciliation_sweep", "tenantRepositoryPrReconciliationSweep"],
]);
for (const [toolName, handlerName] of expectedV2Handlers) {
  const descriptor = TENANT_REPOSITORY_INTELLIGENCE_V2_SYSTEM_TOOLS.find((tool) => tool.name === toolName);
  assert(descriptor, `V2 descriptor ${toolName} must exist`);
  assert.equal(descriptor.handler_name, handlerName, `${toolName} must declare explicit handler_name`);
  assert.equal(typeof v2Runtime[handlerName], "function", `${handlerName} must be a callable runtime export`);
}
for (const alias of [
  "tenantRepoPrReconciliationSweep",
  "platformResourceAuthorityBindingCreate",
  "platformResourceAuthorityBindingList",
  "platformResourceAuthorityBindingRevoke",
]) {
  assert.equal(typeof v2Runtime[alias], "function", `compatibility alias ${alias} must remain callable`);
}
for (const checkName of [
  "descriptor_handler_present",
  "direct_public_tool_call_succeeds",
  "tenant_scope_forced",
  "missing_binding_blocks_before_provider",
  "active_binding_allows_read_only",
  "no_mutation",
  "no_secrets",
]) {
  assert(v2.includes(`name: "${checkName}"`), `V2 readiness smoke must include ${checkName}`);
}
assert(routes.includes("dispatchSystemTool"), "descriptor runtime must inject a governed child dispatcher");
assert(routes.includes("runRepositoryIntelligenceV2DescriptorReadinessSmoke"), "system-layer routes must expose dispatcher-level V2 readiness");
assert(releaseReadiness.includes("runRepositoryIntelligenceV2DescriptorReadinessSmoke"), "release readiness must execute the public descriptor smoke");
assert(releaseReadiness.includes('status: issues.length ? "fail" : "pass"'), "public descriptor failures must block release readiness");
assert(routes.includes("system_layer_descriptor_callability_audit"), "system-layer routes must expose the universal descriptor callability audit");
assert(routes.includes("runSystemLayerDescriptorCallabilityAudit"), "system-layer routes must implement the universal descriptor audit");
assert(routes.includes('readiness_tool: "tenant_repository_intelligence_v2_readiness_smoke"'), "V2 descriptor source must declare its safe readiness smoke");
assert(routes.includes('readiness_tool: "tenant_repository_advisory_comment_v5_readiness_smoke"'), "V5 descriptor source must declare its safe readiness smoke");
assert(routes.includes("failed_source_count"), "descriptor audit must fail closed on source-level failures");
assert(releaseReadiness.includes("checkSystemLayerDescriptorCallability"), "release readiness must execute the universal descriptor callability audit");
assert(releaseReadiness.includes("system_layer_descriptor_callability.status === \"fail\""), "descriptor audit failures must block release readiness");

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
