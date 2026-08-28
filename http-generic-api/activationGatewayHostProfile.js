import { resolveRuntimeEnvironment } from "./runtimeEnvironmentResolver.js";

const PROFILE_BY_ENVIRONMENT = Object.freeze({
  production: Object.freeze({
    gateway_key: "activation_gateway_production",
    public_host: "activation.mad4b.com",
    upstream_host: "auth.mad4b.com",
    oauth_issuer_host: "auth.mad4b.com",
    admin_auth: "backend_bearer",
    tenant_resource: "activation",
    scope_namespace: "shared_auth_scopes",
  }),
  staging: Object.freeze({
    gateway_key: "activation_gateway_staging",
    public_host: "activation-dev.mad4b.com",
    upstream_host: "dev.mad4b.com",
    oauth_issuer_host: "dev.mad4b.com",
    admin_auth: "backend_bearer",
    tenant_resource: "activation",
    scope_namespace: "shared_auth_scopes",
  }),
  test: Object.freeze({
    gateway_key: "activation_gateway_synthetic",
    public_host: "activation.mad4b.com",
    upstream_host: "auth.mad4b.com",
    oauth_issuer_host: "auth.mad4b.com",
    admin_auth: "backend_bearer",
    tenant_resource: "activation",
    scope_namespace: "shared_auth_scopes",
  }),
  ci: Object.freeze({
    gateway_key: "activation_gateway_synthetic",
    public_host: "activation.mad4b.com",
    upstream_host: "auth.mad4b.com",
    oauth_issuer_host: "auth.mad4b.com",
    admin_auth: "backend_bearer",
    tenant_resource: "activation",
    scope_namespace: "shared_auth_scopes",
  }),
});

function fail(reason, runtime = null) {
  return Object.freeze({
    ok: false,
    contract: "mad4b.activation-gateway-host-profile.v1",
    reason,
    runtime,
    profile: null,
    secrets_included: false,
  });
}

export function resolveActivationGatewayHostProfile(env = process.env) {
  const runtime = resolveRuntimeEnvironment(env);
  if (!runtime.ok) return fail(`runtime_identity_${runtime.reason}`, runtime);
  const base = PROFILE_BY_ENVIRONMENT[runtime.environment_key];
  if (!base) return fail("runtime_identity_environment_unsupported", runtime);

  const configuredPublicHost = String(env.ACTIVATION_HOST_GATEWAY_HOST || "").trim().toLowerCase();
  const configuredUpstreamHost = String(env.ACTIVATION_STAGING_UPSTREAM_HOST || "").trim().toLowerCase();
  if (configuredPublicHost && configuredPublicHost !== base.public_host) {
    return fail("activation_gateway_public_host_conflict", runtime);
  }
  if (runtime.environment_key === "staging" && configuredUpstreamHost && configuredUpstreamHost !== base.upstream_host) {
    return fail("activation_gateway_upstream_host_conflict", runtime);
  }

  return Object.freeze({
    ok: true,
    contract: "mad4b.activation-gateway-host-profile.v1",
    reason: null,
    runtime,
    profile: Object.freeze({
      ...base,
      environment_key: runtime.environment_key,
      runtime_class: runtime.runtime_class,
      public_gateway: `https://${base.public_host}`,
      upstream_origin: `https://${base.upstream_host}`,
      oauth_issuer: `https://${base.oauth_issuer_host}`,
      resource_origin: `https://${base.public_host}`,
      authority_mode: runtime.authority_mode,
    }),
    secrets_included: false,
  });
}

export const _testingActivationGatewayHostProfile = Object.freeze({
  PROFILE_BY_ENVIRONMENT,
});
