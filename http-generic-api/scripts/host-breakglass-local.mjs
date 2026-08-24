#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildHostBreakglassPlan } from "../hostBreakglassCatalog.js";
import { readRuntimeBootstrapContract, runBootstrap, sanitizeBootstrapError } from "../runtimeBootstrapContract.js";
import { runSqlCapsule } from "./host-breakglass-capsule-executor.mjs";

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
    ,HOST_BREAKGLASS_ENVIRONMENT_KEY: plan.environment_key
    ,HOST_BREAKGLASS_CAPSULE_PATH: plan.capsule_path || ""
    ,HOST_BREAKGLASS_CAPSULE_SHA256: plan.capsule_sha256 || ""
    ,HOST_BREAKGLASS_CAPSULE_CONFIRMATION: plan.confirmation || ""
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
  if (plan.action === "execute_sql_capsule") {
    const result = await runSqlCapsule({ env: localEnv(), contract: stagingContract() });
    process.stdout.write(`${JSON.stringify({ ...result, execution_transport: "local_cli", secrets_included: false })}\n`);
    process.exit(0);
  }
  if (plan.action === "execute_shell_capsule") {
    const checkoutSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: path.resolve(API_ROOT, ".."), encoding: "utf8" }).trim().toLowerCase();
    if (checkoutSha !== plan.expected_sha) throw Object.assign(new Error("Staging checkout SHA does not match the approved shell capsule source."), { code: "host_breakglass_capsule_source_mismatch", status: 409 });
    const capsule = fs.readFileSync(path.resolve(API_ROOT, "..", plan.capsule_path), "utf8");
    const capsuleHash = createHash("sha256").update(capsule).digest("hex");
    if (capsuleHash !== plan.capsule_sha256) throw Object.assign(new Error("Shell capsule hash mismatch."), { code: "host_breakglass_capsule_hash_mismatch", status: 400 });
    const composeArgs = ["compose", "--env-file", overlay.compose_env_file, ...overlay.compose_files.flatMap((file) => ["-f", file]), "exec", "-T", overlay.shell_service, "sh", "-s"];
    const shell = spawnSync("docker", composeArgs, { cwd: API_ROOT, input: capsule, encoding: "utf8", windowsHide: true, timeout: 300000, maxBuffer: 1024 * 1024, shell: false });
    if (shell.status !== 0) throw Object.assign(new Error("Docker shell capsule failed."), { code: "host_breakglass_shell_capsule_failed", status: 502 });
    process.stdout.write(`${JSON.stringify({ ok: true, contract: "mad4b.host-breakglass-shell-capsule-result.v1", environment_key: plan.environment_key, capsule_path: plan.capsule_path, capsule_sha256: capsuleHash, exit_code: shell.status, output_sha256: createHash("sha256").update(shell.stdout || "").digest("hex"), output_bytes: Buffer.byteLength(shell.stdout || ""), shell_exception_used: true, database_mutation_performed: "unknown", secrets_included: false })}\n`);
    process.exit(0);
  }
  const result = await runBootstrap({ env: localEnv(), contract: stagingContract(), repoRoot: path.resolve(API_ROOT, "..") });
  process.stdout.write(`${JSON.stringify({ ...result, environment_key: plan.environment_key, execution_transport: "local_cli", secrets_included: false })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, environment_key: "staging_local_windows_docker", error: sanitizeBootstrapError(error), database_mutation_performed: false, secrets_included: false })}\n`);
  process.exitCode = 1;
}
