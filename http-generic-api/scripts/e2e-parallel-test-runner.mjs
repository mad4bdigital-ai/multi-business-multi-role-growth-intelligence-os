#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function parseArgs(argv) {
  const options = { root: REPO_ROOT, contract: null, mode: null, workstreamId: null, reportFile: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const read = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
      index += 1;
      return value;
    };
    if (arg === "--root") options.root = path.resolve(read());
    else if (arg.startsWith("--root=")) options.root = path.resolve(arg.slice(7));
    else if (arg === "--contract") options.contract = read();
    else if (arg.startsWith("--contract=")) options.contract = arg.slice(11);
    else if (arg === "--mode") options.mode = read();
    else if (arg.startsWith("--mode=")) options.mode = arg.slice(7);
    else if (arg === "--workstream-id") options.workstreamId = read();
    else if (arg.startsWith("--workstream-id=")) options.workstreamId = arg.slice(16);
    else if (arg === "--report-file") options.reportFile = read();
    else if (arg.startsWith("--report-file=")) options.reportFile = arg.slice(14);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.contract) throw new Error("--contract is required.");
  if (!['workstream', 'integration'].includes(options.mode)) throw new Error("--mode must be workstream or integration.");
  if (options.mode === 'workstream' && !options.workstreamId) throw new Error("--workstream-id is required in workstream mode.");
  return options;
}

function ensureInside(root, relative) {
  const resolved = path.resolve(root, relative || ".");
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) throw new Error(`Path escapes repository root: ${relative}`);
  return resolved;
}

function commandFor(test) {
  if (test.runner === "node") return { executable: process.execPath, args: [test.path, ...(test.args || [])] };
  if (test.runner === "npm") return { executable: process.platform === "win32" ? "npm.cmd" : "npm", args: ["run", test.script, "--", ...(test.args || [])] };
  throw new Error(`Unsupported runner: ${test.runner}`);
}

function writeAtomic(file, data) {
  if (!file) return;
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(temporary, resolved);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const contractPath = ensureInside(options.root, options.contract);
  const contract = readJson(contractPath);
  const parallel = contract.parallel_work;
  if (!parallel?.enabled) throw new Error("parallel_work is not enabled for this contract.");

  let tests;
  let subject;
  if (options.mode === "workstream") {
    const workstream = parallel.workstreams.find((row) => row.id === options.workstreamId);
    if (!workstream) throw new Error(`Unknown workstream: ${options.workstreamId}`);
    if (workstream.status !== "ready_for_integration") throw new Error(`Workstream ${workstream.id} is not ready_for_integration.`);
    tests = workstream.required_tests || [];
    subject = { type: "workstream", id: workstream.id };
  } else {
    tests = parallel.integration.convergence_tests || [];
    subject = { type: "integration", id: contract.feature_key };
  }
  if (!tests.length) throw new Error(`${subject.type} ${subject.id} has no executable tests.`);

  const results = [];
  for (const test of tests) {
    const cwd = ensureInside(options.root, test.working_directory || ".");
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error(`Missing working directory: ${test.working_directory}`);
    if (test.runner === "node") {
      const script = ensureInside(cwd, test.path);
      if (!fs.existsSync(script) || !fs.statSync(script).isFile()) throw new Error(`Missing Node test file: ${test.path}`);
    }
    const command = commandFor(test);
    const startedAt = Date.now();
    const result = spawnSync(command.executable, command.args, {
      cwd,
      env: {
        ...process.env,
        E2E_PARALLEL_WORK: "true",
        E2E_FEATURE_KEY: contract.feature_key,
        E2E_WORK_MODE: options.mode,
        E2E_WORKSTREAM_ID: options.workstreamId || ""
      },
      shell: false,
      stdio: "inherit",
      encoding: "utf8"
    });
    results.push({
      test_id: test.id,
      runner: test.runner,
      status: result.error ? "error" : result.status === 0 ? "passed" : "failed",
      exit_code: result.error ? 1 : (result.status ?? 1),
      duration_ms: Date.now() - startedAt,
      ...(result.error ? { error: result.error.message } : {})
    });
    if (result.error || result.status !== 0) break;
  }

  const report = {
    schema_version: 1,
    ok: results.length === tests.length && results.every((row) => row.status === "passed"),
    feature_key: contract.feature_key,
    mode: options.mode,
    workstream_id: options.workstreamId || null,
    test_count: tests.length,
    results,
    secrets_included: false
  };
  writeAtomic(options.reportFile, report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

main();
