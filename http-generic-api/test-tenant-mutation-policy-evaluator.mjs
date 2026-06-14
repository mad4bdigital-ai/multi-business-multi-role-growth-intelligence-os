import assert from "node:assert/strict";
import { evaluateTenantToolVisibility } from "./routes/gptToolsRoutes.js";
import { evaluateTenantPlatformEndpointExport } from "./routes/systemLayerRoutes.js";

const allowedDeviceInstall = evaluateTenantToolVisibility({
  tool_key: "connect_device_install",
  http_method: "POST",
  http_path: "/connect/device-install",
  tags: "connect,install,device,mode_governed,state_changing,no_raw_secrets",
});
assert.equal(allowedDeviceInstall.allowed, true);
assert.match(allowedDeviceInstall.reason, /^governed_mutation:/);

const allowedReadonlyPost = evaluateTenantToolVisibility({
  tool_key: "tenant_database_preflight",
  http_method: "POST",
  http_path: "/me/infrastructure/database/connections/{connection_id}/preflight",
  tags: "tenant,preflight,dry_run,read_only,no_secrets",
});
assert.equal(allowedReadonlyPost.allowed, true);

const missingGovernance = evaluateTenantToolVisibility({
  tool_key: "unclassified_mutation",
  http_method: "POST",
  http_path: "/me/unclassified",
  tags: "misc",
});
assert.equal(missingGovernance.allowed, false);
assert.equal(missingGovernance.reason, "missing_mutation_governance_tag");

const blockedGithubWrite = evaluateTenantToolVisibility({
  tool_key: "github_put_contents",
  http_method: "PUT",
  http_path: "/github/contents",
  tags: "tenant,state_changing",
});
assert.equal(blockedGithubWrite.allowed, false);
assert.equal(blockedGithubWrite.reason, "high_risk_tool_name");

const blockedRawSecrets = evaluateTenantToolVisibility({
  tool_key: "tenant_secret_export",
  http_method: "POST",
  http_path: "/me/secret-export",
  tags: "tenant,state_changing,raw_secrets",
});
assert.equal(blockedRawSecrets.allowed, false);
assert.equal(blockedRawSecrets.reason, "blocked_tag:raw_secrets");

const allowedTenantRead = evaluateTenantToolVisibility({
  tool_key: "connect_status",
  http_method: "GET",
  http_path: "/connect/status",
  tags: "tenant,read_only",
});
assert.equal(allowedTenantRead.allowed, true);
assert.equal(allowedTenantRead.reason, "read_only_method");

const platformTenantRead = evaluateTenantPlatformEndpointExport({
  scope_class: "tenant",
  method: "GET",
  auth_policy_json: JSON.stringify({ tenant_allowed: true }),
}, { is_admin: false });
assert.equal(platformTenantRead.allowed, true);

const platformGovernedMutation = evaluateTenantPlatformEndpointExport({
  scope_class: "tenant",
  method: "POST",
  auth_policy_json: JSON.stringify({ tenant_allowed: true }),
  execution_policy_json: JSON.stringify({ capability_envelope_required: true, execution_mode: "capability_gated" }),
}, { is_admin: false });
assert.equal(platformGovernedMutation.allowed, true);
assert.equal(platformGovernedMutation.reason, "governed_tenant_mutation");

const platformMissingGate = evaluateTenantPlatformEndpointExport({
  scope_class: "tenant",
  method: "POST",
  auth_policy_json: JSON.stringify({ tenant_allowed: true }),
  execution_policy_json: JSON.stringify({ runtime_callable: true }),
}, { is_admin: false });
assert.equal(platformMissingGate.allowed, false);
assert.equal(platformMissingGate.reason, "tenant_mutation_governance_gate_missing");

const platformMissingTenantAllow = evaluateTenantPlatformEndpointExport({
  scope_class: "both",
  method: "POST",
  execution_policy_json: JSON.stringify({ approval_required: true }),
}, { is_admin: false });
assert.equal(platformMissingTenantAllow.allowed, false);
assert.equal(platformMissingTenantAllow.reason, "tenant_mutation_not_explicitly_allowed");

const platformAdminOnly = evaluateTenantPlatformEndpointExport({
  scope_class: "tenant",
  method: "GET",
  auth_policy_json: JSON.stringify({ requires_admin: true }),
}, { is_admin: false });
assert.equal(platformAdminOnly.allowed, false);
assert.equal(platformAdminOnly.reason, "admin_policy_required");

const platformDangerousMutation = evaluateTenantPlatformEndpointExport({
  scope_class: "tenant",
  method: "POST",
  auth_policy_json: JSON.stringify({ tenant_allowed: true }),
  execution_policy_json: JSON.stringify({ approval_required: true, direct_provider_write: true }),
}, { is_admin: false });
assert.equal(platformDangerousMutation.allowed, false);
assert.equal(platformDangerousMutation.reason, "dangerous_policy:direct_provider_write");

console.log("tenant mutation policy evaluator tests passed");
