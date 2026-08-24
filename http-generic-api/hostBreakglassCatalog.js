import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { getGitHubAppInstallationToken } from "./githubAppAuth.js";
import { readRuntimeBootstrapContract } from "./runtimeBootstrapContract.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.join(HERE, "config", "host-breakglass-catalog.json");
const SHA_RE = /^[0-9a-f]{40}$/u;
const SAFE_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/u;
const RUNS = new Map();

function fail(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  throw error;
}

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function readHostBreakglassCatalog(catalogPath = CATALOG_PATH) {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  if (catalog?.contract !== "mad4b.host-breakglass-catalog.v1" || catalog?.database_independent !== true) {
    fail(500, "host_breakglass_catalog_invalid", "Host Breakglass catalog is invalid.");
  }
  return catalog;
}

export function publicHostBreakglassCatalog(catalog = readHostBreakglassCatalog()) {
  return { ...catalog, catalog_sha256: stableHash(catalog), secrets_included: false };
}

function migrationFiles(contract) {
  return new Set(Object.keys(contract?.migrations || {}));
}

export function buildHostBreakglassPlan(input = {}, { catalog = readHostBreakglassCatalog(), bootstrapContract = readRuntimeBootstrapContract() } = {}) {
  const environmentKey = String(input.environment_key || "production_hostinger_autodeploy").trim();
  const environment = catalog.environments?.[environmentKey];
  if (!environment) fail(400, "host_breakglass_environment_unknown", "Unknown Host Breakglass environment.", { environment_key: environmentKey });
  const operationKey = String(input.operation_key || "").trim();
  const action = String(input.action || "plan").trim();
  const expectedSha = String(input.expected_sha || "").trim().toLowerCase();
  const targetSource = String(input.target_source || "repository_allowlist").trim();
  const targetKey = String(input.target_key || environment.default_target_key).trim();
  const operation = catalog.operations.find((entry) => entry.key === operationKey);
  if (!operation) fail(400, "host_breakglass_operation_unknown", "Unknown Host Breakglass operation.", { operation_key: operationKey });
  if (!operation.allowed_actions.includes(action)) fail(400, "host_breakglass_action_denied", "Action is not allowed for this operation.", { operation_key: operationKey, action });
  if (!operation.target_sources.includes(targetSource)) fail(400, "host_breakglass_target_source_denied", "Target source is not allowed for this operation.", { target_source: targetSource });
  if (!SHA_RE.test(expectedSha)) fail(400, "host_breakglass_expected_sha_invalid", "expected_sha must be a lowercase 40-character SHA.");
  if (!SAFE_ID_RE.test(targetKey)) fail(400, "host_breakglass_target_key_invalid", "target_key is invalid.");
  const migration = String(input.migration || "").trim();
  if (["dry_run", "apply_migration"].includes(action) && !migrationFiles(bootstrapContract).has(migration)) {
    fail(400, "host_breakglass_migration_not_cataloged", "Migration is not present in the repository-owned bootstrap contract.", { migration });
  }
  if (targetSource === "runtime_env" && !["plan", "dry_run"].includes(action)) {
    fail(403, "host_breakglass_runtime_env_mutation_denied", "runtime_env is restricted to plan and dry_run.");
  }
  const confirmation = String(input.confirmation || "").trim();
  const confirmationRequired = operation.requires_confirmation === true && action.startsWith("apply_");
  const expectedConfirmation = action === "apply_migration"
    ? `APPLY_HOSTINGER_RUNTIME_MIGRATION:${expectedSha}:${targetKey}:${migration}`
    : "";
  const grantsConfirmationValid = action === "apply_grants"
    && new RegExp(`^APPLY_HOSTINGER_RUNTIME_GRANTS:${expectedSha}:${targetKey}:[A-Za-z0-9_$.-]{1,128}:[A-Za-z0-9._%:-]{1,255}$`, "u").test(confirmation);
  if (confirmationRequired && ((action === "apply_migration" && confirmation !== expectedConfirmation) || (action === "apply_grants" && !grantsConfirmationValid))) {
    fail(400, "host_breakglass_confirmation_required", "Exact typed confirmation is required.", { confirmation_formula: action === "apply_migration" ? "APPLY_HOSTINGER_RUNTIME_MIGRATION:<sha>:<target-key>:<migration-file>" : "APPLY_HOSTINGER_RUNTIME_GRANTS:<sha>:<target-key>:<principal>:<principal-host>" });
  }
  const correlationId = String(input.correlation_id || input.idempotency_key || randomUUID()).trim();
  if (!SAFE_ID_RE.test(correlationId)) fail(400, "host_breakglass_correlation_invalid", "correlation_id is invalid.");
  const plan = {
    contract: "mad4b.host-breakglass-plan.v1",
    operation_key: operationKey,
    action,
    expected_sha: expectedSha,
    environment_key: environmentKey,
    environment: environment.environment,
    host: environment.host,
    runtime: environment.runtime,
    execution_transport: environment.execution_transport,
    repository: catalog.repository,
    dispatch_ref: environment.dispatch_ref || null,
    target_branch: environment.source_branch,
    workflow: environment.execution_transport === "github_workflow" ? catalog.workflow : null,
    target_source: targetSource,
    target_key: targetKey,
    migration: migration || null,
    confirmation: confirmation || null,
    correlation_id: correlationId,
    requires_zero_table_database: operation.requires_zero_table_database === true,
    destructive_nonempty_rebuild_allowed: false,
    database_independent_control_plane: true,
    database_mutation_performed: false,
    secrets_included: false
  };
  return { ...plan, plan_sha256: stableHash(plan) };
}

async function githubRequest({ token, method = "GET", pathname, body, fetchImpl = fetch }) {
  const response = await fetchImpl(`https://api.github.com${pathname}`, {
    method,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "mad4b-host-breakglass-broker", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) fail(response.status >= 500 ? 502 : response.status, "host_breakglass_github_request_failed", "GitHub broker request failed.", { upstream_status: response.status, github_message: payload?.message || null });
  return { status: response.status, payload };
}

export async function dispatchHostBreakglassPlan(plan, { fetchImpl = fetch, tokenResolver = getGitHubAppInstallationToken } = {}) {
  if (plan.execution_transport !== "github_workflow" || plan.environment_key !== "production_hostinger_autodeploy") {
    return { ok: true, contract: "mad4b.host-breakglass-local-handoff.v1", correlation_id: plan.correlation_id, plan_sha256: plan.plan_sha256, status: "local_execution_required", environment_key: plan.environment_key, required_platform: "win32", required_runtime: "docker_compose", command: "npm run host-breakglass:local -- --request-file <verified-request.json>", workflow_dispatch_performed: false, database_mutation_performed: false, secrets_included: false };
  }
  const existing = RUNS.get(plan.correlation_id);
  if (existing) {
    if (existing.plan_sha256 !== plan.plan_sha256) fail(409, "host_breakglass_idempotency_conflict", "correlation_id is already bound to a different plan.");
    const { prior_run_ids, ...publicExisting } = existing;
    return { ...publicExisting, replayed: true, secrets_included: false };
  }
  const [owner, repo] = plan.repository.split("/");
  const token = await tokenResolver({ action: {} , fetchImpl });
  const prior = await githubRequest({ token, pathname: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(plan.workflow)}/runs?event=workflow_dispatch&branch=${encodeURIComponent(plan.dispatch_ref)}&per_page=20`, fetchImpl });
  const priorRunIds = (prior.payload?.workflow_runs || []).map((item) => String(item.id));
  const dispatchedAt = new Date().toISOString();
  await githubRequest({ token, method: "POST", pathname: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(plan.workflow)}/dispatches`, fetchImpl, body: { ref: plan.dispatch_ref, inputs: {
    expected_sha: plan.expected_sha,
    expected_branch: plan.target_branch,
    bootstrap_mode: plan.action,
    bootstrap_target_key: plan.target_key,
    bootstrap_target_source: plan.target_source === "runtime_env" ? "hostinger_runtime_env" : "repository_allowlist",
    bootstrap_migration: plan.migration || "20260815_custom_gpt_mcp_catalog_levels.sql",
    bootstrap_migration_confirmation: plan.action === "apply_migration" ? plan.confirmation || "" : "",
    bootstrap_grants_confirmation: plan.action === "apply_grants" ? plan.confirmation || "" : "",
    host_breakglass_operation: plan.operation_key,
    host_breakglass_correlation_id: plan.correlation_id
  } } });
  const receipt = { ok: true, contract: "mad4b.host-breakglass-dispatch-receipt.v1", correlation_id: plan.correlation_id, plan_sha256: plan.plan_sha256, status: "dispatched", workflow_run_id: null, workflow_dispatch_performed: true, database_mutation_performed: false, dispatched_at: dispatchedAt, prior_run_ids: priorRunIds, secrets_included: false };
  RUNS.set(plan.correlation_id, receipt);
  const { prior_run_ids, ...publicReceipt } = receipt;
  return publicReceipt;
}

export async function readHostBreakglassRun(correlationId, { catalog = readHostBreakglassCatalog(), fetchImpl = fetch, tokenResolver = getGitHubAppInstallationToken } = {}) {
  if (!SAFE_ID_RE.test(String(correlationId || ""))) fail(400, "host_breakglass_correlation_invalid", "correlation_id is invalid.");
  const receipt = RUNS.get(correlationId);
  if (!receipt) return { ok: false, contract: "mad4b.host-breakglass-run-status.v1", correlation_id: correlationId, status: "not_found", secrets_included: false };
  const [owner, repo] = catalog.repository.split("/");
  const token = await tokenResolver({ action: {}, fetchImpl });
  const result = await githubRequest({ token, pathname: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(catalog.workflow)}/runs?event=workflow_dispatch&branch=${encodeURIComponent(catalog.dispatch_ref)}&per_page=20`, fetchImpl });
  const candidates = (result.payload?.workflow_runs || []).filter((item) => item?.head_branch === catalog.dispatch_ref && !receipt.prior_run_ids.includes(String(item.id)) && Date.parse(item.created_at || 0) >= Date.parse(receipt.dispatched_at));
  if (candidates.length > 1) return { ok: false, contract: "mad4b.host-breakglass-run-status.v1", correlation_id: correlationId, status: "correlation_ambiguous", candidate_count: candidates.length, secrets_included: false };
  const run = candidates[0] || null;
  return { ok: true, contract: "mad4b.host-breakglass-run-status.v1", correlation_id: correlationId, dispatch_status: receipt.status, workflow_run_id: run?.id ? String(run.id) : null, status: run?.status || "queued", conclusion: run?.conclusion || null, secrets_included: false };
}

export const __hostBreakglassTest = { RUNS };
