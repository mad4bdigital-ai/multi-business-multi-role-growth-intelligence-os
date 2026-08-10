import { runGovernanceDbPrivilegeReadiness } from "./governanceDbPrivilegeReadinessService.js";

export const GOVERNANCE_DB_PRIVILEGE_READINESS_RUNTIME_CONTRACT =
  "mad4b.governance-db-privilege-readiness-runtime.v1";

const DEFAULT_TTL_MS = 60_000;
let cachedSnapshot = null;
let cacheExpiresAt = 0;
let inFlight = null;

function text(value = "") {
  return String(value ?? "").trim();
}

export function projectGovernanceDbPrivilegeReadiness(result = {}) {
  const ready = result.ready === true && result.privilege_readiness?.ready === true;
  return {
    contract: GOVERNANCE_DB_PRIVILEGE_READINESS_RUNTIME_CONTRACT,
    status: ready ? "ready" : "blocked",
    ready,
    code: ready ? null : text(result.code).slice(0, 100) || "GOVERNANCE_DB_PRIVILEGE_READINESS_BLOCKED",
    production_preflight_ready: result.production_preflight_ready === true,
    production_branch_exact: result.production_branch_exact === true,
    promotion_target_branch_exact: result.promotion_target_branch_exact === true,
    governance_identity_configured: result.governance_identity_configured === true,
    privilege_matrix_exact: ready,
    database_connection_performed: result.database_connection_performed === true,
    sql_readback_performed: result.sql_readback_performed === true,
    sql_mutation_performed: false,
    migration_apply_performed: false,
    provider_mutation_performed: false,
    deployment_performed: false,
    secret_value_returned: false,
    secrets_included: false,
  };
}

export async function getGovernanceDbPrivilegeReadinessSnapshot(options = {}, deps = {}) {
  const nowFn = deps.now || Date.now;
  const runner = deps.runner || runGovernanceDbPrivilegeReadiness;
  const ttlMs = Math.max(1_000, Math.min(Number(options.ttlMs) || DEFAULT_TTL_MS, 300_000));
  const now = Number(nowFn());

  if (cachedSnapshot && now < cacheExpiresAt) return cachedSnapshot;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const result = await runner(options.runnerOptions || {}, options.runnerDeps || {});
    const snapshot = {
      ...projectGovernanceDbPrivilegeReadiness(result),
      observed_at: new Date(Number(nowFn())).toISOString(),
      cache_ttl_ms: ttlMs,
    };
    cachedSnapshot = snapshot;
    cacheExpiresAt = Number(nowFn()) + ttlMs;
    return snapshot;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

export function resetGovernanceDbPrivilegeReadinessRuntimeCacheForTest() {
  cachedSnapshot = null;
  cacheExpiresAt = 0;
  inFlight = null;
}
