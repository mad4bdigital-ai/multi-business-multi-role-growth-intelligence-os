#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { testCommands as canonicalTestCommands } from "./test-manifest.mjs";

const authorityRecoveryTestCommands = Object.freeze([
  "node test-context-kernel-principal-resolver.mjs",
  "node test-context-kernel-subject-scope-delegation-resolver.mjs",
  "node test-context-kernel-subject-delegation-fail-closed.mjs",
  "node test-context-kernel-resource-graph-resolver.mjs",
  "node test-context-kernel-resource-graph-fail-closed.mjs",
  "node test-context-kernel-semantic-capability-before-provider.mjs",
  "node test-context-kernel-policy-grant-evaluator.mjs",
  "node test-context-kernel-policy-grant-fail-closed.mjs",
  "node test-context-kernel-endpoint-certification-resolver.mjs",
  "node test-context-kernel-endpoint-certification-fail-closed.mjs",
  "node test-context-kernel-shadow-authority-parity.mjs",
  "node test-context-kernel-shadow-authority-parity-fail-closed.mjs",
  "node test-authority-catalog-census.mjs",
  "node test-authority-path-inventory-compiler.mjs",
  "node test-authority-data-foundation-planner.mjs",
  "node test-authority-evidence-source-adapters.mjs",
  "node test-authority-ownership-review.mjs",
]);

const growthControlContinuationTestCommands = Object.freeze([
  "node test-growth-control-internal-reference-workflow.mjs",
  "node test-growth-control-policy-compiler.mjs",
  "node test-growth-control-final-boundary.mjs",
  "node test-growth-control-provider-adapter-resolver.mjs",
  "node test-growth-control-provider-effect-reconciliation.mjs",
  "node test-growth-control-idempotency-lease-outbox-integration.mjs",
  "node test-growth-control-admin-ui-projection.mjs",
  "node test-growth-control-admin-ui-default-normalization.mjs",
  "node test-growth-control-tenant-role-field-policy.mjs",
  "node test-growth-control-openapi-auth-contracts.mjs",
  "node test-growth-control-typed-invalidation-consumer.mjs",
]);

const diagnosticAutomationTestCommands = Object.freeze([
  "node test-branch-test-diagnostic-shards.mjs",
  "node test-sequential-test-progress-report.mjs",
  "node test-work-map-autofix-diagnostics.mjs",
]);

export const testCommands = Object.freeze([
  ...canonicalTestCommands,
  ...authorityRecoveryTestCommands,
  ...growthControlContinuationTestCommands,
  ...diagnosticAutomationTestCommands,
]);

const MAX_DIAGNOSTIC_STREAM_CHARS = 12_000;
const MAX_CAPTURE_BUFFER_BYTES = 16 * 1024 * 1024;

function defaultReportFile() {
  if (process.env.TEST_MANIFEST_REPORT_FILE) return process.env.TEST_MANIFEST_REPORT_FILE;
  if (process.env.TEST_SUITE_REPORT_DIR) {
    return path.join(process.env.TEST_SUITE_REPORT_DIR, "test-manifest.json");
  }
  return null;
}

function parseArgs(argv) {
  const options = {
    grep: null,
    list: false,
    reportFile: defaultReportFile(),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const readValue = (name) => {
      const value = argv[i + 1];
      if (value == null || value.startsWith("--")) throw new Error(`${name} requires a value.`);
      i += 1;
      return value;
    };

    if (arg === "--list") options.list = true;
    else if (arg === "--grep") options.grep = readValue("--grep");
    else if (arg.startsWith("--grep=")) options.grep = arg.slice("--grep=".length);
    else if (arg === "--report-file") options.reportFile = readValue("--report-file");
    else if (arg.startsWith("--report-file=")) options.reportFile = arg.slice("--report-file=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function splitCommand(command) {
  const parts = [];
  let current = "";
  let quote = null;

  for (const char of command) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) throw new Error(`Unclosed quote in command: ${command}`);
  if (current) parts.push(current);
  return parts;
}

export function redactDiagnosticOutput(value) {
  return String(value || "")
    .replace(/::add-mask::[^\r\n]*/giu, "::add-mask::[REDACTED]")
    .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/gu, "[REDACTED_PRIVATE_KEY]")
    .replace(/\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{16,}\b/gu, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/giu, "Bearer [REDACTED]")
    .replace(/(["']?)(authorization|api[_-]?key|token|secret|password|passwd|private[_-]?key|cookie)\1\s*[:=]\s*(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\s,;]+)/giu, "$1$2$1=[REDACTED]")
    .replace(/(https?:\/\/)([^\s/@:]+):([^\s/@]+)@/giu, "$1[REDACTED]@");
}

export function buildDiagnosticStream(value, maxChars = MAX_DIAGNOSTIC_STREAM_CHARS) {
  const sanitized = redactDiagnosticOutput(value);
  const truncated = sanitized.length > maxChars;
  return Object.freeze({
    tail: truncated ? sanitized.slice(-maxChars) : sanitized,
    truncated,
    originalChars: String(value || "").length,
    retainedChars: Math.min(sanitized.length, maxChars),
  });
}

function runCommand(command) {
  const [program, ...args] = splitCommand(command);
  const executable = program === "node" ? process.execPath : program;
  const startedAt = Date.now();
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    encoding: "utf8",
    maxBuffer: MAX_CAPTURE_BUFFER_BYTES,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  return Object.freeze({
    status: result.error ? 1 : (result.status ?? 1),
    durationMs: Date.now() - startedAt,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    ...(result.error ? { error: result.error.message || String(result.error) } : {}),
  });
}

function catalogSha256(commands) {
  return createHash("sha256").update(JSON.stringify(commands)).digest("hex");
}

function writeReport(reportFile, report) {
  if (!reportFile) return;
  const resolved = path.resolve(process.cwd(), reportFile);
  mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`);
  renameSync(temporary, resolved);
}

function escapedAnnotation(value) {
  return String(value).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function createReport(options, selectedCommands, commands) {
  return {
    contract: "mad4b.test-manifest-progress-report.v1",
    generatedAt: new Date().toISOString(),
    repository: process.env.GITHUB_REPOSITORY || null,
    ref: process.env.GITHUB_REF || null,
    headRef: process.env.GITHUB_HEAD_REF || null,
    baseRef: process.env.GITHUB_BASE_REF || null,
    commitSha: process.env.GITHUB_SHA || null,
    catalogSha256: catalogSha256(commands),
    totalCommands: commands.length,
    grep: options.grep,
    selectedCount: selectedCommands.length,
    status: options.list ? "listed" : "pending",
    currentCommand: null,
    lastPassed: null,
    firstFailure: null,
    commands: selectedCommands.map(({ command, commandIndex }, selectionIndex) => ({
      command,
      commandIndex,
      selectionIndex,
      status: options.list ? "listed" : "pending",
    })),
    diagnostics: {
      captureMode: "bounded_redacted_failure_tail",
      maxCharsPerStream: MAX_DIAGNOSTIC_STREAM_CHARS,
    },
    secretsIncluded: false,
  };
}

export function runTestManifest(argv = process.argv.slice(2), runtime = {}) {
  const options = parseArgs(argv);
  const commands = Object.freeze([...(runtime.testCommands || testCommands)]);
  const executeCommand = runtime.runCommand || runCommand;
  const indexedCommands = commands.map((command, commandIndex) => Object.freeze({ command, commandIndex }));
  const selectedCommands = options.grep
    ? indexedCommands.filter(({ command }) => command.includes(options.grep))
    : indexedCommands;
  const report = createReport(options, selectedCommands, commands);

  if (options.list) {
    selectedCommands.forEach(({ command, commandIndex }, selectionIndex) => {
      console.log(`${selectionIndex + 1}. [test:${commandIndex}] ${command}`);
    });
    report.completedAt = new Date().toISOString();
    writeReport(options.reportFile, report);
    return 0;
  }

  if (!selectedCommands.length) {
    report.status = "no_matches";
    report.completedAt = new Date().toISOString();
    writeReport(options.reportFile, report);
    console.error("No test commands matched.");
    return 1;
  }

  report.status = "running";
  writeReport(options.reportFile, report);

  for (let selectionIndex = 0; selectionIndex < selectedCommands.length; selectionIndex += 1) {
    const { command, commandIndex } = selectedCommands[selectionIndex];
    const current = { command, commandIndex, selectionIndex };
    report.currentCommand = current;
    report.commands[selectionIndex] = { ...current, status: "running", startedAt: new Date().toISOString() };
    writeReport(options.reportFile, report);

    console.log(`\n[${selectionIndex + 1}/${selectedCommands.length}][test:${commandIndex}] ${command}`);
    const execution = executeCommand(command);
    const completedCommand = {
      ...current,
      status: execution.status === 0 ? "passed" : "failed",
      exitCode: execution.status,
      durationMs: execution.durationMs,
      ...(execution.error ? { error: redactDiagnosticOutput(execution.error) } : {}),
    };

    if (execution.status !== 0) {
      completedCommand.diagnostic = {
        stdout: buildDiagnosticStream(execution.stdout),
        stderr: buildDiagnosticStream(execution.stderr),
      };
    }

    report.commands[selectionIndex] = completedCommand;
    report.currentCommand = null;

    if (execution.status === 0) {
      report.lastPassed = completedCommand;
      writeReport(options.reportFile, report);
      continue;
    }

    report.status = "failed";
    report.firstFailure = completedCommand;
    report.completedAt = new Date().toISOString();
    writeReport(options.reportFile, report);
    console.error(`::error title=Sequential test command failed::${escapedAnnotation(command)} (#${commandIndex}) exited with status ${execution.status}`);
    return execution.status;
  }

  report.status = "passed";
  report.completedAt = new Date().toISOString();
  writeReport(options.reportFile, report);
  return 0;
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  return pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href;
}

if (isDirectExecution()) {
  try {
    process.exitCode = runTestManifest();
  } catch (error) {
    console.error(error?.message || error);
    process.exitCode = 1;
  }
}
