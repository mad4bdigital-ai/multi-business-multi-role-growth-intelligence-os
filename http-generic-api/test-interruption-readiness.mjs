import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  classifyLineEndingDrift,
  classifySensitiveChanges,
  buildVerificationPlan,
  compareContinuitySnapshots,
  nodeVersionSatisfiesEngine,
  parseGitPorcelainZ,
  planCommandsSha256,
  evidenceIdentitySha256,
  resumablePassedCommands,
  classifyExecutionLease,
  compareDirectDependencyVersions,
  leaseOwnedBy,
  canRecoverExecutionLease,
  validateCheckpoint,
  validateReadinessEvidence,
  hashVerificationEvent,
  verifyVerificationEventChain,
  shouldFailReadiness,
  summarizeReadiness,
} from "./interruptionReadiness.js";

assert.equal(nodeVersionSatisfiesEngine("v22.14.0", ">=22 <23"), true);
assert.equal(nodeVersionSatisfiesEngine("v21.14.0", ">=22 <23"), false);
assert.equal(nodeVersionSatisfiesEngine("v23.0.0", ">=22 <23"), false);

assert.equal(classifyLineEndingDrift({ changed: false, equalIgnoringEol: true }), "clean");
assert.equal(classifyLineEndingDrift({ changed: true, equalIgnoringEol: true }), "eol_or_trailing_whitespace_only");
assert.equal(classifyLineEndingDrift({ changed: true, equalIgnoringEol: false }), "content_change");
assert.deepEqual(parseGitPorcelainZ(" M .github/workflows/ci.yml\0?? docs/new.md\0"), [
  { status: " M", file: ".github/workflows/ci.yml" },
  { status: "??", file: "docs/new.md" },
]);

const overlap = classifySensitiveChanges(
  ["http-generic-api/modelAdapter.js", "docs/example.md"],
  ["http-generic-api/modelAdapter.js", "http-generic-api/routes/index.js"],
);
assert.deepEqual(overlap.touched, ["http-generic-api/modelAdapter.js"]);
assert.deepEqual(overlap.overlapping, ["http-generic-api/modelAdapter.js"]);
assert.ok(overlap.tests.includes("node test-agent-runtime-ledger-wiring.mjs"));

const plan = buildVerificationPlan([
  "docs/interruption-readiness-automation.md",
  "http-generic-api/routes/index.js",
  "memory_schema.json",
]);
assert.ok(plan.commands.includes("node test-docs-impact-classifier.mjs"));
assert.ok(plan.commands.includes("node test-connect-routes.mjs"));
assert.ok(plan.commands.includes("node ../validate-memory-schema.mjs"));
assert.equal(plan.commands.filter((command) => command === "node test-connect-routes.mjs").length, 1);

const baseline = {
  generated_at: "2026-06-13T12:00:00.000Z",
  head_sha: "head-1",
  target_sha: "target-1",
  merge_base: "base-1",
  package_lock_sha256: "lock-1",
  direct_dependencies_sha256: "dependencies-1",
  worktree_sha256: "worktree-1",
};
assert.deepEqual(
  compareContinuitySnapshots(baseline, { ...baseline }, { now: Date.parse("2026-06-13T12:05:00.000Z"), maxAgeMinutes: 10 }),
  { fresh: true, reasons: [] },
);
assert.deepEqual(compareDirectDependencyVersions(
  { express: "4.21.2", mysql2: "3.22.3" },
  { express: "4.21.2", mysql2: "3.22.3" },
), { ready: true, missing: [], mismatched: [], unlocked: [] });
assert.deepEqual(compareDirectDependencyVersions(
  { express: "4.21.2", mysql2: "3.22.3" },
  { express: "4.20.0" },
), {
  ready: false,
  missing: ["mysql2"],
  mismatched: [{ name: "express", expected: "4.21.2", installed: "4.20.0" }],
  unlocked: [],
});
assert.deepEqual(compareDirectDependencyVersions({ express: null }, { express: "4.21.2" }), {
  ready: false,
  missing: [],
  mismatched: [],
  unlocked: ["express"],
});
const planHash = planCommandsSha256(["node a.mjs", "node b.mjs"]);
assert.match(planHash, /^[a-f0-9]{64}$/);
const evidenceHash = evidenceIdentitySha256({
  schema_version: "interruption_readiness.v1",
  status: "ready",
  continuity_snapshot: { head_sha: "head-1" },
  verification_plan: { commands: ["node a.mjs", "node b.mjs"] },
});
assert.match(evidenceHash, /^[a-f0-9]{64}$/);
assert.deepEqual(resumablePassedCommands({
  evidence_file: "baseline.json",
  evidence_sha256: evidenceHash,
  plan_sha256: planHash,
  steps: [{ command: "node a.mjs", status: "passed" }, { command: "node b.mjs", status: "failed" }],
}, { evidenceFile: "baseline.json", evidenceSha256: evidenceHash, planSha256: planHash, commands: ["node a.mjs", "node b.mjs"] }), ["node a.mjs"]);
assert.deepEqual(resumablePassedCommands({
  evidence_file: "other.json",
  evidence_sha256: evidenceHash,
  plan_sha256: planHash,
  steps: [{ command: "node a.mjs", status: "passed" }],
}, { evidenceFile: "baseline.json", evidenceSha256: evidenceHash, planSha256: planHash, commands: ["node a.mjs"] }), []);
assert.deepEqual(resumablePassedCommands({
  evidence_file: "baseline.json",
  evidence_sha256: evidenceHash,
  plan_sha256: planHash,
  steps: [{ command: "node a.mjs", status: "failed" }, { command: "node b.mjs", status: "passed" }],
}, { evidenceFile: "baseline.json", evidenceSha256: evidenceHash, planSha256: planHash, commands: ["node a.mjs", "node b.mjs"] }), []);
assert.deepEqual(resumablePassedCommands({
  evidence_file: "baseline.json",
  evidence_sha256: "replaced-evidence",
  plan_sha256: planHash,
  steps: [{ command: "node a.mjs", status: "passed" }],
}, { evidenceFile: "baseline.json", evidenceSha256: evidenceHash, planSha256: planHash, commands: ["node a.mjs"] }), []);
assert.equal(classifyExecutionLease({ updated_at: "2026-06-13T12:00:00.000Z" }, { now: Date.parse("2026-06-13T12:30:00.000Z"), leaseTimeoutMinutes: 60 }).state, "active");
assert.deepEqual(classifyExecutionLease({ updated_at: "2026-06-13T12:00:00.000Z" }, { now: Date.parse("2026-06-13T14:01:00.000Z"), leaseTimeoutMinutes: 60 }).recoverable, true);
assert.equal(classifyExecutionLease({ updated_at: "2026-06-13T13:00:00.000Z" }, { now: Date.parse("2026-06-13T12:00:00.000Z"), leaseTimeoutMinutes: 60 }).state, "clock_skew");
assert.equal(leaseOwnedBy({ owner_token: "owner-1" }, "owner-1"), true);
assert.equal(leaseOwnedBy({ owner_token: "owner-2" }, "owner-1"), false);
assert.equal(canRecoverExecutionLease({ requested: true, classification: { state: "active", recoverable: false }, ownerPidValid: true, ownerAlive: false }), true);
assert.equal(canRecoverExecutionLease({ requested: true, classification: { state: "stale", recoverable: true }, ownerPidValid: true, ownerAlive: false }), true);
assert.equal(canRecoverExecutionLease({ requested: true, classification: { state: "stale", recoverable: true }, ownerPidValid: true, ownerAlive: true }), false);
assert.equal(canRecoverExecutionLease({ requested: true, classification: { state: "stale", recoverable: true }, ownerPidValid: false, ownerAlive: false }), false);
assert.deepEqual(validateCheckpoint({
  evidence_file: "baseline.json",
  evidence_sha256: evidenceHash,
  plan_sha256: planHash,
  steps: [{ command: "node a.mjs", status: "passed" }, { command: "node b.mjs", status: "failed" }],
}, { evidenceFile: "baseline.json", evidenceSha256: evidenceHash, planSha256: planHash, commands: ["node a.mjs", "node b.mjs"] }), { valid: true, errors: [] });
assert.equal(validateCheckpoint({
  evidence_file: "baseline.json",
  evidence_sha256: evidenceHash,
  plan_sha256: planHash,
  steps: [{ command: "node a.mjs", status: "failed" }, { command: "node b.mjs", status: "passed" }],
}, { evidenceFile: "baseline.json", evidenceSha256: evidenceHash, planSha256: planHash, commands: ["node a.mjs", "node b.mjs"] }).valid, false);
const eventOne = {
  event_id: "event-1",
  event_type: "execution_started",
  occurred_at: "2026-06-13T12:00:00.000Z",
  previous_event_sha256: null,
  evidence: { secrets_included: false },
};
eventOne.event_sha256 = hashVerificationEvent(eventOne);
const eventTwo = {
  event_id: "event-2",
  event_type: "execution_passed",
  occurred_at: "2026-06-13T12:01:00.000Z",
  previous_event_sha256: eventOne.event_sha256,
  evidence: { secrets_included: false },
};
eventTwo.event_sha256 = hashVerificationEvent(eventTwo);
assert.deepEqual(verifyVerificationEventChain([eventOne, eventTwo], eventTwo.event_sha256), { valid: true, reason: null });
assert.equal(verifyVerificationEventChain([eventOne, { ...eventTwo, event_type: "tampered" }], eventTwo.event_sha256).valid, false);
assert.deepEqual(validateReadinessEvidence({
  schema_version: "interruption_readiness.v1",
  status: "ready",
  checks: [],
  summary: { blocker: 0, warning: 0, info: 0 },
  coverage: { engine: true, dependencies: true, merge: true, worktree: true },
  continuity_snapshot: { head_sha: "head-1", target_sha: "target-1" },
  verification_plan: { commands: [] },
}), { valid: true, errors: [] });
assert.deepEqual(validateReadinessEvidence({
  schema_version: "interruption_readiness.v1",
  status: "blocked",
  checks: [{ id: "blocked", level: "blocker" }],
  summary: { blocker: 1, warning: 0, info: 0 },
  coverage: { engine: true, dependencies: true, merge: true, worktree: true },
  continuity_snapshot: { head_sha: "head-1", target_sha: "target-1" },
  verification_plan: { commands: [] },
}), { valid: false, errors: ["readiness_evidence_blocked"] });
assert.deepEqual(validateReadinessEvidence({
  schema_version: "interruption_readiness.v1",
  status: "ready",
  checks: [{ id: "blocked", level: "blocker" }],
  summary: { blocker: 0, warning: 0, info: 0 },
  coverage: { engine: true, dependencies: true, merge: true, worktree: true },
  continuity_snapshot: { head_sha: "head-1", target_sha: "target-1" },
  verification_plan: { commands: [] },
}), {
  valid: false,
  errors: ["readiness_evidence_summary_mismatch:blocker", "readiness_evidence_status_mismatch"],
});
assert.ok(validateReadinessEvidence({
  schema_version: "interruption_readiness.v1",
  status: "ready",
  checks: [{ id: "unknown", level: "unknown" }],
  summary: { blocker: -1, warning: 0, info: 0 },
  coverage: { engine: "yes", dependencies: true, merge: true, worktree: true },
  continuity_snapshot: { head_sha: "head-1", target_sha: "target-1" },
  verification_plan: { commands: [] },
}).errors.includes("readiness_evidence_check_level_invalid"));
assert.deepEqual(
  compareContinuitySnapshots({ ...baseline, target_sha: null }, { ...baseline, target_sha: null }, { now: Date.parse("2026-06-13T12:05:00.000Z"), maxAgeMinutes: 10 }),
  { fresh: false, reasons: ["baseline_target_missing", "current_target_missing"] },
);
assert.deepEqual(
  compareContinuitySnapshots(baseline, { ...baseline, target_sha: "target-2" }, { now: Date.parse("2026-06-13T12:05:00.000Z"), maxAgeMinutes: 10 }),
  { fresh: false, reasons: ["target_sha_changed"] },
);
assert.deepEqual(
  compareContinuitySnapshots(baseline, { ...baseline, worktree_sha256: "worktree-2" }, { now: Date.parse("2026-06-13T12:05:00.000Z"), maxAgeMinutes: 10 }),
  { fresh: false, reasons: ["worktree_sha256_changed"] },
);
assert.deepEqual(
  compareContinuitySnapshots(baseline, { ...baseline }, { now: Date.parse("2026-06-13T12:20:00.000Z"), maxAgeMinutes: 10 }),
  { fresh: false, reasons: ["baseline_expired"] },
);

const checks = [
  { level: "info" },
  { level: "warning" },
  { level: "blocker" },
];
assert.deepEqual(summarizeReadiness(checks), { blocker: 1, warning: 1, info: 1 });
assert.equal(shouldFailReadiness(checks), true);
assert.equal(shouldFailReadiness(checks.slice(0, 2)), false);

const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const manifest = readFileSync(new URL("./scripts/test-manifest.mjs", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const planRunner = readFileSync(new URL("./scripts/run-interruption-verification-plan.mjs", import.meta.url), "utf8");
const architecture = readFileSync(new URL("../docs/interruption-readiness-automation.md", import.meta.url), "utf8");
const executionLog = readFileSync(new URL("../docs/execution-log-interruption-readiness-2026-06-13.md", import.meta.url), "utf8");

assert.equal(packageJson.scripts["readiness:interruptions"], "node scripts/interruption-readiness.mjs");
assert.equal(packageJson.scripts["readiness:interruptions:ci"], "node scripts/interruption-readiness.mjs --ci");
assert.equal(packageJson.scripts["readiness:verify-plan"], "node scripts/run-interruption-verification-plan.mjs");
assert.match(manifest, /node test-interruption-readiness\.mjs/);
assert.match(manifest, /node test-interruption-verification-recovery\.mjs/);
assert.match(workflow, /--ci --skip-dependencies --skip-worktree/);
assert.match(workflow, /--ci --skip-merge --skip-worktree/);
assert.match(workflow, /--verify-evidence/);
assert.match(planRunner, /ALLOWED_COMMANDS/);
assert.match(planRunner, /--verify-evidence/);
assert.match(planRunner, /shell:\s*false/);
assert.match(planRunner, /interruption_verification_execution\.v1/);
assert.match(planRunner, /openSync\(leaseFile,\s*"wx"\)/);
assert.match(planRunner, /resumed_from_checkpoint/);
assert.doesNotMatch(planRunner, /process\.exit\(execution\.status\)/);
assert.match(planRunner, /verification_execution_lease_blocked/);
assert.match(planRunner, /must be outside the repository/);
assert.match(planRunner, /process\.kill\(pid,\s*0\)/);
assert.match(planRunner, /previous_owner_token/);
assert.match(planRunner, /prior_attempts/);
assert.match(planRunner, /execution_resumed/);
assert.match(planRunner, /events\.length > 200/);
assert.match(architecture, /isolated clean worktree/);
assert.match(executionLog, /Dependency failures are classified before tests/);

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "interruption-readiness-test-"));
try {
  const unauthorizedEvidence = path.join(temporaryDirectory, "unauthorized-evidence.json");
  writeFileSync(unauthorizedEvidence, JSON.stringify({
    verification_plan: { commands: ["node unauthorized-command.mjs"] },
  }));
  const unauthorizedRun = spawnSync(
    process.execPath,
    ["scripts/run-interruption-verification-plan.mjs", "--evidence", unauthorizedEvidence, "--dry-run"],
    { cwd: path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), encoding: "utf8", shell: false },
  );
  assert.equal(unauthorizedRun.status, 1);
  assert.match(unauthorizedRun.stderr, /unauthorized command/);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("interruption readiness checks passed");
