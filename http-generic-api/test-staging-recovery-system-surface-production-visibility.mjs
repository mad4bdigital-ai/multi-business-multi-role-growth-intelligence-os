import assert from "node:assert/strict";
import test from "node:test";
import { SYSTEM_LAYER_TOOLS } from "./routes/systemLayerRoutes.js";

const stagingNames = new Set([
  "staging_certification_canary_plan_create",
  "staging_recovery_access_repair_prepare",
  "staging_recovery_access_repair_approve",
  "staging_recovery_surface_readiness_smoke",
]);

test("Staging Recovery descriptors carry explicit staging-only visibility metadata", () => {
  const rows = SYSTEM_LAYER_TOOLS.filter((tool) => stagingNames.has(tool.name));
  assert.equal(rows.length, stagingNames.size);
  for (const row of rows) {
    assert.deepEqual(row.environments, ["staging"]);
    assert.equal(row.requires_admin, true);
  }
});
