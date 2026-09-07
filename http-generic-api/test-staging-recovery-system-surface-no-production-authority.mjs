import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./stagingRecoverySystemSurface.js", import.meta.url), "utf8");

test("Staging Recovery system surface hard-binds staging-runtime and denies Production authority", () => {
  assert.match(source, /target_key: "staging-runtime"/u);
  assert.match(source, /production_authority: false/u);
  assert.match(source, /production_mutation_performed: false/u);
  assert.doesNotMatch(source, /target_key:\s*args\.target_key/u);
});
