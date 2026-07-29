import assert from "node:assert/strict";
import "./test-repository-authority-capability-v2-migration.mjs";
import "./test-repository-authority-capability-readiness-repair-migration.mjs";
import "./test-repository-authority-context-resolver.mjs";

import {
  PLATFORM_RESOURCE_CONTEXT_SYSTEM_TOOLS,
  platformResourceContextCatalog,
  platformResourceContextDiagnosticHandoff,
  platformResourceContextReadinessSmoke,
  platformResourceContextRelated,
  platformResourceContextResolve,
} from "./platformResourceContextResolver.js";

const tenantId = "tenant-platform-fixture";
const userId = "user-platform-fixture";
const otherUserId = "other-user";
const workspaceId = "workspace-platform-fixture";
const assetId = "asset-platform-fixture";
const siteId = "site-auth-platform-fixture";
const platformConnectionId = "connection-auth-platform-fixture";
const standaloneConnectionId = "connection-analytics-fixture";

// Brand identity matches the canonical platform registry row. Related workspace,
// asset, site, and connection records are isolated unit-test fixtures.
const brands = [
  {
    target_key: "growth_intelligence_platform",
    brand_name: "Growth Intelligence Platform",
    normalized_brand_name: "growth intelligence platform",
    brand_domain: "mad4b.com",
    base_url: "https://auth.mad4b.com",
    site_aliases_json: '["mad4b.com","auth.mad4b.com","connector.mad4b.com","connect.mad4b.com","n8n.mad4b.com"]',
    primary_site_key: null,
    default_wp_api_base: null,
    brand_core_ready: "Yes",
    write_allowed: "TRUE",
    status: "Active",
  },
  {
    target_key: "unrelated_brand_wp",
    brand_name: "Unrelated Brand",
    normalized_brand_name: "unrelated brand",
    brand_domain: "unrelated.example",
    base_url: "https://unrelated.example/wp-json",
    site_aliases_json: '["unrelated"]',
    status: "Active",
  },
];

const workspaces = [{
  workspace_id: workspaceId,
  tenant_id: tenantId,
  workspace_key: "growth-intelligence-platform",
  display_name: "Growth Intelligence Platform Workspace",
  workspace_type: "brand",
  bootstrap_status: "ready",
  linked_brand_key: "growth_intelligence_platform",
}];

const assets = [{
  asset_id: assetId,
  tenant_id: tenantId,
  vault_id: null,
  asset_type: "doc",
  asset_ref: "growth-intelligence-platform-strategy",
  display_name: "Growth Intelligence Platform Brand Strategy",
  brand_ref: "growth_intelligence_platform",
  site_ref: "auth.mad4b.com",
  workflow_ref: null,
  session_ref: null,
  visibility: "workspace",
  lifecycle_status: "active",
}];

const grants = [{
  grant_id: "grant-platform-api",
  site_id: siteId,
  tenant_id: tenantId,
  user_id: userId,
  workspace_id: workspaceId,
  connection_id: platformConnectionId,
  scope: "tenant_brand",
  draft_allowed: 1,
  publish_allowed: 1,
  destructive_allowed: 0,
  status: "active",
}];

const sites = [{
  site_id: siteId,
  app_key: "internal_platform_api",
  normalized_domain: "auth.mad4b.com",
  site_url: "https://auth.mad4b.com",
  wp_json_base: null,
  canonical_target_key: "growth_intelligence_platform",
  platform_status: "active",
  last_verified_at: "2026-07-02T00:00:00.000Z",
}];

const connections = [
  {
    connection_id: platformConnectionId,
    tenant_id: tenantId,
    user_id: userId,
    app_key: "internal_platform_api",
    display_label: "Growth Intelligence Platform Auth API",
    account_label: "auth.mad4b.com",
    auth_type: "service_auth",
    api_base_url: "https://auth.mad4b.com",
    is_primary: 1,
    status: "active",
    validation_status: "valid",
    credential_material_present: 1,
  },
  {
    connection_id: standaloneConnectionId,
    tenant_id: tenantId,
    user_id: otherUserId,
    app_key: "google_analytics",
    display_label: "Growth Intelligence Platform Analytics",
    account_label: "GA4 Growth Intelligence Platform",
    auth_type: "oauth2",
    api_base_url: "https://analyticsdata.googleapis.com",
    is_primary: 0,
    status: "active",
    validation_status: "valid",
    credential_material_present: 1,
  },
];

const repositoryAuthority = [{
  binding_id: "repository-binding-id",
  binding_key: "growth_intelligence_platform.github.primary.production",
  tenant_id: tenantId,
  workspace_id: workspaceId,
  brand_target_key: "growth_intelligence_platform",
  app_key: "github",
  system_id: "github-system-id",
  installation_id: null,
  connection_id: platformConnectionId,
  provider_key: "github",
  repository_external_id: "1213257854",
  repository_node_id: "R_kgDOSFDYfg",
  canonical_owner: "mad4bdigital-ai",
  canonical_name: "multi-business-multi-role-growth-intelligence-os",
  default_branch: "main",
  environment: "production",
  system_binding_mode: "shared_platform_adapter",
  lifecycle_status: "active",
  authority_version: 1,
  lock_version: 1,
  is_primary: 1,
  readiness_status: "ready",
  issue_code: null,
}];

const repositoryAliases = [
  {
    alias_id: "repository-alias-node",
    binding_id: "repository-binding-id",
    alias_type: "node_id",
    alias_value: "R_kgDOSFDYfg",
    normalized_alias: "r_kgdosfdyfg",
    lifecycle_status: "active",
  },
  {
    alias_id: "repository-alias-name",
    binding_id: "repository-binding-id",
    alias_type: "full_name",
    alias_value: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    normalized_alias: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    lifecycle_status: "active",
  },
];

const repositoryCapabilities = [{
  repository_binding_id: "repository-binding-id",
  capability_binding_id: "repository-capability-id",
  capability_binding_key: "growth_intelligence_platform.github.repository_main_moved_webhook.production",
  capability_key: "github_repository_main_moved_webhook_provision",
  operation_intent: "github_repository_main_moved_webhook_provision",
  business_activity_type_key: "software",
  adapter_key: "github_repository_webhook_v2",
  policy_key: "github_repository_main_moved_webhook_dynamic_binding_apply_v2",
  readback_contract_key: "github_repository_main_moved_webhook_readback_v2",
  credential_ref: "ref:secret:TEST_ONLY_MUST_NOT_LEAK",
  effect_class: "external_write",
  configuration_json: '{"hook_name":"web"}',
  lifecycle_status: "active",
  capability_version: 1,
  lock_version: 1,
  is_primary: 1,
  readiness_status: "ready",
  issue_code: null,
}];

const repositoryPolicyLayers = [
  {
    layer_id: "repository-layer-platform",
    capability_binding_id: "repository-capability-id",
    scope_type: "platform",
    scope_ref: "*",
    precedence: 100,
    configuration_json: '{"security":{"require_signed_ping":true}}',
    lifecycle_status: "active",
    layer_version: 1,
    lock_version: 1,
  },
  {
    layer_id: "repository-layer-brand",
    capability_binding_id: "repository-capability-id",
    scope_type: "brand",
    scope_ref: "growth_intelligence_platform",
    precedence: 400,
    configuration_json: '{"events":["push"]}',
    lifecycle_status: "active",
    layer_version: 1,
    lock_version: 1,
  },
  {
    layer_id: "repository-layer-environment",
    capability_binding_id: "repository-capability-id",
    scope_type: "environment",
    scope_ref: "production",
    precedence: 700,
    configuration_json: '{"active":true}',
    lifecycle_status: "active",
    layer_version: 1,
    lock_version: 1,
  },
];

function makePool({ role = "owner" } = {}) {
  return {
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();

      if (normalized.includes(" FROM brands ")) return [brands];

      if (normalized.includes(" FROM memberships ")) {
        const active = params[0] === tenantId && params[1] === userId;
        return [active ? [{ tenant_id: tenantId, user_id: userId, role, status: "active" }] : []];
      }

      if (normalized.includes(" FROM workspace_registry ")) return [workspaces];
      if (normalized.includes(" FROM workspace_assets ")) return [assets];

      if (normalized.includes(" FROM v_workspace_resource_grant_effective ")) {
        return [role === "member" ? [{
          grant_id: "resource-grant-site",
          tenant_id: tenantId,
          grantee_user_id: userId,
          resource_type: "site",
          resource_ref: "auth.mad4b.com",
          permission: "operate",
          grant_status: "active",
        }] : []];
      }

      if (normalized.includes(" FROM cms_site_access_grants ")) return [grants];
      if (normalized.includes(" FROM cms_sites ")) return [sites];

      if (normalized.includes(" FROM user_app_connections ")) {
        if (normalized.includes("(user_id = ? OR connection_id IN")) {
          return [[connections[0]]];
        }
        if (normalized.includes("tenant_id = ? AND user_id = ?")) {
          return [[connections[0]]];
        }
        return [connections];
      }

      if (normalized.includes(" FROM v_repository_authority_binding_readiness authority ")) {
        return [repositoryAuthority];
      }
      if (normalized.includes(" FROM repository_authority_aliases ")) {
        return [repositoryAliases];
      }
      if (normalized.includes(" FROM v_repository_capability_binding_readiness ")) {
        return [repositoryCapabilities];
      }
      if (normalized.includes(" FROM repository_capability_policy_layers ")) {
        return [repositoryPolicyLayers];
      }

      if (normalized.includes(" FROM information_schema.tables ")) {
        return [[
          "brands",
          "memberships",
          "workspace_registry",
          "workspace_assets",
          "v_workspace_resource_grant_effective",
          "cms_sites",
          "cms_site_access_grants",
          "user_app_connections",
          "repository_authority_bindings",
          "repository_authority_aliases",
          "repository_capability_bindings",
          "repository_capability_policy_layers",
          "v_repository_authority_binding_readiness",
          "v_repository_capability_binding_readiness",
        ].map((table_name) => ({ table_name }))];
      }

      throw new Error(`Unexpected SQL: ${normalized}`);
    },
  };
}

const auth = { is_admin: false, tenant_id: tenantId, user_id: userId };
const ownerPool = makePool({ role: "owner" });

const workspaceContext = await platformResourceContextResolve(
  {
    workspace_ref: "Growth Intelligence Platform Workspace",
    include_brand_context: false,
    tenant_id: "spoofed-tenant",
    user_id: "spoofed-user",
  },
  { auth, pool: ownerPool }
);
assert.equal(workspaceContext.ok, true);
assert.equal(workspaceContext.status, "resolved");
assert.equal(workspaceContext.match.resource_type, "workspace");
assert.equal(workspaceContext.match.resource_key, workspaceId);
assert.equal(workspaceContext.context.brands[0].target_key, "growth_intelligence_platform");
assert.equal(workspaceContext.context.sites[0].site_id, siteId);
assert.equal(workspaceContext.context.connections[0].connection_id, platformConnectionId);
assert.equal(workspaceContext.context.repositories.length, 1);
assert.equal(workspaceContext.context.repositories[0].binding_key, "growth_intelligence_platform.github.primary.production");
assert.equal(workspaceContext.context.repository_capabilities.length, 1);
assert.equal(workspaceContext.context.repository_capabilities[0].configuration.security.require_signed_ping, true);
assert.equal(workspaceContext.context.repository_capabilities[0].configuration_source_map.events, "brand:growth_intelligence_platform");
assert.equal(JSON.stringify(workspaceContext).includes("TEST_ONLY_MUST_NOT_LEAK"), false);
assert.equal(workspaceContext.principal.tenant_id, tenantId);
assert.equal(workspaceContext.principal.tenant_override_ignored, true);

const repositoryContext = await platformResourceContextResolve(
  {
    binding_key: "growth_intelligence_platform.github.primary.production",
    include_brand_context: false,
  },
  { auth, pool: ownerPool }
);
assert.equal(repositoryContext.ok, true);
assert.equal(repositoryContext.match.resource_type, "repository");
assert.equal(repositoryContext.match.resource_key, "growth_intelligence_platform.github.primary.production");
assert.equal(repositoryContext.context.repositories[0].repository_node_id, "R_kgDOSFDYfg");
assert.match(repositoryContext.context.repositories[0].binding_sha256, /^[0-9a-f]{64}$/);
assert.match(repositoryContext.context.repository_capabilities[0].capability_sha256, /^[0-9a-f]{64}$/);
assert.equal(repositoryContext.context.workspaces[0].workspace_id, workspaceId);
assert.equal(repositoryContext.context.connections[0].connection_id, platformConnectionId);
assert.equal(JSON.stringify(repositoryContext).includes("ref:secret:"), false);

const repositoryCatalog = await platformResourceContextCatalog(
  { resource_type: "repository", search: "mad4bdigital-ai", limit: 10 },
  { auth, pool: ownerPool }
);
assert.equal(repositoryCatalog.ok, true);
assert.equal(repositoryCatalog.items.length, 1);
assert.equal(repositoryCatalog.items[0].resource_key, "growth_intelligence_platform.github.primary.production");

const repositoryRelated = await platformResourceContextRelated(
  {
    resource_type: "repository",
    resource_key: "R_kgDOSFDYfg",
    include_brand_context: false,
  },
  { auth, pool: ownerPool }
);
assert.equal(repositoryRelated.ok, true);
assert.equal(repositoryRelated.context.repositories.length, 1);
assert.equal(repositoryRelated.context.repository_capabilities.length, 1);
assert.equal(repositoryRelated.context.brands[0].target_key, "growth_intelligence_platform");
assert.equal(JSON.stringify(repositoryRelated).includes("TEST_ONLY_MUST_NOT_LEAK"), false);

const assetContext = await platformResourceContextResolve(
  { asset_ref: "growth-intelligence-platform-strategy", include_brand_context: false },
  { auth, pool: ownerPool }
);
assert.equal(assetContext.match.resource_type, "asset");
assert.equal(assetContext.match.resource_key, assetId);
assert.equal(assetContext.context.workspaces.length, 1);

const siteContext = await platformResourceContextResolve(
  { site_url: "https://auth.mad4b.com", include_brand_context: false },
  { auth, pool: ownerPool }
);
assert.equal(siteContext.match.resource_type, "site");
assert.equal(siteContext.match.resource_key, siteId);
assert.equal(siteContext.context.cms_access_grants.length, 1);

const standaloneConnection = await platformResourceContextResolve(
  { connection_id: standaloneConnectionId, include_brand_context: false },
  { auth, pool: ownerPool }
);
assert.equal(standaloneConnection.match.resource_type, "connection");
assert.equal(standaloneConnection.context.connections.length, 1);
assert.equal(standaloneConnection.context.connections[0].connection_id, standaloneConnectionId);
assert.equal(standaloneConnection.context.sites.length, 0);

const interpretation = await platformResourceContextResolve(
  {
    reference: "منصة ذكاء النمو",
    resource_type: "brand",
    include_brand_context: false,
  },
  { auth, pool: ownerPool }
);
assert.equal(interpretation.status, "interpretation_required");
assert.equal(interpretation.skill.skill_key, "resource_reference_interpreter_v1");
assert.equal(interpretation.authorized_resource_catalog.length, 1);
assert.equal(interpretation.authorized_resource_catalog[0].resource_key, "growth_intelligence_platform");

const interpreted = await platformResourceContextResolve(
  {
    reference: "منصة ذكاء النمو",
    resource_type: "brand",
    candidate_refs: ["growth intelligence platform", "mad4b.com"],
    include_brand_context: false,
  },
  { auth, pool: ownerPool }
);
assert.equal(interpreted.status, "resolved");
assert.equal(interpreted.match.resource_type, "brand");
assert.equal(interpreted.match.resource_key, "growth_intelligence_platform");
assert.equal(interpreted.match.method, "interpreted_candidate");

const catalog = await platformResourceContextCatalog(
  { resource_type: "connection", search: "Growth Intelligence", cursor: 0, limit: 1 },
  { auth, pool: ownerPool }
);
assert.equal(catalog.ok, true);
assert.equal(catalog.items.length, 1);
assert.equal(catalog.items[0].resource_type, "connection");
assert.equal(catalog.page.has_more, true);
assert.equal(catalog.page.next_cursor, 1);

const related = await platformResourceContextRelated(
  {
    resource_type: "workspace",
    resource_key: workspaceId,
    include_brand_context: false,
  },
  { auth, pool: ownerPool }
);
assert.equal(related.ok, true);
assert.equal(related.helper_mode, "exact_key_related_graph");
assert.equal(related.context.sites.length, 1);
assert.equal(related.context.connections[0].connection_id, platformConnectionId);

const handoff = await platformResourceContextDiagnosticHandoff(
  { reference: workspaceId, resource_type: "workspace" },
  { auth, pool: ownerPool }
);
assert.equal(handoff.ok, true);
assert.equal(handoff.status, "ready_for_live_diagnostic");
assert.equal(handoff.diagnostic_contexts.length, 1);
assert.equal(handoff.diagnostic_contexts[0].site_id, siteId);
assert.equal(handoff.diagnostic_contexts[0].connection_id, platformConnectionId);
assert.equal(handoff.diagnostic_contexts[0].credential_status, "present");
assert.equal(handoff.diagnostic_contexts[0].connectivity_status, "not_checked");
assert.deepEqual(handoff.diagnostic_contexts[0].diagnostic_tools, [
  "runtime_endpoint_preview",
]);

const memberCatalog = await platformResourceContextCatalog(
  { resource_type: "connection", limit: 100 },
  { auth, pool: makePool({ role: "member" }) }
);
assert.equal(memberCatalog.ok, true);
assert.deepEqual(memberCatalog.items.map((item) => item.resource_key), [platformConnectionId]);

const unsigned = await platformResourceContextCatalog(
  {},
  { auth: {}, pool: ownerPool }
);
assert.equal(unsigned.ok, false);
assert.equal(unsigned.status, "authorization_gated");
assert.equal(unsigned.error.code, "TENANT_CONTEXT_REQUIRED");

const smoke = await platformResourceContextReadinessSmoke({}, { pool: ownerPool });
assert.equal(smoke.ok, true);
assert.equal(smoke.status, "pass");
assert.equal(PLATFORM_RESOURCE_CONTEXT_SYSTEM_TOOLS.length, 5);

console.log("generic platform resource context resolver tests passed");
