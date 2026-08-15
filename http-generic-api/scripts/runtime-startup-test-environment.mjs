export const RUNTIME_STARTUP_TEST_ENV_CONTRACT = "mad4b.runtime-startup-test-environment.v1";

export const RUNTIME_STARTUP_TEST_ENVIRONMENT_VARIABLES = Object.freeze([
  "JWT_SECRET",
  "TENANT_GPT_SSO_SIGNING_SECRET",
]);

const SAFE_INHERITED_VARIABLE_NAMES = Object.freeze([
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "TZ",
  "CI",
  "GITHUB_ACTIONS",
  "GITHUB_WORKSPACE",
  "GITHUB_WORKFLOW",
  "GITHUB_RUN_ID",
  "GITHUB_RUN_ATTEMPT",
  "GITHUB_JOB",
  "GITHUB_REPOSITORY",
  "GITHUB_REF",
  "GITHUB_REF_NAME",
  "GITHUB_HEAD_REF",
  "GITHUB_BASE_REF",
  "GITHUB_SHA",
  "RUNNER_OS",
  "RUNNER_ARCH",
  "RUNNER_TEMP",
  "RUNNER_TOOL_CACHE",
  "DEPLOYMENT_BRANCH",
  "DEPLOYMENT_COMMIT_SHA",
  "CI_CANDIDATE_KIND",
  "CI_CANDIDATE_SHA",
  "CI_SOURCE_HEAD_SHA",
  "FORCE_ROUTE_RUNTIME_TESTS",
  "NODE_ENV",
  "PORT",
  "ACTIVATION_GITHUB_BRANCH",
]);

// These values are deterministic, repository-local test fixtures. They are not
// credentials and must never be sourced from GitHub secrets, provider state, or
// a deployed runtime. The child environment is rebuilt from an explicit
// allowlist so unrelated DB/provider/credential variables are not inherited.
const SYNTHETIC_TEST_VALUES = Object.freeze({
  JWT_SECRET: "runtime-startup-test-jwt-secret-32-characters-minimum-v1",
  TENANT_GPT_SSO_SIGNING_SECRET: "runtime-startup-test-sso-signing-secret-32-characters-minimum-v1",
  BACKEND_API_KEY: "runtime-startup-test-backend-api-key-v1",
  QUEUE_WORKER_ENABLED: "FALSE",
  REDIS_URL: "redis://127.0.0.1:6399",
});

function copyAllowlistedEnvironment(baseEnv) {
  const sanitized = {};
  for (const name of SAFE_INHERITED_VARIABLE_NAMES) {
    const value = baseEnv[name];
    if (value !== undefined && value !== null && String(value).length > 0) {
      sanitized[name] = String(value);
    }
  }
  return sanitized;
}

export function buildRuntimeStartupTestEnvironment(baseEnv = {}) {
  if (!baseEnv || typeof baseEnv !== "object" || Array.isArray(baseEnv)) {
    throw new TypeError("runtime startup test environment base must be an object");
  }

  return {
    ...copyAllowlistedEnvironment(baseEnv),
    ...SYNTHETIC_TEST_VALUES,
    RUNTIME_STARTUP_TEST_ENV_CONTRACT,
  };
}

export function assertRuntimeStartupTestEnvironment(env) {
  const invalidNames = RUNTIME_STARTUP_TEST_ENVIRONMENT_VARIABLES.filter(name => {
    const value = env?.[name];
    return typeof value !== "string" || value.length < 32 || value !== SYNTHETIC_TEST_VALUES[name];
  });

  for (const name of ["BACKEND_API_KEY", "QUEUE_WORKER_ENABLED", "REDIS_URL"]) {
    if (env?.[name] !== SYNTHETIC_TEST_VALUES[name]) invalidNames.push(name);
  }

  if (env?.RUNTIME_STARTUP_TEST_ENV_CONTRACT !== RUNTIME_STARTUP_TEST_ENV_CONTRACT) {
    invalidNames.push("RUNTIME_STARTUP_TEST_ENV_CONTRACT");
  }

  const allowedOutputNames = new Set([
    ...SAFE_INHERITED_VARIABLE_NAMES,
    ...Object.keys(SYNTHETIC_TEST_VALUES),
    "RUNTIME_STARTUP_TEST_ENV_CONTRACT",
  ]);
  for (const name of Object.keys(env || {})) {
    if (!allowedOutputNames.has(name)) invalidNames.push(`unexpected:${name}`);
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
    inherited_variable_policy: "explicit_allowlist",
    inherited_values_overridden: true,
    unrelated_environment_inherited: false,
    credential_payload_read: false,
    production_secret_source_used: false,
    provider_call_executed: false,
    production_mutation_executed: false,
    secrets_included: false,
  };
}
