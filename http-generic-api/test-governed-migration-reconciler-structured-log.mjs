import assert from "node:assert/strict";
import { parseJsonLine } from "./scripts/governed-migration-reconciler.mjs";

const direct = parseJsonLine('{"ok":true,"mode":"apply"}');
assert.deepEqual(direct, { ok: true, mode: "apply" });

const wrapped = parseJsonLine(JSON.stringify({
  timestamp: "2026-06-13T18:32:56.298Z",
  level: "LOG",
  message: JSON.stringify({ ok: true, mode: "apply", ledger: { recorded: true } }),
}));
assert.equal(wrapped?.ok, true);
assert.equal(wrapped?.ledger?.recorded, true);

const noisy = parseJsonLine(`diagnostic line\n${JSON.stringify({
  timestamp: "2026-06-13T18:32:56.298Z",
  level: "LOG",
  message: JSON.stringify({ ok: false, error: "simulated" }),
})}`);
assert.equal(noisy?.ok, false);
assert.equal(noisy?.error, "simulated");

assert.equal(parseJsonLine("not json"), null);

console.log("governed migration reconciler structured log regression passed");
