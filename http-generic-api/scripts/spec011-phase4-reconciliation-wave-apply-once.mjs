import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";

function replaceExactOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label} expected exactly once, found ${count}`);
  return source.replace(before, after);
}

const manifestPath = "http-generic-api/scripts/manifests/test-manifest-spec011.mjs";
let manifest = readFileSync(manifestPath, "utf8");
const command = '  "node test-governed-reconciliation-kernel.mjs",\n';
if (!manifest.includes(command.trim())) {
  manifest = replaceExactOnce(
    manifest,
    "export const testCommands = [\n",
    `export const testCommands = [\n${command}`,
    "Spec 011 test manifest anchor",
  );
  writeFileSync(manifestPath, manifest);
}

const tasksPath = "specs/011-durable-governed-execution-and-agent-delegation/tasks.md";
let tasks = readFileSync(tasksPath, "utf8");
const phase4Tasks = [
  ["- [ ] T160 Add outcome classifier.", "- [x] T160 Add outcome classifier."],
  ["- [ ] T161 Add read-before-retry enforcement after unknown outcomes.", "- [x] T161 Add read-before-retry enforcement after unknown outcomes."],
  ["- [ ] T162 Add repository and PR reconcilers.", "- [x] T162 Add repository and PR reconcilers."],
  ["- [ ] T163 Add migration schema and ledger reconciler.", "- [x] T163 Add migration schema and ledger reconciler."],
  ["- [ ] T164 Add deployment and production-parity reconciler.", "- [x] T164 Add deployment and production-parity reconciler."],
  ["- [ ] T165 Add provider adapter reconciliation contract.", "- [x] T165 Add provider adapter reconciliation contract."],
  ["- [ ] T166 Add duplicate-mutation fault-injection suite.", "- [x] T166 Add duplicate-mutation fault-injection suite."],
];
for (const [open, done] of phase4Tasks) {
  if (tasks.includes(done)) continue;
  tasks = replaceExactOnce(tasks, open, done, done.slice(6, 10));
}
writeFileSync(tasksPath, tasks);

for (const temporaryPath of [
  "http-generic-api/scripts/spec011-phase4-reconciliation-wave-apply-once.mjs",
  ".github/workflows/spec-011-phase4-reconciliation-wave-apply-once.yml",
]) {
  if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
}

console.log(JSON.stringify({
  ok: true,
  phase: "spec011_phase4_reconciliation_readback_wave",
  tasks_completed: phase4Tasks.map(([, done]) => done.match(/T\d+/)?.[0]),
  test_command: command.trim(),
  temporary_files_removed: true,
}, null, 2));
