import assert from "node:assert/strict";

import {
  PLATFORM_RESOURCE_CONTEXT_SYSTEM_TOOLS,
  platformResourceContextCatalog,
  platformResourceContextDiagnosticHandoff,
  platformResourceContextReadinessSmoke,
  platformResourceContextRelated,
  platformResourceContextResolve,
} from "./platformResourceContextResolver.js";

const tenantId = "tenant-allroyal";
const userId = "user-allroyal";
const otherUserId = "other-user";
const workspaceId = "workspace-allroyal";
const assetId = "asset-allroyal";
const siteId = "site-allroyal";
const wpConnectionId = "connection-wordpress";
const standaloneConnectionId = "connection-analytics";

const brands = [
  {
    target_key: "allroyalegypt_wp",
    brand_name: "AllRoyalEgypt Brand",
    normalized_brand_name: "allroyalegypt brand",
    brand_domain: "allroyalegypt.com",
    base_url: "https://allroyalegypt.com/wp-json",
    site_aliases_json: '["all royal egypt","allroyalegypt","allroyalegypt.com"]',
    primary_site_key: null,
    default_wp_api_base: "https://allroyalegypt.com/wp-json/wp/v2",
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
  workspace_key: "allroyalegypt brand",
  display_name: "AllRoyalEgypt Brand Workspace",
  workspace_type: "brand",
  bootstrap_status: "ready",
  linked_brand_key: "allroyalegypt brand",
}];

const assets = [{
  asset_id: assetId,
  tenant_id: tenantId,
  vault_id: null,
  asset_type: "doc",
  asset_ref: "allroyal-brand-strategy",
  display_name: "All Royal Egypt Brand Strategy",
  brand_ref: "allroyalegypt_wp",
  site_ref: "allroyalegypt.com",
  workflow_ref: null,
  session_ref: null,
  visibility: "workspace",
  lifecycle_status: "active",
}];

const grants = [{
  grant_id: "grant-wordpress",
  site_id: siteId,
  tenant_id: tenantId,
  user_id: userId,
  workspace_id: workspaceId,
  connection_id: wpConnectionId,
  scope: "tenant_brand",
  draft_allowed: 1,
  publish_allowed: 1,
  destructive_allowed: 0,
  status: "active",
}];

const sites = [{
  site_id: siteId,
  app_key: "wordpress_rest",
  normalized_domain: "allroyalegypt.com",
  site_url: "https://allroyalegypt.com",
  wp_json_base: "https://allroyalegypt.com/wp-json",
  canonical_target_key: "allroyalegypt_wp",
  platform_status: "active",
  last_verified_at: "2026-06-02T13:50:17.000Z",
}];

const connections = [
  {
    connection_id: wpConnectionId,
    tenant_id: tenantId,
    user_id: userId,
    app_key: "wordpress_rest",
    display_label: "All Royal Egypt WordPress",
    account_label: "allroyalegypt.com",
    auth_type: "basic_auth",
    api_base_url: "https://allroyalegypt.com/wp-json",
    is_primary: 1,
    status: "active",
    validation_status: "stored_private_admin_connection",
    credential_material_present: 1,
  },
  {
    connection_id: standaloneConnectionId,
    tenant_id: tenantId,
    user_id: otherUserId,
    app_key: "google_analytics",
    display_label: "All Royal Egypt Analytics",
    account_label: "GA4 All Royal Egypt",
    auth_type: "oauth2",
    api_base_url: "https://analyticsdata.googleapis.com",
    is_primary: 0,
    status: "active",
    validation_status: "valid",
    credential_material_present: 1,
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
          resource_ref: "allroyalegypt.com",
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
    workspace_ref: "AllRoyalEgypt Brand Workspace",
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
assert.equal(workspaceContext.context.brands[0].target_key, "allroyalegypt_wp");
assert.equal(workspaceContext.context.sites[0].site_id, siteId);
assert.equal(workspaceContext.context.connections[0].connection_id, wpConnectionId);
assert.equal(workspaceContext.principal.tenant_id, tenantId);
assert.equal(workspaceContext.principal.tenant_override_ignored, true);

const assetContext = await platformResourceContextResolve(
  { asset_ref: "allroyal-brand-strategy", include_brand_context: false },
  { auth, pool: ownerPool }
);
assert.equal(assetContext.match.resource_type, "asset");
assert.equal(assetContext.match.resource_key, assetId);
assert.equal(assetContext.context.workspaces.length, 1);

const siteContext = await platformResourceContextResolve(
  { site_url: "https://allroyalegypt.com", include_brand_context: false },
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
    reference: "اول رويال ايجيبت",
    resource_type: "brand",
    include_brand_context: false,
  },
  { auth, pool: ownerPool }
);
assert.equal(interpretation.status, "interpretation_required");
assert.equal(interpretation.skill.skill_key, "resource_reference_interpreter_v1");
assert.equal(interpretation.authorized_resource_catalog.length, 1);
assert.equal(interpretation.authorized_resource_catalog[0].resource_key, "allroyalegypt_wp");

const interpreted = await platformResourceContextResolve(
  {
    reference: "اول رويال ايجيبت",
    resource_type: "brand",
    candidate_refs: ["all royal egypt", "allroyalegypt"],
    include_brand_context: false,
  },
  { auth, pool: ownerPool }
);
assert.equal(interpreted.status, "resolved");
assert.equal(interpreted.match.resource_type, "brand");
assert.equal(interpreted.match.resource_key, "allroyalegypt_wp");
assert.equal(interpreted.match.method, "interpreted_candidate");

const catalog = await platformResourceContextCatalog(
  { resource_type: "connection", search: "Royal Egypt", cursor: 0, limit: 1 },
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
assert.equal(related.context.connections[0].connection_id, wpConnectionId);

const handoff = await platformResourceContextDiagnosticHandoff(
  { reference: workspaceId, resource_type: "workspace" },
  { auth, pool: ownerPool }
);
assert.equal(handoff.ok, true);
assert.equal(handoff.status, "ready_for_live_diagnostic");
assert.equal(handoff.diagnostic_contexts.length, 1);
assert.equal(handoff.diagnostic_contexts[0].site_id, siteId);
assert.equal(handoff.diagnostic_contexts[0].connection_id, wpConnectionId);
assert.equal(handoff.diagnostic_contexts[0].credential_status, "present");
assert.equal(handoff.diagnostic_contexts[0].connectivity_status, "not_checked");
assert.deepEqual(handoff.diagnostic_contexts[0].diagnostic_tools, [
  "wordpress_auth_context_diagnostic",
  "wordpress_publish_authority_diagnostic",
]);

const memberCatalog = await platformResourceContextCatalog(
  { resource_type: "connection", limit: 100 },
  { auth, pool: makePool({ role: "member" }) }
);
assert.equal(memberCatalog.ok, true);
assert.deepEqual(memberCatalog.items.map((item) => item.resource_key), [wpConnectionId]);

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
