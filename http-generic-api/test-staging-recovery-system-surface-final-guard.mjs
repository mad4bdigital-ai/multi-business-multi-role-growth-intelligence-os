import assert from "node:assert/strict";
import test from "node:test";
import { STAGING_RECOVERY_SYSTEM_TOOLS } from "./stagingRecoverySystemSurface.js";

test("P0 surface descriptors are unique", () => {
  const names = STAGING_RECOVERY_SYSTEM_TOOLS.map((tool) => tool.name);
  assert.equal(new Set(names).size, names.length);
});
