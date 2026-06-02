#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writePlatformEngineValidatorResult } from "../platformEngineRegistry.js";

const DEFAULT_EXCERPT_LIMIT = 4000;
const ALLOWED_PROGRAMS = new Set(["node", "npm.cmd", "npm"]);

function readArgValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    actor_id: "",
    command: "",
    dry_run: false,
    engine_key: "",
    policy_key: "",
    resource_key: "",
    resource_kind: "",
    run_id: "",
    run_key: "",
    strategy_key: "",
    task_class: "",
    tenant_id: "",
    trace_id: "",
    validator_key: "",
    write_log: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--write-log") {
      options.write_log = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dry_run = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const [rawName, inlineValue] = arg.slice(2).split("=", 2);
    const name = rawName.replace(/-/g, "_");
    if (!Object.prototype.hasOwnProperty.call(options, name)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (typeof options[name] === "boolean") {
      options[name] = inlineValue === undefined ? true : inlineValue === "true";
      continue;
    }
    options[name] = inlineValue === undefined ? readArgValue(argv, index, arg) : inlineValue;
    if (inlineValue === undefined) index += 1;
  }

  return options;
}

function splitCommand(command) {
  const parts = [];
  let current = "";
  let quote = null;

  for (const char of String(command || "")) {
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

  if (quote) throw new Error(`Unclosed quote in validator command: ${command}`);
  if (current) parts.push(current);
  return parts;
}

function boundedExcerpt(value, limit = DEFAULT_EXCERPT_LIMIT) {
  const text = String(value || "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...[truncated:${text.length}]`;
}

function sanitizeEvidence(options, commandParts) {
  return {
    runner: "platform_engine_validator_runner_v1",
    command_program: commandParts[0],
    dry_run: options.dry_run === true,
    write_log: options.write_log === true,
    no_apply: true,
    no_secret_read: true,
    shell: false,
  };
}

function requireOption(options, name) {
  const value = String(options[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function executeValidator(command) {
  const commandParts = splitCommand(command);
  const program = commandParts[0];
  if (!program) throw new Error("command is required.");
  if (!ALLOWED_PROGRAMS.has(program)) {
    throw new Error(`validator program is not allowlisted: ${program}`);
  }

  const executable = program === "node" ? process.execPath : program;
  const startedAt = Date.now();
  const result = spawnSync(executable, commandParts.slice(1), {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    shell: false,
  });
  const durationMs = Date.now() - startedAt;

  return {
    commandParts,
    duration_ms: durationMs,
    exit_code: result.status ?? 1,
    stderr: boundedExcerpt(result.stderr || result.error?.message || ""),
    stdout: boundedExcerpt(result.stdout || ""),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  requireOption(options, "engine_key");
  requireOption(options, "task_class");
  const command = requireOption(options, "command");

  const executed = executeValidator(command);
  const status = executed.exit_code === 0 ? "passed" : "failed";
  const payload = {
    actor_id: options.actor_id || undefined,
    duration_ms: executed.duration_ms,
    engine_key: options.engine_key,
    error_excerpt: executed.stderr,
    evidence: sanitizeEvidence(options, executed.commandParts),
    exit_code: executed.exit_code,
    output_excerpt: executed.stdout,
    policy_key: options.policy_key || undefined,
    resource_key: options.resource_key || undefined,
    resource_kind: options.resource_kind || undefined,
    run_id: options.run_id || undefined,
    run_key: options.run_key || undefined,
    status,
    strategy_key: options.strategy_key || undefined,
    task_class: options.task_class,
    tenant_id: options.tenant_id || undefined,
    trace_id: options.trace_id || undefined,
    validator_command: command,
    validator_key: options.validator_key || undefined,
  };

  let logResult = null;
  if (options.write_log && !options.dry_run) {
    logResult = await writePlatformEngineValidatorResult(payload);
  }

  console.log(JSON.stringify({
    ok: status === "passed",
    apply_executed: false,
    validators_executed_by_runner: true,
    validator_result: payload,
    log_result: logResult,
  }, null, 2));

  process.exit(executed.exit_code);
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    apply_executed: false,
    error: {
      code: error?.code || "platform_engine_validator_runner_failed",
      message: error?.message || String(error),
    },
  }, null, 2));
  process.exit(1);
});
