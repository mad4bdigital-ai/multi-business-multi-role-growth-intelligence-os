#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const CONTRACT = "mad4b.work-map-autofix-diagnostic-report.v1";
const DEFAULT_TAIL_LINES = 120;
const DEFAULT_TAIL_CHARACTERS = 30_000;

function parseOptions(argv) {
  const command = argv[0];
  const options = {};
  const remainder = [];
  let readingCommand = false;

  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (readingCommand) {
      remainder.push(argument);
      continue;
    }
    if (argument === "--") {
      readingCommand = true;
      continue;
    }
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    const separator = argument.indexOf("=");
    if (separator > 2) {
      options[argument.slice(2, separator)] = argument.slice(separator + 1);
      continue;
    }
    const name = argument.slice(2);
    const value = argv[index + 1];
    if (value == null || value.startsWith("--")) {
      throw new Error(`--${name} requires a value.`);
    }
    options[name] = value;
    index += 1;
  }

  return { command, options, remainder };
}

function required(options, name) {
  const value = options[name];
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}

function atomicWrite(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, content, "utf8");
  renameSync(temporary, file);
}

function atomicWriteJson(file, value) {
  atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`);
}

function safeId(value) {
  const normalized = String(value || "command")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized || "command";
}

function quoteArgument(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./:=@+-]+$/u.test(text) ? text : JSON.stringify(text);
}

function formatCommand(program, args) {
  return [program, ...args].map(quoteArgument).join(" ");
}

function loadReport(root) {
  const reportFile = path.join(root, "report.json");
  if (!existsSync(reportFile)) {
    throw new Error(`Diagnostic report is not initialized: ${reportFile}`);
  }
  return JSON.parse(readFileSync(reportFile, "utf8"));
}

function tail(value, maxLines = DEFAULT_TAIL_LINES, maxCharacters = DEFAULT_TAIL_CHARACTERS) {
  const text = String(value || "").replace(/\r\n/gu, "\n");
  const lines = text.split("\n");
  const lineTail = lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
  return lineTail.length > maxCharacters ? lineTail.slice(-maxCharacters) : lineTail;
}

function markdownCell(value) {
  return String(value ?? "—").replace(/\|/gu, "\\|").replace(/\r?\n/gu, " ");
}

function statusIcon(status) {
  if (status === "passed") return "✅";
  if (status === "failed") return "❌";
  if (status === "running") return "⏳";
  if (status === "interrupted") return "⚠️";
  return "•";
}

export function renderDiagnosticMarkdown(report) {
  const lines = [
    "# Work Map Autofix Diagnostic Report",
    "",
    `**Status:** ${statusIcon(report.status)} ${report.status}`,
    "",
    "## Execution context",
    "",
    "| Field | Value |",
    "|---|---|",
    `| Contract | \`${markdownCell(report.contract)}\` |`,
    `| Repository | \`${markdownCell(report.repository)}\` |`,
    `| Workflow | \`${markdownCell(report.workflow)}\` |`,
    `| Run | \`${markdownCell(report.runId)}\` (attempt ${markdownCell(report.runAttempt)}) |`,
    `| Event | \`${markdownCell(report.eventName)}\` |`,
    `| Target branch | \`${markdownCell(report.targetBranch)}\` |`,
    `| Expected head | \`${markdownCell(report.expectedHeadSha)}\` |`,
    `| Checked-out SHA | \`${markdownCell(report.git?.head || report.githubSha)}\` |`,
    `| Runner | \`${markdownCell(report.runnerOS)}\` / \`${markdownCell(report.runnerName)}\` |`,
    `| Node | \`${markdownCell(report.nodeVersion)}\` |`,
    "",
    "## Commands",
    "",
    "| # | ID | Status | Exit | Duration | Command |",
    "|---:|---|---|---:|---:|---|",
  ];

  if (!report.commands?.length) {
    lines.push("| 1 | — | — | — | — | No recorded commands |", "");
  } else {
    report.commands.forEach((entry, index) => {
      lines.push(
        `| ${index + 1} | \`${markdownCell(entry.id)}\` | ${statusIcon(entry.status)} ${markdownCell(entry.status)} | ${markdownCell(entry.exitCode)} | ${markdownCell(entry.durationMs)} ms | \`${markdownCell(entry.command)}\` |`,
      );
    });
    lines.push("");
  }

  if (report.currentCommand) {
    lines.push(
      "## Interrupted command",
      "",
      `- ID: \`${markdownCell(report.currentCommand.id)}\``,
      `- Command: \`${markdownCell(report.currentCommand.command)}\``,
      `- Started: ${markdownCell(report.currentCommand.startedAt)}`,
      "",
    );
  }

  if (report.firstFailure) {
    lines.push(
      "## First failure",
      "",
      `- ID: \`${markdownCell(report.firstFailure.id)}\``,
      `- Exit code: \`${markdownCell(report.firstFailure.exitCode)}\``,
      `- Command: \`${markdownCell(report.firstFailure.command)}\``,
      `- Log: \`${markdownCell(report.firstFailure.logFile)}\``,
      "",
    );
    if (report.firstFailure.outputTail) {
      lines.push("```text", report.firstFailure.outputTail, "```", "");
    }
  }

  if (report.uncapturedFailure) {
    lines.push(
      "## Uncaptured workflow failure",
      "",
      "The job failed outside the governed command runner. Inspect the remaining workflow step logs; the captured git state below narrows the affected phase.",
      "",
    );
  }

  if (report.git) {
    lines.push(
      "## Git readback",
      "",
      `- Head: \`${markdownCell(report.git.head)}\``,
      `- Status entries: ${report.git.status?.length || 0}`,
      `- Changed paths: ${report.git.changedPaths?.length || 0}`,
      "",
    );
    if (report.git.status?.length) {
      lines.push("```text", report.git.status.join("\n"), "```", "");
    }
  }

  lines.push(
    "## Safety",
    "",
    "This runner does not enumerate environment values. It records command metadata, command output, and bounded output tails; governed commands must not print secrets.",
    "",
  );

  return `${lines.join("\n")}\n`;
}

function writeReport(root, report) {
  atomicWriteJson(path.join(root, "report.json"), report);
  atomicWrite(path.join(root, "report.md"), renderDiagnosticMarkdown(report));
}

function createInitialReport() {
  return {
    contract: CONTRACT,
    generatedAt: new Date().toISOString(),
    completedAt: null,
    status: "initialized",
    conclusion: null,
    repository: process.env.GITHUB_REPOSITORY || null,
    workflow: process.env.GITHUB_WORKFLOW || null,
    runId: process.env.GITHUB_RUN_ID || null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
    eventName: process.env.GITHUB_EVENT_NAME || null,
    githubSha: process.env.GITHUB_SHA || null,
    targetBranch: process.env.TARGET_BRANCH || null,
    expectedHeadSha: process.env.EXPECTED_HEAD_SHA || null,
    runnerOS: process.env.RUNNER_OS || process.platform,
    runnerName: process.env.RUNNER_NAME || null,
    nodeVersion: process.version,
    commands: [],
    currentCommand: null,
    lastPassed: null,
    firstFailure: null,
    uncapturedFailure: false,
    git: null,
    secretsIncluded: false,
  };
}

function initialize(root) {
  mkdirSync(path.join(root, "logs"), { recursive: true });
  const report = createInitialReport();
  writeReport(root, report);
  console.log(`Initialized Work Map diagnostic report at ${root}`);
}

function readGit(commandArgs) {
  const result = spawnSync("git", commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 30_000,
  });
  if (result.error || result.status !== 0) return null;
  return String(result.stdout || "").trim();
}

function gitReadback() {
  const head = readGit(["rev-parse", "HEAD"]);
  const status = readGit(["status", "--short"]);
  const changedPaths = readGit(["diff", "--name-only"]);
  return {
    head,
    status: status ? status.split(/\r?\n/u) : [],
    changedPaths: changedPaths ? changedPaths.split(/\r?\n/u) : [],
  };
}

function escapedAnnotation(value) {
  return String(value).replace(/%/gu, "%25").replace(/\r/gu, "%0D").replace(/\n/gu, "%0A");
}

async function execute(root, idValue, commandParts) {
  if (!commandParts.length) throw new Error("A command is required after --.");
  const report = loadReport(root);
  const id = safeId(idValue);
  if (report.commands.some((entry) => entry.id === id)) {
    throw new Error(`Duplicate diagnostic command id: ${id}`);
  }

  const [program, ...args] = commandParts;
  const command = formatCommand(program, args);
  const startedAt = new Date();
  const logRelative = path.posix.join("logs", `${id}.log`);
  const logFile = path.join(root, "logs", `${id}.log`);
  mkdirSync(path.dirname(logFile), { recursive: true });

  report.status = "running";
  report.currentCommand = {
    id,
    command,
    startedAt: startedAt.toISOString(),
    logFile: logRelative,
  };
  writeReport(root, report);

  const logStream = createWriteStream(logFile, { flags: "w" });
  const child = spawn(program, args, {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    logStream.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
    logStream.write(chunk);
  });

  const result = await new Promise((resolve) => {
    let spawnError = null;
    child.on("error", (error) => {
      spawnError = error;
      const message = `${error.stack || error.message || String(error)}\n`;
      process.stderr.write(message);
      logStream.write(message);
    });
    child.on("close", (code, signal) => {
      resolve({
        exitCode: spawnError ? 1 : (code ?? 1),
        signal: signal || null,
        error: spawnError ? (spawnError.message || String(spawnError)) : null,
      });
    });
  });

  await new Promise((resolve) => logStream.end(resolve));
  const completedAt = new Date();
  const output = existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
  const entry = {
    id,
    command,
    status: result.exitCode === 0 ? "passed" : "failed",
    exitCode: result.exitCode,
    signal: result.signal,
    error: result.error,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    logFile: logRelative,
    outputTail: tail(output),
  };

  report.commands.push(entry);
  report.currentCommand = null;
  if (entry.status === "passed") {
    report.lastPassed = entry;
  } else {
    report.status = "failed";
    report.firstFailure ||= entry;
  }
  writeReport(root, report);

  if (entry.status === "failed" && process.env.GITHUB_ACTIONS === "true") {
    console.error(`::error title=Work Map Autofix command failed::${escapedAnnotation(`${id} exited with ${entry.exitCode}: ${command}`)}`);
  }

  return result.exitCode;
}

function finalize(root, conclusion) {
  const report = loadReport(root);
  report.conclusion = conclusion || "unknown";
  report.completedAt = new Date().toISOString();
  report.git = gitReadback();

  if (report.currentCommand) {
    const interrupted = {
      ...report.currentCommand,
      status: "interrupted",
      exitCode: null,
      completedAt: report.completedAt,
      durationMs: Math.max(0, Date.now() - Date.parse(report.currentCommand.startedAt)),
      outputTail: existsSync(path.join(root, report.currentCommand.logFile))
        ? tail(readFileSync(path.join(root, report.currentCommand.logFile), "utf8"))
        : "",
    };
    report.commands.push(interrupted);
    report.firstFailure ||= interrupted;
    report.currentCommand = null;
  }

  const hasCapturedFailure = report.commands.some((entry) => entry.status === "failed" || entry.status === "interrupted");
  const workflowFailed = !["success", "passed"].includes(String(report.conclusion).toLowerCase());
  report.uncapturedFailure = workflowFailed && !hasCapturedFailure;
  report.status = hasCapturedFailure || workflowFailed ? "failed" : "passed";
  writeReport(root, report);

  if (process.env.GITHUB_ACTIONS === "true") {
    if (report.firstFailure) {
      console.error(`::error title=Work Map Autofix diagnostic report::${escapedAnnotation(`First failure: ${report.firstFailure.id}; see report artifact.`)}`);
    } else if (report.uncapturedFailure) {
      console.error("::error title=Work Map Autofix diagnostic report::Workflow failed outside the governed command runner; see report artifact.");
    } else {
      console.log("::notice title=Work Map Autofix diagnostic report::All governed commands passed.");
    }
  }

  console.log(path.join(root, "report.md"));
}

export async function main(argv = process.argv.slice(2)) {
  const { command, options, remainder } = parseOptions(argv);
  const root = path.resolve(required(options, "root"));

  if (command === "init") {
    initialize(root);
    return 0;
  }
  if (command === "exec") {
    return execute(root, required(options, "id"), remainder);
  }
  if (command === "finalize") {
    finalize(root, options.conclusion || process.env.WORK_MAP_JOB_STATUS || "unknown");
    return 0;
  }
  throw new Error("Usage: work-map-autofix-diagnostics.mjs <init|exec|finalize> --root <directory> [options] [-- command args...]");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(error.stack || error.message || String(error));
      process.exitCode = 1;
    });
}
