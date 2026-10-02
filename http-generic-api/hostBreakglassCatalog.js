import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { getGitHubAppInstallationToken } from "./githubAppAuth.js";
import { readRuntimeBootstrapContract } from "./runtimeBootstrapContract.js";
import { executeHostLocalRoleInspection } from "./hostLocalRuntimeInspection.js";
import { canonicalizeRoleSelection, computeRoleSelectionProofHash } from "./roleSelectionProof.js";

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

function reconstructionPreviewEvidence(bootstrapContract, databaseRoleTopology, selectedRoles = null) {
  const baseline = bootstrapContract?.baseline_bundle || {};
  const migrationCatalog = Object.entries(bootstrapContract?.migrations || {}).map(([file, spec]) => ({ file, sha256: String(spec?.sha256 || "").toLowerCase(), statement_count: Number(spec?.statement_count || 0), role: spec?.role || null, allowed_modes: Array.isArray(spec?.allowed_modes) ? [...spec.allowed_modes] : [] }));
  const migrationSequence = migrationCatalog.filter((entry) => entry.allowed_modes.includes("apply_migration"));
  const candidateRoles = Object.entries(databaseRoleTopology || {}).filter(([, config]) => config?.required === true).map(([role]) => role);
  const roles = (Array.isArray(selectedRoles) && selectedRoles.length ? selectedRoles : candidateRoles).map((role) => reconstructionRoleEvidence(role, baseline));
  return {
    zero_object_proof_required: true,
    zero_object_proof_roles: roles.map((entry) => entry.role),
    selected_roles: Array.isArray(selectedRoles) ? [...selectedRoles] : [],
    selection_pending_inspection: !(Array.isArray(selectedRoles) && selectedRoles.length),
    zero_object_kinds: ["tables", "views", "triggers", "routines", "events"],
    baseline_bundle: {
      manifest_contract: baseline.manifest_contract || null,
      manifest_path: baseline.default_manifest_path || null,
      schema_only_required: baseline.schema_only_required === true,
      roles,
    },
    execution_order: ["full_inspection_durable_record", "selected_zero_object_role_recheck", "selected_role_bundle_baseline", "selected_role_seeds", "selected_role_postconditions", "next_selected_role_or_stop", "separate_least_privilege_grants_approval", "behavioral_probes"],
    migration_catalog: migrationCatalog,
    migration_sequence: migrationSequence,
    seed_set_by_role: Object.fromEntries(Object.entries(baseline.role_seed_files || {}).map(([role, entries]) => [role, (Array.isArray(entries) ? entries : []).map((entry) => ({ file: entry.file || null, sha256: String(entry.sha256 || "").toLowerCase(), statement_count: Number(entry.statement_count || 0) }))])),
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

function buildRunbookExecutionGraph({ runbookKey, action, toolChain, databaseRoleTopology, bootstrapContract, selectedRoles = null }) {
  if (runbookKey !== "database.empty_rebuild") return null;
  const mutating = action === "apply_migration";
  const preview = reconstructionPreviewEvidence(bootstrapContract, databaseRoleTopology, selectedRoles);
  const graphRoles = Array.isArray(selectedRoles) && selectedRoles.length
    ? selectedRoles
    : Object.keys(databaseRoleTopology).filter((role) => databaseRoleTopology[role]?.required === true);
  const steps = [
    { key: "target.classify", mutation: false, zero_table_required: true, zero_object_required: true, object_kinds: ["tables", "views", "triggers", "routines", "events"], readback_required: true },
    { key: "schema_bundle.inspect", mutation: false, exact_sha_required: true },
    ...graphRoles.map((role) => ({
      key: `schema_bundle.rebuild_empty.${role}`,
      role,
      mutation: mutating,
      executor_available: databaseRoleTopology[role]?.rebuild_executor_available === true,
      bundle_file: preview.baseline_bundle.roles.find((entry) => entry.role === role)?.bundle_file || null,
      required_tables: preview.baseline_bundle.roles.find((entry) => entry.role === role)?.required_tables || [],
      zero_table_required: true,
      zero_object_required: true,
      object_kinds: ["tables", "views", "triggers", "routines", "events"],
      same_cycle_readback_required: true,
      selected_role_only: Array.isArray(selectedRoles) && selectedRoles.length > 0,
    })),
    { key: "migration_contract.apply", mutation: false, execution_included: false, repository_owned: true, baseline_first_required: true },
    { key: "canonical_seeds.apply", mutation: mutating, repository_owned: true, selected_role_only: true },
    { key: "grant_contract.apply", mutation: true, execution_included: false, separate_runbook: "database.access_repair", separate_approval_required: true },
    { key: "database.postconditions.read", mutation: false, same_cycle_readback_required: true },
    { key: "ledger.readback", mutation: false, same_cycle_readback_required: true },
  ];
  if (mutating && (!toolChain.includes("schema_bundle.rebuild_empty") || (selectedRoles || []).includes("runtime_persistence") && !toolChain.includes("schema_bundle.rebuild_runtime_persistence"))) {
    fail(403, "host_breakglass_runbook_execution_denied", "Runbook graph does not grant the repository-owned selected-role reconstruction capability.");
  }
  if (mutating && steps.some((step) => step.executor_available === false)) {
    fail(409, "host_breakglass_runbook_executor_missing", "A required database role has no reconstruction executor.");
  }
  const graph = { contract: "mad4b.host-breakglass-runbook-graph.v1", runbook_key: runbookKey, execution_mode: mutating ? "apply_runbook" : "inspect_runbook", grants_included: false, arbitrary_sql_allowed: false, destructive_nonempty_rebuild_allowed: false, partial_role_rebuild_allowed: true, sequential_role_execution: true, stop_on_role_verification_failure: true, ...preview, steps };
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
  const requiredMutationTool = action === "apply_migration"
    ? operation.key === "database.rebuild_empty" ? "schema_bundle.rebuild_empty" : "migration_contract.apply"
    : action === "apply_grants" ? "grant_contract.apply" : action === "execute_sql_capsule" ? "raw_sql.execute_exception" : action === "execute_shell_capsule" ? "shell.execute_exception" : null;
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

export function buildHostBreakglassPlan(input = {}, { catalog = readHostBreakglassCatalog(), bootstrapContract = readRuntimeBootstrapContract(), toolContract = readHostBreakglassToolContract(), proofResolver = null } = {}) {
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
  const callerRoleSelectionProof = input.role_selection_proof && typeof input.role_selection_proof === "object" ? input.role_selection_proof : null;
  let roleSelectionProof = callerRoleSelectionProof;
  const allowedRoles = ["runtime", "governance", "runtime_persistence"];
  let rawSelectedRoles = Array.isArray(roleSelectionProof?.selected_roles) ? [...new Set(roleSelectionProof.selected_roles.map((role) => String(role).trim().toLowerCase()))] : [];
  if (rawSelectedRoles.some((role) => !allowedRoles.includes(role))) fail(400, "host_breakglass_role_selection_invalid", "Role selection proof contains an unregistered role.", { allowed_roles: allowedRoles });
  let selectedRoles = canonicalizeRoleSelection(rawSelectedRoles);
  const roleSelectiveApply = operationKey === "database.rebuild_empty" && action === "apply_migration";
  if (roleSelectiveApply) {
    if (typeof proofResolver !== "function") fail(503, "host_breakglass_role_selection_provenance_unavailable", "Role-selective apply requires a server-resolved durable inspection proof; caller-supplied proof is never authoritative.");
    const resolvedProof = proofResolver({ expected_sha: expectedSha, target_key: targetKey, operation_key: operationKey });
    if (resolvedProof && typeof resolvedProof.then === "function") fail(500, "host_breakglass_role_selection_resolver_async", "The synchronous plan builder requires a pre-resolved durable proof reference.");
    if (!resolvedProof || typeof resolvedProof !== "object" || resolvedProof.source !== "durable_full_inspection") fail(503, "host_breakglass_role_selection_provenance_unavailable", "No durable full-inspection proof was resolved for this exact target.");
    const resolvedRoles = canonicalizeRoleSelection(resolvedProof.selected_roles);
    const resolvedHash = computeRoleSelectionProofHash({ ...resolvedProof, selected_roles: resolvedRoles });
    if (resolvedProof.selection_hash && String(resolvedProof.selection_hash).toLowerCase() !== resolvedHash) fail(409, "host_breakglass_role_selection_hash_invalid", "Resolved role-selection proof hash is not canonical.");
    if (callerRoleSelectionProof) {
      const callerHash = computeRoleSelectionProofHash({ ...callerRoleSelectionProof, selected_roles: canonicalizeRoleSelection(callerRoleSelectionProof.selected_roles) });
      if (callerHash !== resolvedHash) fail(409, "host_breakglass_role_selection_provenance_mismatch", "Caller-supplied role proof does not match the durable server-resolved proof.");
    }
    roleSelectionProof = { ...resolvedProof, selected_roles: resolvedRoles, selection_hash: resolvedHash };
    rawSelectedRoles = resolvedRoles;
    selectedRoles = resolvedRoles;
    if (!roleSelectionProof.inspection_run_id || !roleSelectionProof.inspection_evidence_hash || !roleSelectionProof.composite_target_fingerprint || !Array.isArray(roleSelectionProof.finding_ids) || roleSelectionProof.finding_ids.length === 0 || !selectedRoles.length) fail(400, "host_breakglass_role_selection_proof_required", "Role-selective rebuild apply requires a bounded durable full-inspection proof, finding IDs, and selected zero-object roles.");
    if (String(roleSelectionProof.expected_sha || "").toLowerCase() !== expectedSha) fail(409, "host_breakglass_role_selection_sha_mismatch", "Role selection proof is bound to a different exact source SHA.");
    if (!CAPSULE_SHA_RE.test(String(roleSelectionProof.inspection_evidence_hash).toLowerCase()) || !CAPSULE_SHA_RE.test(String(roleSelectionProof.composite_target_fingerprint).toLowerCase())) fail(400, "host_breakglass_role_selection_proof_invalid", "Role selection proof hashes must be full SHA-256 values.");
    for (const role of selectedRoles) if (!CAPSULE_SHA_RE.test(String(roleSelectionProof.role_object_count_fingerprints?.[role] || "").toLowerCase())) fail(400, "host_breakglass_role_selection_fingerprint_invalid", "Every selected role requires a full object-count fingerprint.", { role });
    if (roleSelectionProof.finding_ids.some((id) => !/^finding:[0-9a-f]{16,64}$/u.test(String(id)))) fail(400, "host_breakglass_role_selection_finding_invalid", "Role selection proof finding IDs must be bounded durable finding references.");
  }
  const { runbookKey, toolChain } = resolveToolChain({ operation, action, input, toolContract });
  if (!SHA_RE.test(expectedSha)) fail(400, "host_breakglass_expected_sha_invalid", "expected_sha must be a lowercase 40-character SHA.");
  if (!SAFE_ID_RE.test(targetKey)) fail(400, "host_breakglass_target_key_invalid", "target_key is invalid.");
  if (!targetKey.startsWith(environment.target_key_prefix || `${environment.environment}-`)) fail(403, "host_breakglass_environment_target_mismatch", "Target key does not belong to the selected environment.", { environment_key: environmentKey, target_key: targetKey });
  const governanceEvidence = migrationGovernanceEvidence(catalog, bootstrapContract, environmentKey);
  const executionGraph = buildRunbookExecutionGraph({ runbookKey, action, toolChain, databaseRoleTopology: catalog.database_role_topology || {}, bootstrapContract, selectedRoles: selectedRoles.length ? selectedRoles : null });
  const migration = String(input.migration || "").trim();
  const migrationOptional = (operationKey === "database.inspect" && runbookKey === "database.full_inspection" && action === "dry_run")
    || (operationKey === "database.repair" && runbookKey === "database.access_repair" && action !== "apply_migration")
    || (operationKey === "database.rebuild_empty" && runbookKey === "database.empty_rebuild" && !migration);
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
  const grantBindingHash = String(input.grant_binding_hash || "").trim().toLowerCase();
  const migrationPrefix = targetSource === "staging_local_role_env" ? environment.apply_migration_confirmation_prefix : "APPLY_HOSTINGER_RUNTIME_MIGRATION";
  const grantsPrefix = targetSource === "staging_local_role_env" ? environment.apply_grants_confirmation_prefix : "APPLY_HOSTINGER_RUNTIME_GRANTS";
  const rebuildConfirmationPrefix = targetSource === "staging_local_role_env" ? environment.rebuild_confirmation_prefix : "APPLY_HOSTINGER_RUNTIME_BASELINE_REBUILD";
  const expectedConfirmation = action === "apply_migration"
    ? operationKey === "database.rebuild_empty" && !migration
      ? `${rebuildConfirmationPrefix}:${expectedSha}:${targetKey}:${selectedRoles.join(",")}`
      : `${migrationPrefix}:${expectedSha}:${targetKey}:${migration}`
    : "";
  const grantsConfirmationValid = action === "apply_grants"
    && confirmation === `${grantsPrefix}:${expectedSha}:${targetKey}:${grantBindingHash}`;
  const capsuleConfirmation = `EXECUTE_HOST_BREAKGLASS_CAPSULE:${environmentKey}:${expectedSha}:${capsuleSha256}`;
  const capsuleConfirmationValid = capsuleAction && confirmation === capsuleConfirmation;
  if (confirmationRequired && ((action === "apply_migration" && confirmation !== expectedConfirmation) || (action === "apply_grants" && !grantsConfirmationValid) || (capsuleAction && !capsuleConfirmationValid))) {
    const confirmationFormula = action === "apply_migration" && operationKey === "database.rebuild_empty" && !migration
      ? `${rebuildConfirmationPrefix}:<sha>:<target-key>:<selected-roles>`
      : action === "apply_migration" ? `${migrationPrefix}:<sha>:<target-key>:<migration-file>` : `${grantsPrefix}:<sha>:<target-key>:<grant-binding-hash>`;
    fail(400, "host_breakglass_confirmation_required", "Exact environment-bound typed confirmation is required.", { confirmation_formula: confirmationFormula });
  }
  const executionTicketId = String(input.execution_ticket_id || "").trim();
  const executionTicketHash = String(input.execution_ticket_hash || "").trim().toLowerCase();
  if (executionTicketId && !SAFE_ID_RE.test(executionTicketId)) fail(400, "host_breakglass_execution_ticket_invalid", "execution_ticket_id is invalid.");
  if (executionTicketHash && !CAPSULE_SHA_RE.test(executionTicketHash)) fail(400, "host_breakglass_execution_ticket_hash_invalid", "execution_ticket_hash must be a full SHA-256 value.");
  if (!["plan", "dry_run"].includes(action) && (!executionTicketId || !executionTicketHash)) fail(503, "host_breakglass_execution_ticket_required", "Every Host Breakglass mutation requires a server-issued execution ticket ID and hash reference.");
  if (action === "apply_grants" && !CAPSULE_SHA_RE.test(grantBindingHash)) fail(503, "host_breakglass_grant_binding_hash_required", "Grant repair requires a canonical hash binding every role database, principal, host, table set, and operation set.");
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
    execution_authority: environment.admin_execution_authority || environment.execution_authority || null,
    control_plane_host: environment.admin_surface_host || null,
    local_connector_status: environment.local_connector_status || catalog.production_reconstruction_authority?.local_connector?.status || null,
    local_connector_required: environment.local_connector_required === true,
    local_connector_fallback_allowed: environment.local_connector_fallback_allowed === true,
    repository: catalog.repository,
    dispatch_ref: environment.dispatch_ref || null,
    target_branch: environment.source_branch,
    workflow: environment.execution_transport === "github_workflow" ? catalog.workflow : null,
    target_source: targetSource,
    execution_ticket_id: executionTicketId || null,
    execution_ticket_hash: executionTicketHash || null,
    grant_binding_hash: grantBindingHash || null,
    target_key: targetKey,
    migration_governance: governanceEvidence,
    database_role_topology: catalog.database_role_topology,
    runbook_execution_graph: executionGraph,
    migration: migration || null,
    migration_selected: Boolean(migration),
    migration_selection: migration ? "explicit" : migrationOptional ? (operationKey === "database.rebuild_empty" ? "inspection_derived_role_selection" : "full_inspection_catalog") : "required",
    selected_rebuild_roles: selectedRoles,
    role_selection_proof: roleSelectionProof ? { source: String(roleSelectionProof.source || ""), inspection_run_id: String(roleSelectionProof.inspection_run_id || ""), inspection_evidence_hash: String(roleSelectionProof.inspection_evidence_hash || "").toLowerCase(), expected_sha: String(roleSelectionProof.expected_sha || expectedSha).toLowerCase(), finding_ids: Array.isArray(roleSelectionProof.finding_ids) ? roleSelectionProof.finding_ids.map((id) => String(id)) : [], selected_roles: selectedRoles, role_object_count_fingerprints: roleSelectionProof.role_object_count_fingerprints && typeof roleSelectionProof.role_object_count_fingerprints === "object" ? Object.fromEntries(selectedRoles.map((role) => [role, String(roleSelectionProof.role_object_count_fingerprints[role] || "").toLowerCase()])) : {}, composite_target_fingerprint: String(roleSelectionProof.composite_target_fingerprint || "").toLowerCase(), selection_hash: computeRoleSelectionProofHash({ ...roleSelectionProof, selected_roles: selectedRoles }), secrets_included: false } : null,
    capsule_path: capsulePath || null,
    capsule_sha256: capsuleSha256 || null,
    backup_evidence_path: backupEvidencePath || null,
    backup_evidence_sha256: backupEvidenceSha256,
    confirmation: confirmation || null,
    correlation_id: correlationId,
    requires_zero_table_database: operation.requires_zero_table_database === true,
    requires_zero_object_database: operation.requires_zero_object_database === true,
    requires_zero_object_proof_for_all_roles: false,
    role_selection_required: operationKey === "database.rebuild_empty",
    sequential_role_execution: operationKey === "database.rebuild_empty",
    stop_on_role_verification_failure: operationKey === "database.rebuild_empty",
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
  return `runtime-breakglass-${plan.correlation_id}-${plan.expected_sha}`;
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

export async function dispatchHostBreakglassPlan(plan, { env = process.env, fetchImpl = fetch, tokenResolver = getGitHubAppInstallationToken, hostLocalExecutor = executeHostLocalRoleInspection, hostLocalMutationExecutor = null } = {}) {
  if (plan.environment_key === "production_hostinger_autodeploy" && (plan.execution_authority !== "existing_admin_governed_execution" || plan.local_connector_required || plan.local_connector_fallback_allowed)) {
    fail(403, "host_breakglass_production_admin_authority_invalid", "Production reconstruction requires the existing Admin governed execution path and cannot depend on or fall back to the Local Connector.");
  }
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
        execution_authority: plan.execution_authority,
        control_plane_host: plan.control_plane_host,
        local_connector_status: plan.local_connector_status,
        local_connector_required: plan.local_connector_required,
        local_connector_fallback_allowed: plan.local_connector_fallback_allowed,
        workflow_dispatch_performed: false,
        database_mutation_performed: false,
        migration_apply_performed: false,
        grant_mutation_performed: false,
        secrets_included: false,
      };
    }
    if (["apply_migration", "apply_grants", "execute_sql_capsule", "execute_shell_capsule"].includes(plan.action)) {
      if (!plan.execution_ticket_id || !plan.execution_ticket_hash) fail(503, "host_breakglass_execution_ticket_required", "Host-local mutation requires a server-issued execution ticket ID and hash reference.");
      if (typeof hostLocalMutationExecutor !== "function") fail(503, "host_breakglass_host_local_mutation_executor_unavailable", "No governed Hostinger role-specific mutation executor is configured; no database operation was attempted.");
      const execution = await hostLocalMutationExecutor({ execution_ticket_id: plan.execution_ticket_id, execution_ticket_hash: plan.execution_ticket_hash, plan_hash: plan.plan_sha256, expected_sha: plan.expected_sha, target_key: plan.target_key, operation_key: plan.operation_key, runbook_key: plan.runbook_key, action: plan.action, migration: plan.migration, selected_roles: Array.isArray(plan.selected_rebuild_roles) ? [...plan.selected_rebuild_roles] : [], role_selection_proof_hash: plan.role_selection_proof?.selection_hash || null, grant_binding_hash: plan.grant_binding_hash || null, correlation_id: plan.correlation_id }, { env });
      return { ok: execution?.ok !== false, contract: "mad4b.host-breakglass-host-local-mutation-receipt.v1", correlation_id: plan.correlation_id, plan_sha256: plan.plan_sha256, status: execution?.status || "host_local_mutation_submitted", environment_key: plan.environment_key, target_source: plan.target_source, role_credential_source: "existing_hostinger_environment", execution_authority: plan.execution_authority, control_plane_host: plan.control_plane_host, execution_ticket_id: plan.execution_ticket_id,
        execution_ticket_hash: plan.execution_ticket_hash,
        selected_rebuild_roles: Array.isArray(plan.selected_rebuild_roles) ? plan.selected_rebuild_roles : [], role_selection_proof_hash: plan.role_selection_proof?.selection_hash || null, grant_binding_hash: plan.grant_binding_hash || null, workflow_dispatch_performed: false, database_mutation_performed: execution?.database_mutation_performed === true, migration_apply_performed: execution?.migration_apply_performed === true, grant_mutation_performed: execution?.grant_mutation_performed === true, readback_required: true, secrets_included: false };
    }
    return { ok: true, contract: "mad4.host-breakglass-host-local-handoff.v1", correlation_id: plan.correlation_id, plan_sha256: plan.plan_sha256, status: "host_local_execution_required", environment_key: plan.environment_key, target_source: plan.target_source, role_credential_source: "existing_hostinger_environment", execution_authority: plan.execution_authority, control_plane_host: plan.control_plane_host, local_connector_status: plan.local_connector_status, local_connector_required: plan.local_connector_required, local_connector_fallback_allowed: plan.local_connector_fallback_allowed, selected_rebuild_roles: Array.isArray(plan.selected_rebuild_roles) ? plan.selected_rebuild_roles : [], role_selection_proof_hash: plan.role_selection_proof?.selection_hash || null, separate_typed_confirmation_required: plan.action === "apply_migration" || plan.action === "apply_grants", github_secrets_required: false, workflow_dispatch_performed: false, database_mutation_performed: false, secrets_included: false };
  }
  if (plan.execution_transport !== "github_workflow" || plan.environment_key !== "production_hostinger_autodeploy") {
    return { ok: true, contract: "mad4b.host-breakglass-local-handoff.v1", correlation_id: plan.correlation_id, plan_sha256: plan.plan_sha256, status: "local_execution_required", environment_key: plan.environment_key, required_platform: "win32", required_runtime: "docker_compose", command: "npm run host-breakglass:local -- --request-file <verified-request.json>", workflow_dispatch_performed: false, database_mutation_performed: false, secrets_included: false };
  }
  if (plan.target_source === "host_local_role_env") fail(403, "host_breakglass_host_local_github_workflow_denied", "host_local_role_env cannot be downgraded into a GitHub workflow source.");
  const targetSourceMap = Object.freeze({ runtime_env: "hostinger_runtime_env", repository_allowlist: "repository_allowlist" });
  const bootstrapTargetSource = targetSourceMap[plan.target_source];
  if (!bootstrapTargetSource) fail(403, "host_breakglass_target_source_mapping_denied", "Unknown or unsupported target source cannot be dispatched to GitHub.");
  const existing = RUNS.get(plan.correlation_id);
  if (existing && existing.plan_sha256 !== plan.plan_sha256) fail(409, "host_breakglass_idempotency_conflict", "correlation_id is already bound to a different plan.");
  const [owner, repo] = plan.repository.split("/");
  const { token, auth_mode } = await resolveHostBreakglassToken({ env, fetchImpl, tokenResolver });
  const prior = await githubRequest({ token, pathname: workflowRunsPath(plan), fetchImpl });
  const matchingRuns = matchingHostBreakglassRuns(prior.payload, plan);
  if (matchingRuns.length > 1) fail(409, "host_breakglass_idempotency_ambiguous", "More than one exact GitHub workflow run matches this correlation and plan.", { candidate_count: matchingRuns.length });
  if (matchingRuns.length === 1) {
    const run = matchingRuns[0];
    const receipt = { ok: true, contract: "mad4b.host-breakglass-dispatch-receipt.v1", correlation_id: plan.correlation_id, plan_sha256: plan.plan_sha256, status: "reused", workflow_run_id: String(run.id), execution_authority: plan.execution_authority, control_plane_host: plan.control_plane_host, local_connector_status: plan.local_connector_status, local_connector_required: plan.local_connector_required, local_connector_fallback_allowed: plan.local_connector_fallback_allowed, workflow_dispatch_performed: false, idempotent_reuse: true, replayed: true, durable_github_readback: true, broker_auth_mode: auth_mode, database_mutation_performed: false, secrets_included: false };
    RUNS.set(plan.correlation_id, receipt);
    return receipt;
  }
  const dispatchedAt = new Date().toISOString();
  await githubRequest({ token, method: "POST", pathname: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(plan.workflow)}/dispatches`, fetchImpl, body: { ref: plan.dispatch_ref, inputs: {
    breakglass_correlation_id: plan.correlation_id,
    expected_sha: plan.expected_sha,
    bootstrap_mode: plan.action,
    bootstrap_target_key: plan.target_key,
    bootstrap_target_source: bootstrapTargetSource,
    bootstrap_migration: plan.migration || (plan.operation_key === "database.rebuild_empty" ? "" : "20260815_custom_gpt_mcp_catalog_levels.sql"),
    bootstrap_migration_confirmation: plan.action === "apply_migration" && plan.operation_key !== "database.rebuild_empty" ? plan.confirmation || "" : "",
    bootstrap_rebuild_confirmation: plan.action === "apply_migration" && plan.operation_key === "database.rebuild_empty" ? plan.confirmation || "" : "",
    bootstrap_role_selection: Array.isArray(plan.selected_rebuild_roles) ? plan.selected_rebuild_roles.join(",") : "",
    bootstrap_inspection_run_id: plan.role_selection_proof?.inspection_run_id || "",
    bootstrap_role_selection_hash: plan.role_selection_proof?.selection_hash || "",
    bootstrap_role_object_count_fingerprints: plan.role_selection_proof ? JSON.stringify({ source: plan.role_selection_proof.source, expected_sha: plan.role_selection_proof.expected_sha, inspection_evidence_hash: plan.role_selection_proof.inspection_evidence_hash, finding_ids: plan.role_selection_proof.finding_ids, role_object_count_fingerprints: plan.role_selection_proof.role_object_count_fingerprints, composite_target_fingerprint: plan.role_selection_proof.composite_target_fingerprint }) : "",
    bootstrap_grants_confirmation: plan.action === "apply_grants" ? plan.confirmation || "" : "",
    bootstrap_grant_binding_hash: plan.grant_binding_hash || "",
    bootstrap_execution_ticket_id: plan.execution_ticket_id || "",
    bootstrap_execution_ticket_hash: plan.execution_ticket_hash || "",
    recovery_envelope: JSON.stringify({
      contract: "mad4b.host-breakglass-recovery-envelope.v1",
      host_breakglass: {
        operation: plan.operation_key,
        runbook: plan.runbook_key,
        tool_contract_sha256: plan.tool_contract_sha256,
        capsule_json: plan.capsule_path ? JSON.stringify({ path: plan.capsule_path, sha256: plan.capsule_sha256, confirmation: plan.confirmation, backup_evidence_path: plan.backup_evidence_path }) : "",
        correlation_id: plan.correlation_id,
        plan_sha256: plan.plan_sha256,
      },
      secrets_included: false,
    }),
  } } });
  const receipt = { ok: true, contract: "mad4b.host-breakglass-dispatch-receipt.v1", correlation_id: plan.correlation_id, plan_sha256: plan.plan_sha256, status: "dispatched", workflow_run_id: null, execution_authority: plan.execution_authority, control_plane_host: plan.control_plane_host, local_connector_status: plan.local_connector_status, local_connector_required: plan.local_connector_required, local_connector_fallback_allowed: plan.local_connector_fallback_allowed, workflow_dispatch_performed: true, broker_auth_mode: auth_mode, database_mutation_performed: false, dispatched_at: dispatchedAt, secrets_included: false };
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
  return { ok: true, contract: "mad4b.host-breakglass-run-status.v1", correlation_id: correlationId, plan_sha256: receipt?.plan_sha256 || null, dispatch_status: receipt?.status || "recovered_from_github", workflow_run_id: run?.id ? String(run.id) : null, status: run?.status || "queued", conclusion: run?.conclusion || null, durable_github_readback: true, broker_auth_mode: auth_mode, secrets_included: false };
}

export const __hostBreakglassTest = { RUNS, MIGRATION_DISCOVERY_CACHE };