import assert from "node:assert/strict";

import {
  buildAdminConfigurationFormManifest,
} from "./src/domain/growthControlPlane/adminGrowthControlUiProjection.js";

const manifest = buildAdminConfigurationFormManifest({
  configKey: "growth.ui.default-normalization",
  schemaVersion: 1,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      optionalLabel: { type: "string", title: "Optional label" },
      enabled: { type: "boolean", title: "Enabled" },
    },
  },
  defaultValues: { enabled: false },
  allowedScopes: ["platform"],
  securityClassification: "tenant_internal",
  revision: 1,
  checksumSha256: "d".repeat(64),
});

const optionalLabel = manifest.fields.find((field) => field.path === "optionalLabel");
const enabled = manifest.fields.find((field) => field.path === "enabled");
assert.ok(optionalLabel);
assert.equal(optionalLabel.defaultValue, null);
assert.equal(Object.hasOwn(optionalLabel, "defaultValue"), true);
assert.equal(enabled.defaultValue, false);
assert.doesNotThrow(() => JSON.stringify(manifest));
assert.match(JSON.stringify(manifest), /"defaultValue":null/);

console.log("growth control Admin UI default normalization tests passed");
