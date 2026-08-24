#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildHostBreakglassPlan } from "../hostBreakglassCatalog.js";
import { readRuntimeBootstrapContract, runBootstrap, sanitizeBootstrapError } from "../runtimeBootstrapContract.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(HERE, "..");
const overlay = JSON.parse(fs.readFileSync(path.join(API_ROOT, "config", "host-breakglass-staging-contract.json"), "utf8"));
const requestIndex = process.argv.indexOf("--request-file");
if (requestIndex < 0 || !process.argv[requestIndex + 1]) throw new Error("--request-file <path> is required");
const requestPath = path.resolve(process.cwd(), process.argv[requestIndex + 1]);
const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
request.environment_key = "staging_local_windows_docker";
const plan = buildHostBreakglassPlan(request);

function stagingContract() {
  const base = structuredClone(readRuntimeBootstrapContract());
  base.contract = overlay.contract;
  base.source_binding.branch = overlay.source_branch;
  base.target_binding.required_branch = overlay.source_branch;
  base.target_binding.required_environment = overlay.target_environment;
  base.target_binding.default_target_key = overlay.default_target_key;
  return base;
}

function localEnv() {
  const env = { ...process.env };
  for (const [source, target] of Object.entries(overlay.credential_mapping)) if (env[source]) env[target] = env[source];
  return {
    ...env,
    BOOTSTRAP_MODE: plan.action,
    BOOTSTRAP_EXPECTED_SHA: plan.expected_sha,
    BOOTSTRAP_EXPECTED_BRANCH: overlay.source_branch,
    BOOTSTRAP_EXPECTED_REPOSITORY: plan.repository,
    BOOTSTRAP_TARGET_KEY: plan.target_key,
    BOOTSTRAP_TARGET_SOURCE: plan.target_source,
    BOOTSTRAP_MIGRATION: plan.migration || env.BOOTSTRAP_MIGRATION,
    BOOTSTRAP_MIGRATION_CONFIRMATION: plan.action === "apply_migration" ? plan.confirmation || "" : "",
    BOOTSTRAP_GRANTS_CONFIRMATION: plan.action === "apply_grants" ? plan.confirmation || "" : "",
    HOST_BREAKGLASS_OPERATION: plan.operation_key
  };
}

try {
  if (plan.action === "plan") {
    process.stdout.write(`${JSON.stringify({ ok: true, ...plan, local_execution_performed: false, secrets_included: false })}\n`);
    process.exit(0);
  }
  if (process.platform !== overlay.required_platform) throw Object.assign(new Error("Staging Host Breakglass execution requires Windows."), { code: "host_breakglass_windows_required", status: 409 });
  const docker = spawnSync("docker", ["info", "--format", "{{json .ServerVersion}}"], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  if (docker.status !== 0) throw Object.assign(new Error("Docker Desktop must be running before Staging Host Breakglass execution."), { code: "host_breakglass_docker_required", status: 409 });
  const result = await runBootstrap({ env: localEnv(), contract: stagingContract(), repoRoot: path.resolve(API_ROOT, "..") });
  process.stdout.write(`${JSON.stringify({ ...result, environment_key: plan.environment_key, execution_transport: "local_cli", secrets_included: false })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, environment_key: "staging_local_windows_docker", error: sanitizeBootstrapError(error), database_mutation_performed: false, secrets_included: false })}\n`);
  process.exitCode = 1;
}
