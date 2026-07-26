import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const API_ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "interruption-verification-recovery-"));

function run(args) {
  return spawnSync(process.execPath, args, {
    cwd: API_ROOT,
    encoding: "utf8",
    shell: false,
  });
}

try {
  const evidenceFile = path.join(temporaryDirectory, "evidence.json");
  const resultFile = path.join(temporaryDirectory, "result.json");
  const readiness = run([
    "scripts/interruption-readiness.mjs",
    "--skip-dependencies",
    "--skip-merge",
    "--skip-worktree",
    "--report-file",
    evidenceFile,
  ]);
  assert.equal(readiness.status, 0, readiness.stderr || readiness.stdout);
  const evidence = JSON.parse(readFileSync(evidenceFile, "utf8"));
  evidence.verification_plan = { changed_files: [], matched_rules: [], commands: ["node test-interruption-readiness.mjs"] };
  writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);

  const firstRun = run([
    "scripts/run-interruption-verification-plan.mjs",
    "--evidence",
    evidenceFile,
    "--result-file",
    resultFile,
  ]);
  assert.equal(firstRun.status, 0, firstRun.stderr || firstRun.stdout);
  const firstResult = JSON.parse(readFileSync(resultFile, "utf8"));
  assert.equal(firstResult.status, "passed");
  assert.equal(firstResult.steps[0].status, "passed");
  assert.equal(existsSync(`${resultFile}.lease`), false);

  const resume = run([
    "scripts/run-interruption-verification-plan.mjs",
    "--evidence",
    evidenceFile,
    "--result-file",
    resultFile,
    "--resume",
  ]);
  assert.equal(resume.status, 0, resume.stderr || resume.stdout);
  const resumedResult = JSON.parse(readFileSync(resultFile, "utf8"));
  assert.equal(resumedResult.resumed, true);
  assert.equal(resumedResult.steps[0].resumed_from_checkpoint, true);
  assert.equal(resumedResult.prior_attempts.length, 1);

  const tamperedResultFile = path.join(temporaryDirectory, "tampered-result.json");
  const tamperedResult = structuredClone(resumedResult);
  tamperedResult.events[0].event_type = "tampered_event";
  writeFileSync(tamperedResultFile, `${JSON.stringify(tamperedResult, null, 2)}\n`);
  const tamperedResume = run([
    "scripts/run-interruption-verification-plan.mjs",
    "--evidence",
    evidenceFile,
    "--result-file",
    tamperedResultFile,
    "--resume",
  ]);
  assert.equal(tamperedResume.status, 1);
  assert.match(tamperedResume.stderr, /checkpoint_event_chain_invalid/);

  const blockedEvidenceFile = path.join(temporaryDirectory, "blocked-evidence.json");
  const blockedResultFile = path.join(temporaryDirectory, "blocked-result.json");
  writeFileSync(blockedEvidenceFile, `${JSON.stringify({
    ...evidence,
    status: "blocked",
    summary: { blocker: 1, warning: 0, info: 0 },
    checks: [{ id: "simulated_blocker", level: "blocker", message: "simulated", evidence: {} }],
  }, null, 2)}\n`);
  const blockedBaseline = run([
    "scripts/run-interruption-verification-plan.mjs",
    "--evidence",
    blockedEvidenceFile,
    "--result-file",
    blockedResultFile,
    "--dry-run",
  ]);
  assert.equal(blockedBaseline.status, 1);
  const blockedResult = JSON.parse(readFileSync(blockedResultFile, "utf8"));
  assert.equal(blockedResult.status, "blocked");
  assert.equal(blockedResult.blocker.code, "readiness_evidence_invalid");
  assert.equal(blockedResult.steps.some((step) => step.status === "passed"), false);

  const activeResultFile = path.join(temporaryDirectory, "active-result.json");
  writeFileSync(`${activeResultFile}.lease`, JSON.stringify({
    schema_version: "interruption_verification_lease.v1",
    owner_token: "active-owner",
    pid: process.pid,
    acquired_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
  const activeLease = run([
    "scripts/run-interruption-verification-plan.mjs",
    "--evidence",
    evidenceFile,
    "--result-file",
    activeResultFile,
    "--dry-run",
  ]);
  assert.equal(activeLease.status, 1);
  assert.match(activeLease.stderr, /lease is active/);
  assert.equal(existsSync(activeResultFile), false);

  const orphanResultFile = path.join(temporaryDirectory, "orphan-result.json");
  writeFileSync(`${orphanResultFile}.lease`, JSON.stringify({
    schema_version: "interruption_verification_lease.v1",
    owner_token: "orphan-owner",
    pid: 2147483647,
    acquired_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
  const orphanRecovery = run([
    "scripts/run-interruption-verification-plan.mjs",
    "--evidence",
    evidenceFile,
    "--result-file",
    orphanResultFile,
    "--dry-run",
    "--recover-stale-lease",
  ]);
  assert.equal(orphanRecovery.status, 0, orphanRecovery.stderr || orphanRecovery.stdout);
  const orphanResult = JSON.parse(readFileSync(orphanResultFile, "utf8"));
  assert.equal(orphanResult.status, "planned");
  assert.ok(orphanResult.events.some((event) => event.event_type === "lease_recovered"));
  assert.equal(existsSync(`${orphanResultFile}.lease`), false);

  evidence.continuity_snapshot.generated_at = new Date(Date.now() + 60_000).toISOString();
  writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
  const replacedEvidenceResume = run([
    "scripts/run-interruption-verification-plan.mjs",
    "--evidence",
    evidenceFile,
    "--result-file",
    resultFile,
    "--resume",
  ]);
  assert.equal(replacedEvidenceResume.status, 1);
  assert.match(replacedEvidenceResume.stderr, /checkpoint_evidence_identity_mismatch/);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("interruption verification recovery checks passed");
