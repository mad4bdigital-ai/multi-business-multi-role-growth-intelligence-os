import assert from "node:assert/strict";
import test from "node:test";
import { STAGING_RECOVERY_SYSTEM_SURFACE_CONTRACT } from "./stagingRecoverySystemSurface.js";

test("P0 contract identity is stable", () => {
  assert.equal(STAGING_RECOVERY_SYSTEM_SURFACE_CONTRACT, "mad4b.staging-recovery-system-surface.v1");
});
