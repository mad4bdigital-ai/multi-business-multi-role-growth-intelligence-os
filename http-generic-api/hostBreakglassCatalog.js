import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { getGitHubAppInstallationToken } from "./githubAppAuth.js";
import { readRuntimeBootstrapContract } from "./runtimeBootstrapContract.js";
import { executeHostLocalRoleInspection } from "./hostLocalRuntimeInspection.js";

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

function reconstructionRoleEvidence(role, baseline = {}) {
  const roleConfig = {
    runtime: { bundle_file: baseline.runtime_role_file, required_tables: baseline.required_runtime_tables },
    governance: { bundle_file: baseline.governance_role_file, required_tables: baseline.required_governance_tables },
    runtime_persistence: { bundle_file: baseline.runtime_persistence_role_file, required_tables: baseline.required_runtime_persistence_tables },
  }[role];
  return roleConfig ? { role, bundle_file: roleConfig.bundle_file || null, required_tables: Array.isArray(roleConfig.required_tables) ? [...roleConfig.required_tables] : [], object_kinds: ["tables", "views", "triggers", "routines", "events"] } : { role, bundle_file: null, required_tables: [], object_kinds: ["tables", "views", "triggers", "routines", "events"] };
}

function reconstructionPreviewEvidence(bootstrapContract, databaseRoleTopology) {
  const baseline = bootstrapContract?.baseline_bundle || {};
  const migrationCatalog = Object.entries(bootstrapContract?.migrations || {}).map(([file, spec]) => ({ file, sha256: String(spec?.sha256 || "").toLowerCase(), statement_count: Number(spec?.statement_count || 0), role: spec?.role || null, allowed_modes: Array.isArray(spec?.allowed_modes) ? [...spec.allowed_modes] : [] }));
  const migrationSequence = migrationCatalog.filter((entry) => entry.allowed_modes.includes("apply_migration"));
  const roles = Object.entries(databaseRoleTopology || {}).filter(([, config]) => config?.required === true).map(([role]) => reconstructionRoleEvidence(role, baseline));
  return {
    zero_object_proof_required: true,
    zero_object_proof_roles: roles.map((entry) => entry.role),
    zero_object_kinds: ["tables", "views", "triggers", "routines", "events"],
    baseline_bundle: {
      manifest_contract: baseline.manifest_contract || null,
      manifest_path: baseline.default_manifest_path || null,
      schema_only_required: baseline.schema_only_required === true,
      roles,
    },
    execution_order: ["zero_object_proof", "role_bundle_baseline", "allowlisted_migration_sequence", "canonical_seeds", "separate_least_privilege_grants_approval", "same_cycle_postconditions", "behavioral_probes"],
    migration_catalog: migrationCatalog,
    migration_sequence: migrationSequence,
    seed_set: (Array.isArray(baseline.required_seed_files) ? baseline.required_seed_files : []).map((entry) => ({ file: entry.file || null, sha256: String(entry.sha256 || "").toLowerCase(), statement_count: Number(entry.statement_count || 0) })),
    grant_manifest: {
      tables: Array.isArray(bootstrapContract?.grant_policy?.required_tables) ? [...bootstrapContract.grant_policy.required_tables] : [],
      operations: Array.isArray(bootstrapContract?.grant_policy?.required_operations) ? [...bootstrapContract.grant_policy.required_operations] : [],
      separate_approval_required: true,
      grant_option_allowed: bootstrapContract?.grant_policy?.allow_grant_option === true,
    },
    postcondition_migration_keys: Object.keys(bootstrapContract?.postconditions || {}).sort(),
    behavioral_probes: (Array.isArray(baseline.behavioral_probes) ? baseline.behavioral_probes : []).map((probe) => ({ ...probe, execution_status: "declared_not_executed_in_preview", provider_accessed: false, runtime_mutation_performed: false, secrets_included: false })),
  };
}

function buildRunbookExecutionGraph({ runbookKey, action, toolChain, databaseRoleTopology, bootstrapContract }) {
  if (runbookKey !== "database.empty_rebuild") return null;
  const mutating = action === "apply_migration";
  const preview = reconstructionPreviewEvidence(bootstrapContract, databaseRoleTopology);
  const steps = [
    { key: "target.classify", mutation: false, zero_table_required: true, zero_object_required: true, object_kinds: ["tables", "views", "triggers", "routines", "events"], readback_required: true },
    { key: "schema_bundle.inspect", mutation: false, exact_sha_required: true },
    ...Object.keys(databaseRoleTopology).filter((role) => databaseRoleTopology[role]?.required === true).map((role) => ({
      key: `schema_bundle.rebuild_empty.${role}`,
      role,
      mutation: mutating,
      executor_available: databaseRoleTopology[role]?.rebuild_executor_available === true,
      bundle_file: preview.baseline_bundle.roles.find((entry) => entry.role === role)?.bundle_file || null,
      required_tables: preview.baseline_bundle.roles.find((entry) => entry.role === role)?.required_tables || [],
      zero_table_required: true,
      zero_object_required: true,
      object_kinds: ["tables", "views", "triggers", "routines", "events"],
      same_cycle_readback_required: role === "runtime_persistence",
    })),
    { key: "migration_contract.apply", mutation: mutating, execution_allowlist_required: true },
    { key: "canonical_seeds.apply", mutation: mutating, repository_owned: true },
    { key: "grant_contract.apply", mutation: true, execution_included: false, separate_runbook: "database.access_repair", separate_approval_required: true },
    { key: "database.postconditions.read", mutation: false, same_cycle_readback_required: true },
    { key: "ledger.readback", mutation: false, same_cycle_readback_required: true },
  ];
  if (mutating && (!toolChain.includes("schema_bundle.rebuild_empty") || !toolChain.includes("schema_bundle.rebuild_runtime_persistence") || !toolChain.includes("migration_contract.apply"))) {
    fail(403, "host_breakglass_runbook_execution_denied", "Runbook graph does not grant both repository-owned reconstruction and migration capabilities.");
  }
  if (mutating && steps.some((step) => step.executor_available === false)) {
    fail(409, "host_breakglass_runbook_executor_missing", "A required database role has no reconstruction executor.");
  }
  const graph = { contract: "mad4b.host-breakglass-runbook-graph.v1", runbook_key: runbookKey, execution_mode: mutating ? "apply_runbook" : "inspect_runbook", grants_included: false, arbitrary_sql_allowed: false, destructive_nonempty_rebuild_allowed: false, partial_role_rebuild_allowed: false, ...preview, steps };
  return { ...graph, graph_sha256: stableHash(graph) };
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
  const discoveryIdentity = `${environmentKey || "all"}:${stableHash(bootstrapContract.migrations || {})}:${files.join("|")}`;
  const cached = MIGRATION_DISCOVERY_CACHE.get(discoveryIdentity);
  if (cached) return cached;
  const digest = createHash("sha256");
  for (const file of files) digest.update(`${file}:${stableFileHash(path.join(MIGRATIONS_PATH, file))}\n`);
  const allowlisted = Object.entries(bootstrapContract.migrations || {});
  const applyEligible = allowlisted.filter(([, rule]) => Array.isArray(rule.allowed_modes) && rule.allowed_modes.includes("apply_migration"));
  let foundationEvidence = { available: false, compatible: false };
  if (fs.existsSync(SHARED_MIGRATION_POLICY_PATH)) {
    const policy = JSON.parse(fs.readFileSync(SHARED_MIGRATION_POLICY_PATH, "utf8"));
    foundationEvidence = {
      available: true,
      compatible: policy.execution_authority?.discovery_grants_execution === false && policy.execution_authority?.production_auto_apply_allowed === false,
      environment_profile_declared: environmentKey ? Boolean(policy.environment_profiles?.[environmentKey]) : null,
      sha256: stableFileHash(SHARED_MIGRATION_POLICY_PATH)
    };
    if (!foundationEvidence.compatible || (environmentKey && !foundationEvidence.environment_profile_declared)) fail(500, "host_breakglass_shared_migration_policy_invalid", "Shared migration policy does not isolate discovery, environment, and execution authority.");
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
    shared_policy: foundationEvidence,
    required_database_roles: Object.entries(catalog.database_role_topology || {}).filter(([, role]) => role.required === true).map(([role]) => role).sort(),
    missing_rebuild_role_executors: Object.entries(catalog.database_role_topology || {}).filter(([, role]) => role.required === true && role.rebuild_executor_available !== true).map(([role]) => role).sort(),
    secrets_included: false
  };
  MIGRATION_DISCOVERY_CACHE.set(discoveryIdentity, evidence);
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
  if (targetSource === "host_local_role_env" && environmentKey !== "production_hostinger_autodeploy") {
    fail(403, "host_breakglass_role_source_environment_mismatch", "Hostinger role credentials cannot be used for Staging.", { environment_key: environmentKey });
  }
  if (targetSource === "staging_local_role_env" && environmentKey !== "staging_local_windows_docker") {
    fail(403, "host_breakglass_role_source_environment_mismatch", "Windows/Docker role credentials cannot be used for Production.", { environment_key: environmentKey });
  }
  const { runbookKey, toolChain } = resolveToolChain({ operation, action, input, toolContract });
  if (!SHA_RE.test(expectedSha)) fail(400, "host_breakglass_expected_sha_invalid", "expected_sha must be a lowercase 40-character SHA.");
  if (!SAFE_ID_RE.test(targetKey)) fail(400, "host_breakglass_target_key_invalid", "target_key is invalid.");
  if (!targetKey.startsWith(environment.target_key_prefix || `${environment.environment}-`)) fail(403, "host_breakglass_environment_target_mismatch", "Target key does not belong to the selected environment.", { environment_key: environmentKey, target_key: targetKey });
  const governanceEvidence = migrationGovernanceEvidence(catalog, bootstrapContract, environmentKey);
  const executionGraph = buildRunbookExecutionGraph({ runbookKey, action, toolChain, databaseRoleTopology: catalog.database_role_topology || {}, bootstrapContract });
  const migration = String(input.migration || "").trim();
  const migrationOptional = operationKey === "database.inspect" && runbookKey === "database.full_inspection" && action === "dry_run";
  if (["dry_run", "apply_migration"].includes(action) && !migrationOptional && !migrationFiles(bootstrapContract).has(migration)) {
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
  const migrationPrefix = targetSource === "staging_local_role_env" ? environment.apply_migration_confirmation_prefix : "APPLY_HOSTINGER_RUNTIME_MIGRATION";
  const grantsPrefix = targetSource === "staging_local_role_env" ? environment.apply_grants_confirmation_prefix : "APPLY_HOSTINGER_RUNTIME_GRANTS";
  const expectedConfirmation = action === "apply_migration"
    ? `${migrationPrefix}:${expectedSha}:${targetKey}:${migration}`
    : "";
  const grantsConfirmationValid = action === "apply_grants"
    && new RegExp(`^${grantsPrefix}:${expectedSha}:${targetKey}:[A-Za-z0-9_$.-]{1,128}:[A-Za-z0-9._%:-]{1,255}$`, "u").test(confirmation);
  const capsuleConfirmation = `EXECUTE_HOST_BREAKGLASS_CAPSULE:${environmentKey}:${expectedSha}:${capsuleSha256}`;
  const capsuleConfirmationValid = capsuleAction && confirmation === capsuleConfirmation;
  if (confirmationRequired && ((action === "apply_migration" && confirmation !== expectedConfirmation) || (action === "apply_grants" && !grantsConfirmationValid) || (capsuleAction && !capsuleConfirmationValid))) {
    fail(400, "host_breakglass_confirmation_required", "Exact environment-bound typed confirmation is required.", { confirmation_formula: action === "apply_migration" ? `${migrationPrefix}:<sha>:<target-key>:<migration-file>` : `${grantsPrefix}:<sha>:<target-key>:<principal>:<principal-host>` });
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
    runbook_execution_graph: executionGraph,
    migration: migration || null,
    migration_selected: Boolean(migration),
    migration_selection: migration ? "explicit" : migrationOptional ? "full_inspection_catalog" : "required",
    capsule_path: capsulePath || null,
    capsule_sha256: capsuleSha256 || null,
    backup_evidence_path: backupEvidencePath || null,
    backup_evidence_sha256: backupEvidenceSha256,
    confirmation: confirmation || null,
    correlation_id: correlationId,
    requires_zero_table_database: operation.requires_zero_table_database === true,
    requires_zero_object_database: operation.requires_zero_object_database === true,
    requires_zero_object_proof_for_all_roles: operation.requires_zero_object_proof_for_all_roles === true,
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

async function resolveHostBreakglassToken({ env = process.env, fetchImpl = fetch, tokenResolver = getGitHubAppInstallationToken } = {}) {
  const directToken = String(env.RUNTIME_BREAKGLASS_GITHUB_TOKEN || "").trim();
  if (directToken) return { token: directToken, auth_mode: "server_side_token" };
  try {
    const token = await tokenResolver({
      action: {
        github_app_id: env.RUNTIME_BREAKGLASS_GITHUB_APP_ID || env.GITHUB_APP_ID,
        github_app_installation_id: env.RUNTIME_BREAKGLASS_GITHUB_APP_INSTALLATION_ID || env.GITHUB_APP_INSTALLATION_ID,
        secret_store_ref: env.RUNTIME_BREAKGLASS_GITHUB_APP_PRIVATE_KEY_REF || "",
      },
      fetchImpl,
    });
    if (token) return { token: String(token), auth_mode: "github_app_installation" };
  } catch (error) {
    fail(503, "host_breakglass_github_broker_unconfigured", "The server-side GitHub broker credential is unavailable or invalid.", { cause_code: error?.code || "github_broker_auth_failed" });
  }
  fail(503, "host_breakglass_github_broker_unconfigured", "The server-side GitHub broker credential is not configured.");
}

function expectedHostBreakglassRunName(plan) {
  return `runtime-breakglass-${plan.correlation_id}-${plan.expected_sha}-${plan.plan_sha256}`;
}

function workflowRunsPath(plan) {
  const [owner, repo] = plan.repository.split("/");
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(plan.workflow)}/runs?event=workflow_dispatch&branch=${encodeURIComponent(plan.dispatch_ref)}&per_page=20`;
}

function matchingHostBreakglassRuns(payload, plan) {
  const expectedRunName = expectedHostBreakglassRunName(plan);
  return (payload?.workflow_runs || []).filter((item) =>
    String(item?.path || "") === String(plan.workflow || "")
      && String(item?.event || "") === "workflow_dispatch"
      && String(item?.head_branch || "") === String(plan.dispatch_ref || "")
      && String(item?.display_title || item?.run_name || "") === expectedRunName
  );
}

export async function dispatchHostBreakglassPlan(plan, { env = process.env, fetchImpl = fetch, tokenResolver = getGitHubAppInstallationToken, hostLocalExecutor = executeHostLocalRoleInspection } = {}) {
  if (plan.target_source === "host_local_role_env") {
    if (plan.environment_key !== "production_hostinger_autodeploy") fail(403, "host_breakglass_host_local_environment_denied", "Host-local role credentials are restricted to the Hostinger Production environment.");
    if (!["database.inspect", "database.repair", "database.rebuild_empty"].includes(plan.operation_key)) fail(403, "host_breakglass_host_local_operation_denied", "Host-local role credentials require a bounded database inspection or recovery runbook.");
    if (plan.action === "apply_grants" && plan.operation_key !== "database.repair") fail(403, "host_breakglass_host_local_grants_denied", "Host-local grants require the separately approved database access repair runbook.");
    if (plan.operation_key === "database.inspect" && plan.runbook_key === "database.full_inspection" && plan.action === "dry_run") {
      if (typeof hostLocalExecutor !== "function") fail(500, "host_breakglass_host_local_executor_unconfigured", "The Hostinger host-local inspection executor is unavailable.");
      const inspection = await hostLocalExecutor(plan, { env });
      return {
        ...inspection,
        ok: inspection?.ok !== false,
        contract: "mad4b.host-breakglass-host-local-inspection-receipt.v1",
        correlation_id: plan.correlation_id,
        plan_sha256: plan.plan_sha256,
        status: inspection?.status || "host_local_inspection_complete",
        environment_key: plan.environment_key,
        target_source: plan.target_source,
        role_credential_source: "existing_hostinger_environment",
        workflow_dispatch_performed: false,
        database_mutation_performed: false,
        migration_apply_performed: false,
        grant_mutation_performed: false,
        secrets_included: false,
      };
    }
    return { ok: true, contract: "mad4b.host-breakglass-host-local-handoff.v1", correlation_id: plan.correlation_id, plan_sha256: plan.plan_sha256, status: "host_local_execution_required", environment_key: plan.environment_key, target_source: plan.target_source, role_credential_source: "existing_hostinger_environment", command: "node scripts/hostinger-runtime-bootstrap.mjs --" + plan.action.replaceAll("_", "-") + " --host-local-role-credentials --operation " + plan.operation_key + " --env-file .env", separate_typed_confirmation_required: plan.action === "apply_migration" || plan.action === "apply_grants", github_secrets_required: false, workflow_dispatch_performed: false, database_mutation_performed: false, secrets_included: false };
  }
  if (plan.execution_transport !== "github_workflow" || plan.environment_key !== "production_hostinger_autodeploy") {
    return { ok: true, contract: "mad4b.host-breakglass-local-handoff.v1", correlation_id: plan.correlation_id, plan_sha256: plan.plan_sha256, status: "local_execution_required", environment_key: plan.environment_key, required_platform: "win32", required_runtime: "docker_compose", command: "npm run host-breakglass:local -- --request-file <verified-request.json>", workflow_dispatch_performed: false, database_mutation_performed: false, secrets_included: false };
  }
  const existing = RUNS.get(plan.correlation_id);
  if (existing && existing.plan_sha256 !== plan.plan_sha256) fail(409, "host_breakglass_idempotency_conflict", "correlation_id is already bound to a different plan.");
  const [owner, repo] = plan.repository.split("/");
  const { token, auth_mode } = await resolveHostBreakglassToken({ env, fetchImpl, tokenResolver });
  const prior = await githubRequest({ token, pathname: workflowRunsPath(plan), fetchImpl });
  const matchingRuns = matchingHostBreakglassRuns(prior.payload, plan);
  if (matchingRuns.length > 1) fail(409, "host_breakglass_idempotency_ambiguous", "More than one exact GitHub workflow run matches this correlation and plan.", { candidate_count: matchingRuns.length });
  if (matchingRuns.length === 1) {
    const run = matchingRuns[0];
    const receipt = { ok: true, contract: "mad4b.host-breakglass-dispatch-receipt.v1", correlation_id: plan.correlation_id, plan_sha256: plan.plan_sha256, status: "reused", workflow_run_id: String(run.id), workflow_dispatch_performed: false, idempotent_reuse: true, replayed: true, durable_github_readback: true, broker_auth_mode: auth_mode, database_mutation_performed: false, secrets_included: false };
    RUNS.set(plan.correlation_id, receipt);
    return receipt;
  }
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
    host_breakglass_correlation_id: plan.correlation_id,
    host_breakglass_plan_sha256: plan.plan_sha256
  } } });
  const receipt = { ok: true, contract: "mad4b.host-breakglass-dispatch-receipt.v1", correlation_id: plan.correlation_id, plan_sha256: plan.plan_sha256, status: "dispatched", workflow_run_id: null, workflow_dispatch_performed: true, broker_auth_mode: auth_mode, database_mutation_performed: false, dispatched_at: dispatchedAt, secrets_included: false };
  RUNS.set(plan.correlation_id, receipt);
  return receipt;
}

export async function readHostBreakglassRun(correlationId, { catalog = readHostBreakglassCatalog(), fetchImpl = fetch, env = process.env, tokenResolver = getGitHubAppInstallationToken } = {}) {
  if (!SAFE_ID_RE.test(String(correlationId || ""))) fail(400, "host_breakglass_correlation_invalid", "correlation_id is invalid.");
  const receipt = RUNS.get(correlationId);
  const [owner, repo] = catalog.repository.split("/");
  const { token, auth_mode } = await resolveHostBreakglassToken({ env, fetchImpl, tokenResolver });
  const result = await githubRequest({ token, pathname: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(catalog.workflow)}/runs?event=workflow_dispatch&branch=${encodeURIComponent(catalog.dispatch_ref)}&per_page=20`, fetchImpl });
  const durablePrefix = `runtime-breakglass-${correlationId}-`;
  const candidates = (result.payload?.workflow_runs || []).filter((item) => item?.head_branch === catalog.dispatch_ref && String(item?.event || "") === "workflow_dispatch" && String(item.display_title || item.run_name || "").startsWith(durablePrefix));
  if (candidates.length === 0) return { ok: false, contract: "mad4b.host-breakglass-run-status.v1", correlation_id: correlationId, status: "not_found", durable_github_readback: true, secrets_included: false };
  if (candidates.length > 1) return { ok: false, contract: "mad4b.host-breakglass-run-status.v1", correlation_id: correlationId, status: "correlation_ambiguous", candidate_count: candidates.length, secrets_included: false };
  // Zero and ambiguity cases returned above; destructuring preserves the proven-unique candidate without positional selection.
  const [run] = candidates;
  return { ok: true, contract: "mad4b.host-breakglass-run-status.v1", correlation_id: correlationId, plan_sha256: receipt?.plan_sha256 || String(run.display_title || run.run_name || "").split("-").pop() || null, dispatch_status: receipt?.status || "recovered_from_github", workflow_run_id: run?.id ? String(run.id) : null, status: run?.status || "queued", conclusion: run?.conclusion || null, durable_github_readback: true, broker_auth_mode: auth_mode, secrets_included: false };
}

export const __hostBreakglassTest = { RUNS, MIGRATION_DISCOVERY_CACHE };
