import assert from "node:assert/strict";

import {
  assertGovernanceDbProviderCapability,
  evaluateGovernanceDbProviderCapability,
} from "./governanceDbProviderCapability.js";
import {
  assertGovernanceProductionEnvironmentAuthority,
  resolveGovernanceProductionPreflight,
} from "./governanceProductionPreflight.js";

const governanceEnv = {
  DB_HOST: "db.internal",
  DB_NAME: "platform",
  DB_PORT: "3306",
  DB_USER: "runtime_identity_fixture_6813",
  DB_PASSWORD: "runtime-secret-value",
  GOVERNANCE_DB_USER: "governance_identity_fixture_6813",
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

const supportedProviderPolicy = {
  environments: {
    Production: {
      provider_key: "synthetic_multi_principal_mysql",
      provider_mode: "synthetic_test_provider",
      capabilities: {
        second_principal_same_database_via_managed_control_plane: true,
        exact_direct_table_grants_via_managed_control_plane: true,
        dedicated_governance_writer_contract_v1: true,
      },
      remediation_classes: [],
    },
  },
};

const assertSupportedProviderCapability = (input = {}) =>
  assertGovernanceDbProviderCapability({ ...input, policy: supportedProviderPolicy });

{
  const provider = evaluateGovernanceDbProviderCapability({ environment: "Production" });
  assert.equal(provider.ready, false);
  assert.equal(provider.status, "unsupported");
  assert.equal(provider.code, "GOVERNANCE_DB_PROVIDER_CAPABILITY_UNSUPPORTED");
  assert.equal(provider.provider_key, "hostinger_web_cloud_mysql");
  assert.equal(provider.provider_mode, "managed_hpanel_mysql");
  assert.equal(provider.checks.second_principal_same_database_via_managed_control_plane, false);
  assert.equal(provider.checks.exact_direct_table_grants_via_managed_control_plane, false);
  assert.equal(provider.checks.dedicated_governance_writer_contract_v1, false);
  assert.equal(provider.remediation_required, true);
  assert.deepEqual(provider.remediation_classes, ["provider_migration", "governance_datastore_redesign"]);
  assert.equal(provider.provider_mutation_performed, false);
  assert.equal(provider.database_connection_performed, false);
  assert.equal(provider.sql_execution_performed, false);
  assert.equal(provider.secrets_included, false);
  assert.throws(
    () => assertGovernanceDbProviderCapability({ environment: "Production" }),
    (error) => error?.code === "GOVERNANCE_DB_PROVIDER_CAPABILITY_UNSUPPORTED"
      && error?.details?.provider_key === "hostinger_web_cloud_mysql"
      && error?.details?.secrets_included === false,
  );
}

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
    assertGovernanceDbProviderCapability: assertSupportedProviderCapability,
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
assert.equal(preflight.provider_capability.supported, true);
assert.equal(preflight.provider_capability.provider_key, "synthetic_multi_principal_mysql");
assert.equal(preflight.provider_capability.remediation_required, false);
assert.equal(preflight.governance_db.identity_configured, true);
assert.equal(preflight.governance_db.runtime_identity_fallback_allowed, false);
assert.equal(preflight.governance_db.same_runtime_identity_rejected, true);
assert.equal(preflight.environment_authority.production_branch, "Production");
assert.equal(preflight.environment_authority.promotion_target_branch, "Production");
assert.equal(preflight.database_connection_performed, false);
assert.equal(preflight.sql_execution_performed, false);
assert.equal(preflight.migration_apply_performed, false);
assert.equal(preflight.provider_mutation_performed, false);
assert.equal(preflight.deployment_performed, false);
assert.equal(preflight.secrets_included, false);
assert.doesNotMatch(JSON.stringify(preflight), /governance-secret-value|runtime-secret-value/);
assert.doesNotMatch(
  JSON.stringify(preflight),
  /governance_identity_fixture_6813|runtime_identity_fixture_6813/,
  "Preflight evidence must not expose fixture database identities",
);

let providerBlockedAuthorityLoads = 0;
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
        providerBlockedAuthorityLoads += 1;
        return canonicalAuthority;
      },
    },
  ),
  (error) => error?.code === "GOVERNANCE_DB_PROVIDER_CAPABILITY_UNSUPPORTED"
    && error?.details?.provider_key === "hostinger_web_cloud_mysql"
    && error?.details?.secrets_included === false,
  "Provider capability must fail closed before credential readiness or environment-authority loading",
);
assert.equal(providerBlockedAuthorityLoads, 0);

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
      assertGovernanceDbProviderCapability: assertSupportedProviderCapability,
      loadEnvironmentBranchAuthority: async () => {
        missingConfigAuthorityLoads += 1;
        return canonicalAuthority;
      },
    },
  ),
  (error) => error?.code === "GOVERNANCE_DB_CONFIG_MISSING"
    && error?.details?.runtime_identity_fallback_allowed === false
    && error?.details?.same_runtime_identity_rejected === true
    && error?.details?.secrets_included === false,
  "A provider capable of dedicated identities must still require explicit Governance writer credentials",
);
assert.equal(missingConfigAuthorityLoads, 0);

await assert.rejects(
  () => resolveGovernanceProductionPreflight(
    { env: governanceEnv },
    {
      assertGovernanceDbProviderCapability: assertSupportedProviderCapability,
      loadEnvironmentBranchAuthority: async () => ({
        ...canonicalAuthority,
        production_branch: "main",
      }),
    },
  ),
  (error) => error?.code === "GOVERNANCE_PRODUCTION_ENVIRONMENT_AUTHORITY_MISMATCH",
);

console.log("Governance Production provider/environment-authority preflight tests passed");
