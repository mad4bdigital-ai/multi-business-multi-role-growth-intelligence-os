#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { testCommands } from "./run-test-manifest.mjs";

const MAX_PARTITIONS = 64;
const MAX_MATRIX_JOBS = 64;
const DEFAULT_TARGET_SIZE = 8;
const COMPOUND_FAMILIES = Object.freeze([
  "growth-control",
  "context-kernel",
  "repository-authority",
  "resource-authority",
  "frontend-surface",
  "frontend-operation",
  "custom-gpt",
  "execution-resolver",
  "delegation-grant",
  "tenant-activation",
  "system-tool",
  "provider-adapter",
  "authority-catalog",
  "admin-workspace",
  "container-authority",
  "durable-execution",
  "sequential-plan",
]);

function parseArgs(argv) {
  const options = {
    parentIndex: 0,
    parentCount: 1,
    shardIndex: null,
    shardCount: null,
    family: null,
    grep: null,
    list: false,
    failFast: false,
    reportFile: null,
    emitMatrix: false,
    targetSize: DEFAULT_TARGET_SIZE,
    maxJobs: MAX_MATRIX_JOBS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const readValue = (name) => {
      const value = argv[index + 1];
      if (value == null || value.startsWith("--")) throw new Error(`${name} requires a value.`);
      index += 1;
      return value;
    };

    if (argument === "--parent-index") options.parentIndex = Number(readValue("--parent-index"));
    else if (argument.startsWith("--parent-index=")) options.parentIndex = Number(argument.slice("--parent-index=".length));
    else if (argument === "--parent-count") options.parentCount = Number(readValue("--parent-count"));
    else if (argument.startsWith("--parent-count=")) options.parentCount = Number(argument.slice("--parent-count=".length));
    else if (argument === "--shard-index") options.shardIndex = Number(readValue("--shard-index"));
    else if (argument.startsWith("--shard-index=")) options.shardIndex = Number(argument.slice("--shard-index=".length));
    else if (argument === "--shard-count") options.shardCount = Number(readValue("--shard-count"));
    else if (argument.startsWith("--shard-count=")) options.shardCount = Number(argument.slice("--shard-count=".length));
    else if (argument === "--family") options.family = readValue("--family");
    else if (argument.startsWith("--family=")) options.family = argument.slice("--family=".length);
    else if (argument === "--grep") options.grep = readValue("--grep");
    else if (argument.startsWith("--grep=")) options.grep = argument.slice("--grep=".length);
    else if (argument === "--report-file") options.reportFile = readValue("--report-file");
    else if (argument.startsWith("--report-file=")) options.reportFile = argument.slice("--report-file=".length);
    else if (argument === "--target-size") options.targetSize = Number(readValue("--target-size"));
    else if (argument.startsWith("--target-size=")) options.targetSize = Number(argument.slice("--target-size=".length));
    else if (argument === "--max-jobs") options.maxJobs = Number(readValue("--max-jobs"));
    else if (argument.startsWith("--max-jobs=")) options.maxJobs = Number(argument.slice("--max-jobs=".length));
    else if (argument === "--emit-matrix") options.emitMatrix = true;
    else if (argument === "--list") options.list = true;
    else if (argument === "--fail-fast") options.failFast = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }

  for (const [name, value] of Object.entries({ parentIndex: options.parentIndex, parentCount: options.parentCount })) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`);
  }
  if (options.parentCount < 1 || options.parentCount > MAX_PARTITIONS) {
    throw new Error(`parentCount must be from 1 to ${MAX_PARTITIONS}.`);
  }
  if (options.parentIndex >= options.parentCount) {
    throw new Error("Diagnostic parent coordinates are out of range.");
  }
  if (!Number.isInteger(options.targetSize) || options.targetSize < 1 || options.targetSize > 256) {
    throw new Error("targetSize must be an integer from 1 to 256.");
  }
  if (!Number.isInteger(options.maxJobs) || options.maxJobs < 1 || options.maxJobs > 256) {
    throw new Error("maxJobs must be an integer from 1 to 256.");
  }

  if (!options.emitMatrix) {
    for (const [name, value] of Object.entries({ shardIndex: options.shardIndex, shardCount: options.shardCount })) {
      if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`);
    }
    if (options.shardCount < 1 || options.shardCount > MAX_PARTITIONS) {
      throw new Error(`shardCount must be from 1 to ${MAX_PARTITIONS}.`);
    }
    if (options.shardIndex >= options.shardCount) {
      throw new Error("Diagnostic shard coordinates are out of range.");
    }
  }

  return options;
}

function splitCommand(command) {
  const parts = [];
  let current = "";
  let quote = null;
  for (const character of command) {
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (current) parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (quote) throw new Error(`Unclosed quote in command: ${command}`);
  if (current) parts.push(current);
  return parts;
}

function commandTestStem(command) {
  const parts = splitCommand(command);
  const testFile = parts.find((part) => /^test-.+\.mjs$/u.test(path.basename(part)));
  if (!testFile) return "misc";
  return path.basename(testFile).replace(/^test-/u, "").replace(/\.mjs$/u, "");
}

export function deriveDiagnosticFamily(command) {
  const stem = commandTestStem(command);
  const compound = COMPOUND_FAMILIES.find((family) => stem === family || stem.startsWith(`${family}-`));
  if (compound) return compound;
  const tokens = stem.split("-").filter(Boolean);
  return tokens.slice(0, Math.min(2, tokens.length)).join("-") || "misc";
}

function safeSlug(value) {
  return String(value || "misc")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "misc";
}

function indexedCatalog(options) {
  const indexed = testCommands.map((command, commandIndex) => Object.freeze({
    command,
    commandIndex,
    family: deriveDiagnosticFamily(command),
  }));
  const filtered = indexed.filter((item) => {
    if (options.grep && !item.command.includes(options.grep)) return false;
    if (options.family && item.family !== options.family) return false;
    return item.commandIndex % options.parentCount === options.parentIndex;
  });
  return Object.freeze(filtered);
}

export function buildDiagnosticMatrix(options) {
  const candidates = indexedCatalog(options);
  if (!candidates.length) throw new Error("No test commands matched the diagnostic plan.");

  const groups = new Map();
  for (const item of candidates) {
    const familyCommands = groups.get(item.family) || [];
    familyCommands.push(item);
    groups.set(item.family, familyCommands);
  }

  let targetSize = options.targetSize;
  let rows = [];
  do {
    rows = [];
    for (const family of [...groups.keys()].sort()) {
      const familyCommands = groups.get(family);
      const shardCount = Math.max(1, Math.ceil(familyCommands.length / targetSize));
      for (let shardIndex = 0; shardIndex < shardCount; shardIndex += 1) {
        const selectedCount = familyCommands.filter((_, localIndex) => localIndex % shardCount === shardIndex).length;
        rows.push(Object.freeze({
          family,
          family_slug: safeSlug(family),
          shard_index: shardIndex,
          shard_number: shardIndex + 1,
          shard_count: shardCount,
          command_count: selectedCount,
        }));
      }
    }
    if (rows.length <= options.maxJobs) break;
    targetSize += 1;
  } while (targetSize <= 256);

  if (rows.length > options.maxJobs) {
    throw new Error(`Diagnostic matrix requires ${rows.length} jobs, above maxJobs=${options.maxJobs}.`);
  }

  return Object.freeze({
    include: rows,
    target_size: targetSize,
    family_count: groups.size,
    command_count: candidates.length,
  });
}

function selectCommands(options) {
  const candidates = indexedCatalog(options);
  return Object.freeze(candidates.filter((_, localIndex) => localIndex % options.shardCount === options.shardIndex));
}

function runCommand(command) {
  const [program, ...args] = splitCommand(command);
  const startedAt = Date.now();
  const result = spawnSync(program === "node" ? process.execPath : program, args, {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  return Object.freeze({ status: result.status ?? 1, durationMs: Date.now() - startedAt });
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

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function runDiagnosticShard(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.emitMatrix) {
    process.stdout.write(`${JSON.stringify(buildDiagnosticMatrix(options))}\n`);
    return 0;
  }

  const selected = selectCommands(options);
  const catalogSha256 = sha256(testCommands);
  const report = {
    contract: "mad4b.test-diagnostic-shard-report.v2",
    generatedAt: new Date().toISOString(),
    repository: process.env.GITHUB_REPOSITORY || null,
    ref: process.env.GITHUB_REF || null,
    headRef: process.env.GITHUB_HEAD_REF || null,
    baseRef: process.env.GITHUB_BASE_REF || null,
    commitSha: process.env.GITHUB_SHA || null,
    catalogSha256,
    totalCommands: testCommands.length,
    family: options.family,
    grep: options.grep,
    parentIndex: options.parentIndex,
    parentCount: options.parentCount,
    shardIndex: options.shardIndex,
    shardCount: options.shardCount,
    selectedCount: selected.length,
    failFast: options.failFast,
    status: options.list ? "listed" : "running",
    commands: selected.map(({ command, commandIndex, family }) => ({
      command,
      commandIndex,
      family,
      status: options.list ? "listed" : "pending",
    })),
    failures: [],
    rerun: {
      family: options.family,
      parentIndex: options.shardIndex,
      parentCount: options.shardCount,
    },
    secretsIncluded: false,
  };

  console.log(JSON.stringify({
    contract: report.contract,
    catalogSha256,
    totalCommands: report.totalCommands,
    family: report.family,
    grep: report.grep,
    parentIndex: report.parentIndex,
    parentCount: report.parentCount,
    shardIndex: report.shardIndex,
    shardCount: report.shardCount,
    selectedCount: report.selectedCount,
    failFast: report.failFast,
    secretsIncluded: false,
  }, null, 2));

  if (options.list) {
    for (const item of report.commands) console.log(`[${item.family}][test:${item.commandIndex}] ${item.command}`);
    writeReport(options.reportFile, report);
    return 0;
  }

  for (let index = 0; index < selected.length; index += 1) {
    const { command, commandIndex, family } = selected[index];
    console.log(`\n[${index + 1}/${selected.length}][${family}][test:${commandIndex}] ${command}`);
    let execution;
    try {
      execution = runCommand(command);
    } catch (error) {
      execution = { status: 1, durationMs: 0, error: error?.message || String(error) };
    }
    report.commands[index] = {
      command,
      commandIndex,
      family,
      status: execution.status === 0 ? "passed" : "failed",
      exitCode: execution.status,
      durationMs: execution.durationMs,
      ...(execution.error ? { error: execution.error } : {}),
    };
    if (execution.status !== 0) {
      const failure = { command, commandIndex, family, exitCode: execution.status };
      report.failures.push(failure);
      console.error(`::error title=${escapedAnnotation(family)} diagnostic failed::${escapedAnnotation(command)} exited with status ${execution.status}`);
      if (options.failFast) break;
    }
  }

  report.status = report.failures.length ? "failed" : "passed";
  report.completedAt = new Date().toISOString();
  writeReport(options.reportFile, report);
  console.log(JSON.stringify({
    contract: report.contract,
    catalogSha256,
    family: report.family,
    status: report.status,
    selectedCount: report.selectedCount,
    passedCount: report.commands.filter((item) => item.status === "passed").length,
    failedCount: report.failures.length,
    failureCommandIndexes: report.failures.map((item) => item.commandIndex),
    rerun: report.rerun,
    secretsIncluded: false,
  }, null, 2));
  return report.failures.length ? 1 : 0;
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  return pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href;
}

if (isDirectExecution()) {
  try {
    process.exitCode = runDiagnosticShard();
  } catch (error) {
    console.error(error?.message || error);
    process.exitCode = 1;
  }
}
