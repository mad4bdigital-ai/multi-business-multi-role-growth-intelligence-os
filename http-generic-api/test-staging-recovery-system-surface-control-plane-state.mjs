import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./stagingRecoverySystemSurface.js", import.meta.url), "utf8");

test("stateful Staging surface does not call itself discovery-only", () => {
  assert.match(source, /surface_semantics: "staging_governed_control_plane"/u);
  assert.match(source, /control_plane_state_write_performed: true/u);
  assert.doesNotMatch(source, /staging_discovery_only/u);
});
