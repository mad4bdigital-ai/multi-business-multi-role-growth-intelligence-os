import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const policyPath = "http-generic-api/config/staging-openapi-mcp-policy.json";
const inspectionPath = "http-generic-api/config/admin-tenant-inspection-policy.json";
const policy = JSON.parse(read(policyPath));
const inspection = JSON.parse(read(inspectionPath));
const presetSource = read("http-generic-api/tenantGptOAuthPreset.js");
const oauthConfigSource = read("http-generic-api/tenantGptOAuthClientConfig.js");
const resourceProfileSource = read("http-generic-api/tenantGptOAuthResourceProfile.js");
const systemLayerSource = read("http-generic-api/routes/systemLayerRoutes.js");
const oauthTokenSource = read("http-generic-api/routes/tenantGptOAuthTokenExchangeRoutes.js");
const actAsUserPolicySource = read("http-generic-api/actAsUserExecutionPolicy.js");
const actAsUserTestSource = read("http-generic-api/test-act-as-user-execution-policy.mjs");

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
assert(inspection.runtime_binding?.status === "not_bound", "inspection must not claim runtime binding before adapter implementation");
assert(inspection.runtime_binding?.adapter_required === true, "inspection must require an explicit runtime adapter");
assert(inspection.runtime_binding?.deny_until_bound === true, "inspection must deny requests until runtime binding is proven");
for (const evidence of ["authority_resolution", "tenant_membership", "route_allowlist", "readback", "audit_record"]) {
  assert(inspection.runtime_binding?.required_evidence?.includes(evidence), `inspection runtime binding must require ${evidence} evidence`);
}
assert(inspection.admin_context_may_borrow_tenant_authority === false, "Admin must not borrow Tenant authority");
assert(inspection.required_request_fields.includes("tenant_id"), "inspection must require tenant_id");
assert(inspection.required_request_fields.includes("expires_at"), "inspection must require expiry");
assert(inspection.required_request_fields.includes("correlation_id"), "inspection must require audit correlation");
assert(inspection.allowed_operations.every((op) => ["list_routes", "list_tools", "list_catalogs", "read_schema"].includes(op)), "inspection allowed operations must remain read-only discovery operations");
assert(inspection.denied_operations.some((op) => ["call_tool", "execute", "create", "update", "delete", "deploy"].includes(op)), "inspection must deny mutations/tool execution");
const actAsUser = inspection.act_as_user || {};
assert(actAsUser.status === "not_bound", "Act-as-User must remain unbound until runtime implementation and evidence exist");
assert(actAsUser.deny_until_bound === true, "Act-as-User must deny until runtime binding");
assert(actAsUser.target_must_be_lower_role === true, "Act-as-User target must be lower role");
assert(actAsUser.same_tenant_required === true, "Act-as-User must require same Tenant");
assert(actAsUser.effective_authority_rule === "actor_intersection_target_intersection_tenant_intersection_tool", "Act-as-User must use effective authority intersection");
assert(actAsUser.allowed_operations?.includes("call_tool") && actAsUser.allowed_operations?.includes("execute"), "Act-as-User contract must explicitly scope call/execute");
for (const field of ["tenant_id", "target_user_id", "reason", "owner", "expires_at", "correlation_id", "operation_scope", "idempotency_key"]) {
  assert(actAsUser.required_request_fields?.includes(field), `Act-as-User must require ${field}`);
}
assert(Number(actAsUser.max_ttl_seconds) <= 900, "Act-as-User TTL must be at most 900 seconds");
assert(Number(actAsUser.max_operation_scope_entries) <= 50, "Act-as-User operation scope must remain bounded");
assert(actAsUser.wildcard_operation_scope_allowed === false, "Act-as-User must reject wildcard operation scopes");
assert(actAsUser.requires_target_membership === true && actAsUser.requires_active_delegation === true, "Act-as-User must require active target membership and delegation");
for (const control of ["actor_identity_immutable", "target_identity_immutable", "no_token_substitution", "no_cross_tenant", "no_role_escalation", "replay_protection_required", "idempotency_key_required", "audit_secrets_forbidden", "explicit_per_tool_binding_required", "sensitive_tool_step_up_required"]) {
  assert(actAsUser.security_controls?.[control] === true, `Act-as-User security control must remain enabled: ${control}`);
}

assert(presetSource.includes("TENANT_GPT_STAGING_OAUTH_CLIENT_ID"), "staging preset must use a dedicated OAuth client ID namespace");
assert(presetSource.includes("TENANT_GPT_STAGING_OAUTH_CLIENT_SECRET"), "staging preset must use a dedicated OAuth secret namespace");
assert(presetSource.includes("https://dev.mad4b.com"), "staging preset must retain dev resource fallback");
assert(oauthConfigSource.includes("TENANT_GPT_OAUTH_CLIENT_SECRET_ENV") && oauthConfigSource.includes("TENANT_GPT_STAGING_OAUTH_CLIENT_SECRET"), "staging runtime must use the environment-selected staging OAuth secret variable");
assert(oauthConfigSource.includes("url.protocol === \"https:\""), "OAuth callback normalization must require HTTPS");
assert(oauthConfigSource.includes("hostname === \"chatgpt.com\" || hostname === \"chat.openai.com\""), "OAuth callback normalization must restrict hosts to ChatGPT");
assert(resourceProfileSource.includes("TENANT_GPT_IS_STAGING_RUNTIME ? \"\" : \"https://activation.mad4b.com\""), "staging resource profile must not expose activation resource");
assert(resourceProfileSource.includes("clientId"), "resource profile must bind the request to a client ID");
assert(oauthTokenSource.includes("equivalentRedirectUri"), "token exchange must enforce redirect binding");
assert(oauthTokenSource.includes("resolveTenantGptOAuthResourceProfile"), "token exchange must enforce environment resource binding");
assert(systemLayerSource.includes("tenant_system_tool_route_not_allowed"), "Tenant tool dispatch must retain a stable deny code");
assert(systemLayerSource.includes("TENANT_BLOCKED_SYSTEM_TOOL_NAMES"), "Tenant discovery must retain blocked system tool filtering");
assert(systemLayerSource.includes('dispatchToolForCaller("tenant"'), "Tenant tool dispatch must use the tenant caller boundary");
assert(actAsUserPolicySource.includes("resolveActAsUserExecutionContext"), "Act-as-User must have a dedicated execution-policy resolver");
assert(actAsUserPolicySource.includes("act_as_user_role_escalation_denied"), "Act-as-User resolver must deny role escalation");
assert(actAsUserPolicySource.includes("act_as_user_capability_intersection_denied"), "Act-as-User resolver must enforce capability intersection");
assert(actAsUserPolicySource.includes("act_as_user_idempotency_required"), "Act-as-User resolver must require replay protection");
assert(actAsUserPolicySource.includes("act_as_user_revoked"), "Act-as-User resolver must enforce revocation");
assert(actAsUserTestSource.includes("act-as-user execution policy tests passed"), "Act-as-User regression test must remain present");

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

const result = { ok: failures.length === 0, failures, checked: { schemas: schemas.map(([name, p]) => ({ name, path: p, operation_count: operationCount(read(p)), server_urls: serverUrls(read(p)) })), policyPath, inspectionPath, runtime_guards: ["oauth_callback_https_chatgpt_host", "oauth_resource_profile_binding", "oauth_redirect_binding", "tenant_tool_dispatch_deny"] } };
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
