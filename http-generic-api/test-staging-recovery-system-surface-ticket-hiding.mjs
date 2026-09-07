import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./stagingRecoverySystemSurface.js", import.meta.url), "utf8");

test("Staging access-repair surface does not accept caller ticket material", () => {
  assert.doesNotMatch(source, /execution_ticket_id:\s*\{\s*type:/u);
  assert.doesNotMatch(source, /execution_ticket_hash:\s*\{\s*type:/u);
  assert.doesNotMatch(source, /signature:\s*\{\s*type:/u);
});
