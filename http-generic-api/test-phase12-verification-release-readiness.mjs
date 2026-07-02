import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const phase12 = readFileSync(
  "../specs/001-capability-security-hardening/phase12-verification-release-readiness.md",
  "utf8",
);
const releaseChecklist = readFileSync(
  "../specs/001-capability-security-hardening/checklists/release-readiness.md",
  "utf8",
);
const acceptanceMatrix = readFileSync(
  "../specs/001-capability-security-hardening/acceptance-matrix.md",
  "utf8",
);
const completion = JSON.parse(
  readFileSync("../specs/001-capability-security-hardening/completion.json", "utf8"),
);
const manifest = readFileSync("scripts/test-manifest.mjs", "utf8");

for (let task = 103; task <= 114; task += 1) {
  assert(phase12.includes(`T${task}`), `phase12 readiness record must include T${task}`);
}

for (const gate of [
  "Full unit, integration, and security suites",
  "Staging preview acceptance matrix",
  "Shadow evaluation mismatch review",
  "Latency and resource budgets",
  "Dependency-outage fail-closed proof",
  "Bounded staging mutations",
  "Security and architecture reviews",
  "Feature-flag rollback",
  "Production promotion approval",
  "Rollout by enforcement group",
  "Legacy branch retirement",
]) {
  assert(phase12.includes(gate), `phase12 readiness record must include gate: ${gate}`);
}

for (const blockedEvidence of [
  "awaiting full CI evidence",
  "Blocked until staging preview run",
  "Blocked until shadow run",
  "Blocked until benchmark run",
  "Blocked until outage drill",
  "Blocked until staging approval",
  "Blocked until reviews",
  "Blocked until rollback drill",
  "Not granted",
  "Not started",
]) {
  assert(phase12.includes(blockedEvidence), `phase12 must preserve blocker: ${blockedEvidence}`);
}

for (const safetyBoundary of [
  "does not authorize provider execution",
  "credential access",
  "external writes",
  "production mutation",
  "branch merge",
  "production promotion",
  "Do not merge any phase branch",
  "Do not use Phase 12 to create new approval infrastructure",
  "Do not expose admin-only decision trace detail to tenant surfaces",
  "Do not downgrade P0 containment during rollback",
  "Do not include secrets",
]) {
  assert(phase12.includes(safetyBoundary), `phase12 must state safety boundary: ${safetyBoundary}`);
}

for (const matrixId of [
  "A01",
  "B03",
  "C07",
  "D09",
  "E07",
  "F11",
  "G08",
  "H09",
  "I07",
  "J08",
]) {
  assert(acceptanceMatrix.includes(matrixId), `acceptance matrix must retain ${matrixId}`);
  assert(phase12.includes(matrixId[0]), `phase12 matrix record must include group ${matrixId[0]}`);
}

assert.equal(completion.status, "in_progress");
assert.equal(completion.current_increment.tasks_completed_count, 56);
assert.equal(completion.current_increment.tasks_remaining_count, 58);
assert.equal(completion.current_increment.tasks_remaining_range, "T027-T045,T073-T081,T085-T114");
for (const alreadyCompleteTask of ["T046", "T072", "T082", "T084"]) {
  assert(
    completion.current_increment.tasks_completed.includes(alreadyCompleteTask),
    `completion tracking must preserve ${alreadyCompleteTask} as complete`,
  );
}
assert.equal(completion.evidence.release_readiness.status, "blocked_for_full_release");
assert.equal(completion.evidence.release_readiness.production_promotion_authorized, false);
assert.equal(completion.secrets_included, false);

assert(releaseChecklist.includes("Explicit production-promotion approval has not been granted"));
assert(releaseChecklist.includes("Full release-readiness approval remains blocked"));
assert(manifest.includes("node test-phase12-verification-release-readiness.mjs"));

console.log("phase12 verification release readiness tests passed");
