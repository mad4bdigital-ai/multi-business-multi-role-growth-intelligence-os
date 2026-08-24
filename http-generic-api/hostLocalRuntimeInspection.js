import path from "node:path";
import { fileURLToPath } from "node:url";
import { readDeploymentManifest } from "./deploymentManifest.js";
import {
  readRuntimeBootstrapContract,
  runBootstrap,
  sanitizeBootstrapError,
} from "./runtimeBootstrapContract.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const CANONICAL_REPOSITORY = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os";
const PRODUCTION_BRANCH = "Production";
const PRODUCTION_ENVIRONMENT_KEY = "production_hostinger_autodeploy";
const PRODUCTION_TARGET_KEY = "production-runtime";
const SHA_RE = /^[0-9a-f]{40}$/iu;
const REQUEST_KEYS = new Set(["expected_sha", "target_key"]);
const CONTROLLED_ENV_KEYS = [
  "BOOTSTRAP_MODE",
  "BOOTSTRAP_TARGET_SOURCE",
  "BOOTSTRAP_EXPECTED_SHA",
  "BOOTSTRAP_EXPECTED_BRANCH",
  "BOOTSTRAP_EXPECTED_REPOSITORY",
  "BOOTSTRAP_TARGET_KEY",
  "BOOTSTRAP_TARGET_DATABASE",
  "BOOTSTRAP_MIGRATION",
  "BOOTSTRAP_MIGRATION_CONFIRMATION",
  "BOOTSTRAP_GRANTS_CONFIRMATION",
  "BOOTSTRAP_SCHEMA_BUNDLE_MANIFEST",
  "HOST_BREAKGLASS_OPERATION",
  "HOST_BREAKGLASS_ENVIRONMENT_KEY",
  "HOST_BREAKGLASS_HOST_LOCAL_ROLE_CREDENTIALS",
  "BOOTSTRAP_HOST_LOCAL_ROLE_IDENTITY",
];

function safeText(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function adapterError(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.hostLocalAdapter = true;
  error.details = { ...details, secrets_included: false };
  return error;
}

function identityFromEnvironment(env = {}) {
  const manifestResult = readDeploymentManifest(env);
  const manifest = manifestResult.ok ? manifestResult.manifest : null;
  const commit = safeText(
    manifest?.commit_sha || env.GITHUB_SHA || env.DEPLOY_COMMIT || env.COMMIT_SHA || env.REVISION_SHA,
    64,
  ).toLowerCase() || null;
  const branch = safeText(
    manifest?.branch || env.GITHUB_REF_NAME || env.DEPLOY_BRANCH || env.BRANCH_NAME,
    64,
  ) || null;
  const repository = safeText(
    manifest?.repository || env.GITHUB_REPOSITORY || env.DEPLOY_REPOSITORY,
    160,
  ) || null;
  return {
    commit,
    branch,
    repository,
    source: manifest?.source || (manifestResult.ok ? "deployment_manifest" : "runtime_environment"),
  };
}

function identityAvailability(identity) {
  return {
    source: identity.source,
    commit_available: Boolean(identity.commit),
    branch_available: Boolean(identity.branch),
    repository_available: Boolean(identity.repository),
  };
}

function normalizeInspectionPlan(plan = {}) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw adapterError(400, "host_local_inspection_request_invalid", "Host-local inspection request must be an object.");
  }
  const environmentKey = safeText(plan.environment_key, 96);
  const operationKey = safeText(plan.operation_key, 96);
  const action = safeText(plan.action, 32).toLowerCase();
  const runbookKey = safeText(plan.runbook_key, 96);
  const targetSource = safeText(plan.target_source, 64).toLowerCase();
  const targetKey = safeText(plan.target_key || PRODUCTION_TARGET_KEY, 128);
  const expectedSha = safeText(plan.expected_sha, 64).toLowerCase();
  const migration = safeText(plan.migration, 191);
  if (environmentKey !== PRODUCTION_ENVIRONMENT_KEY) {
    throw adapterError(403, "host_local_inspection_environment_denied", "Host-local role inspection is restricted to the Hostinger Production environment.", { environment_key: environmentKey });
  }
  if (operationKey !== "database.inspect" || runbookKey !== "database.full_inspection") {
    throw adapterError(403, "host_local_inspection_operation_denied", "The host-local execution bridge only permits the full database inspection runbook.", { operation_key: operationKey, runbook_key: runbookKey });
  }
  if (action !== "dry_run") {
    throw adapterError(403, "host_local_inspection_mode_denied", "Host-local database inspection is restricted to dry_run.", { action });
  }
  if (targetSource !== "host_local_role_env") {
    throw adapterError(403, "host_local_inspection_source_denied", "The host-local execution bridge requires host_local_role_env.", { target_source: targetSource });
  }
  if (targetKey !== PRODUCTION_TARGET_KEY) {
    throw adapterError(409, "host_local_inspection_target_denied", "Host-local inspection is bound to the production-runtime target.", { target_key: targetKey });
  }
  if (!SHA_RE.test(expectedSha)) {
    throw adapterError(400, "host_local_inspection_expected_sha_invalid", "expected_sha must be a full 40-character SHA.");
  }
  if (migration) {
    throw adapterError(409, "host_local_inspection_migration_forbidden", "Full host-local inspection must omit migration selection.", { migration_selected: true });
  }
  return {
    environment_key: PRODUCTION_ENVIRONMENT_KEY,
    operation_key: "database.inspect",
    runbook_key: "database.full_inspection",
    action: "dry_run",
    expected_sha: expectedSha,
    expected_branch: PRODUCTION_BRANCH,
    expected_repository: CANONICAL_REPOSITORY,
    target_key: PRODUCTION_TARGET_KEY,
    target_source: "host_local_role_env",
    migration: null,
  };
}

function assertRequestShape(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw adapterError(400, "host_local_inspection_request_invalid", "Host-local inspection request must be a JSON object.");
  }
  const unexpected = Object.keys(input).filter((key) => !REQUEST_KEYS.has(String(key).trim().toLowerCase()));
  if (unexpected.length) {
    throw adapterError(400, "host_local_inspection_request_field_forbidden", "Only expected_sha and target_key are accepted; credentials, database identifiers, repository, and workflow controls are server-controlled.", { fields: unexpected });
  }
  return normalizeInspectionPlan({
    environment_key: PRODUCTION_ENVIRONMENT_KEY,
    operation_key: "database.inspect",
    runbook_key: "database.full_inspection",
    action: "dry_run",
    expected_sha: input.expected_sha,
    target_key: input.target_key || PRODUCTION_TARGET_KEY,
    target_source: "host_local_role_env",
    migration: null,
  });
}

function buildBootstrapEnvironment(plan, env = process.env) {
  const bootstrapEnv = { ...env };
  for (const key of CONTROLLED_ENV_KEYS) delete bootstrapEnv[key];
  return {
    ...bootstrapEnv,
    BOOTSTRAP_MODE: "dry_run",
    BOOTSTRAP_TARGET_SOURCE: "host_local_role_env",
    BOOTSTRAP_EXPECTED_SHA: plan.expected_sha,
    BOOTSTRAP_EXPECTED_BRANCH: PRODUCTION_BRANCH,
    BOOTSTRAP_EXPECTED_REPOSITORY: CANONICAL_REPOSITORY,
    BOOTSTRAP_TARGET_KEY: PRODUCTION_TARGET_KEY,
    HOST_BREAKGLASS_OPERATION: "database.inspect",
    HOST_BREAKGLASS_ENVIRONMENT_KEY: PRODUCTION_ENVIRONMENT_KEY,
    HOST_BREAKGLASS_HOST_LOCAL_ROLE_CREDENTIALS: "true",
    BOOTSTRAP_HOST_LOCAL_ROLE_IDENTITY: "true",
  };
}

function assertRuntimeIdentity(identity, plan) {
  if (!identity.commit || !identity.branch || !identity.repository) {
    throw adapterError(412, "host_local_runtime_identity_unavailable", "The running Hostinger deployment identity is incomplete; database inspection was not attempted.", identityAvailability(identity));
  }
  if (!SHA_RE.test(identity.commit) || identity.commit.toLowerCase() !== plan.expected_sha) {
    throw adapterError(412, "host_local_runtime_sha_mismatch", "The running deployment SHA does not match the requested exact SHA; database inspection was not attempted.", identityAvailability(identity));
  }
  if (identity.branch !== PRODUCTION_BRANCH) {
    throw adapterError(412, "host_local_runtime_branch_mismatch", "The running deployment branch is not Production; database inspection was not attempted.", identityAvailability(identity));
  }
  if (identity.repository !== CANONICAL_REPOSITORY) {
    throw adapterError(412, "host_local_runtime_repository_mismatch", "The running deployment repository is not the canonical repository; database inspection was not attempted.", identityAvailability(identity));
  }
}

function safeMutationFlags(result = {}) {
  return {
    database_connection_performed: result.database_connection_performed === true,
    database_mutation_performed: false,
    migration_apply_performed: false,
    grant_mutation_performed: false,
    workflow_dispatch_performed: false,
  };
}

export async function executeHostLocalRoleInspection(planInput = {}, {
  env = process.env,
  bootstrapRunner = runBootstrap,
  contractReader = readRuntimeBootstrapContract,
  identityReader = identityFromEnvironment,
  repoRoot = REPO_ROOT,
} = {}) {
  const plan = planInput && typeof planInput === "object" && (Object.hasOwn(planInput, "environment_key") || Object.hasOwn(planInput, "operation_key") || Object.hasOwn(planInput, "runbook_key"))
    ? normalizeInspectionPlan(planInput)
    : assertRequestShape(planInput);
  const identity = identityReader(env);
  assertRuntimeIdentity(identity, plan);
  const bootstrapEnv = buildBootstrapEnvironment(plan, env);
  try {
    const result = await bootstrapRunner({
      env: bootstrapEnv,
      contract: contractReader(),
      repoRoot,
    });
    if (result?.database_mutation_performed !== false || result?.migration_apply_performed !== false || result?.grant_mutation_performed !== false) {
      throw adapterError(500, "host_local_inspection_mutation_flagged", "Host-local inspection returned an unsafe mutation flag.", safeMutationFlags(result));
    }
    return {
      ...result,
      ok: result?.ok !== false,
      contract: "mad4b.host-breakglass-host-local-inspection.v1",
      status: "host_local_inspection_complete",
      mode: "dry_run",
      operation: "read_only",
      environment_key: PRODUCTION_ENVIRONMENT_KEY,
      target_key: PRODUCTION_TARGET_KEY,
      target_source: "host_local_role_env",
      expected_sha: plan.expected_sha,
      expected_branch: PRODUCTION_BRANCH,
      expected_repository: CANONICAL_REPOSITORY,
      migration: null,
      migration_selected: false,
      migration_selection: "full_inspection_catalog",
      runtime_identity: identityAvailability(identity),
      ...safeMutationFlags(result),
      read_only: true,
      secrets_included: false,
    };
  } catch (error) {
    if (error?.hostLocalAdapter) throw error;
    const safe = sanitizeBootstrapError(error);
    const sanitizedRuntimeError = { ...safe, message: "Host-local bootstrap failed." };
    throw adapterError(412, "host_local_inspection_failed", "Host-local role inspection failed; no mutation was authorized by this adapter.", {
      runtime_error: sanitizedRuntimeError,
      ...safeMutationFlags(error?.details || {}),
      runtime_identity: identityAvailability(identity),
    });
  }
}

export function buildHostLocalRoleInspectionRequest(input = {}) {
  return assertRequestShape(input);
}

export const _testingHostLocalRuntimeInspection = {
  identityFromEnvironment,
  identityAvailability,
  normalizeInspectionPlan,
  assertRequestShape,
  buildBootstrapEnvironment,
  assertRuntimeIdentity,
  safeMutationFlags,
  CANONICAL_REPOSITORY,
  PRODUCTION_BRANCH,
  PRODUCTION_ENVIRONMENT_KEY,
  PRODUCTION_TARGET_KEY,
};
