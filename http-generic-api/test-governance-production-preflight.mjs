import assert from "node:assert/strict";

import {
  assertGovernanceProductionEnvironmentAuthority,
  resolveGovernanceProductionPreflight,
} from "./governanceProductionPreflight.js";

const governanceEnv = {
  DB_HOST: "db.internal",
  DB_NAME: "platform",
  DB_PORT: "3306",
  DB_USER: "runtime_reader",
  DB_PASSWORD: "runtime-secret-value",
  GOVERNANCE_DB_USER: "governance_writer",
  GOVERNANCE_DB_PASSWORD: "governance-secret-value",
  GOVERNANCE_DB_CONNECTION_LIMIT: "2",
};

const canonicalAuthority = {
  staging_branch: "main",
  production_branch: "Production",
  promotion_source_branch: "main",
  promotion_target_branch: "Production",
  source: "platform_runtime_config",
  config_key: "environment_branch_authority_v1",
  secrets_included: false,
};

const asserted = assertGovernanceProductionEnvironmentAuthority(canonicalAuthority);
assert.equal(asserted.production_branch, "Production");
assert.equal(asserted.promotion_target_branch, "Production");
assert.equal(asserted.secrets_included, false);

assert.throws(
  () => assertGovernanceProductionEnvironmentAuthority({
    ...canonicalAuthority,
    production_branch: "main",
  }),
  (error) => error?.code === "GOVERNANCE_PRODUCTION_ENVIRONMENT_AUTHORITY_MISMATCH"
    && error?.details?.checks?.production_branch_exact === false
    && error?.details?.secrets_included === false,
  "Governance Production preflight must reject main as production authority",
);

assert.throws(
  () => assertGovernanceProductionEnvironmentAuthority({
    ...canonicalAuthority,
    promotion_target_branch: "main",
  }),
  (error) => error?.code === "GOVERNANCE_PRODUCTION_ENVIRONMENT_AUTHORITY_MISMATCH"
    && error?.details?.checks?.promotion_target_branch_exact === false
    && error?.details?.secrets_included === false,
  "Governance Production preflight must reject promotion drift away from Production",
);

let authorityLoads = 0;
const preflight = await resolveGovernanceProductionPreflight(
  { env: governanceEnv },
  {
    loadEnvironmentBranchAuthority: async () => {
      authorityLoads += 1;
      return canonicalAuthority;
    },
  },
);
assert.equal(authorityLoads, 1);
assert.equal(preflight.contract, "mad4b.governance-production-preflight.v1");
assert.equal(preflight.status, "preflight_ready");
assert.equal(preflight.ready, true);
assert.equal(preflight.governance_db.identity_configured, true);
assert.equal(preflight.governance_db.runtime_identity_fallback_allowed, false);
assert.equal(preflight.environment_authority.production_branch, "Production");
assert.equal(preflight.environment_authority.promotion_target_branch, "Production");
assert.equal(preflight.database_connection_performed, false);
assert.equal(preflight.sql_execution_performed, false);
assert.equal(preflight.migration_apply_performed, false);
assert.equal(preflight.provider_mutation_performed, false);
assert.equal(preflight.deployment_performed, false);
assert.equal(preflight.secrets_included, false);
assert.doesNotMatch(JSON.stringify(preflight), /governance-secret-value|runtime-secret-value/);
assert.doesNotMatch(JSON.stringify(preflight), /governance_writer|runtime_reader/);

let missingConfigAuthorityLoads = 0;
await assert.rejects(
  () => resolveGovernanceProductionPreflight(
    {
      env: {
        DB_HOST: "db.internal",
        DB_NAME: "platform",
        DB_USER: "runtime_reader",
        DB_PASSWORD: "runtime-secret-value",
      },
    },
    {
      loadEnvironmentBranchAuthority: async () => {
        missingConfigAuthorityLoads += 1;
        return canonicalAuthority;
      },
    },
  ),
  (error) => error?.code === "GOVERNANCE_DB_CONFIG_MISSING"
    && error?.details?.runtime_identity_fallback_allowed === false
    && error?.details?.secrets_included === false,
  "Governance Production preflight must fail closed before authority loading when the dedicated writer identity is absent",
);
assert.equal(missingConfigAuthorityLoads, 0);

await assert.rejects(
  () => resolveGovernanceProductionPreflight(
    { env: governanceEnv },
    {
      loadEnvironmentBranchAuthority: async () => ({
        ...canonicalAuthority,
        production_branch: "main",
      }),
    },
  ),
  (error) => error?.code === "GOVERNANCE_PRODUCTION_ENVIRONMENT_AUTHORITY_MISMATCH",
);

console.log("Governance Production environment-authority preflight tests passed");
