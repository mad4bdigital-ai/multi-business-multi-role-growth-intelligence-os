#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { testCommands as spec011Commands } from "./manifests/test-manifest-spec011.mjs";

const MAX_PARTITIONS = 64;

function parseArgs(argv) {
  const options = {
    parentIndex: 0,
    parentCount: 1,
    shardIndex: null,
    shardCount: null,
    list: false,
    failFast: false,
    reportFile: null,
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
    else if (argument === "--report-file") options.reportFile = readValue("--report-file");
    else if (argument.startsWith("--report-file=")) options.reportFile = argument.slice("--report-file=".length);
    else if (argument === "--list") options.list = true;
    else if (argument === "--fail-fast") options.failFast = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  for (const [name, value] of Object.entries({
    parentIndex: options.parentIndex,
    parentCount: options.parentCount,
    shardIndex: options.shardIndex,
    shardCount: options.shardCount,
  })) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`);
  }
  if (options.parentCount < 1 || options.parentCount > MAX_PARTITIONS) {
    throw new Error(`parentCount must be from 1 to ${MAX_PARTITIONS}.`);
  }
  if (options.shardCount < 1 || options.shardCount > MAX_PARTITIONS) {
    throw new Error(`shardCount must be from 1 to ${MAX_PARTITIONS}.`);
  }
  if (options.parentIndex >= options.parentCount || options.shardIndex >= options.shardCount) {
    throw new Error("Diagnostic shard coordinates are out of range.");
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

function selectCommands(options) {
  const indexedCommands = spec011Commands.map((command, commandIndex) => Object.freeze({ command, commandIndex }));
  const parentCommands = indexedCommands.filter(({ commandIndex }) => commandIndex % options.parentCount === options.parentIndex);
  return Object.freeze(parentCommands.filter((_, parentCommandIndex) => parentCommandIndex % options.shardCount === options.shardIndex));
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

function main() {
  const options = parseArgs(process.argv.slice(2));
  const selected = selectCommands(options);
  const report = {
    contract: "mad4b.spec011.diagnostic-shard-report.v1",
    generatedAt: new Date().toISOString(),
    totalCommands: spec011Commands.length,
    parentIndex: options.parentIndex,
    parentCount: options.parentCount,
    shardIndex: options.shardIndex,
    shardCount: options.shardCount,
    selectedCount: selected.length,
    failFast: options.failFast,
    status: options.list ? "listed" : "running",
    commands: selected.map(({ command, commandIndex }) => ({ command, commandIndex, status: options.list ? "listed" : "pending" })),
    failures: [],
    secretsIncluded: false,
  };
  console.log(JSON.stringify({
    contract: report.contract,
    totalCommands: report.totalCommands,
    parentIndex: report.parentIndex,
    parentCount: report.parentCount,
    shardIndex: report.shardIndex,
    shardCount: report.shardCount,
    selectedCount: report.selectedCount,
    failFast: report.failFast,
    secretsIncluded: false,
  }, null, 2));

  if (options.list) {
    for (const item of report.commands) console.log(`[spec011:${item.commandIndex}] ${item.command}`);
    writeReport(options.reportFile, report);
    return;
  }

  for (let index = 0; index < selected.length; index += 1) {
    const { command, commandIndex } = selected[index];
    console.log(`\n[${index + 1}/${selected.length}][spec011:${commandIndex}] ${command}`);
    let execution;
    try {
      execution = runCommand(command);
    } catch (error) {
      execution = { status: 1, durationMs: 0, error: error?.message || String(error) };
    }
    report.commands[index] = {
      command,
      commandIndex,
      status: execution.status === 0 ? "passed" : "failed",
      exitCode: execution.status,
      durationMs: execution.durationMs,
      ...(execution.error ? { error: execution.error } : {}),
    };
    if (execution.status !== 0) {
      const failure = { command, commandIndex, exitCode: execution.status };
      report.failures.push(failure);
      console.error(`::error title=Spec 011 diagnostic command failed::${escapedAnnotation(command)} exited with status ${execution.status}`);
      if (options.failFast) break;
    }
  }

  report.status = report.failures.length ? "failed" : "passed";
  report.completedAt = new Date().toISOString();
  writeReport(options.reportFile, report);
  console.log(JSON.stringify({
    contract: report.contract,
    status: report.status,
    selectedCount: report.selectedCount,
    passedCount: report.commands.filter((item) => item.status === "passed").length,
    failedCount: report.failures.length,
    failureCommandIndexes: report.failures.map((item) => item.commandIndex),
    secretsIncluded: false,
  }, null, 2));
  if (report.failures.length) process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(error?.message || error);
  process.exit(1);
}
