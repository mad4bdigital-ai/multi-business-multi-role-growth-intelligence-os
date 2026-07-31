#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
]);
const growthControlContinuationTestCommands = Object.freeze([
  "node test-growth-control-internal-reference-workflow.mjs",
  "node test-growth-control-policy-compiler.mjs",
  "node test-growth-control-final-boundary.mjs",
  "node test-growth-control-provider-adapter-resolver.mjs",
  "node test-growth-control-provider-effect-reconciliation.mjs",
]);
const testCommands = Object.freeze([
  ...canonicalTestCommands,
  ...authorityRecoveryTestCommands,
  ...growthControlContinuationTestCommands,
]);

function parsePositiveInteger(value, flag) {
  if (!/^\d+$/.test(value || "")) {
    throw new Error(`${flag} must be a positive integer.`);
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer.`);
  }

  return parsed;
}

function readOptionValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    grep: null,
    list: false,
    shardIndex: null,
    shardCount: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--list") {
      options.list = true;
      continue;
    }
    if (arg === "--grep") {
      options.grep = readOptionValue(argv, i, "--grep");
      i += 1;
      continue;
    }
    if (arg.startsWith("--grep=")) {
      options.grep = arg.slice("--grep=".length);
      continue;
    }
    if (arg === "--shard-index") {
      options.shardIndex = parsePositiveInteger(readOptionValue(argv, i, "--shard-index"), "--shard-index");
      i += 1;
      continue;
    }
    if (arg.startsWith("--shard-index=")) {
      options.shardIndex = parsePositiveInteger(arg.slice("--shard-index=".length), "--shard-index");
      continue;
    }
    if (arg === "--shard-count") {
      options.shardCount = parsePositiveInteger(readOptionValue(argv, i, "--shard-count"), "--shard-count");
      i += 1;
      continue;
    }
    if (arg.startsWith("--shard-count=")) {
      options.shardCount = parsePositiveInteger(arg.slice("--shard-count=".length), "--shard-count");
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  const hasShardIndex = options.shardIndex !== null;
  const hasShardCount = options.shardCount !== null;
  if (hasShardIndex !== hasShardCount) {
    throw new Error("--shard-index and --shard-count must be provided together.");
  }
  if (hasShardIndex && options.shardIndex > options.shardCount) {
    throw new Error("--shard-index cannot exceed --shard-count.");
  }

  return options;
}

function stableShardIndex(command, shardCount) {
  const digest = createHash("sha256").update(command, "utf8").digest();
  return digest.readUInt32BE(0) % shardCount;
}

function selectCommands(options) {
  const matchingCommands = options.grep
    ? testCommands.filter((command) => command.includes(options.grep))
    : testCommands;

  if (options.shardCount === null) {
    return matchingCommands;
  }

  const zeroBasedShardIndex = options.shardIndex - 1;
  return matchingCommands.filter(
    (command) => stableShardIndex(command, options.shardCount) === zeroBasedShardIndex,
  );
}

function splitCommand(command) {
  const parts = [];
  let current = "";
  let quote = null;

  for (const char of command) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
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

  if (quote) {
    throw new Error(`Unclosed quote in command: ${command}`);
  }
  if (current) {
    parts.push(current);
  }

  return parts;
}

function runCommand(command) {
  const [program, ...args] = splitCommand(command);
  const executable = program === "node" ? process.execPath : program;
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const selectedCommands = selectCommands(options);

  if (options.list) {
    selectedCommands.forEach((command, index) => {
      console.log(`${index + 1}. ${command}`);
    });
    return;
  }

  if (!selectedCommands.length) {
    const shardLabel = options.shardCount === null
      ? ""
      : ` for diagnostic shard ${options.shardIndex}/${options.shardCount}`;
    console.error(`No test commands matched${shardLabel}.`);
    process.exit(1);
  }

  if (options.shardCount !== null) {
    console.log(
      `Diagnostic shard ${options.shardIndex}/${options.shardCount}: selected ${selectedCommands.length} of ${testCommands.length} manifest commands.`,
    );
  }

  for (let index = 0; index < selectedCommands.length; index += 1) {
    const command = selectedCommands[index];
    console.log(`\n[${index + 1}/${selectedCommands.length}] ${command}`);
    const status = runCommand(command);
    if (status !== 0) {
      const escaped = command.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
      console.error(`::error title=Test command failed::${escaped} exited with status ${status}`);
      process.exit(status);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error?.message || error);
  process.exit(1);
}
