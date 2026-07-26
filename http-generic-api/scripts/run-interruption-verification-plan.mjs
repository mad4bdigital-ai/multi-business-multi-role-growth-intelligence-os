#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { testCommands } from "./test-manifest.mjs";
import { canRecoverExecutionLease, classifyExecutionLease, evidenceIdentitySha256, hashVerificationEvent, leaseOwnedBy, planCommandsSha256, resumablePassedCommands, validateCheckpoint, validateReadinessEvidence } from "../interruptionReadiness.js";

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(API_ROOT, "..");
const ALLOWED_COMMANDS = new Set([
  ...testCommands,
  "node ../validate-memory-schema.mjs",
  "node ../validate-canonical-sources.mjs",
  "node ../build-canonicals.mjs --check",
]);

function parseArgs(argv) {
  const options = { evidence: null, resultFile: null, dryRun: false, resume: false, recoverStaleLease: false, maxAgeMinutes: 360, leaseTimeoutMinutes: 120 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--evidence") options.evidence = argv[++index];
    else if (arg.startsWith("--evidence=")) options.evidence = arg.slice("--evidence=".length);
    else if (arg === "--result-file") options.resultFile = argv[++index];
    else if (arg.startsWith("--result-file=")) options.resultFile = arg.slice("--result-file=".length);
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--resume") options.resume = true;
    else if (arg === "--recover-stale-lease") options.recoverStaleLease = true;
    else if (arg === "--max-age-minutes") options.maxAgeMinutes = Number(argv[++index]);
    else if (arg.startsWith("--max-age-minutes=")) options.maxAgeMinutes = Number(arg.slice("--max-age-minutes=".length));
    else if (arg === "--lease-timeout-minutes") options.leaseTimeoutMinutes = Number(argv[++index]);
    else if (arg.startsWith("--lease-timeout-minutes=")) options.leaseTimeoutMinutes = Number(arg.slice("--lease-timeout-minutes=".length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.evidence) throw new Error("--evidence is required");
  if ((options.resume || options.recoverStaleLease) && !options.resultFile) throw new Error("--result-file is required for resume or stale lease recovery");
  if (!Number.isFinite(options.maxAgeMinutes) || options.maxAgeMinutes < 0) throw new Error("--max-age-minutes must be a non-negative number");
  if (!Number.isFinite(options.leaseTimeoutMinutes) || options.leaseTimeoutMinutes < 0) throw new Error("--lease-timeout-minutes must be a non-negative number");
  return options;
}

function assertOperationalArtifactOutsideRepo(file, label) {
  if (!file) return;
  const resolved = path.resolve(process.cwd(), file);
  const relative = path.relative(REPO_ROOT, resolved);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error(`${label} must be outside the repository to avoid invalidating continuity evidence.`);
  }
}

function splitCommand(command) {
  const parts = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return parts.map((part) => part.replace(/^(["'])(.*)\1$/, "$2"));
}

function run(command, { inherit = true } = {}) {
  const [program, ...args] = splitCommand(command);
  const executable = program === "node" ? process.execPath : program;
  const result = spawnSync(executable, args, {
    cwd: API_ROOT,
    env: process.env,
    encoding: inherit ? undefined : "utf8",
    shell: false,
    stdio: inherit ? "inherit" : "pipe",
  });
  if (result.error) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function assertFresh(evidenceFile, maxAgeMinutes) {
  const command = `node scripts/interruption-readiness.mjs --skip-dependencies --skip-merge --skip-worktree --verify-evidence "${evidenceFile}" --max-age-minutes ${maxAgeMinutes}`;
  const result = run(command, { inherit: false });
  if (result.status !== 0) {
    throw new Error(`Readiness evidence is stale or blocked.\n${result.stdout}${result.stderr}`.trim());
  }
}

function writeResult(file, result) {
  if (!file) return;
  const resolved = path.resolve(process.cwd(), file);
  const temporary = `${resolved}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(result, null, 2)}\n`);
  renameSync(temporary, resolved);
}

function appendEvent(result, eventType, evidence = {}) {
  const event = {
    event_id: randomUUID(),
    event_type: eventType,
    occurred_at: new Date().toISOString(),
    previous_event_sha256: result.event_chain_head_sha256 || null,
    evidence: { ...evidence, secrets_included: false },
  };
  event.event_sha256 = hashVerificationEvent(event);
  result.events.push(event);
  result.event_chain_head_sha256 = event.event_sha256;
  if (result.events.length > 200) result.events = result.events.slice(-200);
}

function summarizePreviousAttempt(previous) {
  if (!previous) return null;
  return {
    run_id: previous.run_id || null,
    attempt_number: previous.attempt_number || 1,
    status: previous.status || null,
    completed_at: previous.completed_at || null,
    passed_commands: (previous.steps || []).filter((step) => step.status === "passed").map((step) => step.command),
    blocker_code: previous.blocker?.code || null,
    secrets_included: false,
  };
}

function acquireLease(resultFile, options) {
  if (!resultFile) return null;
  const leaseFile = `${path.resolve(process.cwd(), resultFile)}.lease`;
  const lease = {
    schema_version: "interruption_verification_lease.v1",
    owner_token: randomUUID(),
    pid: process.pid,
    acquired_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  try {
    const descriptor = openSync(leaseFile, "wx");
    writeFileSync(descriptor, `${JSON.stringify(lease, null, 2)}\n`);
    closeSync(descriptor);
    return { leaseFile, lease };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = JSON.parse(readFileSync(leaseFile, "utf8"));
    const classification = classifyExecutionLease(existing, { leaseTimeoutMinutes: options.leaseTimeoutMinutes });
    const ownerPid = Number(existing.pid);
    const ownerPidValid = Number.isInteger(ownerPid) && ownerPid > 0;
    const ownerAlive = ownerPidValid && processIsAlive(ownerPid);
    const recoverable = canRecoverExecutionLease({
      requested: options.recoverStaleLease,
      classification,
      ownerPidValid,
      ownerAlive,
    });
    if (!recoverable) {
      const blocked = new Error(`Verification execution lease is ${classification.state}; another executor may own this plan.`);
      blocked.code = "verification_execution_lease_blocked";
      throw blocked;
    }
    unlinkSync(leaseFile);
    lease.recovery = {
      classification: classification.state === "stale" ? "stale_owner_dead" : "orphaned_owner_dead",
      previous_owner_token: existing.owner_token || null,
      previous_pid: existing.pid || null,
    };
    const descriptor = openSync(leaseFile, "wx");
    writeFileSync(descriptor, `${JSON.stringify(lease, null, 2)}\n`);
    closeSync(descriptor);
    return { leaseFile, lease };
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function heartbeatLease(leaseState) {
  if (!leaseState) return;
  const current = JSON.parse(readFileSync(leaseState.leaseFile, "utf8"));
  if (!leaseOwnedBy(current, leaseState.lease.owner_token)) {
    const error = new Error("Verification execution lease ownership was lost.");
    error.code = "verification_execution_lease_lost";
    throw error;
  }
  leaseState.lease.updated_at = new Date().toISOString();
  writeFileSync(leaseState.leaseFile, `${JSON.stringify(leaseState.lease, null, 2)}\n`);
}

function releaseLease(leaseState) {
  if (!leaseState || !existsSync(leaseState.leaseFile)) return;
  const current = JSON.parse(readFileSync(leaseState.leaseFile, "utf8"));
  if (leaseOwnedBy(current, leaseState.lease.owner_token)) unlinkSync(leaseState.leaseFile);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  assertOperationalArtifactOutsideRepo(options.resultFile, "--result-file");
  const evidenceFile = path.resolve(process.cwd(), options.evidence);
  const evidence = JSON.parse(readFileSync(evidenceFile, "utf8"));
  const commands = evidence.verification_plan?.commands || [];
  const planSha256 = planCommandsSha256(commands);
  const evidenceSha256 = evidenceIdentitySha256(evidence);
  const resultFile = options.resultFile ? path.resolve(process.cwd(), options.resultFile) : null;
  const previous = options.resume && resultFile && existsSync(resultFile) ? JSON.parse(readFileSync(resultFile, "utf8")) : null;
  if (options.resume) {
    const checkpoint = validateCheckpoint(previous, { evidenceFile, evidenceSha256, planSha256, commands });
    if (!checkpoint.valid) throw new Error(`Checkpoint cannot be resumed: ${checkpoint.errors.join(", ")}`);
  }
  const resumable = new Set(resumablePassedCommands(previous, { evidenceFile, evidenceSha256, planSha256, commands }));
  const result = {
    schema_version: "interruption_verification_execution.v1",
    run_id: randomUUID(),
    attempt_number: Number(previous?.attempt_number || 0) + 1,
    evidence_file: evidenceFile,
    baseline_generated_at: evidence.continuity_snapshot?.generated_at || null,
    evidence_sha256: evidenceSha256,
    plan_sha256: planSha256,
    dry_run: options.dryRun,
    resumed: options.resume,
    status: "running",
    started_at: new Date().toISOString(),
    completed_at: null,
    prior_attempts: [...(Array.isArray(previous?.prior_attempts) ? previous.prior_attempts : []), summarizePreviousAttempt(previous)].filter(Boolean).slice(-20),
    events: [],
    event_chain_head_sha256: null,
    steps: commands.map((command) => ({
      command,
      status: resumable.has(command) ? "passed" : options.dryRun ? "planned" : "pending",
      ...(resumable.has(command) ? { resumed_from_checkpoint: true } : {}),
    })),
  };
  let leaseState = null;
  appendEvent(result, options.resume ? "execution_resumed" : "execution_started", {
    attempt_number: result.attempt_number,
    resumed_passed_step_count: resumable.size,
  });

  try {
    leaseState = acquireLease(options.resultFile, options);
    appendEvent(result, leaseState?.lease?.recovery ? "lease_recovered" : "lease_acquired", leaseState?.lease?.recovery || {});
    heartbeatLease(leaseState);
    const evidenceValidation = validateReadinessEvidence(evidence);
    if (!evidenceValidation.valid) {
      result.status = "blocked";
      result.blocker = { code: "readiness_evidence_invalid", reasons: evidenceValidation.errors };
      result.completed_at = new Date().toISOString();
      appendEvent(result, "execution_blocked", { blocker_code: result.blocker.code, reasons: evidenceValidation.errors });
      writeResult(options.resultFile, result);
      throw new Error(`Readiness evidence cannot authorize verification execution: ${evidenceValidation.errors.join(", ")}`);
    }
    const unauthorized = commands.filter((command) => !ALLOWED_COMMANDS.has(command));
    if (unauthorized.length) {
      result.status = "blocked";
      result.blocker = { code: "unauthorized_verification_command", commands: unauthorized };
      result.completed_at = new Date().toISOString();
      appendEvent(result, "execution_blocked", { blocker_code: result.blocker.code });
      writeResult(options.resultFile, result);
      throw new Error(`Verification plan contains unauthorized command(s): ${unauthorized.join(", ")}`);
    }
    assertFresh(evidenceFile, options.maxAgeMinutes);
    writeResult(options.resultFile, result);
    for (const step of result.steps) {
      if (step.status === "passed") continue;
      const command = step.command;
      heartbeatLease(leaseState);
      assertFresh(evidenceFile, options.maxAgeMinutes);
      if (options.dryRun) continue;
      step.status = "running";
      appendEvent(result, "step_started", { command });
      writeResult(options.resultFile, result);
      const execution = run(command);
      step.exit_code = execution.status;
      step.status = execution.status === 0 ? "passed" : "failed";
      appendEvent(result, step.status === "passed" ? "step_passed" : "step_failed", { command, exit_code: execution.status });
      writeResult(options.resultFile, result);
      if (execution.status !== 0) {
        result.status = "failed";
        result.completed_at = new Date().toISOString();
        writeResult(options.resultFile, result);
        const stepError = new Error(`Verification step failed with exit code ${execution.status}: ${command}`);
        stepError.code = "verification_step_failed";
        throw stepError;
      }
    }
    assertFresh(evidenceFile, options.maxAgeMinutes);
    result.status = options.dryRun ? "planned" : "passed";
    result.completed_at = new Date().toISOString();
    appendEvent(result, options.dryRun ? "execution_planned" : "execution_passed", { step_count: commands.length });
    writeResult(options.resultFile, result);
    console.log(`Interruption verification plan: ${result.status.toUpperCase()} (${commands.length} step(s))`);
  } catch (error) {
    if (result.status === "running" && error?.code !== "verification_execution_lease_blocked") {
      result.status = "blocked";
      result.blocker = { code: "verification_continuity_blocked", message: error?.message || String(error) };
      result.completed_at = new Date().toISOString();
      appendEvent(result, "execution_blocked", { blocker_code: result.blocker.code });
      writeResult(options.resultFile, result);
    }
    throw error;
  } finally {
    releaseLease(leaseState);
  }
}

try {
  main();
} catch (error) {
  console.error(error?.message || error);
  process.exit(1);
}
