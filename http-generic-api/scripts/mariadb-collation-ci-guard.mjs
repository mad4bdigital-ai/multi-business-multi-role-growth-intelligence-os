import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  inspectMigrationCollationSql,
  loadDatabaseCollationPolicy,
} from "../databaseCollationPolicyGuard.js";

const MODULE_PATH = fileURLToPath(import.meta.url);
const __dirname = path.dirname(MODULE_PATH);
const REPO_ROOT = path.resolve(__dirname, "../..");
const CONTRACT = "mad4b.mariadb-collation-ci-guard.v1";
const SQL_FILE_PATTERNS = [
  /^http-generic-api\/migrations\/.*\.sql$/u,
  /^http-generic-api\/schema\.sql$/u,
];

function isSha(value = "") {
  return /^[0-9a-f]{40}$/iu.test(String(value || "").trim());
}

function isSqlFile(file = "") {
  const normalized = String(file || "").replaceAll("\\", "/");
  return SQL_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function git(args) {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function resolveSqlFiles({ baseSha = "", headSha = "", all = false, gitFn = git } = {}) {
  if (all) {
    return gitFn(["ls-files", "--", "http-generic-api/migrations", "http-generic-api/schema.sql"])
      .split(/\r?\n/u)
      .map((file) => file.trim())
      .filter(isSqlFile)
      .sort();
  }

  const normalizedBase = String(baseSha || "").trim();
  const normalizedHead = String(headSha || "").trim();
  let diffArgs;
  if (isSha(normalizedBase) && isSha(normalizedHead)) {
    diffArgs = ["diff", "--name-only", normalizedBase, normalizedHead, "--"];
  } else if (isSha(normalizedHead)) {
    diffArgs = ["diff", "--name-only", `${normalizedHead}^`, normalizedHead, "--"];
  } else {
    diffArgs = ["diff", "--name-only", "HEAD^", "HEAD", "--"];
  }

  return gitFn(diffArgs)
    .split(/\r?\n/u)
    .map((file) => file.trim())
    .filter(isSqlFile)
    .sort();
}

export function evaluateSqlFiles(
  files = [],
  {
    engine = "mariadb",
    policy = loadDatabaseCollationPolicy(),
    readFile = (file) => fs.readFileSync(path.resolve(REPO_ROOT, file), "utf8"),
  } = {},
) {
  const results = files.map((file) => {
    const sql = readFile(file);
    const evaluation = inspectMigrationCollationSql(sql, { engine, policy });
    return {
      file,
      ok: evaluation.ok === true,
      ready: evaluation.ready === true,
      blocked_reason: evaluation.blocked_reason || null,
      issues: evaluation.issues || [],
      tables: evaluation.tables || [],
      secrets_included: false,
    };
  });
  const blocked = results.filter((result) => !result.ok);
  return {
    contract: CONTRACT,
    engine,
    policy_key: policy.policy_key,
    files_checked: results.length,
    files: results,
    blocked_files: blocked.map((result) => result.file),
    ok: blocked.length === 0,
    ready: blocked.length === 0,
    sql_mutation_performed: false,
    database_connection_performed: false,
    provider_mutation_performed: false,
    secrets_included: false,
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    baseSha: process.env.COLLATION_BASE_SHA || "",
    headSha: process.env.COLLATION_HEAD_SHA || "",
    all: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--all") options.all = true;
    else if (arg === "--base-sha") options.baseSha = String(argv[++index] || "");
    else if (arg.startsWith("--base-sha=")) options.baseSha = arg.slice("--base-sha=".length);
    else if (arg === "--head-sha") options.headSha = String(argv[++index] || "");
    else if (arg.startsWith("--head-sha=")) options.headSha = arg.slice("--head-sha=".length);
    else throw new Error(`Unsupported argument: ${arg}`);
  }
  return options;
}

export function runCollationGuard(options = {}) {
  const files = resolveSqlFiles(options);
  return evaluateSqlFiles(files, options);
}

if (path.resolve(process.argv[1] || "") === path.resolve(MODULE_PATH)) {
  try {
    const report = runCollationGuard(parseArgs());
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      contract: CONTRACT,
      ok: false,
      ready: false,
      blocked_reason: "collation_ci_guard_failed",
      error_code: String(error?.code || "COLLATION_CI_GUARD_FAILED").slice(0, 128),
      sql_mutation_performed: false,
      database_connection_performed: false,
      provider_mutation_performed: false,
      secrets_included: false,
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
