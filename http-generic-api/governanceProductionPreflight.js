import { resolveGovernanceDbConfig } from "./governanceDb.js";
import { loadEnvironmentBranchAuthority } from "./environmentBranchAuthority.js";

function text(value = "") {
  return String(value ?? "").trim();
}

function structuredError(code, message, status = 409, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = { ...details, secrets_included: false };
  return error;
}

export function assertGovernanceProductionEnvironmentAuthority(authority = {}) {
  const productionBranch = text(authority.production_branch);
  const promotionTargetBranch = text(authority.promotion_target_branch);
  const checks = {
    production_branch_exact: productionBranch === "Production",
    promotion_target_branch_exact: promotionTargetBranch === "Production",
  };

  if (Object.values(checks).some((value) => value !== true)) {
    throw structuredError(
      "GOVERNANCE_PRODUCTION_ENVIRONMENT_AUTHORITY_MISMATCH",
      "Governance Production preflight requires Production as the exact environment and promotion authority.",
      409,
      {
        checks,
        observed_production_branch: productionBranch || null,
        observed_promotion_target_branch: promotionTargetBranch || null,
        authority_source: text(authority.source) || null,
        authority_config_key: text(authority.config_key) || null,
      },
    );
  }

  return {
    production_branch: productionBranch,
    promotion_target_branch: promotionTargetBranch,
    authority_source: text(authority.source) || null,
    authority_config_key: text(authority.config_key) || null,
    secrets_included: false,
  };
}

export async function resolveGovernanceProductionPreflight({ env = process.env } = {}, deps = {}) {
  // Validate the dedicated Governance writer identity first. This resolves only
  // configuration and never opens a database connection or returns credentials.
  const governanceConfig = resolveGovernanceDbConfig(env);
  const loadAuthority = deps.loadEnvironmentBranchAuthority || loadEnvironmentBranchAuthority;
  const authority = await loadAuthority(deps.environmentAuthorityDeps || {});
  const environmentAuthority = assertGovernanceProductionEnvironmentAuthority(authority);

  return {
    contract: "mad4b.governance-production-preflight.v1",
    status: "preflight_ready",
    ready: true,
    governance_db: {
      identity_configured: true,
      runtime_identity_fallback_allowed: false,
      host_configured: Boolean(governanceConfig.host),
      database_configured: Boolean(governanceConfig.database),
      connection_limit: governanceConfig.connectionLimit,
    },
    environment_authority: environmentAuthority,
    database_connection_performed: false,
    sql_execution_performed: false,
    migration_apply_performed: false,
    provider_mutation_performed: false,
    deployment_performed: false,
    secret_value_returned: false,
    secrets_included: false,
  };
}
