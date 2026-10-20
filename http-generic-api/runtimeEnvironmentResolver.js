import {
  RUNTIME_ENVIRONMENT_ALIAS_MAP,
  RUNTIME_ENVIRONMENT_POLICY_CONTRACT,
  canonicalRuntimeVariantFor,
  resolveRuntimeEnvironmentProfile,
} from "./runtimeEnvironmentPolicy.js";

export const RUNTIME_ENVIRONMENT_RESOLVER_CONTRACT = "mad4b.runtime-environment-resolver.v1";

const ENVIRONMENT_KEYS = Object.freeze([
  "DEPLOYMENT_ENVIRONMENT",
  "REMOTE_MCP_ENVIRONMENT",
  "NODE_ENV",
]);

const ALIASES = RUNTIME_ENVIRONMENT_ALIAS_MAP;

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function valueEvidence(key, raw, canonical) {
  return Object.freeze({ key, value: raw, canonical });
}

function identityFor(environmentKey, runtimeVariant) {
  const profile = resolveRuntimeEnvironmentProfile(environmentKey, runtimeVariant);
  if (!profile) return null;
  return {
    environment: profile.environment,
    environment_key: profile.environment_key,
    runtime_class: profile.runtime_class,
    deployment_model: profile.deployment_model,
    source_branch: profile.source_branch,
    branch: profile.branch,
    authority_mode: profile.authority_mode,
    gateway_class: profile.gateway_class,
    public_gateway: profile.public_gateway,
    upstream_service: profile.upstream_service,
  };
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
      runtime_class_explicit: false,
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
      runtime_class_explicit: false,
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
      runtime_class_explicit: false,
      reason: "runtime_environment_conflict",
      values: evidence,
      canonical_values: canonicalValues,
      secrets_included: false,
    });
  }

  const environmentKey = canonicalValues[0];
  const rawVariants = [...new Set(evidence.map((entry) => entry.value))];
  if (rawVariants.includes("staging_hosted") && rawVariants.includes("staging_local_windows_docker")) {
    return Object.freeze({
      ok: false,
      contract: RUNTIME_ENVIRONMENT_RESOLVER_CONTRACT,
      environment_key: null,
      runtime_variant: null,
      runtime_class_explicit: false,
      reason: "runtime_class_conflict",
      values: evidence,
      secrets_included: false,
    });
  }

  const runtimeVariant = rawVariants.includes("staging_local_windows_docker")
    ? "staging_local_windows_docker"
    : rawVariants.includes("staging_hosted")
      ? "staging_hosted"
      : rawVariants.includes("production_hostinger_autodeploy")
        ? "production_hostinger_autodeploy"
        : rawVariants[0];
  const identity = identityFor(environmentKey, runtimeVariant);
  const runtimeClassExplicit = environmentKey === "staging"
    ? rawVariants.includes("staging_local_windows_docker") || rawVariants.includes("staging_hosted")
    : environmentKey === "production"
      ? rawVariants.includes("production_hostinger_autodeploy")
      : true;
  return Object.freeze({
    ok: true,
    contract: RUNTIME_ENVIRONMENT_RESOLVER_CONTRACT,
    ...identity,
    runtime_variant: runtimeVariant,
    canonical_runtime_variant: canonicalRuntimeVariantFor(environmentKey, runtimeVariant),
    runtime_class_explicit: runtimeClassExplicit,
    environment_policy_contract: RUNTIME_ENVIRONMENT_POLICY_CONTRACT,
    reason: null,
    values: evidence,
    unknown_values: [],
    secrets_included: false,
  });
}

export function resolveRuntimeEnvironmentStrict(env = process.env) {
  const resolved = resolveRuntimeEnvironment(env);
  if (!resolved.ok || !["staging", "production"].includes(resolved.environment_key) || resolved.runtime_class_explicit) return resolved;
  return Object.freeze({
    ...resolved,
    ok: false,
    runtime_class: null,
    deployment_model: null,
    reason: "runtime_class_ambiguous",
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
  RUNTIME_ENVIRONMENT_POLICY_CONTRACT,
  ENVIRONMENT_KEYS,
  normalize,
});