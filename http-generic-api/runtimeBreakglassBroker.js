import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bootstrapError,
  readRuntimeBootstrapContract,
  selectMigration,
} from "./runtimeBootstrapContract.js";
import { getRuntimeBootstrapStatus } from "./runtimeBootstrapStatus.js";
import {
  getGitHubAppInstallationToken,
  resolveGitHubAppConfig,
} from "./githubAppAuth.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const CATALOG_PATH = path.join(HERE, "config", "runtime-breakglass-catalog.json");
const RECOVERY_ROUTES_PATH = path.join(REPO_ROOT, ".github", "ops", "production-runtime-recovery-routes.json");
const SHA_RE = /^[0-9a-f]{40}$/iu;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$/u;
const RUN_ID_RE = /^[0-9]{1,20}$/u;
const MAX_RESPONSE_CHARS = 48_000;
const REVIEWED_SCHEMA_FILE = "20260815_custom_gpt_mcp_catalog_levels.sql";
const FORBIDDEN_REQUEST_KEYS = new Set([
  "database",
  "database_name",
  "target_database",
  "db_name",
  "db_user",
  "db_password",
  "password",
  "secret",
  "token",
  "credential",
  "credentials",
  "github_token",
  "repository",
  "repo",
  "workflow",
  "workflow_file",
  "ref",
  "dispatch_ref",
]);

let catalogMemo = null;
let recoveryRoutesMemo = null;

function safeText(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function brokerError(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function readJsonFile(file, code, message) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw brokerError(500, code, message, {
      source_file: path.relative(REPO_ROOT, file),
      cause_code: error?.code || "parse_failed",
    });
  }
}

function readCatalog() {
  if (!catalogMemo) catalogMemo = readJsonFile(CATALOG_PATH, "breakglass_catalog_unreadable", "The repository-owned Breakglass catalog is unavailable.");
  if (catalogMemo?.contract !== "mad4b.runtime-breakglass-catalog.v1") {
    throw brokerError(500, "breakglass_catalog_contract_invalid", "The repository-owned Breakglass catalog contract is invalid.");
  }
  return catalogMemo;
}

function readRecoveryRoutes() {
  if (!recoveryRoutesMemo) recoveryRoutesMemo = readJsonFile(RECOVERY_ROUTES_PATH, "breakglass_recovery_policy_unreadable", "The reviewed recovery policy is unavailable.");
  if (recoveryRoutesMemo?.schema_version !== "production-runtime-recovery-routes.v1") {
    throw brokerError(500, "breakglass_recovery_policy_invalid", "The reviewed recovery policy contract is invalid.");
  }
  return recoveryRoutesMemo;
}

function canonicalRepository() {
  return readCatalog().repository;
}

function canonicalWorkflow() {
  return readCatalog().workflow;
}

function normalizeEnvironment(value) {
  const environment = safeText(value, 32).toLowerCase();
  if (!environment) throw brokerError(400, "breakglass_environment_required", "environment is required.");
  if (!Object.prototype.hasOwnProperty.call(readCatalog().environments, environment)) {
    throw brokerError(400, "breakglass_environment_not_allowed", "The requested environment is not registered by the Breakglass catalog.", { environment });
  }
  return environment;
}

function normalizeContractKey(value) {
  const key = safeText(value, 96);
  if (!key) throw brokerError(400, "breakglass_contract_required", "contract_key is required.");
  const contract = readCatalog().contracts.find((entry) => entry.key === key);
  if (!contract) throw brokerError(400, "breakglass_contract_not_allowed", "The requested Breakglass contract is not registered.", { contract_key: key });
  return contract;
}

function normalizeMode(value) {
  const mode = safeText(value || "plan", 32).toLowerCase();
  if (!["plan", "dry_run", "apply_migration", "apply_grants"].includes(mode)) {
    throw brokerError(400, "breakglass_mode_invalid", "mode must be plan, dry_run, apply_migration, or apply_grants.", { mode });
  }
  return mode;
}

function normalizeSha(value, { required = false } = {}) {
  const sha = safeText(value, 64).toLowerCase();
  if (!sha && !required) return null;
  if (!SHA_RE.test(sha)) throw brokerError(400, "breakglass_expected_sha_invalid", "expected_sha must be a full 40-character SHA.");
  return sha;
}

function normalizeId(value, field) {
  const id = safeText(value, 96);
  if (!SAFE_ID_RE.test(id)) throw brokerError(400, "breakglass_idempotency_key_invalid", `${field} must be 8-96 safe characters.`);
  return id;
}

function normalizeMigration(value, mode) {
  const migration = safeText(value || REVIEWED_SCHEMA_FILE, 191);
  if (!migration || migration.includes("/") || migration.includes("\\") || migration.includes("..")) {
    throw brokerError(400, "breakglass_migration_invalid", "migration must be a canonical allowlisted filename.");
  }
  const recoveryPolicy = readRecoveryRoutes();
  const recoverySpec = recoveryPolicy.recovery_migrations?.[migration];
  if (!recoverySpec) throw brokerError(400, "breakglass_migration_not_allowed", "The migration is not registered by the reviewed recovery policy.", { migration });
  if (mode === "apply_migration" && recoverySpec.incident_role !== "only_current_apply_candidate") {
    throw brokerError(409, "breakglass_migration_apply_forbidden", "Only the reviewed current apply candidate may be applied through Breakglass.", { migration, incident_role: recoverySpec.incident_role || null });
  }
  if (mode !== "plan" && !(recoverySpec.allowed_modes || []).includes(mode === "apply_migration" ? "apply" : "dry_run")) {
    throw brokerError(409, "breakglass_migration_mode_forbidden", "The migration is not allowed in the requested mode.", { migration, mode });
  }
  return migration;
}

function contractEnvironmentAllowed(contract, environment) {
  return Array.isArray(contract.environments) && contract.environments.includes(environment);
}

function safeEnvironmentSummary(environmentKey, entry) {
  return {
    environment: environmentKey,
    source_branch: entry.source_branch,
    deployment_provider: entry.deployment_provider,
    deployment_mode: entry.deployment_mode,
    runtime_kind: entry.runtime_kind,
    target_key: entry.target_key,
    target_sources: entry.target_sources || [entry.target_source],
    allowed_hosts: [...(entry.allowed_hosts || [])],
    forbidden_hosts: [...(entry.forbidden_hosts || [])],
    credential_namespace: entry.credential_namespace,
    allowed_modes: [...(entry.allowed_modes || [])],
    execution_authority: entry.execution_authority || null,
    admin_route_mutation: entry.admin_route_mutation,
    github_workflow_dispatch: entry.github_workflow_dispatch === true,
    readback_authority: entry.readback_authority || null,
  };
}

function gitHubBrokerStatus(env = process.env) {
  const directToken = Boolean(String(env.RUNTIME_BREAKGLASS_GITHUB_TOKEN || env.GITHUB_TOKEN || "").trim());
  const appConfig = resolveGitHubAppConfig({
    github_app_id: env.RUNTIME_BREAKGLASS_GITHUB_APP_ID || env.GITHUB_APP_ID,
    github_app_installation_id: env.RUNTIME_BREAKGLASS_GITHUB_APP_INSTALLATION_ID || env.GITHUB_APP_INSTALLATION_ID,
    secret_store_ref: env.RUNTIME_BREAKGLASS_GITHUB_APP_PRIVATE_KEY_REF || "",
  });
  const appConfigured = Boolean(appConfig.appId && appConfig.installationId && appConfig.privateKey);
  return {
    configured: directToken || appConfigured,
    auth_mode: directToken ? "server_side_token" : appConfigured ? "github_app_installation" : "unconfigured",
    repository: canonicalRepository(),
    workflow: canonicalWorkflow().file,
    dispatch_ref: canonicalWorkflow().dispatch_ref,
    credential_values_exposed: false,
    secrets_included: false,
  };
}

function ensureNoForbiddenRequestFields(input = {}) {
  const keys = Object.keys(input || {}).map((key) => String(key).trim().toLowerCase());
  const forbidden = keys.filter((key) => FORBIDDEN_REQUEST_KEYS.has(key));
  if (forbidden.length) {
    throw brokerError(400, "breakglass_request_field_forbidden", "Database, credential, repository, workflow, and ref fields are server-controlled and cannot be supplied by the caller.", { fields: forbidden });
  }
}

function normalizeTargetSource(value, environment, mode) {
  const envEntry = readCatalog().environments[environment];
  const requested = safeText(value || (environment === "staging" ? "docker_local" : "repository_allowlist"), 64).toLowerCase();
  if (environment === "staging") {
    if (requested !== "docker_local") throw brokerError(409, "breakglass_staging_target_source_invalid", "Staging Breakglass is bound to the local Windows Docker authority.", { target_source: requested });
    if (!["plan", "dry_run"].includes(mode)) throw brokerError(409, "breakglass_staging_admin_mutation_forbidden", "Staging Admin Breakglass is read-only; mutation requires the local operator path.", { mode });
    return requested;
  }
  if (!(envEntry.target_sources || []).includes(requested)) throw brokerError(400, "breakglass_target_source_invalid", "The target source is not registered for this environment.", { target_source: requested, environment });
  if (requested === "runtime_env" && mode !== "dry_run" && mode !== "plan") {
    throw brokerError(409, "breakglass_runtime_env_apply_forbidden", "runtime_env is restricted to dry_run and cannot be used for migration or grant apply.", { mode, workflow_dispatch_performed: false, database_mutation_performed: false });
  }
  return requested;
}

function buildNormalizedRequest(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw brokerError(400, "breakglass_request_invalid", "Breakglass request must be a JSON object.");
  ensureNoForbiddenRequestFields(input);
  const environment = normalizeEnvironment(input.environment);
  const contract = normalizeContractKey(input.contract_key || input.contract || input.action_key);
  if (!contractEnvironmentAllowed(contract, environment)) throw brokerError(409, "breakglass_contract_environment_mismatch", "The contract is not registered for the requested environment.", { contract_key: contract.key, environment });
  const mode = normalizeMode(input.mode);
  const envEntry = readCatalog().environments[environment];
  if (contract.key === "full_database_rebuild" && !["plan", "dry_run"].includes(mode)) {
    throw brokerError(409, "breakglass_full_rebuild_apply_forbidden", "A full rebuild is plan/dry-run only; destructive replacement of a non-empty database is not routable.");
  }
  if (!(contract.allowed_modes || []).includes(mode)) throw brokerError(409, "breakglass_contract_mode_forbidden", "The requested mode is not permitted by the contract.", { contract_key: contract.key, mode });
  const targetSource = normalizeTargetSource(input.target_source, environment, mode);
  if (!(envEntry.allowed_modes || []).includes(mode)) throw brokerError(409, "breakglass_environment_mode_forbidden", "The requested mode is not permitted by the environment authority.", { environment, mode });
  const expectedSha = normalizeSha(input.expected_sha, { required: mode !== "plan" });
  const expectedBranch = safeText(input.expected_branch || envEntry.source_branch, 64);
  if (expectedBranch !== envEntry.source_branch) throw brokerError(409, "breakglass_branch_environment_mismatch", "expected_branch does not match the selected environment authority.", { environment });
  const targetKey = safeText(input.target_key || envEntry.target_key, 128);
  if (targetKey !== envEntry.target_key) throw brokerError(409, "breakglass_target_key_environment_mismatch", "target_key does not match the selected environment authority.", { environment });
  const migration = contract.key === "grant_repair" || contract.key === "schema_repair" || contract.key === "empty_database_rebuild" || contract.key === "runtime_diagnose"
    ? normalizeMigration(input.migration, mode === "apply_migration" ? "apply_migration" : mode)
    : REVIEWED_SCHEMA_FILE;
  const idempotencyKey = input.idempotency_key
    ? normalizeId(input.idempotency_key, "idempotency_key")
    : (environment === "production" && mode !== "plan" ? normalizeId("", "idempotency_key") : null);
  const confirmation = safeText(input.confirmation || input.migration_confirmation || input.grants_confirmation, 500);
  if (mode === "apply_migration" || mode === "apply_grants") {
    if (!confirmation) throw brokerError(409, "breakglass_typed_confirmation_required", "Mutation requires an exact typed confirmation bound to SHA, target, and operation.", { mode });
    if (targetSource !== "repository_allowlist") throw brokerError(409, "breakglass_apply_target_source_forbidden", "Mutation is permitted only through repository_allowlist.", { target_source: targetSource });
  }
  if (environment === "production" && mode === "apply_grants" && contract.key !== "grant_repair") throw brokerError(409, "breakglass_contract_operation_mismatch", "apply_grants is available only through the grant_repair contract.");
  if (environment === "production" && mode === "apply_migration" && !["schema_repair", "empty_database_rebuild"].includes(contract.key)) throw brokerError(409, "breakglass_contract_operation_mismatch", "apply_migration is available only through schema_repair or empty_database_rebuild.");
  if (contract.key === "full_database_rebuild" && mode !== "plan" && mode !== "dry_run") throw brokerError(409, "breakglass_full_rebuild_apply_forbidden", "A full rebuild is plan/dry-run only; destructive replacement of a non-empty database is not routable.");
  return {
    environment,
    contract_key: contract.key,
    contract,
    mode,
    expected_sha: expectedSha,
    expected_branch: expectedBranch,
    target_key: targetKey,
    target_source: targetSource,
    migration,
    idempotency_key: idempotencyKey,
    correlation_id: idempotencyKey ? `bg-${idempotencyKey}` : null,
    confirmation,
  };
}

function buildStagingPlan(request) {
  const entry = readCatalog().environments.staging;
  return {
    ok: true,
    contract: "mad4b.runtime-breakglass-plan.v1",
    environment: "staging",
    contract_key: request.contract_key,
    mode: request.mode,
    status: request.mode === "plan" ? "plan_only" : "local_operator_required",
    execution_authority: entry.execution_authority,
    deployment: {
      source_branch: entry.source_branch,
      deployment_provider: entry.deployment_provider,
      deployment_mode: entry.deployment_mode,
      runtime_kind: entry.runtime_kind,
      docker_compose: "http-generic-api/docker-compose.staging.yml",
      dockerfile: "http-generic-api/Dockerfile.staging",
      local_only: true,
    },
    target: {
      target_key: request.target_key,
      target_source: request.target_source,
      database_identifier_supplied_by_caller: false,
      raw_values_exposed: false,
    },
    source_binding: {
      expected_sha: request.expected_sha,
      expected_branch: request.expected_branch,
      exact_sha_required: request.mode !== "plan",
    },
    rebuild_policy: {
      empty_database_only: request.contract_key === "empty_database_rebuild",
      full_nonempty_replacement: false,
      destructive_apply_route: false,
      local_operator_review_required: true,
    },
    workflow_dispatch_performed: false,
    database_connection_performed: false,
    database_mutation_performed: false,
    migration_apply_performed: false,
    grant_mutation_performed: false,
    readback_required: true,
    secrets_included: false,
  };
}

function workflowInputPayload(request) {
  const workflow = canonicalWorkflow();
  const inputs = {
    expected_sha: request.expected_sha,
    expected_branch: "Production",
    auth_url: "https://auth.mad4b.com/version",
    deployment_info_url: "https://auth.mad4b.com/deployment-info",
    runtime_bootstrap_url: "https://auth.mad4b.com/deployment-info/runtime-bootstrap-dry-run",
    strategy: "disabled",
    source_mode: "sql",
    apply_execution: "false",
    confirmation: "",
    target_key: "runtime",
    bootstrap_mode: request.mode,
    bootstrap_target_key: "production-runtime",
    bootstrap_target_source: request.target_source === "runtime_env" ? "hostinger_runtime_env" : "repository_allowlist",
    bootstrap_migration: request.migration,
    bootstrap_migration_confirmation: request.mode === "apply_migration" ? request.confirmation : "",
    bootstrap_grants_confirmation: request.mode === "apply_grants" ? request.confirmation : "",
    bootstrap_bundle_manifest: "",
    breakglass_correlation_id: request.correlation_id || "",
  };
  return { ref: workflow.dispatch_ref, inputs };
}

function normalizeRunId(value) {
  const runId = safeText(value, 24);
  if (!RUN_ID_RE.test(runId)) throw brokerError(400, "breakglass_run_id_invalid", "run_id must be a numeric GitHub workflow run id.");
  return runId;
}

function githubApiBase(env = process.env) {
  const base = safeText(env.RUNTIME_BREAKGLASS_GITHUB_API_BASE_URL || "https://api.github.com", 200).replace(/\/$/u, "");
  if (!/^https:\/\/api\.github\.com$/u.test(base)) throw brokerError(500, "breakglass_github_api_base_forbidden", "The Breakglass broker is bound to the canonical GitHub API host.");
  return base;
}

async function resolveGitHubToken({ env = process.env, fetchImpl = fetch, getAppToken = getGitHubAppInstallationToken } = {}) {
  const directToken = String(env.RUNTIME_BREAKGLASS_GITHUB_TOKEN || env.GITHUB_TOKEN || "").trim();
  if (directToken) return { token: directToken, auth_mode: "server_side_token" };
  const action = {
    github_app_id: env.RUNTIME_BREAKGLASS_GITHUB_APP_ID || env.GITHUB_APP_ID,
    github_app_installation_id: env.RUNTIME_BREAKGLASS_GITHUB_APP_INSTALLATION_ID || env.GITHUB_APP_INSTALLATION_ID,
    secret_store_ref: env.RUNTIME_BREAKGLASS_GITHUB_APP_PRIVATE_KEY_REF || "",
  };
  try {
    const token = await getAppToken({ action, fetchImpl });
    if (token) return { token: String(token), auth_mode: "github_app_installation" };
  } catch (error) {
    throw brokerError(503, "runtime_breakglass_github_broker_unconfigured", "The server-side GitHub broker credential is unavailable or invalid.", { cause_code: error?.code || "github_broker_auth_failed" });
  }
  throw brokerError(503, "runtime_breakglass_github_broker_unconfigured", "The server-side GitHub broker credential is not configured.");
}

async function githubJson({ env = process.env, token, method = "GET", apiPath, body = undefined, fetchImpl = fetch } = {}) {
  const url = `${githubApiBase(env)}${apiPath}`;
  const response = await fetchImpl(url, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mad4b-runtime-breakglass-broker",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text().catch(() => "");
  let parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = {}; }
  if (!response.ok) {
    throw brokerError(503, "runtime_breakglass_github_request_failed", "The governed GitHub broker request failed.", { upstream_status: response.status, upstream_code: safeText(parsed?.message || "", 120) });
  }
  return parsed;
}

function expectedRunName(request) {
  const workflow = canonicalWorkflow();
  return `${workflow.run_name_prefix}${request.correlation_id || "unknown"}-${request.expected_sha || "unknown"}`;
}

function runMatchesRequest(run, request, dispatchStartedAt) {
  const created = Date.parse(String(run?.created_at || ""));
  const runName = String(run?.run_name || run?.display_title || "");
  const exactRunName = request.correlation_id && request.expected_sha
    ? runName === expectedRunName(request)
    : false;
  return String(run?.path || "") === canonicalWorkflow().file
    && String(run?.event || "") === "workflow_dispatch"
    && String(run?.head_branch || "") === canonicalWorkflow().dispatch_ref
    && (!request.expected_sha || String(run?.head_sha || "").toLowerCase() === String(dispatchStartedAt.main_sha || "").toLowerCase())
    && (exactRunName || (Number.isFinite(created) && created >= dispatchStartedAt.startedAt - 5_000 && !request.correlation_id));
}

async function readMainAndProductionHeads({ env, token, fetchImpl } = {}) {
  const [mainRef, productionRef] = await Promise.all([
    githubJson({ env, token, apiPath: `/repos/${canonicalRepository()}/git/ref/heads/main`, fetchImpl }),
    githubJson({ env, token, apiPath: `/repos/${canonicalRepository()}/git/ref/heads/Production`, fetchImpl }),
  ]);
  const mainSha = safeText(mainRef?.object?.sha, 64).toLowerCase();
  const productionSha = safeText(productionRef?.object?.sha, 64).toLowerCase();
  if (!SHA_RE.test(mainSha) || !SHA_RE.test(productionSha)) throw brokerError(503, "runtime_breakglass_branch_readback_invalid", "GitHub branch head readback did not return exact SHAs.");
  return { main_sha: mainSha, production_sha: productionSha };
}

async function discoverWorkflowRun({ env, token, request, dispatchStartedAt, fetchImpl } = {}) {
  const workflowFile = encodeURIComponent(canonicalWorkflow().file);
  const result = await githubJson({
    env,
    token,
    apiPath: `/repos/${canonicalRepository()}/actions/workflows/${workflowFile}/runs?event=workflow_dispatch&per_page=20`,
    fetchImpl,
  });
  const runs = Array.isArray(result?.workflow_runs) ? result.workflow_runs : [];
  const candidates = runs.filter((run) => runMatchesRequest(run, request, dispatchStartedAt));
  if (candidates.length !== 1) return { proven: false, run_id: null, candidate_count: candidates.length };
  const run = candidates[0];
  return { proven: true, run_id: String(run.id), candidate_count: 1, run };
}

async function dispatchWorkflowAndDiscover({ env = process.env, request, fetchImpl = fetch, getAppToken = getGitHubAppInstallationToken, poll = true } = {}) {
  const { token, auth_mode } = await resolveGitHubToken({ env, fetchImpl, getAppToken });
  const heads = await readMainAndProductionHeads({ env, token, fetchImpl });
  if (heads.production_sha !== request.expected_sha) {
    throw brokerError(412, "runtime_breakglass_production_sha_mismatch", "expected_sha does not match the current Production branch head.", { expected_sha: request.expected_sha, production_head_available: true, workflow_dispatch_performed: false });
  }
  const dispatchStartedAt = { startedAt: Date.now(), main_sha: heads.main_sha };
  const existing = request.correlation_id
    ? await discoverWorkflowRun({
      env,
      token,
      request,
      dispatchStartedAt: { startedAt: 0, main_sha: heads.main_sha },
      fetchImpl,
    })
    : { proven: false, run_id: null, candidate_count: 0 };
  if (existing.proven) {
    return {
      workflow_dispatch_performed: false,
      idempotent_reuse: true,
      workflow: canonicalWorkflow().file,
      dispatch_ref: canonicalWorkflow().dispatch_ref,
      broker_auth_mode: auth_mode,
      correlation_id: request.correlation_id,
      run_discovery: {
        proven: true,
        run_id: existing.run_id,
        candidate_count: existing.candidate_count,
        bounded_polling_performed: false,
      },
      source_heads: {
        dispatch_main_sha: heads.main_sha,
        production_sha_verified: heads.production_sha,
      },
      request: {
        environment: request.environment,
        contract_key: request.contract_key,
        mode: request.mode,
        expected_sha: request.expected_sha,
        expected_branch: request.expected_branch,
        target_key: request.target_key,
        target_source: request.target_source,
        migration: request.migration,
      },
      database_connection_performed: false,
      database_mutation_performed: false,
      migration_apply_performed: false,
      grant_mutation_performed: false,
      readback_required: true,
      secrets_included: false,
    };
  }
  const payload = workflowInputPayload(request);
  await githubJson({
    env,
    token,
    method: "POST",
    apiPath: `/repos/${canonicalRepository()}/actions/workflows/${encodeURIComponent(canonicalWorkflow().file)}/dispatches`,
    body: payload,
    fetchImpl,
  });
  let discovery = { proven: false, run_id: null, candidate_count: 0 };
  if (poll) {
    for (const delay of [250, 750, 1500, 3000, 5000]) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      discovery = await discoverWorkflowRun({ env, token, request, dispatchStartedAt, fetchImpl });
      if (discovery.proven) break;
    }
  }
  return {
    workflow_dispatch_performed: true,
    workflow: canonicalWorkflow().file,
    dispatch_ref: canonicalWorkflow().dispatch_ref,
    broker_auth_mode: auth_mode,
    correlation_id: request.correlation_id,
    run_discovery: {
      proven: discovery.proven,
      run_id: discovery.run_id,
      candidate_count: discovery.candidate_count,
      bounded_polling_performed: poll,
    },
    source_heads: {
      dispatch_main_sha: heads.main_sha,
      production_sha_verified: heads.production_sha,
    },
    request: {
      environment: request.environment,
      contract_key: request.contract_key,
      mode: request.mode,
      expected_sha: request.expected_sha,
      expected_branch: request.expected_branch,
      target_key: request.target_key,
      target_source: request.target_source,
      migration: request.migration,
    },
    database_connection_performed: false,
    database_mutation_performed: false,
    migration_apply_performed: false,
    grant_mutation_performed: false,
    readback_required: true,
    secrets_included: false,
  };
}

async function readWorkflowRun({ env = process.env, runId, expectedSha = null, correlationId = null, fetchImpl = fetch, getAppToken = getGitHubAppInstallationToken } = {}) {
  const normalizedRunId = normalizeRunId(runId);
  const normalizedExpectedSha = expectedSha ? normalizeSha(expectedSha, { required: true }) : null;
  const normalizedCorrelationId = correlationId ? normalizeId(correlationId, "correlation_id") : null;
  const { token, auth_mode } = await resolveGitHubToken({ env, fetchImpl, getAppToken });
  const run = await githubJson({ env, token, apiPath: `/repos/${canonicalRepository()}/actions/runs/${normalizedRunId}`, fetchImpl });
  const workflow = canonicalWorkflow();
  const runName = String(run?.run_name || run?.display_title || "");
  const exactRunName = normalizedExpectedSha && normalizedCorrelationId
    ? `${workflow.run_name_prefix}${normalizedCorrelationId}-${normalizedExpectedSha}`
    : null;
  const verified = String(run?.path || "") === workflow.file
    && String(run?.event || "") === "workflow_dispatch"
    && String(run?.head_branch || "") === workflow.dispatch_ref
    && (!normalizedExpectedSha || Boolean(exactRunName && runName === exactRunName));
  if (!verified) throw brokerError(409, "runtime_breakglass_workflow_identity_mismatch", "The requested workflow run is outside the fixed Breakglass workflow identity or exact request binding.", { run_id: normalizedRunId, workflow_identity_verified: false, exact_request_binding_verified: false });
  const artifacts = await githubJson({ env, token, apiPath: `/repos/${canonicalRepository()}/actions/runs/${normalizedRunId}/artifacts?per_page=100`, fetchImpl });
  const artifactItems = Array.isArray(artifacts?.artifacts) ? artifacts.artifacts : [];
  if (exactRunName && runName !== exactRunName) {
    throw brokerError(409, "runtime_breakglass_correlation_mismatch", "The workflow run does not match the supplied correlation id and expected SHA.", { run_id: normalizedRunId });
  }
  return {
    ok: true,
    contract: "mad4b.runtime-breakglass-run-readback.v1",
    run_id: normalizedRunId,
    repository: canonicalRepository(),
    workflow: workflow.file,
    dispatch_ref: workflow.dispatch_ref,
    status: safeText(run?.status, 32) || null,
    conclusion: safeText(run?.conclusion, 32) || null,
    created_at: safeText(run?.created_at, 40) || null,
    updated_at: safeText(run?.updated_at, 40) || null,
    head_sha: SHA_RE.test(String(run?.head_sha || "")) ? String(run.head_sha).toLowerCase() : null,
    expected_sha: normalizedExpectedSha,
    correlation_id: normalizedCorrelationId,
    expected_run_name: exactRunName,
    workflow_identity_verified: true,
    exact_request_binding_verified: Boolean(exactRunName),
    exact_sha_binding_source: exactRunName ? "workflow_run_name" : null,
    artifacts: artifactItems.slice(0, 50).map((artifact) => ({
      name: safeText(artifact?.name, 160),
      expired: artifact?.expired === true,
      size_in_bytes: Number.isFinite(Number(artifact?.size_in_bytes)) ? Number(artifact.size_in_bytes) : null,
    })),
    bounded_evidence_only: true,
    raw_logs_read: false,
    secrets_included: false,
    broker_auth_mode: auth_mode,
  };
}

export function getRuntimeBreakglassCatalogStatus(env = process.env) {
  const catalog = readCatalog();
  const runtimeStatus = getRuntimeBootstrapStatus(env);
  return {
    ok: true,
    contract: "mad4b.runtime-breakglass-catalog-status.v1",
    repository: catalog.repository,
    workflow: {
      file: catalog.workflow.file,
      dispatch_ref: catalog.workflow.dispatch_ref,
      production_branch: catalog.workflow.production_branch,
      production_environment: catalog.workflow.production_environment,
    },
    environments: Object.fromEntries(Object.entries(catalog.environments).map(([key, entry]) => [key, safeEnvironmentSummary(key, entry)])),
    contracts: catalog.contracts.map((entry) => ({
      key: entry.key,
      kind: entry.kind,
      environments: [...(entry.environments || [])],
      allowed_modes: [...(entry.allowed_modes || [])],
      target_sources: entry.production_apply_target_source ? [entry.production_apply_target_source, ...(entry.runtime_env_allowed_modes ? ["runtime_env"] : [])] : ["docker_local"],
      mutation_allowed: entry.mutation_allowed,
      requires_database_classification: entry.requires_database_classification || null,
      apply_policy: entry.apply_policy || null,
      requires_readback: entry.requires_readback === true,
    })),
    runtime_bootstrap: runtimeStatus,
    github_broker: gitHubBrokerStatus(env),
    safety: { ...catalog.safety },
    database_connection_performed: false,
    database_mutation_performed: false,
    workflow_dispatch_performed: false,
    secrets_included: false,
  };
}

export function buildRuntimeBreakglassPlan(input = {}, { env = process.env } = {}) {
  const request = buildNormalizedRequest(input);
  const catalog = readCatalog();
  if (request.environment === "staging") return buildStagingPlan(request);
  return {
    ok: true,
    contract: "mad4b.runtime-breakglass-plan.v1",
    environment: request.environment,
    contract_key: request.contract_key,
    mode: request.mode,
    status: "plan_only",
    execution_authority: "github_workflow_broker",
    deployment: safeEnvironmentSummary(request.environment, catalog.environments[request.environment]),
    workflow: {
      file: catalog.workflow.file,
      dispatch_ref: catalog.workflow.dispatch_ref,
      target_branch: catalog.workflow.production_branch,
      environment: catalog.workflow.production_environment,
      request_ref_accepted: false,
    },
    source_binding: {
      expected_sha: request.expected_sha,
      expected_branch: request.expected_branch,
      exact_sha_required: request.mode !== "plan",
    },
    target: {
      target_key: request.target_key,
      target_source: request.target_source,
      database_identifier_supplied_by_caller: false,
      raw_values_exposed: false,
    },
    rebuild_policy: {
      empty_database_only: request.contract_key === "empty_database_rebuild",
      full_nonempty_replacement: false,
      destructive_apply_route: false,
      baseline_contract: request.contract.baseline_contract_ref || null,
    },
    workflow_dispatch_performed: false,
    database_connection_performed: false,
    database_mutation_performed: false,
    migration_apply_performed: false,
    grant_mutation_performed: false,
    readback_required: true,
    secrets_included: false,
    github_broker: gitHubBrokerStatus(env),
  };
}

export async function createRuntimeBreakglassRun(input = {}, { env = process.env, fetchImpl = fetch, getAppToken = getGitHubAppInstallationToken, poll = true } = {}) {
  const request = buildNormalizedRequest(input);
  if (request.mode === "plan") return buildRuntimeBreakglassPlan(input, { env });
  if (request.environment === "staging") return {
    ...buildStagingPlan(request),
    status: "local_operator_required",
    error: { code: "breakglass_staging_local_operator_required", message: "Staging runs are bound to the local Windows/Docker operator and are not dispatched by the Production GitHub broker." },
  };
  const result = await dispatchWorkflowAndDiscover({ env, request, fetchImpl, getAppToken, poll });
  return {
    ok: true,
    contract: "mad4b.runtime-breakglass-run.v1",
    status: result.run_discovery.proven ? "queued" : "dispatched_run_id_unproven",
    ...result,
  };
}

export async function getRuntimeBreakglassRun(input = {}, { env = process.env, fetchImpl = fetch, getAppToken = getGitHubAppInstallationToken } = {}) {
  return readWorkflowRun({
    env,
    runId: input.run_id,
    expectedSha: input.expected_sha || null,
    correlationId: input.correlation_id || null,
    fetchImpl,
    getAppToken,
  });
}

export const _testingRuntimeBreakglass = {
  readCatalog,
  readRecoveryRoutes,
  normalizeMigration,
  normalizeTargetSource,
  ensureNoForbiddenRequestFields,
  buildNormalizedRequest,
  buildStagingPlan,
  workflowInputPayload,
  runMatchesRequest,
  expectedRunName,
  gitHubBrokerStatus,
  resolveGitHubToken,
  normalizeRunId,
};
