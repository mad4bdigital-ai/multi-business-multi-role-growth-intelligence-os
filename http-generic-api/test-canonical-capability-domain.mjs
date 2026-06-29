import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CapabilityDomainError,
  createCanonicalCapability,
} from "./src/domain/capability/canonicalCapability.js";
import {
  assertOneActiveAliasToOneCapability,
  createCapabilityAlias,
  normalizeSelectorValue,
} from "./src/domain/capability/capabilityAlias.js";
import { composeCapabilityPolicy } from "./src/domain/capability/policyComposition.js";
import { CapabilityInventoryService } from "./src/application/capability/capabilityInventoryService.js";

const readCapability = createCanonicalCapability({
  id: "cap_read",
  key: "github.repo.read",
  display_name: "GitHub repository read",
  risk_level: "low",
  effect: "read",
  state_changing: false,
  status: "active",
  policy_version: "v1",
});
assert.equal(readCapability.key, "github.repo.read");

assert.throws(
  () => createCanonicalCapability({
    id: "cap_write",
    key: "github.repo.write",
    display_name: "GitHub repository write",
    risk_level: "high",
    effect: "update",
    state_changing: true,
    status: "active",
    policy_version: "v1",
  }),
  (error) => error instanceof CapabilityDomainError && error.code === "INCOMPLETE_CAPABILITY_CLASSIFICATION"
);

const alias = createCapabilityAlias({
  id: "alias_1",
  selector_type: "tool_key",
  selector_value: " GitHub_Repo_Read ",
  canonical_capability_id: "cap_read",
  surface: "tenant",
  status: "active",
  registry_version: "v1",
});
assert.equal(alias.selector_value, "github_repo_read");
assert.equal(normalizeSelectorValue("route_key", "get /admin/capabilities"), "GET /admin/capabilities");
assert.throws(
  () => assertOneActiveAliasToOneCapability([
    alias,
    { ...alias, id: "alias_2", surface: "admin", canonical_capability_id: "cap_other" },
  ]),
  (error) => error.code === "CAPABILITY_ALIAS_CONFLICT"
);

const composed = composeCapabilityPolicy(
  {
    allowed_principal_classes: ["tenant", "admin"],
    allowed_roles: ["owner", "admin"],
    allowed_surfaces: ["tenant", "admin"],
    required_skills: ["repo.read"],
    mutation_mode: "user_approval",
    fail_closed: true,
    version: "v1",
  },
  {
    allowed_principal_classes: ["admin"],
    allowed_roles: ["owner"],
    allowed_surfaces: ["admin"],
    required_skills: ["repo.read", "repo.audit"],
    mutation_mode: "platform_admin_approval",
    fail_closed: true,
    version: "admin-v1",
  }
);
assert.deepEqual(composed.allowed_principal_classes, ["admin"]);
assert.equal(composed.mutation_mode, "platform_admin_approval");
assert.throws(
  () => composeCapabilityPolicy(
    { allowed_principal_classes: ["tenant"], allowed_roles: [], allowed_surfaces: ["tenant"], required_skills: [], mutation_mode: "preview_only", fail_closed: true },
    { allowed_principal_classes: ["tenant", "admin"], mutation_mode: "auto_bounded" }
  ),
  (error) => error.code === "SURFACE_POLICY_BROADENS_CANONICAL_POLICY"
);

const service = new CapabilityInventoryService({
  async listCanonicalCapabilities() { return [readCapability]; },
  async listAliases() { return [alias, { ...alias, id: "alias_admin", surface: "admin" }]; },
  async integrityFindings() { return []; },
});
const inventory = await service.buildInventory();
assert.equal(inventory.status, "pass");
assert.equal(inventory.counts.dual_surface_capabilities, 1);
assert.equal((await service.buildIntegrityReport()).status, "pass");

const migration = readFileSync("migrations/1030_sprint69_canonical_capability_domain.sql", "utf8");
assert.match(migration, /CREATE TABLE IF NOT EXISTS canonical_capabilities/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS capability_aliases/);
assert.match(migration, /CREATE OR REPLACE VIEW v_capability_alias_integrity/);
assert.match(migration, /admin_platform_endpoint_tools/);
assert.match(migration, /tenant_platform_endpoint_tools/);
assert.doesNotMatch(migration, /\bDROP\s+(TABLE|VIEW|DATABASE)\b/i);

console.log("canonical capability domain tests passed");
