#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
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
    "Usage: node scripts/hostinger-runtime-bootstrap.mjs [--plan|--dry-run|--apply]",
    "",
    "Default mode is --plan and never opens a database connection.",
    "--dry-run and --apply require repository-owned target JSON and dedicated MYSQL_BOOTSTRAP_* credentials.",
    "--apply additionally requires --confirm APPLY_HOSTINGER_RUNTIME_BOOTSTRAP:<sha>:<target-key>.",
    "No mode invokes the normal application routes or falls back to DB_* runtime credentials.",
    "",
  ].join("\n"));
}

function modeFromArgs() {
  if (has("--plan")) return "plan";
  if (has("--dry-run")) return "dry_run";
  if (has("--apply")) return "apply";
  return normalizeMode(process.env.BOOTSTRAP_MODE || "plan");
}

function buildEnvironment() {
  const mode = modeFromArgs();
  const env = { ...process.env, BOOTSTRAP_MODE: mode };
  const mappings = [
    ["--migration", "BOOTSTRAP_MIGRATION"],
    ["--target-key", "BOOTSTRAP_TARGET_KEY"],
    ["--target-database", "BOOTSTRAP_TARGET_DATABASE"],
    ["--expected-sha", "BOOTSTRAP_EXPECTED_SHA"],
    ["--expected-branch", "BOOTSTRAP_EXPECTED_BRANCH"],
    ["--expected-repository", "BOOTSTRAP_EXPECTED_REPOSITORY"],
    ["--confirm", "BOOTSTRAP_CONFIRMATION"],
    ["--bundle-manifest", "BOOTSTRAP_SCHEMA_BUNDLE_MANIFEST"],
  ];
  for (const [flag, variable] of mappings) {
    const value = valueAfter(flag);
    if (value !== undefined) env[variable] = String(value);
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
  const env = buildEnvironment();
  try {
    const result = env.BOOTSTRAP_MODE === "plan"
      ? buildPlan(env, contract)
      : await runBootstrap({ env, contract, repoRoot: REPO_ROOT });
    writeEvidence(env, { ...result, secrets_included: false });
    return result.ok === false ? 1 : 0;
  } catch (error) {
    writeEvidence(env, {
      ok: false,
      contract: "mad4b.hostinger.runtime-bootstrap-evidence.v1",
      mode: env.BOOTSTRAP_MODE || "plan",
      error: sanitizeBootstrapError(error),
      database_connection_performed: false,
      database_mutation_performed: false,
      migration_apply_performed: false,
      grant_mutation_performed: false,
      secrets_included: false,
    });
    return 1;
  }
}

process.exitCode = await main();
