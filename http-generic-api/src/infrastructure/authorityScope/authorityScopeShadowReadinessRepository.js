function requirePool(pool) {
  if (!pool || typeof pool.execute !== "function") {
    throw new TypeError("Authority Scope shadow readiness repository requires a SQL pool with execute().");
  }
  return pool;
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function mapSummary(row = {}) {
  return Object.freeze({
    sampleCount:numeric(row.sample_count),
    matchCount:numeric(row.match_count),
    mismatchCount:numeric(row.mismatch_count),
    unresolvedCount:numeric(row.unresolved_count),
    comparableSampleCount:numeric(row.comparable_sample_count),
    mismatchPercent:numeric(row.mismatch_percent),
    lastObservedAt:row.last_observed_at || null,
    secretsIncluded:false
  });
}

function mapReadiness(row = {}) {
  return Object.freeze({
    policyKey:String(row.policy_key || ""),
    rolloutMode:String(row.rollout_mode || "shadow"),
    baseReadinessCode:String(row.base_readiness_code || "unknown"),
    readinessCode:String(row.readiness_code || "unknown"),
    authorityScope:mapSummary({
      sample_count:row.authority_scope_sample_count,
      match_count:row.authority_scope_match_count,
      mismatch_count:row.authority_scope_mismatch_count,
      unresolved_count:row.authority_scope_unresolved_count,
      comparable_sample_count:row.authority_scope_comparable_sample_count,
      mismatch_percent:row.authority_scope_mismatch_percent,
      last_observed_at:row.authority_scope_last_observed_at
    }),
    enforcementRequested:Boolean(row.enforcement_requested),
    secretsIncluded:false
  });
}

export function createAuthorityScopeShadowReadinessRepository({ resolvePool }) {
  if (typeof resolvePool !== "function") {
    throw new TypeError("Authority Scope shadow readiness repository requires resolvePool().");
  }

  async function readSummary() {
    const pool = requirePool(await resolvePool());
    const [rows] = await pool.execute(
      `SELECT sample_count,match_count,mismatch_count,unresolved_count,
              comparable_sample_count,mismatch_percent,last_observed_at,secrets_included
         FROM v_authority_scope_shadow_summary
        LIMIT 1`
    );
    return mapSummary(rows?.[0] || {});
  }

  async function readCombinedReadiness(policyKey = "dynamic_container_authority_v1") {
    const pool = requirePool(await resolvePool());
    const [rows] = await pool.execute(
      `SELECT policy_key,rollout_mode,base_readiness_code,readiness_code,
              authority_scope_sample_count,authority_scope_match_count,
              authority_scope_mismatch_count,authority_scope_unresolved_count,
              authority_scope_comparable_sample_count,authority_scope_mismatch_percent,
              authority_scope_last_observed_at,enforcement_requested,secrets_included
         FROM v_container_rollout_readiness_v2
        WHERE policy_key=?
        LIMIT 1`,
      [String(policyKey)]
    );
    return rows?.[0] ? mapReadiness(rows[0]) : null;
  }

  return Object.freeze({ readSummary, readCombinedReadiness });
}

export const _testingAuthorityScopeShadowReadinessRepository = Object.freeze({
  numeric,
  mapSummary,
  mapReadiness
});
