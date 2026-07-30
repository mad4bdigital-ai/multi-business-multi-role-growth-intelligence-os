import { getPool } from "./db.js";
import { createDelegationGrantMariaDbRepository } from "./delegationGrantMariaDbRepository.js";
import { executeDelegationGrantRepositoryMutation } from "./delegationGrantRepositoryMutationService.js";
import {
  collectDelegationGrantMariaDbReadinessEvidence,
  DELEGATION_GRANT_MARIADB_MIGRATION_FILE,
} from "./delegationGrantMariaDbReadinessCollector.js";

export const DELEGATION_GRANT_MARIADB_RUNTIME_BINDING_VERSION =
  "spec011-delegation-grant-mariadb-runtime-binding-v1";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const ACTIONS = new Set(["create", "revoke", "expire"]);

function runtimeBindingError(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function compact(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function enabled(value) {
  return /^(1|true|yes|on)$/i.test(compact(value, 16));
}

function allowedActions(value) {
  return new Set(
    compact(value, 191)
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => ACTIONS.has(entry)),
  );
}

function resolveRuntimeConfig(env = process.env) {
  const runtimeEnabled = enabled(env.DELEGATION_GRANT_MARIADB_RUNTIME_ENABLED);
  const certified = enabled(env.DELEGATION_GRANT_MARIADB_RUNTIME_CERTIFIED);
  const checksum = compact(env.DELEGATION_GRANT_MARIADB_EXPECTED_MIGRATION_SHA256, 64).toLowerCase();
  const actions = allowedActions(env.DELEGATION_GRANT_MARIADB_RUNTIME_ALLOWED_ACTIONS);
  const ttlCandidate = Number(env.DELEGATION_GRANT_MARIADB_READINESS_TTL_MS || 60000);
  return {
    runtime_enabled: runtimeEnabled,
    certified,
    expected_migration_checksum_sha256: HASH_PATTERN.test(checksum) ? checksum : null,
    allowed_actions: actions,
    readiness_ttl_ms: Number.isFinite(ttlCandidate)
      ? Math.min(300000, Math.max(0, Math.trunc(ttlCandidate)))
      : 60000,
  };
}

function planAction(plan = {}) {
  const action = compact(plan.action || plan.command_preview?.action, 32).toLowerCase();
  if (!ACTIONS.has(action)) {
    throw runtimeBindingError(400, "DELEGATION_MARIADB_RUNTIME_ACTION_INVALID", "Lifecycle plan action is invalid.");
  }
  return action;
}

export function createDelegationGrantMariaDbRuntimeBinding({
  pool,
  env = process.env,
  readinessCollector = collectDelegationGrantMariaDbReadinessEvidence,
  repositoryFactory = createDelegationGrantMariaDbRepository,
  mutationExecutor = executeDelegationGrantRepositoryMutation,
  clock = () => Date.now(),
} = {}) {
  if (!pool || typeof pool.query !== "function" || typeof pool.getConnection !== "function") {
    throw runtimeBindingError(500, "DELEGATION_MARIADB_RUNTIME_POOL_INVALID", "A query and transaction capable MariaDB pool is required.");
  }

  let cachedReadiness = null;
  let cachedAt = 0;

  async function readiness({ force = false, now = new Date().toISOString() } = {}) {
    const config = resolveRuntimeConfig(env);
    const current = Number(clock());
    if (!force && cachedReadiness && current - cachedAt <= config.readiness_ttl_ms) {
      return structuredClone(cachedReadiness);
    }
    const evidence = await readinessCollector({
      pool,
      migrationFile: DELEGATION_GRANT_MARIADB_MIGRATION_FILE,
      expectedMigrationChecksum: config.expected_migration_checksum_sha256,
      runtimeAuthorityEnabled: false,
      now,
    });
    cachedReadiness = structuredClone(evidence);
    cachedAt = current;
    return structuredClone(evidence);
  }

  function status() {
    const config = resolveRuntimeConfig(env);
    return {
      ok: true,
      report_type: "delegation_grant_mariadb_runtime_binding_status",
      binding_version: DELEGATION_GRANT_MARIADB_RUNTIME_BINDING_VERSION,
      runtime_enabled: config.runtime_enabled,
      certified: config.certified,
      checksum_pin_present: Boolean(config.expected_migration_checksum_sha256),
      allowed_actions: [...config.allowed_actions].sort(),
      readiness_cached: Boolean(cachedReadiness),
      public_route_added: false,
      runtime_policy_ready_promoted: false,
      secrets_included: false,
    };
  }

  async function execute({ plan, tenantId, authorization, now = new Date().toISOString() } = {}) {
    const config = resolveRuntimeConfig(env);
    if (!config.runtime_enabled || !config.certified) {
      throw runtimeBindingError(503, "DELEGATION_MARIADB_RUNTIME_DISABLED", "Delegation MariaDB runtime binding is default-off and not certified.", {
        runtime_enabled: config.runtime_enabled,
        certified: config.certified,
      });
    }
    if (!config.expected_migration_checksum_sha256) {
      throw runtimeBindingError(503, "DELEGATION_MARIADB_RUNTIME_CHECKSUM_PIN_REQUIRED", "A certified migration checksum pin is required.");
    }
    const action = planAction(plan);
    if (!config.allowed_actions.has(action)) {
      throw runtimeBindingError(403, "DELEGATION_MARIADB_RUNTIME_ACTION_NOT_ALLOWED", "Lifecycle action is not allowlisted for the runtime binding.", {
        action,
      });
    }

    const schemaReadiness = await readiness({ force: true, now });
    if (
      schemaReadiness.status !== "verified_applied"
      || schemaReadiness.migration_applied !== true
      || schemaReadiness.readback_complete !== true
      || schemaReadiness.checksum_pin_match !== true
      || schemaReadiness.migration_checksum_sha256 !== config.expected_migration_checksum_sha256
    ) {
      throw runtimeBindingError(409, "DELEGATION_MARIADB_RUNTIME_SCHEMA_NOT_READY", "Live MariaDB readiness does not satisfy the certified binding contract.", {
        blockers: schemaReadiness.blockers || [],
        checksum_pin_match: schemaReadiness.checksum_pin_match === true,
      });
    }

    const repository = repositoryFactory({ pool });
    const result = await mutationExecutor({
      repository,
      plan,
      tenantId,
      schemaReadiness,
      authorization,
      now,
    });

    return {
      ...result,
      runtime_binding_version: DELEGATION_GRANT_MARIADB_RUNTIME_BINDING_VERSION,
      certified_migration_checksum_sha256: config.expected_migration_checksum_sha256,
      runtime_binding_enabled: true,
      runtime_policy_ready_promoted: false,
      public_route_added: false,
      secrets_included: false,
    };
  }

  return Object.freeze({ status, readiness, execute });
}

let defaultBinding = null;

export function getDelegationGrantMariaDbRuntimeBinding() {
  if (!defaultBinding) {
    defaultBinding = createDelegationGrantMariaDbRuntimeBinding({ pool: getPool() });
  }
  return defaultBinding;
}

export const _testingDelegationGrantMariaDbRuntimeBinding = {
  enabled,
  allowedActions,
  resolveRuntimeConfig,
  planAction,
};
