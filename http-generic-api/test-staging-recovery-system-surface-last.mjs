import assert from "node:assert/strict";
import test from "node:test";
import { STAGING_RECOVERY_SYSTEM_TOOLS } from "./stagingRecoverySystemSurface.js";

test("P0 Staging Recovery surface remains private recovery catalog", () => {
  for (const tool of STAGING_RECOVERY_SYSTEM_TOOLS) assert.equal(tool.catalog_level, "private_recovery");
});
