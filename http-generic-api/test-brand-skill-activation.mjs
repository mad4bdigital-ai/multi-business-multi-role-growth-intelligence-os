import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  _testingBrandSkillActivationService,
  normalizeRequestedOperations,
  normalizeTtlHours,
  operationsAllowed,
} from "./brandSkillActivationService.js";
import { assessMigrationSqlPreflight } from "./releaseReadiness.js";

assert.deepEqual(normalizeRequestedOperations(["Publish", "update", "publish"]), ["publish", "update"]);
assert.equal(operationsAllowed(["publish"], ["create", "publish"]), true);
assert.equal(operationsAllowed(["delete"], ["create", "publish"]), false);
assert.equal(operationsAllowed(["delete"], ["*"]), true);
assert.equal(normalizeTtlHours(null, "temporary_only", 48), 24);
assert.equal(normalizeTtlHours(12, "self_service", 48), 12);
assert.throws(() => normalizeRequestedOperations(["BAD OPERATION"]), (error) => error.code === "BRAND_SKILL_OPERATIONS_INVALID");
assert.throws(() => normalizeTtlHours(49, "temporary_only", 48), (error) => error.code === "BRAND_SKILL_TTL_INVALID");
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
  "provider_call_allowed: false",
  "external_write_allowed: false",
]) assert(service.includes(marker), `service missing ${marker}`);

const routes = readFileSync(new URL("./routes/brandSkillRoutes.js", import.meta.url), "utf8");
assert(routes.includes("requireUserJwt"));
assert(routes.includes("/me/workspaces/:tenant_id/brands/:brand_key/skills"));
assert(routes.includes("/:skill_key/activate"));
assert(routes.includes("/:skill_key/activation"));
assert(routes.includes("requestId"));

const gate = readFileSync(new URL("./agentToolAuthorizationGate.js", import.meta.url), "utf8");
assert(gate.includes("resolveUserBrandSkillEntitlement"));
assert(gate.includes("user_brand_skill_grant"));

const entitlement = readFileSync(new URL("./userBrandSkillEntitlement.js", import.meta.url), "utf8");
assert(entitlement.includes("brand_skill_policies"));
assert(entitlement.includes("v_effective_user_brand_skill_grants"));
assert(entitlement.includes("user_brand_skill_grant_missing"));
assert(entitlement.includes("enforce_brand_skill_entitlement"));

const openapi = readFileSync(new URL("./openapi/brand-skill-activation.yaml", import.meta.url), "utf8");
assert(openapi.includes("openapi: 3.1.0"));
assert(openapi.includes("activateBrandSkillForSignedInUser"));
assert(openapi.includes("ErrorEnvelope"));
assert(openapi.includes("requestId"));

console.log("PASS brand-scoped user skill activation");
