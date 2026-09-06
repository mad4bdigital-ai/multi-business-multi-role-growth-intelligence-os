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

function stagingContract() { return structuredClone(bootstrapContract); }
function stable(value) { return Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value; }
function evidenceHash(value) { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }

function publicGrantPolicy(policy) {
  return {
    required_tables: [...(policy.required_tables || [])],
    optional_tables: [...(policy.optional_tables || [])],
    required_operations: [...(policy.required_operations || [])],
    required_operations_by_table: policy.required_operations_by_table ? Object.fromEntries(Object.entries(policy.required_operations_by_table).map(([table, operations]) => [table, [...operations]])) : null,
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
    mutation_blocking_reason: "server_issued_execution_ticket_required_before_local_database_mutation",
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
    HOST_BREAKGLASS_CORRELATION_ID: plan.correlation_id,
    HOST_BREAKGLASS_HOST_LOCAL_ROLE_CREDENTIALS: plan.target_source === overlay.role_target_source ? "true" : "",
    HOST_BREAKGLASS_ENVIRONMENT_KEY: plan.environment_key,
    HOST_BREAKGLASS_CAPSULE_PATH: plan.capsule_path || "",
    HOST_BREAKGLASS_CAPSULE_SHA256: plan.capsule_sha256 || "",
    HOST_BREAKGLASS_CAPSULE_CONFIRMATION: plan.confirmation || ""
  };
}

function stagingBootstrapAuthorityClient(env) {
  const baseUrl = String(env.STAGING_RECOVERY_ADMIN_URL || "https://activation-dev.mad4b.com").trim().replace(/\/+$/u, "");
  const backendApiKey = String(env.STAGING_RECOVERY_BACKEND_API_KEY || env.BACKEND_API_KEY || "").trim();
  if (!backendApiKey) throw Object.assign(new Error("Staging bootstrap execution requires the existing BACKEND_API_KEY for the private Activation Gateway authority."), { code: "host_breakglass_staging_ticket_authority_auth_missing", status: 503 });
  let reservedBinding = null;
  let reservationReceipt = null;
  let reservationGeneration = null;
  let executionReceipt = null;

  const post = async (pathname, body) => {
    let response;
    try {
      response = await fetch(`${baseUrl}${pathname}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": backendApiKey, "x-request-id": plan.correlation_id },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
    } catch (error) {
      throw Object.assign(new Error("Staging bootstrap execution authority is unreachable; no automatic local mutation is allowed."), { code: "host_breakglass_staging_ticket_authority_unreachable", status: 503, cause: error });
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error("Staging bootstrap execution authority rejected the request."), { code: payload?.error?.code || "host_breakglass_staging_ticket_authority_rejected", status: response.status, details: { upstream_status: response.status, requestId: payload?.error?.requestId || payload?.error?.request_id || null, reconciliation_required: response.status === 409, automatic_rerun_allowed: false, secrets_included: false } });
    return payload;
  };

  const bindingBody = ({ ticket_id, ticket_hash, expected }) => ({
    execution_ticket_id: ticket_id,
    execution_ticket_hash: ticket_hash,
    expected_sha: expected.production_sha || plan.expected_sha,
    target_key: expected.target_key || plan.target_key,
    target_fingerprint: expected.target_fingerprint,
    operation: expected.operation,
    plan_hash: plan.plan_sha256,
    idempotency_key: plan.correlation_id,
    role_selection_hash: expected.role_selection_hash || plan.role_selection_proof?.selection_hash || null,
    grant_binding_hash: expected.grant_binding_hash || plan.grant_binding_hash || null,
  });

  return {
    executionTicketVerifier: Object.freeze({
      async verifyForBootstrap(input = {}) {
        const body = bindingBody(input);
        const result = await post("/admin/recovery/staging/bootstrap-ticket/verify", body);
        if (result?.valid !== true || result?.reserved !== true || !result?.reservation_receipt || !result?.reservation_generation) return { valid: false };
        reservedBinding = body;
        reservationReceipt = result.reservation_receipt;
        reservationGeneration = result.reservation_generation;
        const started = await post("/admin/recovery/staging/bootstrap-ticket/verify", { ...body, authority_action: "mark_executing", reservation_receipt: reservationReceipt });
        if (started?.executing !== true || started?.lifecycle_state !== "executing" || !started?.execution_receipt || started?.reservation_generation !== reservationGeneration) throw Object.assign(new Error("Staging execution-start receipt was not issued for the reserved ticket; local mutation is forbidden."), { code: "RECOVERY_RECONCILIATION_REQUIRED", status: 409, details: { reconciliation_required: true, automatic_rerun_allowed: false, database_mutation_performed: false } });
        executionReceipt = started.execution_receipt;
        return { valid: true, reserved: true, executing: true, reservation_fingerprint: result.reservation_fingerprint || null };
      },
    }),
    partialReceiptStore: Object.freeze({
      async putImmutablePartialRebuildReceipt(receipt) {
        const result = await post("/admin/recovery/staging/bootstrap-partial-receipt", { receipt });
        if (result?.persisted !== true || result?.durable !== true) throw Object.assign(new Error("Staging partial mutation receipt was not durably persisted."), { code: "host_breakglass_staging_partial_receipt_not_durable", status: 503 });
        return result;
      },
    }),
    async finalize(result) {
      if (!reservedBinding || !reservationReceipt || !reservationGeneration || !executionReceipt) throw Object.assign(new Error("No complete server-side Staging reservation/execution-start receipt chain exists for this local execution."), { code: "RECOVERY_RECONCILIATION_REQUIRED", status: 409, details: { reconciliation_required: true, automatic_rerun_allowed: false } });
      const roleReadback = result?.grants?.grant_readback_by_role || null;
      const readbackReady = result?.status === "apply_grants_complete"
        ? Boolean(roleReadback && Object.keys(roleReadback).length && Object.values(roleReadback).every((entry) => entry?.ready === true))
        : Boolean(result?.postconditions?.ready === true || result?.role_rebuild_evidence?.verification?.every?.((entry) => entry?.required_tables_present === true));
      if (!readbackReady) throw Object.assign(new Error("Local bootstrap completed without the canonical same-cycle readback required to finalize its ticket."), { code: "RECOVERY_READBACK_UNVERIFIED", status: 409, details: { database_mutation_performed: result?.database_mutation_performed === true, reconciliation_required: true, automatic_rerun_allowed: false } });
      const roleProjection = roleReadback ? Object.fromEntries(Object.entries(roleReadback).map(([role, entry]) => [role, { ready: entry?.ready === true, evidence_fingerprint: evidenceHash(entry) }])) : null;
      const evidence = {
        contract: "mad4b.staging-bootstrap-local-readback-evidence.v1",
        ticket_id: reservedBinding.execution_ticket_id,
        reservation_generation: reservationGeneration,
        expected_sha: reservedBinding.expected_sha,
        target_key: reservedBinding.target_key,
        target_fingerprint: reservedBinding.target_fingerprint,
        operation: reservedBinding.operation,
        plan_hash: reservedBinding.plan_hash,
        idempotency_key: reservedBinding.idempotency_key,
        grant_binding_hash: reservedBinding.grant_binding_hash || null,
        role_selection_hash: reservedBinding.role_selection_hash || null,
        status: result.status,
        observed_at: new Date().toISOString(),
        same_cycle: true,
        database_mutation_performed: result.database_mutation_performed === true,
        grant_readback_by_role: roleProjection,
        postconditions_fingerprint: result?.postconditions ? evidenceHash(result.postconditions) : null,
        mutation_evidence_fingerprint: result?.mutation_evidence ? evidenceHash(result.mutation_evidence) : null,
        secrets_included: false,
      };
      try {
        return await post("/admin/recovery/staging/bootstrap-ticket/finalize", { ...reservedBinding, reservation_receipt: reservationReceipt, execution_receipt: executionReceipt, readback_evidence: evidence });
      } catch (error) {
        error.details = { ...(error.details || {}), database_mutation_performed: result?.database_mutation_performed === true, reconciliation_required: true, automatic_rerun_allowed: false };
        throw error;
      }
    },
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
  const env = localEnv();
  const authority = stagingBootstrapAuthorityClient(env);
  const result = await runBootstrap({ env, contract: stagingContract(), repoRoot: path.resolve(API_ROOT, ".."), executionTicketVerifier: authority.executionTicketVerifier, partialReceiptStore: authority.partialReceiptStore });
  if (["apply_migration", "apply_grants"].includes(plan.action)) await authority.finalize(result);
  process.stdout.write(`${JSON.stringify({ ...result, environment_key: plan.environment_key, execution_transport: "local_cli", execution_ticket_finalized: ["apply_migration", "apply_grants"].includes(plan.action), secrets_included: false })}\n`);
} catch (error) {
  const sanitized = sanitizeBootstrapError(error);
  const mutationPerformed = sanitized?.details?.database_mutation_performed ?? false;
  process.stdout.write(`${JSON.stringify({ ok: false, environment_key: "staging_local_windows_docker", error: sanitized, database_mutation_performed: mutationPerformed, reconciliation_required: sanitized?.details?.reconciliation_required === true, automatic_rerun_allowed: sanitized?.details?.automatic_rerun_allowed === false ? false : undefined, secrets_included: false })}\n`);
  process.exitCode = 1;
}
