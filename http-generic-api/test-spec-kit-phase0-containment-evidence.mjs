import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../specs/001-capability-security-hardening/", import.meta.url);
const tasks = await readFile(new URL("tasks.md", root), "utf8");
const validation = await readFile(new URL("containment-validation.md", root), "utf8");
const traceability = await readFile(new URL("traceability.md", root), "utf8");
const rollout = await readFile(new URL("rollout.md", root), "utf8");

for (let task = 1; task <= 9; task += 1) {
  const key = String(task).padStart(3, "0");
  assert.match(tasks, new RegExp(`^- \\[x\\] \\*\\*T${key}\\*\\*`, "m"), `T${key} must be checked for Phase 0 closure`);
}
const laterUnchecked = [...tasks.matchAll(/^- \[ \] \*\*T(0(1[0-9]|[2-9][0-9])|1[01][0-9])\*\*/gm)];
const laterChecked = [...tasks.matchAll(/^- \[x\] \*\*T(0(1[0-9]|[2-9][0-9])|1[01][0-9])\*\*/gm)];
assert(laterUnchecked.length > 0, "later Spec Kit work must remain explicitly tracked");
assert(laterChecked.length > 0, "previously completed later-phase evidence must be preserved");
assert.match(tasks, /^- \[ \] \*\*T010\*\*/m, "T010 discovery work must remain open");
assert.match(tasks, /^- \[x\] \*\*T046\*\*/m, "previously completed credential-policy work must remain preserved");
assert.match(tasks, /^- \[ \] \*\*T114\*\*/m, "legacy retirement must remain open");

for (const required of [
  "Phase 0 — Safety containment (T001–T009)",
  "Unchecked T010–T114 remain open by design",
  "Growth Intelligence Platform Admin (`nagyxs@gmail.com`)",
  "Essam Nagy / Nagy (`mad4b.digital@gmail.com`)",
  "Growth Intelligence Platform Admin Assistant (`platform-admin@mad4b.com`)",
  "d98394a37310124f6d05069667a42664ee0e8e50",
  "7dd1e6f850c7eb2969d3790199ac56a674981c01",
  "203224b81b8cd7dc81d1f37d213d99722c36615f",
  "CAPABILITY_KILL_SWITCH_LOCAL_SHELL",
  "CI must pass again on the final reconciled PR head before merge",
  "same-cycle PR gate and GitHub merge audit",
  "Unrelated advancement of `main` does not invalidate this baseline",
  "Secrets included: `false`",
]) {
  assert(validation.includes(required), `containment validation evidence must include: ${required}`);
}

assert(traceability.includes("| T009 |"), "traceability must include T009 evidence");
assert(traceability.includes("containment-validation.md"), "traceability must point to the validation record");
assert(rollout.includes("containment-validation.md"), "rollout must point to the validation record");
assert(!validation.includes("is production-promotion approval"), "validation must not grant production promotion");
assert(validation.includes("not production-promotion approval"), "validation must deny implicit production approval");

console.log("Spec Kit Phase 0 containment evidence tests passed");