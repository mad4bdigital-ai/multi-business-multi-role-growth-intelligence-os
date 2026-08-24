import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { getGitHubAppInstallationToken } from "./githubAppAuth.js";
import { readRuntimeBootstrapContract } from "./runtimeBootstrapContract.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.join(HERE, "config", "host-breakglass-catalog.json");
const TOOL_CONTRACT_PATH = path.join(HERE, "config", "host-breakglass-tool-contracts.json");
const MIGRATIONS_PATH = path.join(HERE, "migrations");
const SHARED_MIGRATION_POLICY_PATH = path.join(HERE, "config", "staging-migration-contract-policy.json");
const SHA_RE = /^[0-9a-f]{40}$/u;
const SAFE_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/u;
const CAPSULE_SHA_RE = /^[0-9a-f]{64}$/u;
const CAPSULE_PATH_RE = /^\.github\/breakglass\/(sql\/[A-Za-z0-9._-]+\.sql|shell\/[A-Za-z0-9._-]+\.sh)$/u;
const BACKUP_EVIDENCE_PATH_RE = /^\.github\/breakglass\/evidence\/[A-Za-z0-9._-]+\.json$/u;
const RUNS = new Map();
const MIGRATION_DISCOVERY_CACHE = new Map();

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

function stableFileHash(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function validateRepositoryBackupEvidence(relativePath, { expectedSha, targetKey }) {
  const absolute = path.resolve(HERE, "..", relativePath);
  const repositoryRoot = path.resolve(HERE, "..");
  if (!absolute.startsWith(`${repositoryRoot}${path.sep}`) || !fs.existsSync(absolute)) fail(400, "host_breakglass_backup_evidence_missing", "Repository backup evidence is missing.");
  const evidence = JSON.parse(fs.readFileSync(absolute, "utf8"));
  if (evidence?.contract !== "mad4b.host-breakglass-backup-evidence.v1" || evidence?.environment !== "production" || evidence?.status !== "verified" || evidence?.source_sha !== expectedSha || evidence?.target_key !== targetKey || evidence?.restore_test?.status !== "pass" || evidence?.secrets_included !== false || Date.parse(evidence?.expires_at || 0) <= Date.now()) fail(400, "host_breakglass_backup_evidence_not_ready", "Backup evidence is expired or not bound to this exact SHA and target.");
  return stableHash(evidence);
}

export function readHostBreakglassCatalog(catalogPath = CATALOG_PATH) {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  if (catalog?.contract !== "mad4b.host-breakglass-catalog.v1" || catalog?.database_independent !== true) {
    fail(500, "host_breakglass_catalog_invalid", "Host Breakglass catalog is invalid.");
  }
  return catalog;
}

export function publicHostBreakglassCatalog(catalog = readHostBreakglassCatalog()) {
  const toolContract = readHostBreakglassToolContract();
  const bootstrapContract = readRuntimeBootstrapContract();
  return { ...catalog, tool_contract: publicToolContract(toolContract), migration_catalog: migrationGovernanceEvidence(catalog, bootstrapContract), catalog_sha256: stableHash(catalog), secrets_included: false };
}

export function readHostBreakglassToolContract(contractPath = TOOL_CONTRACT_PATH) {
  const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  if (contract?.contract !== "mad4b.host-breakglass-tool-contracts.v1" || contract?.database_independent !== true || contract?.default_policy !== "deny") {
    fail(500, "host_breakglass_tool_contract_invalid", "Host Breakglass tool contract is invalid.");
  }
  return contract;
}

function publicToolContract(contract) {
  return { ...contract, contract_sha256: stableHash(contract), secrets_included: false };
}

function resolveToolChain({ operation, action, input, toolContract }) {
  const requested = String(input.runbook_key || operation.allowed_runbooks?.[0] || "").trim();
  if (!operation.allowed_runbooks?.includes(requested)) {
    fail(403, "host_breakglass_runbook_denied", "Runbook is not allowed for this operation.", { runbook_key: requested, operation_key: operation.key });
  }
  const runbook = toolContract.runbooks?.[requested];
  if (!runbook || runbook.operation !== operation.key) fail(500, "host_breakglass_runbook_invalid", "Runbook contract is invalid.");
  const toolChain = runbook.tools.filter((key) => toolContract.tools?.[key]?.actions?.includes(action));
  if (!toolChain.includes("catalog.resolve") || !toolChain.includes("authority.validate")) fail(500, "host_breakglass_tool_chain_invalid", "Tool chain does not contain mandatory authority gates.");
  for (const key of toolChain) if (!toolContract.tools[key]) fail(500, "host_breakglass_tool_unknown", "Runbook references an unknown tool.", { tool_key: key });
  for (const key of toolChain) {
    const environments = toolContract.tools[key].environments;
    if (environments && !environments.includes(input.environment_key || "production_hostinger_autodeploy")) fail(403, "host_breakglass_tool_environment_denied", "Tool is unavailable in the selected environment.", { tool_key: key });
  }
  const requiredMutationTool = action === "apply_migration" ? "migration_contract.apply" : action === "apply_grants" ? "grant_contract.apply" : action === "execute_sql_capsule" ? "raw_sql.execute_exception" : action === "execute_shell_capsule" ? "shell.execute_exception" : null;
  if (requiredMutationTool && !toolChain.includes(requiredMutationTool)) {
    fail(403, "host_breakglass_runbook_action_denied", "Runbook does not grant the mutation capability required by this action.", { runbook_key: requested, action, required_tool: requiredMutationTool });
  }
  return { runbookKey: requested, toolChain };
}

function migrationFiles(contract) {
  return new Set(Object.keys(contract?.migrations || {}));
}

function migrationGovernanceEvidence(catalog, bootstrapContract, environmentKey = null) {
  const governance = catalog.migration_governance;
  if (!governance || governance.discovery_grants_execution !== false || governance.production_auto_apply_allowed !== false || governance.silent_ledger_reconciliation_allowed !== false) {
    fail(500, "host_breakglass_migration_governance_invalid", "Migration discovery must remain separate from execution authority and silent reconciliation.");
  }
  const files = fs.readdirSync(MIGRATIONS_PATH).filter((file) => /^\d[^/\\]*\.sql$/u.test(file)).sort((left, right) => Number(left.match(/^\d+/u)?.[0] || 0) - Number(right.match(/^\d+/u)?.[0] || 0) || left.localeCompare(right));
  const cacheKey = `${environmentKey || "all"}:${stableHash(bootstrapContract.migrations || {})}:${files.join("|")}`;
  const cached = MIGRATION_DISCOVERY_CACHE.get(cacheKey);
  if (cached) return cached;
  const digest = createHash("sha256");
  for (const file of files) digest.update(`${file}:${stableFileHash(path.join(MIGRATIONS_PATH, file))}\n`);
  const allowlisted = Object.entries(bootstrapContract.migrations || {});
  const applyEligible = allowlisted.filter(([, rule]) => Array.isArray(rule.allowed_modes) && rule.allowed_modes.includes("apply_migration"));
  let sharedPolicy = { available: false, compatible: false };
  if (fs.existsSync(SHARED_MIGRATION_POLICY_PATH)) {
    const policy = JSON.parse(fs.readFileSync(SHARED_MIGRATION_POLICY_PATH, "utf8"));
    sharedPolicy = {
      available: true,
      compatible: policy.execution_authority?.discovery_grants_execution === false && policy.execution_authority?.production_auto_apply_allowed === false,
      environment_profile_declared: environmentKey ? Boolean(policy.environment_profiles?.[environmentKey]) : null,
      sha256: stableFileHash(SHARED_MIGRATION_POLICY_PATH)
    };
    if (!sharedPolicy.compatible || (environmentKey && !sharedPolicy.environment_profile_declared)) fail(500, "host_breakglass_shared_migration_policy_invalid", "Shared migration policy does not isolate discovery, environment, and execution authority.");
  }
  const evidence = {
    contract: governance.contract,
    environment_key: environmentKey,
    discovered_migration_count: files.length,
    execution_allowlist_count: allowlisted.length,
    execution_eligible_count: applyEligible.length,
    migration_catalog_sha256: digest.digest("hex"),
    discovery_grants_execution: false,
    production_auto_apply_allowed: false,
    shared_policy: sharedPolicy,
    required_database_roles: Object.entries(catalog.database_role_topology || {}).filter(([, role]) => role.required === true).map(([role]) => role).sort(),
    missing_rebuild_role_executors: Object.entries(catalog.database_role_topology || {}).filter(([, role]) => role.required === true && role.rebuild_executor_available !== true).map(([role]) => role).sort(),
    secrets_included: false
  };
  MIGRATION_DISCOVERY_CACHE.set(cacheKey, evidence);
  return evidence;
}

export function buildHostBreakglassPlan(input = {}, { catalog = readHostBreakglassCatalog(), bootstrapContract = readRuntimeBootstrapContract(), toolContract = readHostBreakglassToolContract() } = {}) {
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
  const { runbookKey, toolChain } = resolveToolChain({ operation, action, input, toolContract });
  if (!SHA_RE.test(expectedSha)) fail(400, "host_breakglass_expected_sha_invalid", "expected_sha must be a lowercase 40-character SHA.");
  if (!SAFE_ID_RE.test(targetKey)) fail(400, "host_breakglass_target_key_invalid", "target_key is invalid.");
  if (!targetKey.startsWith(environment.target_key_prefix || `${environment.environment}-`)) fail(403, "host_breakglass_environment_target_mismatch", "Target key does not belong to the selected environment.", { environment_key: environmentKey, target_key: targetKey });
  const governanceEvidence = migrationGovernanceEvidence(catalog, bootstrapContract, environmentKey);
  const migration = String(input.migration || "").trim();
  if (["dry_run", "apply_migration"].includes(action) && !migrationFiles(bootstrapContract).has(migration)) {
    fail(400, "host_breakglass_migration_not_cataloged", "Migration is not present in the repository-owned bootstrap contract.", { migration });
  }
  if (targetSource === "runtime_env" && !["plan", "dry_run"].includes(action)) {
    fail(403, "host_breakglass_runtime_env_mutation_denied", "runtime_env is restricted to plan and dry_run.");
  }
  const confirmation = String(input.confirmation || "").trim();
  const capsulePath = String(input.capsule_path || "").trim();
  const capsuleSha256 = String(input.capsule_sha256 || "").trim().toLowerCase();
  const capsuleAction = ["execute_sql_capsule", "execute_shell_capsule"].includes(action);
  if (capsuleAction && (!CAPSULE_PATH_RE.test(capsulePath) || !CAPSULE_SHA_RE.test(capsuleSha256))) fail(400, "host_breakglass_capsule_invalid", "A repository-owned capsule_path and lowercase capsule_sha256 are required.");
  if (action === "execute_sql_capsule" && !capsulePath.startsWith(".github/breakglass/sql/")) fail(400, "host_breakglass_capsule_type_invalid", "SQL action requires an SQL capsule.");
  if (action === "execute_shell_capsule" && !capsulePath.startsWith(".github/breakglass/shell/")) fail(400, "host_breakglass_capsule_type_invalid", "Shell action requires a shell capsule.");
  if (capsuleAction) {
    const capsuleAbsolute = path.resolve(HERE, "..", capsulePath);
    const repositoryRoot = path.resolve(HERE, "..");
    if (!capsuleAbsolute.startsWith(`${repositoryRoot}${path.sep}`) || !fs.existsSync(capsuleAbsolute) || stableFileHash(capsuleAbsolute) !== capsuleSha256) fail(400, "host_breakglass_capsule_hash_mismatch", "Repository capsule is absent or does not match capsule_sha256.");
  }
  const backupEvidencePath = String(input.backup_evidence_path || "").trim();
  if (capsuleAction && environmentKey === "production_hostinger_autodeploy" && !BACKUP_EVIDENCE_PATH_RE.test(backupEvidencePath)) fail(400, "host_breakglass_backup_evidence_required", "Production command capsule requires repository-owned backup evidence.");
  const backupEvidenceSha256 = capsuleAction && environmentKey === "production_hostinger_autodeploy" ? validateRepositoryBackupEvidence(backupEvidencePath, { expectedSha, targetKey }) : null;
  const confirmationRequired = operation.requires_confirmation === true && !["plan", "dry_run"].includes(action);
  const expectedConfirmation = action === "apply_migration"
    ? `APPLY_HOSTINGER_RUNTIME_MIGRATION:${expectedSha}:${targetKey}:${migration}`
    : "";
  const grantsConfirmationValid = action === "apply_grants"
    && new RegExp(`^APPLY_HOSTINGER_RUNTIME_GRANTS:${expectedSha}:${targetKey}:[A-Za-z0-9_$.-]{1,128}:[A-Za-z0-9._%:-]{1,255}$`, "u").test(confirmation);
  const capsuleConfirmation = `EXECUTE_HOST_BREAKGLASS_CAPSULE:${environmentKey}:${expectedSha}:${capsuleSha256}`;
  const capsuleConfirmationValid = capsuleAction && confirmation === capsuleConfirmation;
  if (confirmationRequired && ((action === "apply_migration" && confirmation !== expectedConfirmation) || (action === "apply_grants" && !grantsConfirmationValid) || (capsuleAction && !capsuleConfirmationValid))) {
    fail(400, "host_breakglass_confirmation_required", "Exact typed confirmation is required.", { confirmation_formula: action === "apply_migration" ? "APPLY_HOSTINGER_RUNTIME_MIGRATION:<sha>:<target-key>:<migration-file>" : "APPLY_HOSTINGER_RUNTIME_GRANTS:<sha>:<target-key>:<principal>:<principal-host>" });
  }
  const correlationId = String(input.correlation_id || input.idempotency_key || randomUUID()).trim();
  if (!SAFE_ID_RE.test(correlationId)) fail(400, "host_breakglass_correlation_invalid", "correlation_id is invalid.");
  const plan = {
    contract: "mad4b.host-breakglass-plan.v1",
    operation_key: operationKey,
    runbook_key: runbookKey,
    capability_grants: toolChain,
    denied_capabilities: [...toolContract.denied_capabilities],
    tool_contract_sha256: stableHash(toolContract),
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
    migration_governance: governanceEvidence,
    database_role_topology: catalog.database_role_topology,
    migration: migration || null,
    capsule_path: capsulePath || null,
    capsule_sha256: capsuleSha256 || null,
    backup_evidence_path: backupEvidencePath || null,
    backup_evidence_sha256: backupEvidenceSha256,
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
    host_breakglass_runbook: plan.runbook_key,
    host_breakglass_tool_contract_sha256: plan.tool_contract_sha256,
    host_breakglass_capsule: plan.capsule_path ? JSON.stringify({ path: plan.capsule_path, sha256: plan.capsule_sha256, confirmation: plan.confirmation, backup_evidence_path: plan.backup_evidence_path }) : "",
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
  const [owner, repo] = catalog.repository.split("/");
  const token = await tokenResolver({ action: {}, fetchImpl });
  const result = await githubRequest({ token, pathname: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(catalog.workflow)}/runs?event=workflow_dispatch&branch=${encodeURIComponent(catalog.dispatch_ref)}&per_page=20`, fetchImpl });
  const durableTitle = `Host Breakglass ${correlationId}`;
  const candidates = (result.payload?.workflow_runs || []).filter((item) => item?.head_branch === catalog.dispatch_ref && String(item.display_title || "") === durableTitle && (!receipt || (!receipt.prior_run_ids.includes(String(item.id)) && Date.parse(item.created_at || 0) >= Date.parse(receipt.dispatched_at))));
  if (!receipt && candidates.length === 0) return { ok: false, contract: "mad4b.host-breakglass-run-status.v1", correlation_id: correlationId, status: "not_found", durable_github_readback: true, secrets_included: false };
  if (candidates.length > 1) return { ok: false, contract: "mad4b.host-breakglass-run-status.v1", correlation_id: correlationId, status: "correlation_ambiguous", candidate_count: candidates.length, secrets_included: false };
  const run = candidates.length === 1 ? candidates.pop() : null;
  return { ok: true, contract: "mad4b.host-breakglass-run-status.v1", correlation_id: correlationId, dispatch_status: receipt?.status || "recovered_from_github", workflow_run_id: run?.id ? String(run.id) : null, status: run?.status || "queued", conclusion: run?.conclusion || null, durable_github_readback: true, secrets_included: false };
}

export const __hostBreakglassTest = { RUNS, MIGRATION_DISCOVERY_CACHE };
