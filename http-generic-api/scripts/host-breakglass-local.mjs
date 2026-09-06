#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildHostBreakglassPlan } from "../hostBreakglassCatalog.js";
import { runBootstrap, sanitizeBootstrapError } from "../runtimeBootstrapContract.js";
import { readStagingRuntimeBootstrapContract } from "../stagingRuntimeBootstrapContract.js";
import { STAGING_ROLE_GRANT_POLICIES } from "../databasePrivilegeContracts.js";
import { runSqlCapsule } from "./host-breakglass-capsule-executor.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(HERE, "..");
const overlay = JSON.parse(fs.readFileSync(path.join(API_ROOT, "config", "host-breakglass-staging-contract.json"), "utf8"));
const requestIndex = process.argv.indexOf("--request-file");
if (requestIndex < 0 || !process.argv[requestIndex + 1]) throw new Error("--request-file <path> is required");
const requestPath = path.resolve(process.cwd(), process.argv[requestIndex + 1]);
const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
request.environment_key = "staging_local_windows_docker";
const bootstrapContract = readStagingRuntimeBootstrapContract();
const plan = buildHostBreakglassPlan(request, { bootstrapContract });

function stagingContract() {
  return structuredClone(bootstrapContract);
}

function publicGrantPolicy(policy) {
  return {
    required_tables: [...(policy.required_tables || [])],
    optional_tables: [...(policy.optional_tables || [])],
    required_operations: [...(policy.required_operations || [])],
    required_operations_by_table: policy.required_operations_by_table
      ? Object.fromEntries(Object.entries(policy.required_operations_by_table).map(([table, operations]) => [table, [...operations]]))
      : null,
    apply_when: policy.apply_when || "always",
  };
}

function stagingAccessRepairDryRun() {
  const access = overlay.readiness_remediation?.access_repair || {};
  return {
    ok: true,
    contract: "mad4b.staging-access-repair-repository-dry-run.v1",
    status: "repository_dry_run_complete",
    environment_key: plan.environment_key,
    expected_sha: plan.expected_sha,
    target_key: plan.target_key,
    operation_key: plan.operation_key,
    runbook_key: plan.runbook_key,
    grant_policies: Object.fromEntries(Object.entries(STAGING_ROLE_GRANT_POLICIES).map(([role, policy]) => [role, publicGrantPolicy(policy)])),
    optional_surface_absence_is_blocking: access.optional_surface_absence_is_blocking === true,
    required_surface_absence_is_blocking: access.required_surface_absence_is_blocking !== false,
    same_cycle_readback_required: access.same_cycle_readback_required !== false,
    canonical_local_repair: access.canonical_local_repair || null,
    database_connection_performed: false,
    database_readback_performed: false,
    database_mutation_performed: false,
    mutation_ready: false,
    mutation_blocking_reason: "governed_execution_ticket_verifier_and_same_cycle_local_database_readback_required",
    production_authority: false,
    secrets_included: false,
  };
}

function localEnv() {
  if (plan.target_source === overlay.role_target_source) {
    const requestedIndex = process.argv.indexOf("--env-file");
    const requested = requestedIndex >= 0 ? process.argv[requestedIndex + 1] : null;
    const candidates = requested ? [requested] : [overlay.compose_env_file, ".env"];
    const selected = candidates.map((item) => path.resolve(API_ROOT, item)).find((item) => fs.existsSync(item) && fs.statSync(item).isFile());
    if (!selected) throw Object.assign(new Error("Staging role-bound recovery requires an existing local Docker environment file."), { code: "host_breakglass_staging_env_file_missing", status: 409 });
    if (fs.statSync(selected).size > 1024 * 1024) throw Object.assign(new Error("Staging role-bound environment file exceeds the bounded size limit."), { code: "host_breakglass_staging_env_file_too_large", status: 409 });
    if (typeof process.loadEnvFile !== "function") throw Object.assign(new Error("This Node.js runtime cannot safely load the Staging environment file."), { code: "host_breakglass_staging_env_file_unsupported", status: 409 });
    process.loadEnvFile(selected);
  }
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
    BOOTSTRAP_MIGRATION_CONFIRMATION: plan.action === "apply_migration" && plan.operation_key !== "database.rebuild_empty" ? plan.confirmation || "" : "",
    BOOTSTRAP_REBUILD_CONFIRMATION: plan.action === "apply_migration" && plan.operation_key === "database.rebuild_empty" ? plan.confirmation || "" : "",
    BOOTSTRAP_ROLE_SELECTION: Array.isArray(plan.selected_rebuild_roles) ? plan.selected_rebuild_roles.join(",") : "",
    BOOTSTRAP_INSPECTION_RUN_ID: plan.role_selection_proof?.inspection_run_id || "",
    BOOTSTRAP_PLAN_SHA256: plan.plan_sha256,
    BOOTSTRAP_ROLE_SELECTION_HASH: plan.role_selection_proof?.selection_hash || "",
    BOOTSTRAP_ROLE_OBJECT_COUNT_FINGERPRINTS: plan.role_selection_proof?.role_object_count_fingerprints ? JSON.stringify(plan.role_selection_proof.role_object_count_fingerprints) : "",
    BOOTSTRAP_GRANTS_CONFIRMATION: plan.action === "apply_grants" ? plan.confirmation || "" : "",
    BOOTSTRAP_GRANT_BINDING_HASH: plan.grant_binding_hash || "",
    BOOTSTRAP_EXECUTION_TICKET_ID: plan.execution_ticket_id || "",
    BOOTSTRAP_EXECUTION_TICKET_HASH: plan.execution_ticket_hash || "",
    HOST_BREAKGLASS_OPERATION: plan.operation_key,
    HOST_BREAKGLASS_HOST_LOCAL_ROLE_CREDENTIALS: plan.target_source === overlay.role_target_source ? "true" : "",
    HOST_BREAKGLASS_ENVIRONMENT_KEY: plan.environment_key,
    HOST_BREAKGLASS_CAPSULE_PATH: plan.capsule_path || "",
    HOST_BREAKGLASS_CAPSULE_SHA256: plan.capsule_sha256 || "",
    HOST_BREAKGLASS_CAPSULE_CONFIRMATION: plan.confirmation || ""
  };
}

try {
  if (plan.action === "plan") {
    process.stdout.write(`${JSON.stringify({ ok: true, ...plan, local_execution_performed: false, secrets_included: false })}\n`);
    process.exit(0);
  }
  if (plan.runbook_key === "database.access_repair" && plan.action === "dry_run") {
    process.stdout.write(`${JSON.stringify(stagingAccessRepairDryRun())}\n`);
    process.exit(0);
  }
  if (plan.runbook_key === "database.access_repair" && plan.action === "apply_grants") {
    throw Object.assign(new Error("Staging access mutation requires a governed server-side execution-ticket verifier before the canonical local repair may run; no database operation was attempted."), {
      code: "host_breakglass_staging_access_repair_verifier_required",
      status: 503,
      details: {
        canonical_local_repair: overlay.readiness_remediation?.access_repair?.canonical_local_repair || null,
        execution_ticket_authority_required: true,
        same_cycle_readback_required: true,
        database_connection_performed: false,
        database_mutation_performed: false,
      },
    });
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
