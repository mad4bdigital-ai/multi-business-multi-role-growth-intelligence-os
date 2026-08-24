import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tenantGptRefreshReady } from "./tenantGptOAuthGrantStore.js";
import { buildTrustedIngressReadiness } from "./trustedIngressContract.js";
import { readMcpCatalogSchemaReadiness } from "./mcpCatalogSchemaGuard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mutationRegistryFile = path.resolve(__dirname, "openapi/openapi-mutation-policy.generated.json");

function secretReady(value) {
  return typeof value === "string" && value.trim().length >= 32;
}

function flag(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function readMutationRegistry() {
  try {
    return JSON.parse(fs.readFileSync(mutationRegistryFile, "utf8"));
  } catch {
    return null;
  }
}

export async function buildTenantGptOperationalReadiness({ env = process.env, pool = null } = {}) {
  const refresh = await tenantGptRefreshReady(env, pool);
  const trustedIngress = buildTrustedIngressReadiness(env);
  const mcpCatalogSchema = await readMcpCatalogSchemaReadiness({ pool: pool || undefined });
  const registry = readMutationRegistry();
  const ssoSecretReady = secretReady(env.TENANT_GPT_SSO_SIGNING_SECRET);
  const jwtSecretReady = secretReady(env.JWT_SECRET);
  const cookieHandoffReady = flag(env.TENANT_GPT_SSO_TRUST_BOUNDARY_ATTESTED) && flag(env.ACTIVATION_GATEWAY_POLICY_ATTESTED);
  const externalCanaryPassed = flag(env.TENANT_GPT_EXTERNAL_CANARY_PASSED);
  const browserClientEvidence = flag(env.TENANT_GPT_CHATGPT_CLIENT_EVIDENCE_PASSED);
  const openapiCoverageReady = Boolean(registry?.all_operations_accounted_for === true);
  const mutationGovernanceReady = false;
  const checks = {
    oauth_pkce_ready: true,
    sso_secret_ready: ssoSecretReady,
    jwt_secret_ready: jwtSecretReady,
    activation_cookie_handoff_ready: cookieHandoffReady,
    trusted_ingress_ready: trustedIngress.ready,
    scope_minimization_ready: true,
    refresh_ready: refresh.ready === true,
    openapi_coverage_ready: openapiCoverageReady,
    mcp_catalog_schema_ready: mcpCatalogSchema.ok === true,
    mutation_governance_ready: mutationGovernanceReady,
    external_canary_ready: externalCanaryPassed,
    chatgpt_client_evidence_ready: browserClientEvidence,
  };
  const blocking = Object.entries(checks).filter(([, value]) => value !== true).map(([key]) => key);
  const readinessDomains = {
    discovery: {
      ready: checks.trusted_ingress_ready === true && checks.openapi_coverage_ready === true,
      blocking_checks: ["trusted_ingress_ready", "openapi_coverage_ready"].filter((key) => checks[key] !== true),
    },
    data_plane: {
      ready: checks.mcp_catalog_schema_ready === true && checks.refresh_ready === true,
      blocking_checks: ["mcp_catalog_schema_ready", "refresh_ready"].filter((key) => checks[key] !== true),
    },
    oauth_token: {
      ready: checks.sso_secret_ready === true
        && checks.jwt_secret_ready === true
        && checks.activation_cookie_handoff_ready === true
        && checks.refresh_ready === true,
      blocking_checks: ["sso_secret_ready", "jwt_secret_ready", "activation_cookie_handoff_ready", "refresh_ready"]
        .filter((key) => checks[key] !== true),
    },
    mutation_governance: {
      ready: checks.mutation_governance_ready === true,
      blocking_checks: ["mutation_governance_ready"].filter((key) => checks[key] !== true),
    },
    external_acceptance: {
      ready: checks.external_canary_ready === true && checks.chatgpt_client_evidence_ready === true,
      blocking_checks: ["external_canary_ready", "chatgpt_client_evidence_ready"].filter((key) => checks[key] !== true),
    },
  };
  return {
    ready: blocking.length === 0,
    production_ready: blocking.length === 0,
    discovery_ready: readinessDomains.discovery.ready,
    data_plane_ready: readinessDomains.data_plane.ready,
    oauth_token_ready: readinessDomains.oauth_token.ready,
    mutation_governance_ready: readinessDomains.mutation_governance.ready,
    readiness_domains: readinessDomains,
    environment: String(env.REMOTE_MCP_ENVIRONMENT || env.NODE_ENV || "staging").trim().toLowerCase(),
    checks,
    blocking_checks: blocking,
    refresh_readiness: refresh,
    trusted_ingress: trustedIngress,
    mcp_catalog_schema: mcpCatalogSchema,
    openapi_mutation_registry: {
      present: Boolean(registry),
      operation_count: Number(registry?.operation_count || 0),
      unbound_operation_count: Number(registry?.unbound_operation_count || 0),
      all_operations_accounted_for: registry?.all_operations_accounted_for === true,
      write_activation_allowed: registry?.write_activation_allowed === true,
    },
    write_scopes_enabled: false,
    provider_mutation_allowed: false,
    migrations_applied: false,
    production_allowed: false,
    secrets_included: false,
  };
}
