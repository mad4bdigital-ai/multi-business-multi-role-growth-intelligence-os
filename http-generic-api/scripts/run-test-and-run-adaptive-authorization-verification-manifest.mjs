import { spawnSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const phases = Object.freeze([
  Object.freeze({ id: "brand-skill-migration-preflight", script: "test-brand-skill-migration-preflight.mjs" }),
  Object.freeze({ id: "brand-skill-mariadb-certification", script: "test-brand-skill-mariadb-certification-contract.mjs" }),
  Object.freeze({ id: "canonical-test-manifest", script: "scripts/run-test-manifest.mjs" }),
  Object.freeze({ id: "managed-git-remote-transport", script: "test-managed-git-remote-transport.mjs" }),
  Object.freeze({ id: "operation-orchestrator-managed-git-transport", script: "test-operation-orchestrator-managed-git-transport.mjs" }),
  Object.freeze({ id: "managed-git-input-hardening", script: "test-managed-git-remote-transport-input-hardening.mjs" }),
  Object.freeze({ id: "dynamic-container-override-governance", script: "test-dynamic-container-override-governance-smoke.mjs" }),
  Object.freeze({ id: "adaptive-authorization-verification", script: "scripts/run-adaptive-authorization-verification-manifest.mjs" }),
]);

function reportDirectory() {
  return process.env.TEST_SUITE_REPORT_DIR || null;
}

function reportFile() {
  if (process.env.TEST_SUITE_REPORT_FILE) return process.env.TEST_SUITE_REPORT_FILE;
  const directory = reportDirectory();
  return directory ? path.join(directory, "test-suite.json") : null;
}

function writeReport(file, report) {
  if (!file) return;
  const resolved = path.resolve(root, file);
  mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`);
  renameSync(temporary, resolved);
}

function escapedAnnotation(value) {
  return String(value).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

const outputFile = reportFile();
const report = {
  contract: "mad4b.sequential-test-suite-progress-report.v1",
  generatedAt: new Date().toISOString(),
  repository: process.env.GITHUB_REPOSITORY || null,
  ref: process.env.GITHUB_REF || null,
  headRef: process.env.GITHUB_HEAD_REF || null,
  baseRef: process.env.GITHUB_BASE_REF || null,
  commitSha: process.env.GITHUB_SHA || null,
  status: "running",
  currentPhase: null,
  lastPassed: null,
  firstFailure: null,
  phases: phases.map(({ id, script }, phaseIndex) => ({ id, script, phaseIndex, status: "pending" })),
  secretsIncluded: false,
};
writeReport(outputFile, report);

for (let phaseIndex = 0; phaseIndex < phases.length; phaseIndex += 1) {
  const { id, script } = phases[phaseIndex];
  const currentPhase = { id, script, phaseIndex };
  report.currentPhase = currentPhase;
  report.phases[phaseIndex] = { ...currentPhase, status: "running", startedAt: new Date().toISOString() };
  writeReport(outputFile, report);

  const startedAt = Date.now();
  const childEnvironment = { ...process.env };
  const directory = reportDirectory();
  if (directory && !childEnvironment.TEST_MANIFEST_REPORT_FILE) {
    childEnvironment.TEST_MANIFEST_REPORT_FILE = path.join(directory, "test-manifest.json");
  }
  const completed = spawnSync(process.execPath, [script], {
    cwd: root,
    env: childEnvironment,
    stdio: "inherit",
    shell: false,
  });

  const phaseResult = {
    ...currentPhase,
    status: completed.error || completed.status !== 0 ? "failed" : "passed",
    exitCode: completed.error ? 1 : (completed.status ?? 1),
    durationMs: Date.now() - startedAt,
    ...(completed.error ? { error: completed.error.message || String(completed.error) } : {}),
  };
  report.phases[phaseIndex] = phaseResult;
  report.currentPhase = null;

  if (phaseResult.status === "passed") {
    report.lastPassed = phaseResult;
    writeReport(outputFile, report);
    continue;
  }

  report.status = "failed";
  report.firstFailure = phaseResult;
  report.completedAt = new Date().toISOString();
  writeReport(outputFile, report);
  console.error(`::error title=Sequential test phase failed::${escapedAnnotation(id)} (${escapedAnnotation(script)}) exited with status ${phaseResult.exitCode}`);
  process.exit(phaseResult.exitCode);
}

report.status = "passed";
report.completedAt = new Date().toISOString();
writeReport(outputFile, report);
