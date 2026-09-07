import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const routes = fs.readFileSync(new URL("./routes/systemLayerRoutes.js", import.meta.url), "utf8");

test("Staging stateful recovery capabilities are not added to shared read-only recovery allowlist", () => {
  const shared = routes.match(/const SHARED_ADMIN_RECOVERY_READONLY_CAPABILITIES = new Set\(\[([\s\S]*?)\]\);/u)?.[1] || "";
  assert.ok(shared);
  assert.doesNotMatch(shared, /staging_certification_canary_plan_create|staging_recovery_access_repair/u);
});
