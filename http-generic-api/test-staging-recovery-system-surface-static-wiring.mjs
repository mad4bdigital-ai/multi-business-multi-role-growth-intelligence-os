import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const routes = fs.readFileSync(new URL("./routes/systemLayerRoutes.js", import.meta.url), "utf8");
const kernel = fs.readFileSync(new URL("./recoveryKernel.js", import.meta.url), "utf8");

test("System Layer wires Staging Recovery as an environment-scoped descriptor source", () => {
  assert.match(routes, /STAGING_RECOVERY_SYSTEM_TOOLS/u);
  assert.match(routes, /StagingRecoverySystemSurfaceRuntime/u);
  assert.match(routes, /source_key: "staging_recovery_system_surface_v1"/u);
  assert.match(routes, /assertSystemToolEnvironmentAccess/u);
  assert.match(routes, /system_tool_environment_not_available/u);
});

test("Recovery capability view identifies Staging as governed control-plane, not discovery-only", () => {
  assert.match(kernel, /staging_governed_control_plane/u);
  assert.doesNotMatch(kernel, /environment_view: staging \? "staging_discovery_only"/u);
  assert.match(kernel, /staging\.certification\.canary\.plan_create/u);
  assert.match(kernel, /staging_database_access_repair\.prepare/u);
  assert.match(kernel, /staging_database_access_repair\.approve/u);
});
