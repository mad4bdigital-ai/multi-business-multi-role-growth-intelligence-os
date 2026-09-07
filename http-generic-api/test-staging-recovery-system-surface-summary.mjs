import assert from "node:assert/strict";
import test from "node:test";
import { STAGING_RECOVERY_SYSTEM_TOOLS } from "./stagingRecoverySystemSurface.js";

test("P0 Staging Recovery surface has no caller-controlled execution transport", () => {
  const schema = JSON.stringify(STAGING_RECOVERY_SYSTEM_TOOLS.map((tool) => tool.inputSchema));
  assert.doesNotMatch(schema, /execution_ticket|approval_token|raw_sql|shell|command|workflow|dispatch_ref/iu);
});
