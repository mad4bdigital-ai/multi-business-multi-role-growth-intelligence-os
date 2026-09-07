import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const kernel = fs.readFileSync(new URL("./recoveryKernel.js", import.meta.url), "utf8");

test("existing Staging canary planner remains exact-main bound", () => {
  assert.match(kernel, /branch !== "main"/u);
  assert.match(kernel, /RECOVERY_STAGING_CANARY_IDENTITY_MISMATCH/u);
});
