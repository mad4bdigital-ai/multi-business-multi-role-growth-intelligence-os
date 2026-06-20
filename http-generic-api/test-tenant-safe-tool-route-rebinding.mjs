import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/1016_sprint69_tenant_safe_tool_route_rebinding.sql", "utf8");
const fullOpenApi = readFileSync("openapi.yaml", "utf8");
const tenantOpenApi = readFileSync("openapi.tenant-gpt.auth.yaml", "utf8");

for (const tool of [
  "local_gateway_tools_list",
  "local_connector_devices",
  "local_connector_health",
  "me_scope_grants_list",
]) {
  assert(migration.includes(`'${tool}'`), `${tool} must be covered by tenant-safe route rebinding`);
}

for (const path of [
  "'/local/tools'",
  "'/local-connector/devices'",
  "'/local-connector/health'",
  "'/me/scope-grants'",
]) {
  assert(migration.includes(path), `${path} must be the tenant-safe route target`);
}

assert(
  migration.includes("disabled_admin_path_drift") &&
    migration.includes("`http_path` LIKE '/admin/%'") &&
    migration.includes("`http_path` LIKE '/connector/%'"),
  "migration must disable tenant-visible rows that drift to admin or connector proxy paths"
);
assert(migration.includes("auth_derived"), "tenant-safe routes must derive identity context from auth");

for (const marker of [
  "no_provider_call",
  "no_credential_payload_read",
  "no_raw_secrets",
  "no_external_send",
  "no_external_write",
  "secrets_included=false",
]) {
  assert(migration.includes(marker), "migration must declare safety marker " + marker);
}

for (const spec of [fullOpenApi, tenantOpenApi]) {
  assert(spec.includes("  /local/tools:"), "OpenAPI must document GET /local/tools");
  assert(spec.includes("operationId: listLocalGatewayTools"), "OpenAPI must expose listLocalGatewayTools");
}
assert(tenantOpenApi.includes("https://auth.mad4b.com/scopes/tenant.system-tools"), "tenant action must require tenant.system-tools OAuth scope");

console.log("tenant-safe tool route rebinding guard passed");
