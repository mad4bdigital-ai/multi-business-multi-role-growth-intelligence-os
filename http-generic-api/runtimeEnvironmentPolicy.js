// Repository-owned specialized runtime_policy registry; not a general Config Catalog entry.
// Authority family: platform_engine_policy / platform_policy_registry; values are code-reviewed deployment invariants.
export const RUNTIME_ENVIRONMENT_POLICY_CONTRACT = "mad4b.runtime-environment-policy.v1";

function freezeProfile(profile) {
  return Object.freeze({
    ...profile,
    aliases: Object.freeze([...(profile.aliases || [])]),
    explicit_variants: Object.freeze([...(profile.explicit_variants || [])]),
  });
}

export const RUNTIME_ENVIRONMENT_PROFILES = Object.freeze({
  production: freezeProfile({
    environment: "production",
    environment_key: "production",
    canonical_variant: "production_hostinger_autodeploy",
    aliases: ["production", "prod", "production_hostinger_autodeploy"],
    explicit_variants: ["production_hostinger_autodeploy"],
    runtime_class: "hostinger_autodeploy",
    deployment_model: "production_hostinger",
    source_branch: "Production",
    branch: "Production",
    authority_mode: "production_live_or_disabled",
    gateway_class: "activation_gateway_production",
    public_gateway: "activation.mad4b.com",
    upstream_service: "auth.mad4b.com",
  }),
  staging_local_windows_docker: freezeProfile({
    environment: "staging",
    environment_key: "staging",
    canonical_variant: "staging_local_windows_docker",
    aliases: ["staging_local_windows_docker"],
    explicit_variants: ["staging_local_windows_docker"],
    runtime_class: "local_windows_docker",
    deployment_model: "main_local_staging",
    source_branch: "main",
    branch: "main",
    authority_mode: "non_live",
    gateway_class: "activation_gateway_staging",
    public_gateway: "activation-dev.mad4b.com",
    upstream_service: "dev.mad4b.com",
  }),
  staging_hosted: freezeProfile({
    environment: "staging",
    environment_key: "staging",
    canonical_variant: "staging_hosted",
    aliases: ["staging_hosted"],
    explicit_variants: ["staging_hosted"],
    runtime_class: "staging_hosted",
    deployment_model: "main_hosted_staging",
    source_branch: "main",
    branch: "main",
    authority_mode: "non_live",
    gateway_class: "activation_gateway_staging",
    public_gateway: "activation-dev.mad4b.com",
    upstream_service: "dev.mad4b.com",
  }),
  staging_ambiguous: freezeProfile({
    environment: "staging",
    environment_key: "staging",
    canonical_variant: null,
    aliases: ["staging"],
    explicit_variants: [],
    runtime_class: "staging_hosted",
    deployment_model: "main_hosted_staging",
    source_branch: "main",
    branch: "main",
    authority_mode: "non_live",
    gateway_class: "activation_gateway_staging",
    public_gateway: "activation-dev.mad4b.com",
    upstream_service: "dev.mad4b.com",
  }),
  test: freezeProfile({
    environment: "test",
    environment_key: "test",
    canonical_variant: "test",
    aliases: ["test"],
    explicit_variants: ["test"],
    runtime_class: "synthetic_non_live",
    deployment_model: "repository_test",
    source_branch: null,
    branch: null,
    authority_mode: "non_live",
    gateway_class: "activation_gateway_synthetic",
    public_gateway: "activation.mad4b.com",
    upstream_service: "auth.mad4b.com",
  }),
  ci: freezeProfile({
    environment: "ci",
    environment_key: "ci",
    canonical_variant: "ci",
    aliases: ["ci"],
    explicit_variants: ["ci"],
    runtime_class: "synthetic_non_live",
    deployment_model: "repository_test",
    source_branch: null,
    branch: null,
    authority_mode: "non_live",
    gateway_class: "activation_gateway_synthetic",
    public_gateway: "activation.mad4b.com",
    upstream_service: "auth.mad4b.com",
  }),
});

export const RUNTIME_ENVIRONMENT_ALIAS_MAP = Object.freeze({
  production: "production",
  prod: "production",
  production_hostinger_autodeploy: "production",
  staging: "staging",
  staging_hosted: "staging",
  staging_local_windows_docker: "staging",
  test: "test",
  ci: "ci",
});

export function resolveRuntimeEnvironmentProfile(environmentKey, runtimeVariant = null) {
  if (environmentKey === "production") return RUNTIME_ENVIRONMENT_PROFILES.production;
  if (environmentKey === "staging") {
    if (runtimeVariant === "staging_local_windows_docker") return RUNTIME_ENVIRONMENT_PROFILES.staging_local_windows_docker;
    if (runtimeVariant === "staging_hosted") return RUNTIME_ENVIRONMENT_PROFILES.staging_hosted;
    return RUNTIME_ENVIRONMENT_PROFILES.staging_ambiguous;
  }
  return RUNTIME_ENVIRONMENT_PROFILES[environmentKey] || null;
}

export function canonicalRuntimeVariantFor(environmentKey, runtimeVariant = null) {
  return resolveRuntimeEnvironmentProfile(environmentKey, runtimeVariant)?.canonical_variant || null;
}