import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const policyPath = "http-generic-api/config/staging-openapi-mcp-policy.json";
const inspectionPath = "http-generic-api/config/admin-tenant-inspection-policy.json";
const policy = JSON.parse(read(policyPath));
const inspection = JSON.parse(read(inspectionPath));

function assert(condition, message) {
  if (!condition) failures.push(message);
}
function operationCount(text) {
  return [...text.matchAll(/^\s+operationId:\s*\S+/gm)].length;
}
function serverUrls(text) {
  return [...text.matchAll(/^\s+- url:\s*(\S+)/gm)].map((m) => m[1]);
}

assert(policy.schema_version === "mad4b.staging-openapi-mcp-policy.v1", "staging policy schema version changed unexpectedly");
assert(policy.environment === "staging", "staging policy must target staging");
assert(policy.fail_closed === true, "staging policy must remain fail-closed");
assert(policy.custom_gpt.resource === "https://dev.mad4b.com", "Tenant staging resource must be dev.mad4b.com");
assert(policy.custom_gpt.authorization_server === "https://dev.mad4b.com", "Tenant staging issuer/resource boundary must be dev.mad4b.com");
assert(policy.custom_gpt.admin_read_only.write_activation === false, "Admin staging write activation must remain disabled");
assert(policy.custom_gpt.production_resources_forbidden.includes("https://auth.mad4b.com"), "auth production host must remain forbidden in staging");
assert(policy.custom_gpt.production_resources_forbidden.includes("https://activation.mad4b.com"), "activation production host must remain forbidden in staging");
assert(inspection.fail_closed === true, "Admin/Tenant inspection must be fail-closed");
assert(inspection.mode === "read_only_shadow", "inspection mode must remain read_only_shadow");
assert(inspection.admin_context_may_borrow_tenant_authority === false, "Admin must not borrow Tenant authority");
assert(inspection.required_request_fields.includes("tenant_id"), "inspection must require tenant_id");
assert(inspection.required_request_fields.includes("expires_at"), "inspection must require expiry");
assert(inspection.required_request_fields.includes("correlation_id"), "inspection must require audit correlation");
assert(inspection.allowed_operations.every((op) => ["list_routes", "list_tools", "list_catalogs", "read_schema"].includes(op)), "inspection allowed operations must remain read-only discovery operations");
assert(inspection.denied_operations.some((op) => ["call_tool", "execute", "create", "update", "delete", "deploy"].includes(op)), "inspection must deny mutations/tool execution");

const schemas = [
  ["tenant", "http-generic-api/openapi/openapi.tenant-gpt.staging.yaml", policy.custom_gpt.schema_url],
  ["admin", "http-generic-api/openapi/openapi.custom-gpt.staging-admin.yaml", policy.custom_gpt.admin_read_only.schema_url],
];
for (const [name, relativePath, expectedUrl] of schemas) {
  const text = read(relativePath);
  const urls = serverUrls(text);
  const count = operationCount(text);
  assert(urls.length === 1 && urls[0] === policy.custom_gpt.resource, `${name} schema must have exactly one staging server URI`);
  assert(expectedUrl.startsWith(policy.custom_gpt.resource + "/"), `${name} schema URL must be under staging resource`);
  assert(count <= 30, `${name} schema has ${count} operations; hard limit is 30`);
  assert(!/https:\/\/(auth|activation)\.mad4b\.com/.test(text), `${name} staging schema contains a production Auth/Activation host`);
  if (name === "tenant") assert(/https:\/\/dev\.mad4b\.com\/scopes\//.test(text), "tenant staging schema must use staging scopes");
}

const result = { ok: failures.length === 0, failures, checked: { schemas: schemas.map(([name, p]) => ({ name, path: p, operation_count: operationCount(read(p)), server_urls: serverUrls(read(p)) })), policyPath, inspectionPath } };
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
