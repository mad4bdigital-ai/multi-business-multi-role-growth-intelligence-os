import assert from "node:assert/strict";
import { TENANT_CONNECTION_SELF_REPAIR_ROUTE_CONTRACTS, assertNoSecretBearingFields, buildEffectiveCredentialPlan, findTenantConnectionSelfRepairRoute, validateTenantConnectionSelfRepairRequest } from "./tenantConnectionSelfRepairService.js";

assert.equal(TENANT_CONNECTION_SELF_REPAIR_ROUTE_CONTRACTS.length, 9);

const promotionOrder = [
  "tenant_connection_effective_credential_plan_view",
  "tenant_connection_validate_adapter_smoke",
  "tenant_connection_binding_refresh",
  "tenant_connection_resolver_refresh",
  "tenant_connection_readback_certification",
  "tenant_connection_recertification_policy",
  "tenant_connection_provider_grant_refresh",
  "tenant_connection_bounded_mutation_preflight",
  "tenant_connection_bounded_mutation_execute",
];

const requiredToolKeys = new Set([
  "tenant_connection_validate_adapter_smoke",
  "tenant_connection_effective_credential_plan_view",
  "tenant_connection_binding_refresh",
  "tenant_connection_provider_grant_refresh",
  "tenant_connection_resolver_refresh",
  "tenant_connection_bounded_mutation_preflight",
  "tenant_connection_bounded_mutation_execute",
  "tenant_connection_readback_certification",
  "tenant_connection_recertification_policy",
]);

assert.deepEqual([...requiredToolKeys].sort(), [...promotionOrder].sort());
assert.deepEqual(
  TENANT_CONNECTION_SELF_REPAIR_ROUTE_CONTRACTS.map((route) => route.tool_key),
  [
    "tenant_connection_validate_adapter_smoke",
    "tenant_connection_effective_credential_plan_view",
    "tenant_connection_binding_refresh",
    "tenant_connection_provider_grant_refresh",
    "tenant_connection_resolver_refresh",
    "tenant_connection_bounded_mutation_preflight",
    "tenant_connection_bounded_mutation_execute",
    "tenant_connection_readback_certification",
    "tenant_connection_recertification_policy",
  ],
);

const routeByKey = new Map(TENANT_CONNECTION_SELF_REPAIR_ROUTE_CONTRACTS.map((route) => [route.tool_key, route]));
for (const readOnlyKey of ["tenant_connection_effective_credential_plan_view", "tenant_connection_validate_adapter_smoke"]) {
  assert.equal(routeByKey.get(readOnlyKey).provider_write_allowed, false);
  assert.equal(routeByKey.get(readOnlyKey).requires_operator_approval, false);
}
for (const governedWriteKey of [
  "tenant_connection_binding_refresh",
  "tenant_connection_provider_grant_refresh",
  "tenant_connection_resolver_refresh",
  "tenant_connection_readback_certification",
  "tenant_connection_recertification_policy",
]) {
  assert.equal(routeByKey.get(governedWriteKey).requires_operator_approval, true);
  assert.equal(routeByKey.get(governedWriteKey).requires_readback, true);
}
assert.equal(routeByKey.get("tenant_connection_bounded_mutation_preflight").provider_write_allowed, false);
assert.equal(routeByKey.get("tenant_connection_bounded_mutation_execute").provider_write_allowed, true);
assert.equal(routeByKey.get("tenant_connection_bounded_mutation_execute").requires_preflight_id, true);
assert.equal(routeByKey.get("tenant_connection_bounded_mutation_execute").requires_live_execution_approval, true);
assert.equal(routeByKey.get("tenant_connection_bounded_mutation_execute").publish_or_destructive_default_blocked, true);

for (const route of TENANT_CONNECTION_SELF_REPAIR_ROUTE_CONTRACTS) {
  assert.ok(requiredToolKeys.has(route.tool_key), `unexpected route ${route.tool_key}`);
  assert.match(route.path, /^\/me\/connections\/\{connection_id\}\//);
  assert.equal(route.requires_readback, true);
  assert.equal(route.path.includes("secret"), false);
  assert.equal(route.path.includes("token"), false);
}

assert.equal(findTenantConnectionSelfRepairRoute("tenant_connection_validate_adapter_smoke").method, "POST");
assert.equal(findTenantConnectionSelfRepairRoute("tenant_connection_effective_credential_plan_view").method, "GET");

const unknown = validateTenantConnectionSelfRepairRequest("missing_route", { connection_id: "c1" });
assert.equal(unknown.ok, false);
assert.equal(unknown.status, 404);
assert.equal(unknown.secrets_included, false);

const readOnlySmoke = validateTenantConnectionSelfRepairRequest("tenant_connection_validate_adapter_smoke", { connection_id: "c1", app_key: "wordpress_rest" });
assert.equal(readOnlySmoke.ok, true);
assert.equal(readOnlySmoke.provider_write_allowed, false);
assert.equal(readOnlySmoke.readback_required, true);

const bindingWithoutApproval = validateTenantConnectionSelfRepairRequest("tenant_connection_binding_refresh", { connection_id: "c1", target_key: "brand_a", action_key: "wordpress_api" });
assert.equal(bindingWithoutApproval.ok, false);
assert.equal(bindingWithoutApproval.status, 403);
assert.equal(bindingWithoutApproval.error.code, "tenant_connection_self_repair_operator_approval_required");

const preflight = validateTenantConnectionSelfRepairRequest("tenant_connection_bounded_mutation_preflight", { connection_id: "c1", adapter_key: "wordpress_rest", operator_approved: true, dry_run: true, preflight_only: true });
assert.equal(preflight.ok, true);
assert.equal(preflight.provider_write_allowed, false);

const executeWithoutPreflight = validateTenantConnectionSelfRepairRequest("tenant_connection_bounded_mutation_execute", { connection_id: "c1", adapter_key: "wordpress_rest", operator_approved: true, live_execution_approved: true });
assert.equal(executeWithoutPreflight.ok, false);
assert.equal(executeWithoutPreflight.error.code, "tenant_connection_self_repair_preflight_id_required");

const executePublishBlocked = validateTenantConnectionSelfRepairRequest("tenant_connection_bounded_mutation_execute", { connection_id: "c1", adapter_key: "wordpress_rest", operator_approved: true, live_execution_approved: true, preflight_id: "pf_1", publish_or_destructive_approved: true });
assert.equal(executePublishBlocked.ok, false);
assert.equal(executePublishBlocked.error.code, "tenant_connection_self_repair_publish_destructive_requires_adapter_policy");

const execute = validateTenantConnectionSelfRepairRequest("tenant_connection_bounded_mutation_execute", { connection_id: "c1", adapter_key: "wordpress_rest", operator_approved: true, live_execution_approved: true, preflight_id: "pf_1" });
assert.equal(execute.ok, true);
assert.equal(execute.provider_write_allowed, true);
assert.equal(execute.readback_required, true);

assert.throws(() => assertNoSecretBearingFields({ nested: { access_token: "x" } }), /Secret-bearing field is not allowed/);

const plan = buildEffectiveCredentialPlan({
  connection: { connection_id: "c1", tenant_id: "t1", user_id: "u1", app_key: "wordpress_rest", auth_type: "basic_auth", status: "active", validation_status: "validated", secret_present: true },
  bindings: [{ binding_id: "b1", connection_id: "c1", action_key: "wordpress_api", credential_role: "default", credential_ref: "connection:c1", resolution_priority: 5, status: "active" }],
  grants: [{ grant_id: "g1", resource_type: "cms_site", resource_ref: "site_1", status: "active" }],
});

assert.equal(plan.ok, true);
assert.equal(plan.connection.secret_present, true);
assert.equal(plan.effective_binding.credential_ref, "connection:c1");
assert.equal(plan.platform_fallback_allowed, false);
assert.equal(plan.no_raw_secret_return, true);
assert.equal(plan.secrets_included, false);
assert.equal(JSON.stringify(plan).includes("access_token"), false);

console.log("tenant connection self-repair service contract passed");
