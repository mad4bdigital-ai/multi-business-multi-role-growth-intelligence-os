import assert from "node:assert/strict";
import test from "node:test";
import { STAGING_RECOVERY_SYSTEM_TOOLS } from "./stagingRecoverySystemSurface.js";

const serialized = JSON.stringify(STAGING_RECOVERY_SYSTEM_TOOLS);

test("Staging Recovery system surface never advertises generic execution authority", () => {
  for (const forbidden of ["raw_sql", "shell", "command", "script_path", "workflow", "dispatch_ref", "database_name", "credentials", "production-runtime"]) {
    assert.equal(serialized.includes(`\"${forbidden}\"`), false, `forbidden caller field advertised: ${forbidden}`);
  }
});
