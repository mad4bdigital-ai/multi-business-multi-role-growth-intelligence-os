#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { testCommands as spec011Commands } from "./manifests/test-manifest-spec011.mjs";

function integerArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const inline = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  const pairIndex = process.argv.indexOf(`--${name}`);
  const raw = inline ? inline.slice(prefix.length) : pairIndex >= 0 ? process.argv[pairIndex + 1] : fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return value;
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

function run(command) {
  const [program, ...args] = splitCommand(command);
  const result = spawnSync(program === "node" ? process.execPath : program, args, {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const parentIndex = integerArg("parent-index", 0);
const parentCount = integerArg("parent-count", 1);
const shardIndex = integerArg("shard-index");
const shardCount = integerArg("shard-count");
if (parentCount < 1 || shardCount < 1 || parentIndex >= parentCount || shardIndex >= shardCount) {
  throw new Error("Diagnostic shard coordinates are out of range.");
}

const parentCommands = spec011Commands.filter((_, index) => index % parentCount === parentIndex);
const selected = parentCommands
  .map((command, localIndex) => ({ command, localIndex }))
  .filter(({ localIndex }) => localIndex % shardCount === shardIndex);

console.log(JSON.stringify({
  contract: "mad4b.spec011.diagnostic-shard.v1",
  totalCommands: spec011Commands.length,
  parentIndex,
  parentCount,
  shardIndex,
  shardCount,
  selectedCount: selected.length,
}, null, 2));

for (const { command, localIndex } of selected) {
  console.log(`\n[spec011:${localIndex}] ${command}`);
  const status = run(command);
  if (status !== 0) {
    const escaped = command.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
    console.error(`::error title=Spec 011 diagnostic command failed::${escaped} exited with status ${status}`);
    process.exit(status);
  }
}
