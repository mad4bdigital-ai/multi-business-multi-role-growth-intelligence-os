import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./", import.meta.url));
const manifestRunner = "scripts/run-test-manifest.mjs";
const shardRunner = "scripts/run-test-diagnostic-shard.mjs";
const shardCount = 4;

function invoke(runner, args) {
  return spawnSync(process.execPath, [runner, ...args], {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
}

function listManifestCommands() {
  const completed = invoke(manifestRunner, ["--list"]);
  assert.equal(completed.status, 0, `manifest list failed: ${completed.stderr}`);
  return completed.stdout
    .split(/\r?\n/)
    .map((line) => line.match(/^\d+\.\s+\[test:\d+\]\s+(.+)$/u)?.[1] || null)
    .filter(Boolean);
}

function listShardCommands(args) {
  const completed = invoke(shardRunner, ["--list", ...args]);
  assert.equal(
    completed.status,
    0,
    `diagnostic shard list failed for ${args.join(" ")}: ${completed.stderr}`,
  );
  return completed.stdout
    .split(/\r?\n/)
    .map((line) => line.match(/^\[[^\]]+\]\[test:\d+\]\s+(.+)$/u)?.[1] || null)
    .filter(Boolean);
}

const fullSuite = listManifestCommands();
assert.ok(fullSuite.length >= shardCount, "manifest must contain enough commands for every diagnostic shard");
assert.equal(new Set(fullSuite).size, fullSuite.length, "full manifest contains duplicate commands");

const selectedByShard = [];
for (let shardIndex = 0; shardIndex < shardCount; shardIndex += 1) {
  const args = [`--shard-index=${shardIndex}`, `--shard-count=${shardCount}`];
  const first = listShardCommands(args);
  const second = listShardCommands(args);

  assert.ok(first.length > 0, `diagnostic shard ${shardIndex + 1}/${shardCount} is empty`);
  assert.deepEqual(second, first, `diagnostic shard ${shardIndex + 1}/${shardCount} is not deterministic`);
  selectedByShard.push(...first.map((command) => ({ command, shardIndex })));
}

const assignments = new Map();
for (const { command, shardIndex } of selectedByShard) {
  assert.equal(
    assignments.has(command),
    false,
    `${command} was assigned to both shard ${assignments.get(command)} and shard ${shardIndex}`,
  );
  assignments.set(command, shardIndex);
}

assert.deepEqual(
  [...assignments.keys()].sort(),
  [...fullSuite].sort(),
  "diagnostic shard union must equal the complete manifest",
);

const invalidArgumentSets = [
  ["--shard-index=0"],
  ["--shard-count=4"],
  ["--shard-index=-1", "--shard-count=4"],
  ["--shard-index=4", "--shard-count=4"],
  ["--shard-index=one", "--shard-count=4"],
  ["--shard-index=0", "--shard-count=0"],
];

for (const args of invalidArgumentSets) {
  const completed = invoke(shardRunner, ["--list", ...args]);
  assert.notEqual(completed.status, 0, `invalid shard arguments unexpectedly passed: ${args.join(" ")}`);
}

console.log(
  `Test manifest sharding contract passed: ${fullSuite.length} commands partitioned exactly once across ${shardCount} deterministic zero-based shards.`,
);