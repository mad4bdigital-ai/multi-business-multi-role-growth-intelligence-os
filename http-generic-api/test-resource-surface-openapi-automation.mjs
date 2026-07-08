import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const snapshot = JSON.parse(readFileSync(new URL("./resource-surface-registry.snapshot.json", import.meta.url), "utf8"));
const openapi = JSON.parse(readFileSync(new URL("./openapi/resource-surfaces.generated.json", import.meta.url), "utf8"));

const required = [
  "system_endpoints",
  "admin_platform_endpoint_tools",
  "platform_data_table_registry",
  "platform_resource_operation_registry",
  "capability_resolution_envelopes",
  "user_app_connections",
  "app_action_grants",
  "cms_site_access_grants",
  "agent_skill_grants",
  "permission_grants",
];

const keys = new Set(snapshot.resource_surfaces.map((surface) => surface.table_key));
for (const key of required) assert(keys.has(key), `${key} must be present in the DB-backed resource surface snapshot`);

const adminEnum = openapi.paths["/admin/resources/{resourceKey}"].get.parameters.find((parameter) => parameter.name === "resourceKey").schema.enum;
for (const key of ["system_endpoints", "admin_platform_endpoint_tools", "platform_data_table_registry", "platform_resource_operation_registry", "capability_resolution_envelopes", "app_action_grants"]) {
  assert(adminEnum.includes(key), `${key} must be exposed in admin Resource API OpenAPI enum`);
}

const tenantEnum = openapi.paths["/me/workspaces/{tenant_id}/resources/{resourceKey}"].get.parameters.find((parameter) => parameter.name === "resourceKey").schema.enum;
for (const key of ["user_app_connections", "cms_site_access_grants", "agent_skill_grants", "permission_grants"]) {
  assert(tenantEnum.includes(key), `${key} must be exposed in tenant Resource API OpenAPI enum`);
}

const unsafe = /(secret|token|password|credential|cipher|private_key|encrypted|webhook_url|api_base_url|mcp_endpoint|scopes_granted|account_metadata)/i;
for (const surface of snapshot.resource_surfaces) {
  for (const field of ["readable_columns_json", "creatable_columns_json", "patchable_columns_json", "filterable_columns_json"]) {
    for (const column of surface[field] || []) {
      assert(!unsafe.test(column), `${surface.table_key}.${field} must not expose unsafe column ${column}`);
    }
  }
}

assert.equal(openapi["x-source-authority"], "platform_data_table_registry");
assert.equal(openapi["x-secrets-included"], false);
assert.equal(openapi["x-resource-surface-count"], snapshot.resource_surfaces.length);

const check = spawnSync(process.execPath, ["scripts/generate-resource-surface-openapi.mjs", "--check"], {
  cwd: new URL(".", import.meta.url),
  encoding: "utf8",
});
assert.equal(check.status, 0, check.stderr || check.stdout);

console.log("DB-backed Resource API OpenAPI automation coverage OK");
