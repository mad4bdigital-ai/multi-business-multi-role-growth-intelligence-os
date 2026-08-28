export const RUNTIME_ENVIRONMENT_RESOLVER_CONTRACT = "mad4b.runtime-environment-resolver.v1";

const ENVIRONMENT_KEYS = Object.freeze([
  "DEPLOYMENT_ENVIRONMENT",
  "REMOTE_MCP_ENVIRONMENT",
  "NODE_ENV",
]);

const ALIASES = Object.freeze({
  production: "production",
  prod: "production",
  production_hostinger_autodeploy: "production",
  staging: "staging",
  staging_hosted: "staging",
  staging_local_windows_docker: "staging",
  test: "test",
  ci: "ci",
});

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function valueEvidence(key, raw, canonical) {
  return Object.freeze({ key, value: raw, canonical });
}

function identityFor(environmentKey, runtimeVariant) {
  if (environmentKey === "production") {
    return {
      environment: "production",
      environment_key: "production",
      runtime_class: "hostinger_autodeploy",
      deployment_model: "production_hostinger",
      source_branch: "Production",
      branch: "Production",
      authority_mode: "production_live_or_disabled",
      gateway_class: "activation_gateway_production",
      public_gateway: "activation.mad4b.com",
      upstream_service: "auth.mad4b.com",
    };
  }
  if (environmentKey === "staging") {
    return {
      environment: "staging",
      environment_key: "staging",
      runtime_class: runtimeVariant === "staging_local_windows_docker" ? "local_windows_docker" : "staging_hosted",
      deployment_model: "main_local_staging",
      source_branch: "main",
      branch: "main",
      authority_mode: "non_live",
      gateway_class: "activation_gateway_staging",
      public_gateway: "activation-dev.mad4b.com",
      upstream_service: "dev.mad4b.com",
    };
  }
  if (["test", "ci"].includes(environmentKey)) {
    return {
      environment: environmentKey,
      environment_key: environmentKey,
      runtime_class: "synthetic_non_live",
      deployment_model: "repository_test",
      source_branch: null,
      branch: null,
      authority_mode: "non_live",
      gateway_class: "activation_gateway_synthetic",
      public_gateway: "activation.mad4b.com",
      upstream_service: "auth.mad4b.com",
    };
  }
  return null;
}

export function resolveRuntimeEnvironment(env = process.env) {
  const entries = ENVIRONMENT_KEYS
    .map((key) => ({ key, value: normalize(env?.[key]) }))
    .filter((entry) => entry.value);
  if (entries.length === 0) {
    return Object.freeze({
      ok: false,
      contract: RUNTIME_ENVIRONMENT_RESOLVER_CONTRACT,
      environment_key: null,
      runtime_variant: null,
      reason: "runtime_environment_missing",
      values: [],
      secrets_included: false,
    });
  }

  const evidence = entries.map((entry) => valueEvidence(entry.key, entry.value, ALIASES[entry.value] || null));
  const unknown = evidence.filter((entry) => !entry.canonical);
  if (unknown.length > 0) {
    return Object.freeze({
      ok: false,
      contract: RUNTIME_ENVIRONMENT_RESOLVER_CONTRACT,
      environment_key: null,
      runtime_variant: null,
      reason: "runtime_environment_unknown",
      values: evidence,
      unknown_values: unknown,
      secrets_included: false,
    });
  }

  const canonicalValues = [...new Set(evidence.map((entry) => entry.canonical))];
  if (canonicalValues.length !== 1) {
    return Object.freeze({
      ok: false,
      contract: RUNTIME_ENVIRONMENT_RESOLVER_CONTRACT,
      environment_key: null,
      runtime_variant: null,
      reason: "runtime_environment_conflict",
      values: evidence,
      canonical_values: canonicalValues,
      secrets_included: false,
    });
  }

  const environmentKey = canonicalValues[0];
  const rawVariants = [...new Set(evidence.map((entry) => entry.value))];
  // `staging` declares the environment only. A hosted/local runtime declaration
  // is explicit; never silently select local when another source declares hosted.
  if (rawVariants.includes("staging_hosted") && rawVariants.includes("staging_local_windows_docker")) {
    return Object.freeze({ ok: false, contract: RUNTIME_ENVIRONMENT_RESOLVER_CONTRACT,
      environment_key: null, runtime_variant: null, reason: "runtime_class_conflict", values: evidence, secrets_included: false });
  }
  const runtimeVariant = rawVariants.includes("staging_local_windows_docker")
    ? "staging_local_windows_docker"
    : rawVariants[0];
  const identity = identityFor(environmentKey, runtimeVariant);
  return Object.freeze({
    ok: true,
    contract: RUNTIME_ENVIRONMENT_RESOLVER_CONTRACT,
    ...identity,
    runtime_variant: runtimeVariant,
    reason: null,
    values: evidence,
    unknown_values: [],
    secrets_included: false,
  });
}

export function isStagingRuntime(env = process.env) {
  return resolveRuntimeEnvironment(env).environment_key === "staging";
}

export function isProductionRuntime(env = process.env) {
  return resolveRuntimeEnvironment(env).environment_key === "production";
}

export const _testingRuntimeEnvironmentResolver = Object.freeze({
  ALIASES,
  ENVIRONMENT_KEYS,
  normalize,
});
