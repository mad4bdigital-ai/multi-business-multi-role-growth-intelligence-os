#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { testCommands as canonicalTestCommands } from "./test-manifest.mjs";

const testCommands = Object.freeze([
  ...canonicalTestCommands,
]);

function parseArgs(argv) {
  const options = {
    grep: null,
    list: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--list") {
      options.list = true;
      continue;
    }
    if (arg === "--grep") {
      options.grep = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (arg.startsWith("--grep=")) {
      options.grep = arg.slice("--grep=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
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
  const selectedCommands = options.grep
    ? testCommands.filter((command) => command.includes(options.grep))
    : testCommands;

  if (options.list) {
    selectedCommands.forEach((command, index) => {
      console.log(`${index + 1}. ${command}`);
    });
    return;
  }

  if (!selectedCommands.length) {
    console.error("No test commands matched.");
    process.exit(1);
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
