import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GrowthControlPlaneError,
  assertNoSecretFields,
  buildGrowthControlScopeHierarchy,
  mergeConfigurationCandidates,
  normalizeGrowthControlScope,
  resolveEffectiveConfiguration,
  validateActivityPackManifest,
  validateSchemaDefinition,
  validateValueAgainstSchema
} from "./src/domain/growthControlPlane/growthControlPlane.js";
import {
  createGrowthControlPlaneService,
  _testingGrowthControlPlaneService
} from "./src/application/growthControlPlane/growthControlPlaneService.js";
import { _testingDynamicGrowthControlPlaneRoutes } from "./routes/dynamicGrowthControlPlaneRoutes.js";

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["approvalRequired","maxResources"],
  properties: {
    approvalRequired: { type: "boolean" },
    maxResources: { type: "integer", minimum: 1, maximum: 100 },
    locales: { type: "array", uniqueItems: true, items: { type: "string" } }
  }
};

assert.equal(validateSchemaDefinition(schema), true);
assert.deepEqual(validateValueAgainstSchema({ approvalRequired: true, maxResources: 3 }, schema), []);
assert(validateValueAgainstSchema({ approvalRequired: true, maxResources: 3, unknown: true }, schema).some((issue) => issue.issue === "unsupported"));
assert.throws(() => validateSchemaDefinition({ type: "object", arbitraryCode: "return true" }), (error) => error.code === "GROWTH_CONTROL_SCHEMA_KEYWORD_UNSUPPORTED");
assert.throws(() => assertNoSecretFields({ api_key: "forbidden" }), (error) => error.code === "GROWTH_CONTROL_SECRET_FIELD_FORBIDDEN");

const brandScope = normalizeGrowthControlScope({ scopeType: "brand", tenantId: "tenant-a", workspaceId: "workspace-a", brandKey: "brand-a" });
assert.equal(brandScope.scopeKey, "tenant:tenant-a:workspace:workspace-a:brand:brand-a");
assert.throws(() => normalizeGrowthControlScope({ scopeType: "brand", tenantId: "tenant-a" }), GrowthControlPlaneError);
const hierarchy = buildGrowthControlScopeHierarchy({ tenantId: "tenant-a", workspaceId: "workspace-a", brandKey: "brand-a", activityTypeKey: "travel" });
assert.deepEqual(hierarchy.map((item) => item.scopeType), ["platform","activity","tenant","workspace","brand"]);

const deny = mergeConfigurationCandidates([
  { value: true, rank: 40, versionNumber: 1, sourceId: "brand", scopeKey: "brand" },
  { value: false, rank: 0, versionNumber: 1, sourceId: "platform", scopeKey: "platform" }
], "deny_wins");
assert.equal(deny.value, false);
const conflict = mergeConfigurationCandidates([
  { value: 3, rank: 40, versionNumber: 1, sourceId: "a", scopeKey: "brand" },
  { value: 4, rank: 40, versionNumber: 1, sourceId: "b", scopeKey: "brand" }
], "priority_replace");
assert.equal(conflict.blocked, true);

const resolved = resolveEffectiveConfiguration({
  definition: {
    configKey: "growth.execution.policy",
    schema,
    defaultValues: { approvalRequired: true, maxResources: 10, locales: ["ar-EG"] },
    mergeProfile: { approvalRequired: "deny_wins", maxResources: "minimum", locales: "guarded_union" },
    revision: 1
  },
  scopeHierarchy: hierarchy,
  versions: [
    { configVersionId: "v1", scopeKey: hierarchy.at(-1).scopeKey, versionNumber: 1, versionRevision: 1, values: { maxResources: 3, locales: ["en"] } }
  ]
});
assert.equal(resolved.blocked, false);
assert.equal(resolved.values.maxResources, 3);
assert.deepEqual(resolved.values.locales, ["ar-EG","en"]);
assert.match(resolved.sha256, /^[a-f0-9]{64}$/);

const manifest = validateActivityPackManifest({
  entitySchemas: { destination: { type: "object" } },
  knowledgeProfile: { pointerKey: "travel.knowledge.active" },
  kpiTaxonomy: ["qualified_lead_rate"],
  capabilities: ["intent_map_generate"],
  workflows: ["organic_growth_plan"],
  policies: ["internal_draft_policy"],
  providerCompatibility: [],
  tests: { fixtures: ["travel-basic"] }
});
assert.match(manifest.checksumSha256, /^[a-f0-9]{64}$/);

const encodedCursor = _testingGrowthControlPlaneService.encodeCursor(25);
assert.equal(_testingGrowthControlPlaneService.decodeCursor(encodedCursor), 25);
assert.deepEqual(
  _testingGrowthControlPlaneService.normalizeListPage({ limit: "50", cursor: encodedCursor }),
  { limit: 50, offset: 25 }
);
assert.throws(
  () => _testingGrowthControlPlaneService.decodeCursor("not-a-cursor"),
  (error) => error.code === "GROWTH_CONTROL_CURSOR_INVALID"
);
assert.throws(
  () => _testingGrowthControlPlaneService.normalizeListPage({ limit: 101 }),
  (error) => error.code === "GROWTH_CONTROL_LIMIT_INVALID"
);
assert.throws(
  () => _testingDynamicGrowthControlPlaneRoutes.assertAllowedKeys({ unsupported: "1" }, new Set(["limit", "cursor"])),
  (error) => error.code === "GROWTH_CONTROL_VALIDATION_ERROR"
);

const stored = { definitions: new Map(), versions: [], snapshots: [] };
const fakeRepository = {
  async listConfigurationDefinitions({ limit = 25, offset = 0 } = {}) {
    return [...stored.definitions.values()]
      .sort((a, b) => a.configKey.localeCompare(b.configKey))
      .slice(offset, offset + limit);
  },
  async createConfigurationDefinition(record) {
    const saved = { ...record, revision: 1, status: "draft", secretsIncluded: false };
    stored.definitions.set(record.configKey, saved);
    return saved;
  },
  async getConfigurationDefinition(key) { return stored.definitions.get(key) || null; },
  async createConfigurationVersion(record) {
    const saved = {
      ...record,
      scopeKey: record.scope.scopeKey,
      scopeType: record.scope.scopeType,
      versionNumber: 1,
      versionRevision: 1,
      lifecycle: "draft",
      secretsIncluded: false
    };
    stored.versions.push(saved);
    return saved;
  },
  async listResolvableConfigurationVersions({ includeDraftVersionIds }) {
    return stored.versions.filter((item) => includeDraftVersionIds.includes(item.configVersionId));
  },
  async recordResolutionSnapshot(record) { stored.snapshots.push(record); return { resolutionId: record.resolutionId, ...record.result }; },
  async listActivityPacks({ limit = 25, offset = 0 } = {}) {
    return [].slice(offset, offset + limit);
  },
  async createActivityPackDefinition(record) { return { ...record, status: "draft" }; },
  async createActivityPackVersion(record) { return { ...record, versionNumber: 1, lifecycle: "draft" }; },
  async createBrandActivityBinding(record) { return { activityBindingId: record.activityBindingId, ...record.binding }; }
};
let sequence = 0;
const service = createGrowthControlPlaneService({ repository: fakeRepository, uuid: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12,"0")}` });
await service.createConfigurationDefinition({
  configKey: "growth.execution.policy", schema,
  defaultValues: { approvalRequired: true, maxResources: 10 },
  allowedScopes: ["platform","tenant","workspace","brand"],
  mergeProfile: { approvalRequired: "deny_wins", maxResources: "minimum" }
}, { actorId: "admin" });
const draft = await service.createConfigurationVersion("growth.execution.policy", {
  scope: { scopeType: "brand", tenantId: "tenant-a", workspaceId: "workspace-a", brandKey: "brand-a" },
  values: { approvalRequired: true, maxResources: 2 }, expectedRevision: 0
}, { actorId: "admin", idempotencyKey: "config-version-0001" });
const preview = await service.resolveConfiguration("growth.execution.policy", {
  context: { tenantId: "tenant-a", workspaceId: "workspace-a", brandKey: "brand-a" },
  includeDraftVersionIds: [draft.configVersionId]
}, { actorId: "admin" });
assert.equal(preview.values.maxResources, 2);
assert.equal(preview.providerCalls, false);
assert.equal(preview.externalWrites, false);

const migration = readFileSync("migrations/20260720_dynamic_growth_control_plane_foundation.sql", "utf8");
for (const table of [
  "growth_control_config_definitions",
  "growth_control_config_versions",
  "growth_control_config_resolution_snapshots",
  "growth_control_activity_pack_definitions",
  "growth_control_activity_pack_versions",
  "growth_control_brand_activity_bindings"
]) assert(migration.includes(table));
assert(migration.includes("governed_migration_authorization_registry"));
assert(migration.includes("provider_writes',false"));

const routes = readFileSync("routes/dynamicGrowthControlPlaneRoutes.js", "utf8");
assert(routes.includes("/admin/control-plane/configurations"));
assert(routes.includes("/admin/control-plane/activity-packs"));
assert(routes.includes("/admin/control-plane/brand-activity-bindings"));
assert(routes.includes("requireAdminPrincipal"));

console.log("dynamic growth control plane foundation tests passed");
