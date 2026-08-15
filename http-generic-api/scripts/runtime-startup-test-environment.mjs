export const RUNTIME_STARTUP_TEST_ENV_CONTRACT = "mad4b.runtime-startup-test-environment.v1";

export const RUNTIME_STARTUP_TEST_ENVIRONMENT_VARIABLES = Object.freeze([
  "JWT_SECRET",
  "TENANT_GPT_SSO_SIGNING_SECRET",
]);

// These values are deterministic, repository-local test fixtures. They are not
// credentials and must never be sourced from GitHub secrets, provider state, or
// a deployed runtime. Keeping them inside the test harness makes startup proof
// hermetic and prevents workflow-level environment drift.
const SYNTHETIC_TEST_VALUES = Object.freeze({
  JWT_SECRET: "runtime-startup-test-jwt-secret-32-characters-minimum-v1",
  TENANT_GPT_SSO_SIGNING_SECRET: "runtime-startup-test-sso-signing-secret-32-characters-minimum-v1",
});

export function buildRuntimeStartupTestEnvironment(baseEnv = {}) {
  if (!baseEnv || typeof baseEnv !== "object" || Array.isArray(baseEnv)) {
    throw new TypeError("runtime startup test environment base must be an object");
  }

  return {
    ...baseEnv,
    ...SYNTHETIC_TEST_VALUES,
    RUNTIME_STARTUP_TEST_ENV_CONTRACT,
  };
}

export function assertRuntimeStartupTestEnvironment(env) {
  const invalidNames = RUNTIME_STARTUP_TEST_ENVIRONMENT_VARIABLES.filter(name => {
    const value = env?.[name];
    return typeof value !== "string" || value.length < 32 || value !== SYNTHETIC_TEST_VALUES[name];
  });

  if (env?.RUNTIME_STARTUP_TEST_ENV_CONTRACT !== RUNTIME_STARTUP_TEST_ENV_CONTRACT) {
    invalidNames.push("RUNTIME_STARTUP_TEST_ENV_CONTRACT");
  }

  if (invalidNames.length > 0) {
    throw new Error(`runtime_startup_test_environment_contract_invalid:${[...new Set(invalidNames)].join(",")}`);
  }

  return true;
}

export function describeRuntimeStartupTestEnvironment() {
  return {
    contract: RUNTIME_STARTUP_TEST_ENV_CONTRACT,
    variable_names: [...RUNTIME_STARTUP_TEST_ENVIRONMENT_VARIABLES],
    value_source: "repository_local_synthetic_test_fixture",
    inherited_values_overridden: true,
    credential_payload_read: false,
    production_secret_source_used: false,
    provider_call_executed: false,
    production_mutation_executed: false,
    secrets_included: false,
  };
}
