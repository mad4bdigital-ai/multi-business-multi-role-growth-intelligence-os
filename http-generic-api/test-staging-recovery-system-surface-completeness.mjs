import assert from "node:assert/strict";
import test from "node:test";
import { STAGING_RECOVERY_SYSTEM_TOOLS } from "./stagingRecoverySystemSurface.js";

test("P0 exposes plan, prepare, approve, and readiness only", () => {
  assert.equal(STAGING_RECOVERY_SYSTEM_TOOLS.filter((tool) => tool.tags.includes("staging")).length, 4);
});
