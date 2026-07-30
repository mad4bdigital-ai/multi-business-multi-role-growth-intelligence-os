import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  _testingBrandSkillActivationService,
  normalizeRequestedOperations,
  normalizeTtlHours,
  operationsAllowed,
} from "./brandSkillActivationService.js";
import {
  assertRequestedResourceBelongsToBrand,
  grantCoversOperations,
  mergeAllowedOperations,
} from "./brandSkillResourceBinding.js";
import { brandSkillActivationHttpStatus } from "./routes/brandSkillRoutes.js";
import { assessMigrationSqlPreflight } from "./releaseReadiness.js";

assert.deepEqual(normalizeRequestedOperations(["Publish", "update", "publish"]), ["publish", "update"]);
assert.equal(operationsAllowed(["publish"], ["create", "publish"]), true);
assert.equal(operationsAllowed(["delete"], ["create", "publish"]), false);
assert.equal(operationsAllowed(["delete"], ["*"]), true);
assert.equal(normalizeTtlHours(null, "temporary_only", 48), 24);
assert.equal(normalizeTtlHours(null, "self_service", 48), 48);
assert.equal(normalizeTtlHours(null, "self_service", null), null);
assert.equal(normalizeTtlHours(12, "self_service", 48), 12);
assert.throws(() => normalizeRequestedOperations(["BAD OPERATION"]), (error) => error.code === "BRAND_SKILL_OPERATIONS_INVALID");
assert.throws(() => normalizeTtlHours(49, "temporary_only", 48), (error) => error.code === "BRAND_SKILL_TTL_INVALID");
assert.equal(grantCoversOperations('["publish","update"]', ["update"]), true);
assert.equal(grantCoversOperations('["publish"]', ["update"]), false);
assert.deepEqual(mergeAllowedOperations('["publish"]', ["update", "publish"]), ["publish", "update"]);
assert.deepEqual(
  mergeAllowedOperations('["publish","delete"]', ["update"], ["publish", "update"]),
  ["publish", "update"],
  "operations removed from the current policy must not survive grant expansion",
);
assert.equal(brandSkillActivationHttpStatus({ created: true, changed: true }), 201);
assert.equal(brandSkillActivationHttpStatus({ created: false, changed: true }), 200);
assert.equal(brandSkillActivationHttpStatus({ created: false, changed: false }), 200);

const ttlClampQueries = [];
const ttlClampChanged = await _testingBrandSkillActivationService.clampActiveGrantTtl({
  async query(sql, params) {
    ttlClampQueries.push({ sql: String(sql), params });
    return [{ affectedRows: 1 }];
  },
}, { grantId: "grant-1", ttlHours: 48 });
assert.equal(ttlClampChanged, true);
assert.equal(ttlClampQueries.length, 1);
assert.match(ttlClampQueries[0].sql, /expires_at IS NULL OR expires_at > DATE_ADD\(NOW\(\), INTERVAL \? HOUR\)/i);
assert.deepEqual(ttlClampQueries[0].params, [48, "grant-1", 48]);
let skippedClampQueries = 0;
const skippedClamp = await _testingBrandSkillActivationService.clampActiveGrantTtl({
  async query() {
    skippedClampQueries += 1;
    return [{ affectedRows: 1 }];
  },
}, { grantId: "grant-2", ttlHours: null });
assert.equal(skippedClamp, false);
assert.equal(skippedClampQueries, 0);

assert.throws(
  () => _testingBrandSkillActivationService.validatePolicy({
    activation_mode: "approval_required",
    allowed_roles_json: ["owner"],
    allowed_agent_ids_json: [],
    allowed_operations_json: ["publish"],
  }, { membershipRole: "owner", agentId: "agent-1", operations: ["publish"] }),
  (error) => error.code === "BRAND_SKILL_APPROVAL_REQUIRED"
);
assert.throws(
  () => _testingBrandSkillActivationService.validatePolicy({
    activation_mode: "self_service",
    allowed_roles_json: ["publisher"],
    allowed_agent_ids_json: ["agent-1"],
    allowed_operations_json: ["publish"],
  }, { membershipRole: "viewer", agentId: "agent-1", operations: ["publish"] }),
  (error) => error.code === "BRAND_SKILL_ROLE_DENIED"
);

const directBrandBinding = await assertRequestedResourceBelongsToBrand({ query: async () => { throw new Error("query not expected"); } }, {
  tenantId: "tenant-1",
  brandKey: "brand-1",
  requestedResourceType: "brand",
  requestedResourceRef: "brand-1",
});
assert.equal(directBrandBinding.binding_source, "brand_key");

await assert.rejects(
  () => assertRequestedResourceBelongsToBrand({ query: async () => [] }, {
    tenantId: "tenant-1",
    brandKey: "brand-1",
    requestedResourceType: "brand",
    requestedResourceRef: "brand-2",
  }),
  (error) => error.code === "BRAND_SKILL_RESOURCE_BRAND_MISMATCH"
);

const workspaceBinding = await assertRequestedResourceBelongsToBrand({ query: async () => { throw new Error("query not expected"); } }, {
  tenantId: "tenant-1",
  brandKey: "brand-1",
  workspace: { workspace_id: "workspace-1", workspace_key: "brand-workspace-1" },
  requestedResourceType: "workspace",
  requestedResourceRef: "workspace-1",
});
assert.equal(workspaceBinding.binding_source, "workspace_registry");

const siteQueries = [];
const siteBinding = await assertRequestedResourceBelongsToBrand({
  async query(sql, params) {
    siteQueries.push({ sql: String(sql), params });
    return [[{ binding_id: "binding-1", site_id: "site-1" }]];
  },
}, {
  tenantId: "tenant-1",
  brandKey: "brand-1",
  requestedResourceType: "site",
  requestedResourceRef: "site-1",
});
assert.equal(siteBinding.binding_source, "brand_site_bindings");
assert.match(siteQueries[0].sql, /JOIN cms_sites/i);
assert.match(siteQueries[0].sql, /LIMIT 2/i);
assert.deepEqual(siteQueries[0].params, ["brand-1", "site-1", "site-1", "site-1", "site-1"]);

await assert.rejects(
  () => assertRequestedResourceBelongsToBrand({ query: async () => [[]] }, {
    tenantId: "tenant-1",
    brandKey: "brand-1",
    requestedResourceType: "site",
    requestedResourceRef: "site-2",
  }),
  (error) => error.code === "BRAND_SKILL_RESOURCE_BRAND_MISMATCH"
);

await assert.rejects(
  () => assertRequestedResourceBelongsToBrand({
    query: async () => [[
      { binding_id: "binding-1", site_id: "site-1" },
      { binding_id: "binding-2", site_id: "site-2" },
    ]],
  }, {
    tenantId: "tenant-1",
    brandKey: "brand-1",
    requestedResourceType: "site",
    requestedResourceRef: "shared.example.com",
  }),
  (error) => error.code === "BRAND_SKILL_RESOURCE_BINDING_AMBIGUOUS"
);

await assert.rejects(
  () => assertRequestedResourceBelongsToBrand({ query: async () => [[]] }, {
    tenantId: "tenant-1",
    brandKey: "brand-1",
    requestedResourceType: "app",
    requestedResourceRef: "app-1",
  }),
  (error) => error.code === "BRAND_SKILL_RESOURCE_BRAND_BINDING_UNSUPPORTED"
);

const migrationName = "20260728_brand_scoped_user_skill_activation.sql";
const migration = readFileSync(new URL(`./migrations/${migrationName}`, import.meta.url), "utf8");
for (const marker of [
  "CREATE TABLE IF NOT EXISTS brand_skill_policies",
  "CREATE TABLE IF NOT EXISTS user_brand_skill_grants",
  "CREATE OR REPLACE VIEW v_effective_user_brand_skill_grants",
  "configured_brand_policy_enforcement_fail_closed=true",
  "automatic_skill_activation=false",
  "same_cycle_readback_required=true",
  "secrets_included=false",
]) assert(migration.includes(marker), `migration missing ${marker}`);
assert.doesNotMatch(migration, /^\s*(DROP|TRUNCATE|DELETE FROM)\b/mi);
const preflight = assessMigrationSqlPreflight(migrationName, migration);
assert.notEqual(preflight.status, "fail", JSON.stringify(preflight, null, 2));
assert.equal(preflight.secrets_included, false);

const service = readFileSync(new URL("./brandSkillActivationService.js", import.meta.url), "utf8");
for (const marker of [
  "BRAND_SKILL_ACTIVE_MEMBERSHIP_REQUIRED",
  "BRAND_SKILL_RESOURCE_GRANT_REQUIRED",
  "BRAND_SKILL_AGENT_GRANT_REQUIRED",
  "BRAND_SKILL_POLICY_REQUIRED",
  "BRAND_SKILL_OPERATION_DENIED",
  "v_effective_user_brand_skill_grants",
  "m.role AS role",
  "assertRequestedResourceBelongsToBrand",
  "allowed_operations_json = ?",
  "operation_set_extended: true",
  "policy.allowed_operations_json",
  "clampActiveGrantTtl",
  "ttl_clamped: ttlClamped",
  "created: false",
  "created: true",
  "SET status = 'expired'",
  "expires_at <= CURRENT_TIMESTAMP",
  "provider_call_allowed: false",
  "external_write_allowed: false",
]) assert(service.includes(marker), `service missing ${marker}`);
assert.doesNotMatch(service, /m\.role_key AS role/);
assert.doesNotMatch(service, /\brows\s*\[\s*0\s*\]/);

const bindingGuard = readFileSync(new URL("./brandSkillResourceBinding.js", import.meta.url), "utf8");
for (const marker of [
  "brand_site_bindings",
  "workspace_assets",
  "BRAND_SKILL_RESOURCE_BRAND_MISMATCH",
  "BRAND_SKILL_RESOURCE_BINDING_AMBIGUOUS",
  "BRAND_SKILL_RESOURCE_BRAND_BINDING_UNSUPPORTED",
  "BRAND_SKILL_RESOURCE_BINDING_UNAVAILABLE",
]) assert(bindingGuard.includes(marker), `binding guard missing ${marker}`);
assert.doesNotMatch(bindingGuard, /\brows\s*\[\s*0\s*\]/);

const routes = readFileSync(new URL("./routes/brandSkillRoutes.js", import.meta.url), "utf8");
assert(routes.includes("requireUserJwt"));
assert(routes.includes("/me/workspaces/:tenant_id/brands/:brand_key/skills"));
assert(routes.includes("/:skill_key/activate"));
assert(routes.includes("/:skill_key/activation"));
assert(routes.includes("brandSkillActivationHttpStatus"));
assert(routes.includes("result.created === true ? 201 : 200"));
assert(routes.includes("requestId"));

const gate = readFileSync(new URL("./agentToolAuthorizationGate.js", import.meta.url), "utf8");
assert(gate.includes("resolveUserBrandSkillEntitlement"));
assert(gate.includes("user_brand_skill_grant"));
assert(gate.includes("action_registry_resolution_failed"));
assert(gate.includes("AGENT_TOOL_ACTION_AMBIGUOUS"));
assert(gate.includes('configured: true'));
assert(gate.includes('granted: false'));
assert.doesNotMatch(gate, /\brows\s*\[\s*0\s*\]/);
assert.doesNotMatch(gate, /loadAction\([^)]*\)\.catch\(\(\)\s*=>\s*null\)/);

const entitlement = readFileSync(new URL("./userBrandSkillEntitlement.js", import.meta.url), "utf8");
assert(entitlement.includes("brand_skill_policies"));
assert(entitlement.includes("v_effective_user_brand_skill_grants"));
assert(entitlement.includes("user_brand_skill_grant_missing"));
assert(entitlement.includes("enforce_brand_skill_entitlement"));

const openapi = readFileSync(new URL("./openapi/brand-skill-activation.yaml", import.meta.url), "utf8");
assert(openapi.includes("openapi: 3.1.0"));
assert(openapi.includes("activateBrandSkillForSignedInUser"));
assert(openapi.includes("Scope-idempotent activation"));
assert(openapi.includes("Idempotency-Key is not required"));
assert(openapi.includes("ErrorEnvelope"));
assert(openapi.includes("requestId"));

console.log("PASS brand-scoped user skill activation");
