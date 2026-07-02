import assert from "node:assert/strict";

import {
  BRAND_WORKSPACE_CONTEXT_SYSTEM_TOOLS,
  brandWorkspaceContextReadinessSmoke,
  brandWorkspaceContextResolve,
} from "./brandWorkspaceContextResolver.js";

const tenantId = "tenant-platform-fixture";
const userId = "user-platform-fixture";
const workspaceId = "workspace-platform-fixture";
const siteId = "site-platform-cms-fixture";
const connectionId = "connection-platform-cms-fixture";
const platformCmsFixtureDomain = "platform-cms-fixture.test";

// Brand identity matches the canonical platform registry row. CMS and connection
// relationships are isolated test fixtures and do not claim live production bindings.
const brands = [
  {
    target_key: "growth_intelligence_platform",
    brand_name: "Growth Intelligence Platform",
    normalized_brand_name: "growth intelligence platform",
    brand_domain: "mad4b.com",
    base_url: "https://auth.mad4b.com",
    site_aliases_json: '["mad4b.com","auth.mad4b.com","connector.mad4b.com","connect.mad4b.com","n8n.mad4b.com"]',
    primary_site_key: null,
    default_wp_api_base: `https://${platformCmsFixtureDomain}/wp-json/wp/v2`,
    brand_core_ready: "Yes",
    write_allowed: "TRUE",
    status: "Active",
    updated_at: "2026-07-01T00:00:00.000Z",
  },
  {
    target_key: "other_brand_wp",
    brand_name: "Other Brand",
    normalized_brand_name: "other brand",
    brand_domain: "other.example",
    base_url: "https://other.example/wp-json",
    site_aliases_json: '["other"]',
    status: "Active",
  },
];

function rowsFor(sql, params = []) {
  const normalized = String(sql).replace(/\s+/g, " ").trim();

  if (normalized.includes(" FROM brands ")) return brands;

  if (normalized.includes(" FROM memberships ")) {
    return params[0] === tenantId && params[1] === userId
      ? [{ tenant_id: tenantId, user_id: userId, role: "owner", status: "active" }]
      : [];
  }

  if (normalized.includes(" FROM workspace_registry ")) {
    if (params.length && params[0] !== tenantId) return [];
    return [{
      workspace_id: workspaceId,
      tenant_id: tenantId,
      workspace_key: "allroyalegypt brand",
      display_name: "AllRoyalEgypt Brand Workspace",
      workspace_type: "brand",
      bootstrap_status: "ready",
      linked_brand_key: "allroyalegypt brand",
      updated_at: "2026-07-01T00:00:00.000Z",
    }];
  }

  if (normalized.includes(" FROM workspace_assets ")) return [];
  if (normalized.includes(" FROM v_workspace_resource_grant_effective ")) return [];

  if (normalized.includes(" FROM cms_site_access_grants ")) {
    if (!params.includes(tenantId)) return [];
    return [{
      grant_id: "grant-allroyal",
      site_id: siteId,
      tenant_id: tenantId,
      user_id: userId,
      workspace_id: workspaceId,
      connection_id: connectionId,
      scope: "tenant_brand",
      draft_allowed: 1,
      publish_allowed: 1,
      destructive_allowed: 0,
      status: "active",
      approved_at: "2026-06-02T00:00:00.000Z",
      expires_at: null,
      updated_at: "2026-07-01T00:00:00.000Z",
    }];
  }

  if (normalized.includes(" FROM cms_sites ")) {
    return [{
      site_id: siteId,
      app_key: "wordpress_rest",
      normalized_domain: "allroyalegypt.com",
      site_url: "https://allroyalegypt.com",
      wp_json_base: "https://allroyalegypt.com/wp-json",
      canonical_target_key: "allroyalegypt_wp",
      platform_status: "active",
      last_verified_at: "2026-06-02T13:50:17.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
    }];
  }

  if (normalized.includes(" FROM brand_core ")) {
    return [{
      brand_key: "allroyalegypt_wp",
      brand_name: "AllRoyalEgypt Brand",
      asset_key: "brand_strategy",
      doc_key: "brand_strategy",
      doc_id: "drive-file-id",
      file_id: null,
      google_doc_id: null,
      google_drive_link: "https://drive.google.com/file/d/drive-file-id/view",
      asset_type: "strategy",
      document_name: "All Royal Egypt Brand Strategy",
      core_function: "strategy_authority",
      priority: "1",
      read_priority: "1",
      status: "active",
      validation_status: "valid",
      active_status: "active",
      updated_at: "2026-07-01T00:00:00.000Z",
    }];
  }

  if (normalized.includes(" FROM brand_site_bindings ")) {
    return [{
      binding_id: "binding-allroyal",
      site_id: siteId,
      target_key: "allroyalegypt_wp",
      brand_name: "AllRoyalEgypt Brand",
      relationship_type: "primary",
      status: "active",
    }];
  }

  if (normalized.includes(" FROM user_app_connections ")) {
    return [{
      connection_id: connectionId,
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
      last_validated_at: "2026-06-02T00:00:00.000Z",
      connected_at: "2026-06-01T00:00:00.000Z",
      last_used_at: null,
    }];
  }

  if (normalized.includes(" FROM information_schema.tables ")) {
    return [
      "brands",
      "brand_core",
      "memberships",
      "workspace_registry",
      "workspace_assets",
      "v_workspace_resource_grant_effective",
      "cms_sites",
      "brand_site_bindings",
      "cms_site_access_grants",
      "user_app_connections",
    ].map((table_name) => ({ table_name }));
  }

  throw new Error(`Unexpected SQL: ${normalized}`);
}

const pool = {
  async query(sql, params = []) {
    return [rowsFor(sql, params)];
  },
};

const auth = { is_admin: false, tenant_id: tenantId, user_id: userId };

const firstPass = await brandWorkspaceContextResolve(
  {
    brand_name: "اول رويال ايجيبت",
    tenant_id: "spoofed-tenant",
    user_id: "spoofed-user",
  },
  { auth, pool }
);
assert.equal(firstPass.ok, true);
assert.equal(firstPass.status, "interpretation_required");
assert.equal(firstPass.skill.skill_key, "brand_reference_interpreter_v1");
assert.equal(firstPass.authorized_brand_catalog.length, 1);
assert.equal(firstPass.authorized_brand_catalog[0].target_key, "allroyalegypt_wp");
assert.equal(firstPass.request.detected_script, "Arab");

const resolved = await brandWorkspaceContextResolve(
  {
    brand_name: "اول رويال ايجيبت",
    candidate_refs: ["all royal egypt", "allroyalegypt"],
    tenant_id: "spoofed-tenant",
    user_id: "spoofed-user",
  },
  { auth, pool }
);
assert.equal(resolved.ok, true);
assert.equal(resolved.status, "ready_for_live_diagnostic");
assert.equal(resolved.brand.target_key, "allroyalegypt_wp");
assert.equal(resolved.match.method, "interpreted_candidate");
assert.equal(resolved.principal.tenant_id, tenantId);
assert.equal(resolved.principal.user_id, userId);
assert.equal(resolved.principal.tenant_override_ignored, true);
assert.equal(resolved.principal.user_override_ignored, true);
assert.equal(resolved.assets.persisted.length, 0);
assert.equal(resolved.assets.virtual.length, 2);
assert.equal(resolved.connection_state.configuration_status, "configured");
assert.equal(resolved.connection_state.credential_status, "present");
assert.equal(resolved.connection_state.authority_status, "authorized");
assert.equal(resolved.connection_state.connectivity_status, "not_checked");
assert.equal(resolved.wordpress_diagnostic_contexts[0].connection_id, connectionId);
assert.ok(resolved.degraded_surfaces.includes("workspace_assets_derived_not_persisted"));
assert.equal(resolved.provider_calls_made, 0);
assert.equal(resolved.mutations_executed, false);
assert.equal(resolved.secrets_included, false);

const cached = await brandWorkspaceContextResolve(
  { brand_name: "اول رويال ايجيبت" },
  { auth, pool }
);
assert.equal(cached.ok, true);
assert.equal(cached.status, "ready_for_live_diagnostic");
assert.equal(cached.match.method, "temporary_cache");
assert.equal(cached.match.cache_hit, true);

const unauthorized = await brandWorkspaceContextResolve(
  { brand_name: "All Royal Egypt" },
  {
    auth: { is_admin: false, tenant_id: "other-tenant", user_id: "other-user" },
    pool,
  }
);
assert.equal(unauthorized.ok, false);
assert.equal(unauthorized.status, "authorization_gated");
assert.equal(unauthorized.error.code, "WORKSPACE_MEMBERSHIP_REQUIRED");

const smoke = await brandWorkspaceContextReadinessSmoke({}, { pool });
assert.equal(smoke.ok, true);
assert.equal(smoke.status, "pass");
assert.equal(BRAND_WORKSPACE_CONTEXT_SYSTEM_TOOLS.length, 2);

console.log("dynamic brand workspace context resolver tests passed");
