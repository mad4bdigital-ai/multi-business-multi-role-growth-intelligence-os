#!/usr/bin/env python3
from pathlib import Path

path = Path("http-generic-api/scripts/run-test-manifest.mjs")
text = path.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global text
    if text.count(old) != 1:
        raise SystemExit(f"Unable to locate exactly one {label}; found {text.count(old)}")
    text = text.replace(old, new, 1)


helpers = '''function parsePositiveInteger(value, flag) {
  if (!/^\\d+$/.test(value || "")) throw new Error(`${flag} must be a positive integer.`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer.`);
  return parsed;
}

function stableShardIndex(command, shardCount) {
  const digest = createHash("sha256").update(command, "utf8").digest();
  return digest.readUInt32BE(0) % shardCount;
}

'''
replace_once("function parseArgs(argv) {", helpers + "function parseArgs(argv) {", "parseArgs marker")
replace_once(
    "    reportFile: defaultReportFile(),\n",
    "    reportFile: defaultReportFile(),\n    shardIndex: null,\n    shardCount: null,\n",
    "runner option block",
)
replace_once(
    '''    else if (arg.startsWith("--report-file=")) options.reportFile = arg.slice("--report-file=".length);
    else throw new Error(`Unknown argument: ${arg}`);''',
    '''    else if (arg.startsWith("--report-file=")) options.reportFile = arg.slice("--report-file=".length);
    else if (arg === "--shard-index") options.shardIndex = parsePositiveInteger(readValue("--shard-index"), "--shard-index");
    else if (arg.startsWith("--shard-index=")) options.shardIndex = parsePositiveInteger(arg.slice("--shard-index=".length), "--shard-index");
    else if (arg === "--shard-count") options.shardCount = parsePositiveInteger(readValue("--shard-count"), "--shard-count");
    else if (arg.startsWith("--shard-count=")) options.shardCount = parsePositiveInteger(arg.slice("--shard-count=".length), "--shard-count");
    else throw new Error(`Unknown argument: ${arg}`);''',
    "runner flag parser",
)
replace_once(
    '''
  return options;
}

function splitCommand''',
    '''
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

function splitCommand''',
    "runner option validation",
)
replace_once(
    "    grep: options.grep,\n",
    "    grep: options.grep,\n    shardIndex: options.shardIndex,\n    shardCount: options.shardCount,\n",
    "progress report sharding fields",
)
replace_once(
    '''  const selectedCommands = options.grep
    ? indexedCommands.filter(({ command }) => command.includes(options.grep))
    : indexedCommands;''',
    '''  const matchingCommands = options.grep
    ? indexedCommands.filter(({ command }) => command.includes(options.grep))
    : indexedCommands;
  const selectedCommands = options.shardCount === null
    ? matchingCommands
    : matchingCommands.filter(
      ({ command }) => stableShardIndex(command, options.shardCount) === options.shardIndex - 1,
    );''',
    "runner command selection",
)

path.write_text(text)
