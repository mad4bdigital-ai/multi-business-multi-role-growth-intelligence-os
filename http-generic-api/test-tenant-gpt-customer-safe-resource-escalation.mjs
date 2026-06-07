import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const instructions = readFileSync("../GPT_Tenant_Connector_Instructions.md", "utf8");
const knowledge = readFileSync("../GPT_Tenant_Connector_Knowledge.md", "utf8");
const operatingGuide = readFileSync("docs/tenant-gpt-operating-guide.md", "utf8");
const routeSource = readFileSync("routes/workspaceResourceRoutes.js", "utf8");
const migration = readFileSync("migrations/228_sprint67_workspace_brands_list_tool.sql", "utf8");
const openapi = readFileSync("openapi.yaml", "utf8");

assert(instructions.length < 8000, "compact Tenant GPT instructions must stay under 8,000 characters");
assert(instructions.includes("do not show internal route/key/admin wording"), "compact instructions must suppress internal wording");
assert(instructions.includes("connect_escalate"), "compact instructions must require support escalation when available");
assert(instructions.includes("Only show resources returned by tenant-safe authority tools or role-inherited grants"), "compact instructions must enforce resource evidence");

for (const doc of [knowledge, operatingGuide]) {
  assert(doc.includes("workspace_brands_list"), "guides must prefer the tenant-safe brand list tool");
  assert(doc.includes("workspace_resource_grants_list"), "guides must fall back to resource grants");
  assert(doc.includes("workspace_assets_list"), "guides must limit asset brand_ref usage");
  assert(doc.includes("platform_access") && doc.includes("not"), "guides must reject platform_access counts as ownership evidence");
  assert(doc.includes("connect_escalate"), "guides must auto-escalate ambiguous resource authority");
}

assert(routeSource.includes('/me/workspaces/:tenant_id/brands'), "brand list route must exist");
assert(routeSource.includes("diagnostic_counts_used_as_authority: false"), "route must return an evidence guard");
assert(migration.includes("workspace_brands_list"), "tenant tool migration must register workspace_brands_list");
assert(openapi.includes("/me/workspaces/{tenant_id}/brands"), "OpenAPI must document the brand list route");

console.log("tenant GPT customer-safe resource escalation tests passed");
