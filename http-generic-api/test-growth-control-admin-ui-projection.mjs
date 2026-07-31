import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { stableSha256 } from "./src/domain/growthControlPlane/growthControlPlane.js";
import {
  buildAdminConfigurationFormManifest,
  buildAdminConfigurationUiProjection,
} from "./src/domain/growthControlPlane/adminGrowthControlUiProjection.js";
import {
  createAdminGrowthControlUiProjectionService,
} from "./src/application/growthControlPlane/adminGrowthControlUiProjectionService.js";

const definition = Object.freeze({
  configKey: "growth.execution.policy",
  schemaVersion: 3,
  schema: {
    title: "Growth execution policy",
    description: "Bounded controls for Growth Control execution.",
    type: "object",
    additionalProperties: false,
    required: ["approvalRequired", "limits", "strategy"],
    properties: {
      approvalRequired: {
        title: "Approval required",
        type: "boolean",
      },
      callbackUrl: {
        title: "Callback URL",
        type: ["string", "null"],
        format: "uri",
      },
      channels: {
        title: "Channels",
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: { type: "string", enum: ["email", "web", "social"] },
      },
      limits: {
        title: "Limits",
        type: "object",
        additionalProperties: false,
        required: ["maxDaily"],
        properties: {
          maxDaily: { title: "Daily maximum", type: "integer", minimum: 1, maximum: 100 },
          maxSpend: { title: "Spend maximum", type: "number", minimum: 0 },
        },
      },
      strategy: {
        title: "Strategy",
        type: "string",
        enum: ["balanced", "conservative"],
      },
    },
  },
  defaultValues: {
    approvalRequired: true,
    callbackUrl: null,
    channels: ["web"],
    limits: { maxDaily: 10, maxSpend: 100 },
    strategy: "conservative",
  },
  allowedScopes: ["platform", "tenant", "workspace", "brand"],
  securityClassification: "security_control",
  status: "active",
  revision: 8,
  checksumSha256: "a".repeat(64),
  createdBy: "admin",
  createdAt: "2026-07-30T00:00:00.000Z",
  updatedAt: "2026-07-31T00:00:00.000Z",
  secretsIncluded: false,
});

const baseVersion = Object.freeze({
  configVersionId: "11111111-1111-4111-8111-111111111111",
  configKey: definition.configKey,
  versionNumber: 4,
  scopeType: "brand",
  scopeKey: "tenant:t1:workspace:w1:brand:b1",
  tenantId: "t1",
  workspaceId: "w1",
  brandKey: "b1",
  activityTypeKey: "travel",
  activityBindingId: "binding-1",
  profileKey: null,
  workflowKey: null,
  workflowVersion: null,
  workflowNodeId: null,
  planId: null,
  executionId: null,
  values: {
    approvalRequired: true,
    callbackUrl: null,
    channels: ["web"],
    limits: { maxDaily: 10, maxSpend: 100 },
    strategy: "conservative",
  },
  lifecycle: "deprecated",
  versionRevision: 4,
  checksumSha256: "b".repeat(64),
  idempotencyKey: "hidden-idempotency-key",
  createdBy: "admin-a",
  createdAt: "2026-07-30T10:00:00.000Z",
  secretsIncluded: false,
});

const compareVersion = Object.freeze({
  ...baseVersion,
  configVersionId: "22222222-2222-4222-8222-222222222222",
  versionNumber: 5,
  values: {
    approvalRequired: false,
    callbackUrl: "https://example.internal/readback",
    channels: ["social", "web"],
    limits: { maxDaily: 5, maxSpend: 100 },
    strategy: "balanced",
  },
  lifecycle: "active",
  versionRevision: 5,
  checksumSha256: "c".repeat(64),
  idempotencyKey: "another-hidden-key",
  createdBy: "admin-b",
  createdAt: "2026-07-31T00:00:00.000Z",
});

const manifest = buildAdminConfigurationFormManifest(definition);
assert.equal(manifest.contract, "mad4b.growth-control.admin-form.v1");
assert.equal(manifest.readOnlyProjection, true);
assert.equal(manifest.backendValidationRequired, true);
assert.equal(manifest.secretsIncluded, false);
assert.deepEqual(manifest.fields.map((field) => field.path), [
  "approvalRequired",
  "callbackUrl",
  "channels",
  "limits",
  "limits.maxDaily",
  "limits.maxSpend",
  "strategy",
]);
assert.deepEqual(manifest.fields.map((field) => field.component), [
  "checkbox",
  "url",
  "list",
  "group",
  "number",
  "number",
  "select",
]);
assert.equal(manifest.fields.find((field) => field.path === "limits.maxDaily")?.required, true);
assert.equal(manifest.fields.find((field) => field.path === "channels")?.item?.type, "string");
assert.deepEqual(manifest.fields.find((field) => field.path === "strategy")?.options, ["balanced", "conservative"]);
assert.ok(manifest.fields.every((field) => /^[0-9a-f]{20}$/.test(field.fieldId)));

const projection = buildAdminConfigurationUiProjection({ definition, baseVersion, compareVersion });
assert.equal(projection.adminFacing, true);
assert.equal(projection.readOnly, true);
assert.equal(projection.providerCalls, false);
assert.equal(projection.externalWrites, false);
assert.equal(projection.secretsIncluded, false);
assert.equal(projection.comparison.contract, "mad4b.growth-control.admin-diff.v1");
assert.deepEqual(projection.comparison.changes.map((entry) => entry.path), [
  "$.approvalRequired",
  "$.callbackUrl",
  "$.channels",
  "$.limits.maxDaily",
  "$.strategy",
]);
assert.equal(projection.comparison.base.configVersionId, baseVersion.configVersionId);
assert.equal(projection.comparison.compare.configVersionId, compareVersion.configVersionId);
assert.equal(Object.hasOwn(projection.comparison.base, "values"), false);
assert.equal(Object.hasOwn(projection.comparison.base, "createdBy"), false);
assert.equal(Object.hasOwn(projection.comparison.base, "idempotencyKey"), false);
assert.match(projection.comparison.diffSha256, /^[0-9a-f]{64}$/);
assert.equal(
  projection.comparison.diffSha256,
  stableSha256({
    baseChecksumSha256: baseVersion.checksumSha256,
    compareChecksumSha256: compareVersion.checksumSha256,
    changes: projection.comparison.changes,
  }),
);
assert.deepEqual(
  projection,
  buildAdminConfigurationUiProjection({ definition, baseVersion, compareVersion }),
  "identical inputs must produce identical Admin projection evidence",
);

const repositoryCalls = [];
const repository = {
  async getConfigurationDefinition(configKey) {
    repositoryCalls.push(`definition:${configKey}`);
    return configKey === definition.configKey ? definition : null;
  },
  async getConfigurationVersion(configVersionId) {
    repositoryCalls.push(`version:${configVersionId}`);
    if (configVersionId === baseVersion.configVersionId) return baseVersion;
    if (configVersionId === compareVersion.configVersionId) return compareVersion;
    return null;
  },
};
const service = createAdminGrowthControlUiProjectionService({ repository });
const serviceResult = await service.projectConfiguration(definition.configKey, {
  baseVersionId: baseVersion.configVersionId,
  compareVersionId: compareVersion.configVersionId,
});
assert.equal(serviceResult.comparison.changed, true);
assert.deepEqual(repositoryCalls, [
  `definition:${definition.configKey}`,
  `version:${baseVersion.configVersionId}`,
  `version:${compareVersion.configVersionId}`,
]);

await assert.rejects(
  service.projectConfiguration(definition.configKey, { baseVersionId: baseVersion.configVersionId }),
  (error) => error?.code === "GROWTH_CONTROL_UI_COMPARISON_PAIR_REQUIRED" && error?.status === 400,
);
await assert.rejects(
  service.projectConfiguration(definition.configKey, {
    baseVersionId: baseVersion.configVersionId,
    compareVersionId: baseVersion.configVersionId,
  }),
  (error) => error?.code === "GROWTH_CONTROL_UI_COMPARISON_IDENTICAL" && error?.status === 400,
);
await assert.rejects(
  service.projectConfiguration("missing.configuration", {}),
  (error) => error?.code === "GROWTH_CONTROL_CONFIG_NOT_FOUND" && error?.status === 404,
);

assert.throws(
  () => buildAdminConfigurationFormManifest({
    ...definition,
    schema: {
      type: "object",
      properties: { access_token: { type: "string" } },
    },
  }),
  (error) => error?.code === "GROWTH_CONTROL_SECRET_FIELD_FORBIDDEN",
);
assert.throws(
  () => buildAdminConfigurationFormManifest({
    ...definition,
    schema: {
      type: "object",
      properties: { ambiguous: { type: ["string", "number"] } },
    },
  }),
  (error) => error?.code === "GROWTH_CONTROL_UI_SCHEMA_UNION_UNSUPPORTED",
);
assert.throws(
  () => buildAdminConfigurationUiProjection({
    definition,
    baseVersion,
    compareVersion: { ...compareVersion, configKey: "other.configuration" },
  }),
  (error) => error?.code === "GROWTH_CONTROL_CONFIG_VERSION_NOT_FOUND",
);

const routeSource = await fs.readFile(new URL("./routes/dynamicGrowthControlPlaneRoutes.js", import.meta.url), "utf8");
assert.match(routeSource, /GET \/admin\/control-plane\/configurations\/\{configKey\}\/ui-projection/);
assert.match(routeSource, /adminUiProjection\.projectConfiguration/);
assert.match(routeSource, /baseVersionId/);
assert.match(routeSource, /compareVersionId/);

const openApiSource = await fs.readFile(new URL("./openapi/growth-control-plane-admin-ui.openapi.yaml", import.meta.url), "utf8");
assert.match(openApiSource, /getGrowthControlAdminUiProjection/);
assert.match(openApiSource, /mad4b\.growth-control\.admin-form\.v1/);
assert.match(openApiSource, /mad4b\.growth-control\.admin-diff\.v1/);
assert.match(openApiSource, /secretsIncluded/);

console.log("growth control Admin UI projection tests passed");
