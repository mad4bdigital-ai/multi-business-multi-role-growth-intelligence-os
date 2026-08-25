#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bootstrapError,
  buildPlan,
  normalizeMode,
  readRuntimeBootstrapContract,
  runBootstrap,
  sanitizeBootstrapError,
} from "../runtimeBootstrapContract.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(API_ROOT, "..");
const contract = readRuntimeBootstrapContract();
const args = process.argv.slice(2);

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function has(flag) {
  return args.includes(flag);
}

function usage() {
  process.stdout.write([
    "Usage: node scripts/hostinger-runtime-bootstrap.mjs [--plan|--dry-run|--apply-migration|--apply-grants]",
    "",
    "Default mode is --plan and never opens a database connection.",
    "--dry-run defaults to repository-owned target JSON and dedicated MYSQL_BOOTSTRAP_* credentials.",
    "--target-source runtime_env derives DB_NAME/DB_USER from the Hostinger runtime environment and is allowed only for --dry-run.",
    "--env-file <path> explicitly loads a local Hostinger .env file for runtime_env dry_run or explicitly authorized host-local role recovery; it is never loaded implicitly.",
    "--host-local-role-credentials --operation database.inspect|database.repair|database.rebuild_empty binds existing DB_*, GOVERNANCE_DB_*, and RUNTIME_PERSISTENCE_DB_* users to their own databases only; database.inspect is dry-run-only.",
    "--apply-migration requires --migration-confirm APPLY_HOSTINGER_RUNTIME_MIGRATION:<sha>:<target-key>:<migration-file>, or the role-bound baseline confirmation for database.rebuild_empty.",
    "--rebuild-role-set <runtime,governance,runtime_persistence> is accepted only with a durable inspection run, plan hash, role selection hash, and per-role object-count fingerprints.",
    "--apply-grants requires --grants-confirm bound to the exact target identity, or to the canonical split-DB grant-binding hash.",
    "--apply is rejected because migration and grants approvals are independent.",
    "Only explicit host-local role recovery may reuse existing role-bound credentials; grants require their own typed confirmation and GitHub Actions, shell, and SQL capsules remain denied.",
    "",
  ].join("\n"));
}

function modeFromArgs() {
  const selected = ["--plan", "--dry-run", "--apply-migration", "--apply-grants", "--apply"].filter(has);
  if (selected.length > 1) throw bootstrapError("bootstrap_mode_conflict", "Select exactly one bootstrap mode; combined apply is denied");
  if (selected[0] === "--apply") throw bootstrapError("bootstrap_combined_apply_denied", "--apply is intentionally rejected; use --apply-migration or --apply-grants");
  if (selected[0] === "--plan") return "plan";
  if (selected[0] === "--dry-run") return "dry_run";
  if (selected[0] === "--apply-migration") return "apply_migration";
  if (selected[0] === "--apply-grants") return "apply_grants";
  return normalizeMode(process.env.BOOTSTRAP_MODE || "plan");
}

function loadExplicitEnvFile() {
  const envFile = valueAfter("--env-file");
  if (envFile === undefined) return;
  const mode = modeFromArgs();
  const hostLocal = has("--host-local-role-credentials");
  const source = String(valueAfter("--target-source") || (hostLocal ? "host_local_role_env" : process.env.BOOTSTRAP_TARGET_SOURCE || "repository_allowlist")).trim().toLowerCase();
  const readOnlyRuntime = mode === "dry_run" && source === "runtime_env";
  const operation = String(valueAfter("--operation") || "").trim();
  const eligibleInvocation = hostLocal && ["dry_run", "apply_migration", "apply_grants"].includes(mode) && source === "host_local_role_env"
    && ["database.inspect", "database.repair", "database.rebuild_empty"].includes(operation)
    && (operation !== "database.inspect" || mode === "dry_run")
    && (mode !== "apply_grants" || operation === "database.repair");
  if (!readOnlyRuntime && !eligibleInvocation) {
    throw bootstrapError("bootstrap_env_file_mode_denied", "--env-file requires runtime_env dry_run or an explicitly scoped host-local database inspection, repair, or rebuild");
  }
  const resolved = path.resolve(String(envFile || "").trim());
  if (!resolved || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw bootstrapError("bootstrap_env_file_unreadable", "Explicit bootstrap env file is unreadable", { file: path.basename(resolved || "env") });
  }
  if (fs.statSync(resolved).size > 1024 * 1024) {
    throw bootstrapError("bootstrap_env_file_too_large", "Explicit bootstrap env file exceeds the bounded size limit", { max_bytes: 1024 * 1024 });
  }
  if (typeof process.loadEnvFile !== "function") {
    throw bootstrapError("bootstrap_env_file_unsupported", "This Node.js runtime cannot load an explicit env file safely");
  }
  try {
    process.loadEnvFile(resolved);
  } catch (error) {
    throw bootstrapError("bootstrap_env_file_invalid", "Explicit bootstrap env file is invalid", { cause: error?.message || "parse_failed" });
  }
}

function buildEnvironment() {
  const mode = modeFromArgs();
  const env = { ...process.env, BOOTSTRAP_MODE: mode };
  const mappings = [
    ["--migration", "BOOTSTRAP_MIGRATION"],
    ["--target-key", "BOOTSTRAP_TARGET_KEY"],
    ["--target-source", "BOOTSTRAP_TARGET_SOURCE"],
    ["--operation", "HOST_BREAKGLASS_OPERATION"],
    ["--target-database", "BOOTSTRAP_TARGET_DATABASE"],
    ["--expected-sha", "BOOTSTRAP_EXPECTED_SHA"],
    ["--expected-branch", "BOOTSTRAP_EXPECTED_BRANCH"],
    ["--expected-repository", "BOOTSTRAP_EXPECTED_REPOSITORY"],
    ["--migration-confirm", "BOOTSTRAP_MIGRATION_CONFIRMATION"],
    ["--rebuild-confirmation", "BOOTSTRAP_REBUILD_CONFIRMATION"],
    ["--rebuild-role-set", "BOOTSTRAP_ROLE_SELECTION"],
    ["--inspection-run-id", "BOOTSTRAP_INSPECTION_RUN_ID"],
    ["--plan-hash", "BOOTSTRAP_PLAN_SHA256"],
    ["--role-selection-hash", "BOOTSTRAP_ROLE_SELECTION_HASH"],
    ["--role-object-count-fingerprints", "BOOTSTRAP_ROLE_OBJECT_COUNT_FINGERPRINTS"],
    ["--grants-confirm", "BOOTSTRAP_GRANTS_CONFIRMATION"],
    ["--grant-binding-hash", "BOOTSTRAP_GRANT_BINDING_HASH"],
    ["--bundle-manifest", "BOOTSTRAP_SCHEMA_BUNDLE_MANIFEST"],
  ];
  for (const [flag, variable] of mappings) {
    const value = valueAfter(flag);
    if (value !== undefined) env[variable] = String(value);
  }
  if (has("--host-local-role-credentials")) {
    env.BOOTSTRAP_TARGET_SOURCE = env.BOOTSTRAP_TARGET_SOURCE || "host_local_role_env";
    env.HOST_BREAKGLASS_HOST_LOCAL_ROLE_CREDENTIALS = "true";
  }
  return env;
}

function writeEvidence(env, result) {
  const serialized = JSON.stringify(result, null, 2);
  const limit = Number(contract.evidence?.bounded_output_bytes || 49152);
  const output = Buffer.byteLength(serialized, "utf8") <= limit
    ? `${serialized}\n`
    : `${JSON.stringify({
      ok: false,
      error: {
        code: "bootstrap_evidence_too_large",
        category: "bootstrap_error",
        message: "Bootstrap evidence exceeded the bounded output limit",
        details: { bounded_output_bytes: limit },
        secrets_included: false,
      },
      secrets_included: false,
    }, null, 2)}\n`;
  process.stdout.write(output);
  const resultPath = String(env.BOOTSTRAP_RESULT_PATH || "").trim();
  if (resultPath) {
    const resolved = path.resolve(resultPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, output, "utf8");
  }
}

async function main() {
  if (has("--help") || has("-h")) {
    usage();
    return 0;
  }
  let env = { ...process.env, BOOTSTRAP_MODE: "plan" };
  try {
    loadExplicitEnvFile();
    env = buildEnvironment();
    const result = env.BOOTSTRAP_MODE === "plan"
      ? buildPlan(env, contract)
      : await runBootstrap({ env, contract, repoRoot: REPO_ROOT });
    writeEvidence(env, { ...result, secrets_included: false });
    return result.ok === false ? 1 : 0;
  } catch (error) {
    const details = error?.details && typeof error.details === "object" ? error.details : {};
    writeEvidence(env, {
      ok: false,
      contract: "mad4b.hostinger.runtime-bootstrap-evidence.v1",
      mode: env.BOOTSTRAP_MODE || "plan",
      error: sanitizeBootstrapError(error),
      database_connection_performed: details.database_connection_performed ?? false,
      database_mutation_performed: details.database_mutation_performed ?? false,
      migration_apply_performed: details.migration_apply_performed ?? false,
      grant_mutation_performed: details.grant_mutation_performed ?? false,
      mutation_evidence: details.mutation_evidence || { mutation_attempted: false, mutation_state: "none", secrets_included: false },
      secrets_included: false,
    });
    return 1;
  }
}

process.exitCode = await main();
