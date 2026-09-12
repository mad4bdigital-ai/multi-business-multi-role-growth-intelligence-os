#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildHostBreakglassPlan } from "../hostBreakglassCatalog.js";
import { verifyHostBreakglassLocalRequest } from "../hostBreakglassLocalRequest.js";
import { readStagingRuntimeBootstrapContract } from "../stagingRuntimeBootstrapContract.js";
import { computeStagingRoleBundleBindings } from "../stagingRoleBundleBinding.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(API_ROOT, "..");
const LEGACY_RUNNER = path.join(HERE, "host-breakglass-local.mjs");

function fail(code, message, status = 409, details = {}) {
  throw Object.assign(new Error(message), { code, status, details: { ...details, database_mutation_performed: false, secrets_included: false } });
}

function requestFileFromArgs(args) {
  const index = args.indexOf("--request-file");
  if (index < 0 || !args[index + 1]) fail("host_breakglass_local_request_file_required", "--request-file <path> is required.", 400);
  return { index, path: path.resolve(process.cwd(), args[index + 1]) };
}

function envFileFromArgs(args) {
  const index = args.indexOf("--env-file");
  const candidates = index >= 0 && args[index + 1]
    ? [path.resolve(process.cwd(), args[index + 1])]
    : [path.join(API_ROOT, ".env.staging"), path.join(API_ROOT, ".env")];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

function loadBoundedEnvFile(args) {
  const selected = envFileFromArgs(args);
  if (!selected) fail("host_breakglass_staging_env_file_missing", "Staging selective rebuild requires an existing local environment file before authority verification.", 409);
  if (fs.statSync(selected).size > 1024 * 1024) fail("host_breakglass_staging_env_file_too_large", "Staging environment file exceeds the bounded size limit.", 409);
  if (typeof process.loadEnvFile !== "function") fail("host_breakglass_staging_env_file_unsupported", "This Node.js runtime cannot safely load the Staging environment file.", 409);
  process.loadEnvFile(selected);
  return selected;
}

function resolveBundleManifestPath(contract, env = process.env) {
  const configured = String(env.BOOTSTRAP_SCHEMA_BUNDLE_MANIFEST || contract?.baseline_bundle?.default_manifest_path || "").trim();
  if (!configured) fail("host_breakglass_staging_bundle_manifest_missing", "Canonical Staging schema-bundle manifest path is not configured.", 409);
  const resolved = path.isAbsolute(configured) ? path.resolve(configured) : path.resolve(REPO_ROOT, configured);
  const relative = path.relative(REPO_ROOT, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail("host_breakglass_staging_bundle_manifest_outside_repository", "Schema-bundle manifest must remain inside the exact repository checkout.", 409);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) fail("host_breakglass_staging_bundle_manifest_missing", "Canonical generated Staging schema-bundle manifest is missing.", 409);
  return resolved;
}

export function rebuildVerifiedStagingPlan(request = {}) {
  const planInput = verifyHostBreakglassLocalRequest(request);
  const bootstrapContract = readStagingRuntimeBootstrapContract();
  const roleSelectiveRebuild = planInput.operation_key === "database.rebuild_empty" && planInput.action === "apply_migration";
  const durableProof = roleSelectiveRebuild ? planInput.role_selection_proof : null;
  if (roleSelectiveRebuild && durableProof?.source !== "durable_full_inspection") {
    fail("host_breakglass_local_role_selection_provenance_invalid", "Verified selective rebuild requires the server-resolved durable full-inspection proof.");
  }
  const rebuilt = buildHostBreakglassPlan(planInput, {
    bootstrapContract,
    ...(durableProof ? { proofResolver: () => durableProof } : {}),
  });
  if (rebuilt.plan_sha256 !== request.plan_sha256) {
    fail("host_breakglass_local_plan_mismatch", "The local checkout rebuilt a different Host Breakglass transport plan; execution is forbidden.");
  }
  return rebuilt;
}

export const rebuildVerifiedStagingAccessRepairPlan = rebuildVerifiedStagingPlan;

export function verifyHostBreakglassLocalRequestFile(requestPath) {
  if (!fs.existsSync(requestPath) || !fs.statSync(requestPath).isFile()) fail("host_breakglass_local_request_file_missing", "Verified Host Breakglass request file does not exist.", 400);
  if (fs.statSync(requestPath).size > 256 * 1024) fail("host_breakglass_local_request_file_too_large", "Verified Host Breakglass request file exceeds the bounded size limit.", 400);
  const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
  const plan = rebuildVerifiedStagingPlan(request);
  return { request, plan };
}

async function verifySelectiveRoleBundles({ request, plan, args } = {}) {
  if (plan.operation_key !== "database.rebuild_empty" || plan.action !== "apply_migration") return null;
  loadBoundedEnvFile(args);
  const bootstrapContract = readStagingRuntimeBootstrapContract();
  const selectedRoles = Array.isArray(plan.selected_rebuild_roles) ? plan.selected_rebuild_roles : [];
  if (!selectedRoles.length) fail("host_breakglass_staging_role_selection_missing", "Selective rebuild request contains no selected roles.", 409);
  const manifestPath = resolveBundleManifestPath(bootstrapContract);
  const roleBundleBindings = computeStagingRoleBundleBindings({ manifestPath, expectedSha: plan.expected_sha, roles: selectedRoles, contract: bootstrapContract });
  const backendApiKey = String(process.env.STAGING_RECOVERY_BACKEND_API_KEY || process.env.BACKEND_API_KEY || "").trim();
  if (!backendApiKey) fail("host_breakglass_staging_ticket_authority_auth_missing", "Existing BACKEND_API_KEY is required for pre-mutation role-bundle ticket verification.", 503);
  const baseUrl = String(process.env.STAGING_RECOVERY_ADMIN_URL || "https://activation-dev.mad4b.com").trim().replace(/\/+$/u, "");
  if (baseUrl !== "https://activation-dev.mad4b.com") fail("host_breakglass_staging_ticket_authority_host_invalid", "Selective rebuild bundle verification must use activation-dev.mad4b.com.", 409);
  const body = {
    execution_ticket_id: plan.execution_ticket_id,
    execution_ticket_hash: plan.execution_ticket_hash,
    expected_sha: plan.expected_sha,
    target_key: plan.target_key,
    target_fingerprint: plan.role_selection_proof?.composite_target_fingerprint,
    authority_plan_hash: request.authority_plan_hash,
    role_selection_hash: plan.role_selection_proof?.selection_hash,
    idempotency_key: plan.correlation_id,
    selected_roles: selectedRoles,
    role_bundle_bindings: roleBundleBindings,
  };
  let response;
  try {
    response = await fetch(`${baseUrl}/admin/recovery/staging/bootstrap-ticket/bundle-verify`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": backendApiKey, "x-request-id": plan.correlation_id },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    fail("host_breakglass_staging_bundle_authority_unreachable", "Staging bundle verification authority is unreachable; no local mutation is allowed.", 503, { cause_code: error?.code || "unreachable" });
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.status !== "ticket_role_bundle_bindings_verified" || payload?.database_mutation_performed !== false) {
    fail(payload?.error?.code || "host_breakglass_staging_bundle_ticket_mismatch", "Server rejected the exact local role schema bundles for this rebuild ticket; no local mutation is allowed.", response.status || 409);
  }
  return payload;
}

async function main() {
  const args = process.argv.slice(2);
  try {
    const requestFile = requestFileFromArgs(args);
    const verified = verifyHostBreakglassLocalRequestFile(requestFile.path);
    const bundleVerification = await verifySelectiveRoleBundles({ request: verified.request, plan: verified.plan, args });
    const delegatedArgs = [...args];
    delegatedArgs[requestFile.index + 1] = requestFile.path;
    const child = spawnSync(process.execPath, [LEGACY_RUNNER, ...delegatedArgs], {
      cwd: API_ROOT,
      env: {
        ...process.env,
        HOST_BREAKGLASS_VERIFIED_REQUEST_SHA256: verified.request.request_sha256,
        HOST_BREAKGLASS_AUTHORITY_PLAN_HASH: verified.request.authority_plan_hash || "",
        HOST_BREAKGLASS_ROLE_BUNDLE_VERIFICATION: bundleVerification?.status || "",
      },
      stdio: "inherit",
      windowsHide: true,
    });
    if (child.error) throw child.error;
    process.exit(Number.isInteger(child.status) ? child.status : 1);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, contract: "mad4b.host-breakglass-local-request-verifier.v2", status: "verified_request_rejected", error: { code: error?.code || "host_breakglass_local_request_verification_failed", message: error?.message || "Verified Host Breakglass request verification failed." }, database_mutation_performed: false, production_authority: false, secrets_included: false })}\n`);
    process.exit(1);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) await main();
