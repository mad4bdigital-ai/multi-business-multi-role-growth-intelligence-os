import { createStagingCertificationCanaryPlan } from "./recoveryKernel.js";
import { createStagingAccessRepairTicketAuthority } from "./stagingAccessRepairTicketAuthority.js";
import { stagingRecoveryAuthorityInternals } from "./stagingRecoveryAuthorityBinding.js";

export const STAGING_RECOVERY_SYSTEM_SURFACE_CONTRACT = "mad4b.staging-recovery-system-surface.v1";
export const STAGING_RECOVERY_SYSTEM_SOURCE_KEY = "staging_recovery_system_surface_v1";

const SHA40_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const PLAN_ID_RE = /^plan:[0-9a-f]{32}$/u;
const STEP_ID_RE = /^step:[0-9a-f]{32}$/u;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u;

function text(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function systemError(status, code, message, details = {}) {
  return Object.assign(new Error(message), {
    status,
    code,
    details: { ...details, production_authority: false, secrets_included: false },
  });
}

export function isStagingRecoverySystemEnvironment(env = process.env) {
  const values = [env.DEPLOYMENT_ENVIRONMENT, env.REMOTE_MCP_ENVIRONMENT, env.NODE_ENV]
    .map((value) => text(value, 96).toLowerCase())
    .filter(Boolean);
  return values.some((value) => ["staging", "stage", "staging_local_windows_docker"].includes(value));
}

function requireStagingEnvironment(env = process.env) {
  if (!isStagingRecoverySystemEnvironment(env)) {
    throw systemError(404, "STAGING_RECOVERY_SYSTEM_SURFACE_UNAVAILABLE", "Staging Recovery system tools are unavailable outside Staging.");
  }
  return env;
}

function graphFor(env = process.env) {
  requireStagingEnvironment(env);
  stagingRecoveryAuthorityInternals.runtime({
    environment: "staging",
    runtime_class: "local_windows_docker",
    requested_mode: "injected_non_live",
    production_live: false,
  }, env);
  const roots = stagingRecoveryAuthorityInternals.roots(env);
  return stagingRecoveryAuthorityInternals.adapters(roots.readiness, env).adapters;
}

function requireObject(input, allowedKeys, requiredKeys, code) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw systemError(400, code, "Staging Recovery system-tool input must be a JSON object.");
  }
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  const missing = requiredKeys.filter((key) => input[key] === undefined || input[key] === null || input[key] === "");
  if (unexpected.length || missing.length) {
    throw systemError(400, code, "Staging Recovery system-tool input is outside the fixed contract.", {
      unexpected_fields: unexpected,
      missing_fields: missing,
    });
  }
  return input;
}

function requireSha40(value, field) {
  const normalized = text(value, 64).toLowerCase();
  if (!SHA40_RE.test(normalized)) throw systemError(400, "STAGING_RECOVERY_SHA_INVALID", `${field} must be an exact 40-character Git SHA.`, { field });
  return normalized;
}

function requireSha256(value, field) {
  const normalized = text(value, 128).toLowerCase();
  if (!SHA256_RE.test(normalized)) throw systemError(400, "STAGING_RECOVERY_BINDING_INVALID", `${field} must be a SHA-256 digest.`, { field });
  return normalized;
}

function requireSafeId(value, field, pattern = SAFE_ID_RE) {
  const normalized = text(value, 180);
  if (!pattern.test(normalized)) throw systemError(400, "STAGING_RECOVERY_BINDING_INVALID", `${field} is invalid.`, { field });
  return normalized;
}

export async function stagingRecoveryCertificationCanaryPlanCreate(input = {}, { env = process.env } = {}) {
  requireStagingEnvironment(env);
  requireObject(input, ["expected_sha"], ["expected_sha"], "STAGING_RECOVERY_CANARY_PLAN_INPUT_INVALID");
  const expectedSha = requireSha40(input.expected_sha, "expected_sha");
  const graph = graphFor(env);
  const plan = await createStagingCertificationCanaryPlan({ expected_sha: expectedSha }, {
    env,
    recoveryStore: graph.recoveryStore,
    deploymentIdentityProvider: graph.deploymentIdentityProvider,
  });
  return {
    ...plan,
    surface_contract: STAGING_RECOVERY_SYSTEM_SURFACE_CONTRACT,
    control_plane_state_written: true,
    target_database_mutation_performed: false,
    provider_mutation_performed: false,
    production_authority: false,
    secrets_included: false,
  };
}

export async function stagingRecoveryAccessRepairPrepare(input = {}, { env = process.env } = {}) {
  requireStagingEnvironment(env);
  requireObject(
    input,
    ["expected_sha", "target_fingerprint", "grant_binding_hash", "idempotency_key"],
    ["expected_sha", "target_fingerprint", "grant_binding_hash", "idempotency_key"],
    "STAGING_RECOVERY_ACCESS_REPAIR_PREPARE_INPUT_INVALID",
  );
  const authority = createStagingAccessRepairTicketAuthority({ env });
  return authority.prepare({
    expected_sha: requireSha40(input.expected_sha, "expected_sha"),
    target_key: "staging-runtime",
    target_fingerprint: requireSha256(input.target_fingerprint, "target_fingerprint"),
    grant_binding_hash: requireSha256(input.grant_binding_hash, "grant_binding_hash"),
    idempotency_key: requireSafeId(input.idempotency_key, "idempotency_key"),
  });
}

export async function stagingRecoveryAccessRepairApprove(input = {}, { env = process.env } = {}) {
  requireStagingEnvironment(env);
  requireObject(
    input,
    ["plan_id", "plan_hash", "step_id", "idempotency_key", "approval_confirmation"],
    ["plan_id", "plan_hash", "step_id", "idempotency_key", "approval_confirmation"],
    "STAGING_RECOVERY_ACCESS_REPAIR_APPROVE_INPUT_INVALID",
  );
  const authority = createStagingAccessRepairTicketAuthority({ env });
  return authority.approveAndIssue({
    plan_id: requireSafeId(input.plan_id, "plan_id", PLAN_ID_RE),
    plan_hash: requireSha256(input.plan_hash, "plan_hash"),
    step_id: requireSafeId(input.step_id, "step_id", STEP_ID_RE),
    idempotency_key: requireSafeId(input.idempotency_key, "idempotency_key"),
    approval_confirmation: text(input.approval_confirmation, 1024),
  });
}

export async function stagingRecoverySystemSurfaceReadiness(_input = {}, { env = process.env } = {}) {
  const available = isStagingRecoverySystemEnvironment(env);
  if (!available) {
    return {
      ok: true,
      status: "pass",
      classification: "staging_recovery_system_surface_not_advertised_outside_staging",
      available: false,
      production_authority: false,
      mutations_executed: false,
      secrets_included: false,
    };
  }
  graphFor(env);
  return {
    ok: true,
    status: "pass",
    classification: "staging_recovery_system_surface_ready",
    available: true,
    environment: "staging",
    target_key: "staging-runtime",
    production_authority: false,
    caller_selected_target: false,
    raw_sql_allowed: false,
    caller_command_allowed: false,
    mutations_executed: false,
    secrets_included: false,
  };
}

const descriptors = Object.freeze([
  {
    name: "staging_recovery_certification_canary_plan_create",
    handler: "stagingRecoveryCertificationCanaryPlanCreate",
    description: "Staging-only Admin Recovery control-plane operation. Creates and durably persists an exact-SHA certification canary plan bound to the server-derived Staging target. It does not execute the canary and performs no target-database, provider, Production, DNS, or deployment mutation.",
    source_key: STAGING_RECOVERY_SYSTEM_SOURCE_KEY,
    capability_key: "staging_certification_canary_plan_create",
    catalog_level: "private_recovery",
    tags: ["recovery", "staging", "private", "control_plane", "plan"],
    requires_admin: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["expected_sha"],
      properties: { expected_sha: { type: "string", pattern: "^[0-9a-fA-F]{40}$" } },
    },
  },
  {
    name: "staging_recovery_access_repair_prepare",
    handler: "stagingRecoveryAccessRepairPrepare",
    description: "Staging-only Admin Recovery operation. Creates the fixed database-access-repair plan and server-managed approval challenge for staging-runtime. Caller-selected SQL, commands, operation, target key, credentials, and execution tickets are forbidden.",
    source_key: STAGING_RECOVERY_SYSTEM_SOURCE_KEY,
    capability_key: "staging_database_access_repair",
    catalog_level: "private_recovery",
    tags: ["recovery", "staging", "private", "approval", "access_repair"],
    requires_admin: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["expected_sha", "target_fingerprint", "grant_binding_hash", "idempotency_key"],
      properties: {
        expected_sha: { type: "string", pattern: "^[0-9a-fA-F]{40}$" },
        target_fingerprint: { type: "string", pattern: "^[0-9a-fA-F]{64}$" },
        grant_binding_hash: { type: "string", pattern: "^[0-9a-fA-F]{64}$" },
        idempotency_key: { type: "string", minLength: 8, maxLength: 160 },
      },
    },
  },
  {
    name: "staging_recovery_access_repair_approve",
    handler: "stagingRecoveryAccessRepairApprove",
    description: "Staging-only Admin Recovery operation. Consumes the exact high-level access-repair confirmation and issues one server-signed, single-use execution ticket without returning approval material, signatures, SQL, commands, or credentials.",
    source_key: STAGING_RECOVERY_SYSTEM_SOURCE_KEY,
    capability_key: "staging_database_access_repair",
    catalog_level: "private_recovery",
    tags: ["recovery", "staging", "private", "approval", "ticket"],
    requires_admin: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["plan_id", "plan_hash", "step_id", "idempotency_key", "approval_confirmation"],
      properties: {
        plan_id: { type: "string", pattern: "^plan:[0-9a-f]{32}$" },
        plan_hash: { type: "string", pattern: "^[0-9a-fA-F]{64}$" },
        step_id: { type: "string", pattern: "^step:[0-9a-f]{32}$" },
        idempotency_key: { type: "string", minLength: 8, maxLength: 160 },
        approval_confirmation: { type: "string", minLength: 32, maxLength: 1024 },
      },
    },
  },
  {
    name: "staging_recovery_system_surface_readiness",
    handler: "stagingRecoverySystemSurfaceReadiness",
    description: "Staging-only Admin diagnostic for the fixed Recovery System Tool surface. Verifies concrete Staging recovery authorities are constructible without executing a mutation or exposing secrets.",
    source_key: STAGING_RECOVERY_SYSTEM_SOURCE_KEY,
    capability_key: "staging_recovery_system_surface_readiness",
    catalog_level: "private_recovery",
    tags: ["recovery", "staging", "private", "readiness"],
    requires_admin: true,
    inputSchema: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
]);

export function buildStagingRecoverySystemTools(env = process.env) {
  return isStagingRecoverySystemEnvironment(env) ? descriptors.map((tool) => ({ ...tool })) : [];
}

export const STAGING_RECOVERY_SYSTEM_TOOLS = Object.freeze(buildStagingRecoverySystemTools(process.env));
