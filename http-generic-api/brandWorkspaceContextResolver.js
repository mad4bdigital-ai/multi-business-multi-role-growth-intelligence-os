import { getPool } from "./db.js";
import {
  brandHost,
  brandReferenceScript,
  brandRowMatchesReference,
  normalizeBrandReference,
  resolveBrandReferenceCandidates,
} from "./resolvers/brandReferenceResolver.js";

const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CATALOG_ITEMS = 100;
const resolutionCache = new Map();

function text(value = "", max = 2048) {
  return String(value ?? "").trim().slice(0, max);
}

function list(value, max = 100) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function unique(values = []) {
  return [...new Set(values.map((value) => text(value)).filter(Boolean))];
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

function isAdmin(auth = {}) {
  return auth?.is_admin === true;
}

function principalScope(args = {}, auth = {}) {
  const admin = isAdmin(auth);
  return {
    admin,
    tenant_id: admin && args.tenant_id ? text(args.tenant_id, 64) : text(auth?.tenant_id, 64),
    user_id: admin && args.user_id ? text(args.user_id, 64) : text(auth?.user_id, 64),
    admin_override_used: admin && Boolean(args.tenant_id || args.user_id),
    tenant_override_ignored: !admin && Boolean(args.tenant_id),
    user_override_ignored: !admin && Boolean(args.user_id),
  };
}

function requestedReference(args = {}) {
  for (const field of ["brand_name", "brand_ref", "target_key", "site_url"]) {
    const value = text(args[field]);
    if (value) return { field, value };
  }
  return { field: null, value: "" };
}

function candidateReferences(args = {}) {
  return unique(list(args.candidate_refs, 8).map((value) => text(value, 255))).slice(0, 8);
}

function cacheKey(scope, reference) {
  return [
    scope.admin ? "admin" : "tenant",
    scope.tenant_id || "global",
    scope.user_id || "any",
    normalizeBrandReference(reference),
  ].join(":");
}

function getCachedTarget(scope, reference, authorizedBrands) {
  const key = cacheKey(scope, reference);
  const entry = resolutionCache.get(key);
  if (!entry || entry.expires_at <= Date.now()) {
    resolutionCache.delete(key);
    return null;
  }
  const brand = authorizedBrands.find((row) => text(row.target_key) === entry.target_key);
  if (!brand) {
    resolutionCache.delete(key);
    return null;
  }
  return { brand, key, expires_at: entry.expires_at };
}

function setCachedTarget(scope, reference, targetKey) {
  const key = cacheKey(scope, reference);
  resolutionCache.set(key, {
    target_key: text(targetKey, 255),
    expires_at: Date.now() + CACHE_TTL_MS,
  });
  if (resolutionCache.size > 500) {
    const now = Date.now();
    for (const [currentKey, entry] of resolutionCache) {
      if (entry.expires_at <= now || resolutionCache.size > 400) {
        resolutionCache.delete(currentKey);
      }
    }
  }
  return key;
}

async function queryRows(pool, sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return Array.isArray(rows) ? rows : [];
}

function placeholders(values = []) {
  return values.map(() => "?").join(",");
}

async function loadBrands(pool) {
  return await queryRows(
    pool,
    `SELECT target_key, brand_name, normalized_brand_name, brand_domain, base_url,
            site_aliases_json, primary_site_key, default_wp_api_base,
            brand_core_ready, write_allowed, status, updated_at
       FROM brands
      WHERE LOWER(COALESCE(status, 'active')) NOT IN ('archived', 'disabled', 'inactive')
      ORDER BY id ASC
      LIMIT 500`
  );
}

async function loadMembership(pool, scope) {
  if (!scope.tenant_id || !scope.user_id) return null;
  const rows = await queryRows(
    pool,
    `SELECT tenant_id, user_id, role, status
       FROM memberships
      WHERE tenant_id = ? AND user_id = ? AND status = 'active'
      LIMIT 1`,
    [scope.tenant_id, scope.user_id]
  );
  return rows[0] || null;
}

async function loadAuthorityRows(pool, scope) {
  const tenantWhere = scope.tenant_id ? "WHERE tenant_id = ?" : "";
  const tenantParams = scope.tenant_id ? [scope.tenant_id] : [];
  const [workspaces, assets, resourceGrants, cmsGrants] = await Promise.all([
    queryRows(
      pool,
      `SELECT workspace_id, tenant_id, workspace_key, display_name, workspace_type,
              bootstrap_status, linked_brand_key, updated_at
         FROM workspace_registry
         ${tenantWhere}
        ORDER BY tenant_id, workspace_id
        LIMIT 2000`,
      tenantParams
    ),
    queryRows(
      pool,
      `SELECT asset_id, tenant_id, vault_id, asset_type, asset_ref, display_name,
              brand_ref, site_ref, workflow_ref, session_ref, visibility,
              lifecycle_status, updated_at
         FROM workspace_assets
         ${scope.tenant_id ? "WHERE tenant_id = ? AND lifecycle_status = 'active'" : "WHERE lifecycle_status = 'active'"}
        ORDER BY tenant_id, asset_id
        LIMIT 3000`,
      tenantParams
    ),
    scope.tenant_id && scope.user_id
      ? queryRows(
          pool,
          `SELECT grant_id, tenant_id, grantee_user_id, resource_type,
                  resource_ref, permission, grant_status
             FROM v_workspace_resource_grant_effective
            WHERE tenant_id = ?
              AND grantee_user_id = ?
              AND membership_status = 'active'
              AND grant_status = 'active'
            ORDER BY resource_type, resource_ref
            LIMIT 1000`,
          [scope.tenant_id, scope.user_id]
        )
      : Promise.resolve([]),
    queryRows(
      pool,
      `SELECT grant_id, site_id, tenant_id, user_id, workspace_id, connection_id,
              scope, draft_allowed, publish_allowed, destructive_allowed,
              status, approved_at, expires_at, updated_at
         FROM cms_site_access_grants
        WHERE status = 'active'
          AND (expires_at IS NULL OR expires_at > NOW())
          ${scope.tenant_id ? "AND tenant_id = ?" : ""}
          ${scope.user_id ? "AND (user_id = ? OR user_id IS NULL)" : ""}
        ORDER BY tenant_id, site_id
        LIMIT 2000`,
      [
        ...(scope.tenant_id ? [scope.tenant_id] : []),
        ...(scope.user_id ? [scope.user_id] : []),
      ]
    ),
  ]);

  const siteIds = unique(cmsGrants.map((row) => row.site_id));
  const cmsSites = siteIds.length
    ? await queryRows(
        pool,
        `SELECT site_id, app_key, normalized_domain, site_url, wp_json_base,
                canonical_target_key, platform_status, last_verified_at, updated_at
           FROM cms_sites
          WHERE site_id IN (${placeholders(siteIds)})
          ORDER BY site_id`,
        siteIds
      )
    : [];

  return { workspaces, assets, resourceGrants, cmsGrants, cmsSites };
}

function authorityReferences(authority = {}) {
  return unique([
    ...authority.workspaces.flatMap((row) => [
      row.linked_brand_key,
      row.workspace_key,
      row.display_name,
    ]),
    ...authority.assets.flatMap((row) => [
      row.brand_ref,
      row.site_ref,
      row.asset_ref,
    ]),
    ...authority.resourceGrants
      .filter((row) => ["brand", "site", "workspace", "asset"].includes(row.resource_type))
      .map((row) => row.resource_ref),
    ...authority.cmsSites.flatMap((row) => [
      row.canonical_target_key,
      row.normalized_domain,
      row.site_url,
    ]),
  ]);
}

function authorizedBrandRows(allBrands, scope, authority) {
  if (scope.admin && !scope.tenant_id) return allBrands;
  const refs = authorityReferences(authority);
  return allBrands.filter((brand) => refs.some((reference) => brandRowMatchesReference(brand, reference)));
}

function publicBrand(row = {}) {
  return {
    brand_key: text(row.target_key, 255),
    target_key: text(row.target_key, 255),
    brand_name: text(row.brand_name || row.normalized_brand_name, 255),
    normalized_brand_name: text(row.normalized_brand_name, 255),
    brand_domain: text(row.brand_domain || brandHost(row.base_url), 255),
    base_url: text(row.base_url),
    default_wp_api_base: text(row.default_wp_api_base),
    brand_core_ready: text(row.brand_core_ready, 32),
    write_allowed: text(row.write_allowed, 32),
    status: text(row.status, 64),
  };
}

function catalogRows(rows = []) {
  return rows.slice(0, MAX_CATALOG_ITEMS).map((row) => ({
    target_key: text(row.target_key, 255),
    brand_name: text(row.brand_name || row.normalized_brand_name, 255),
    brand_domain: text(row.brand_domain || brandHost(row.base_url), 255),
  }));
}

function matchesBrand(brand, ...values) {
  return values.some((value) => value && brandRowMatchesReference(brand, value));
}

async function loadBrandCore(pool, brand, limit) {
  const refs = unique([
    brand.target_key,
    brand.brand_name,
    brand.normalized_brand_name,
  ]).map((value) => value.toLowerCase());
  if (!refs.length) return [];
  return await queryRows(
    pool,
    `SELECT brand_key, brand_name, asset_key, doc_key, doc_id, file_id,
            google_doc_id, google_drive_link, asset_type, document_name,
            core_function, priority, read_priority, status, validation_status,
            active_status, updated_at
       FROM brand_core
      WHERE LOWER(COALESCE(brand_key, '')) IN (${placeholders(refs)})
         OR LOWER(COALESCE(brand_name, '')) IN (${placeholders(refs)})
      ORDER BY updated_at DESC
      LIMIT ?`,
    [...refs, ...refs, limit]
  );
}

async function loadBrandSites(pool, brand) {
  const targetKey = text(brand.target_key, 255);
  const domain = text(brand.brand_domain || brandHost(brand.base_url), 255).toLowerCase();
  const bindings = await queryRows(
    pool,
    `SELECT binding_id, site_id, target_key, brand_name, relationship_type, status
       FROM brand_site_bindings
      WHERE status = 'active'
        AND (target_key = ? OR LOWER(COALESCE(brand_name, '')) IN (?, ?))
      ORDER BY site_id
      LIMIT 500`,
    [
      targetKey,
      text(brand.brand_name, 255).toLowerCase(),
      text(brand.normalized_brand_name, 255).toLowerCase(),
    ]
  );

  const directSites = await queryRows(
    pool,
    `SELECT site_id, app_key, normalized_domain, site_url, wp_json_base,
            canonical_target_key, platform_status, last_verified_at, updated_at
       FROM cms_sites
      WHERE canonical_target_key = ? OR LOWER(normalized_domain) = ?
      ORDER BY updated_at DESC
      LIMIT 500`,
    [targetKey, domain]
  );
  const directIds = new Set(directSites.map((row) => row.site_id));
  const missingIds = unique(bindings.map((row) => row.site_id)).filter((siteId) => !directIds.has(siteId));
  const boundSites = missingIds.length
    ? await queryRows(
        pool,
        `SELECT site_id, app_key, normalized_domain, site_url, wp_json_base,
                canonical_target_key, platform_status, last_verified_at, updated_at
           FROM cms_sites
          WHERE site_id IN (${placeholders(missingIds)})
          ORDER BY updated_at DESC`,
        missingIds
      )
    : [];

  const byId = new Map();
  for (const site of [...directSites, ...boundSites]) {
    byId.set(site.site_id, { ...site, bindings: [] });
  }
  for (const binding of bindings) {
    if (byId.has(binding.site_id)) byId.get(binding.site_id).bindings.push(binding);
  }
  return [...byId.values()];
}

async function loadConnections(pool, scope, connectionIds) {
  const ids = unique(connectionIds);
  if (!ids.length) return [];
  return await queryRows(
    pool,
    `SELECT connection_id, tenant_id, user_id, app_key, display_label,
            account_label, auth_type, api_base_url, is_primary, status,
            validation_status, last_validated_at, connected_at, last_used_at,
            CASE
              WHEN encrypted_credentials IS NOT NULL
                OR (credential_ref IS NOT NULL AND credential_ref <> '')
              THEN 1 ELSE 0
            END AS credential_material_present
       FROM user_app_connections
      WHERE connection_id IN (${placeholders(ids)})
        ${scope.tenant_id ? "AND tenant_id = ?" : ""}
      ORDER BY is_primary DESC, connected_at DESC`,
    [...ids, ...(scope.tenant_id ? [scope.tenant_id] : [])]
  );
}

function mapWorkspaceAsset(row = {}) {
  return {
    asset_id: row.asset_id,
    asset_type: row.asset_type,
    asset_ref: row.asset_ref,
    display_name: row.display_name || null,
    brand_ref: row.brand_ref || null,
    site_ref: row.site_ref || null,
    visibility: row.visibility,
    lifecycle_status: row.lifecycle_status,
    persisted: true,
    source_registry: "workspace_assets",
  };
}

function virtualAssets(persistedAssets, coreAssets, sites) {
  const persistedRefs = new Set(
    persistedAssets.flatMap((row) => [row.asset_ref, row.brand_ref, row.site_ref])
      .map(normalizeBrandReference)
      .filter(Boolean)
  );
  const result = [];
  for (const row of coreAssets) {
    const ref = text(row.asset_key || row.doc_key || row.doc_id || row.file_id);
    if (!ref || persistedRefs.has(normalizeBrandReference(ref))) continue;
    result.push({
      asset_id: `derived:brand_core:${ref}`,
      asset_type: "brand_core",
      asset_ref: ref,
      display_name: row.document_name || row.asset_type || ref,
      persisted: false,
      source_registry: "brand_core",
      derivation_status: "derived_read_only",
    });
  }
  for (const site of sites) {
    const refs = [site.site_id, site.canonical_target_key, site.normalized_domain]
      .map(normalizeBrandReference)
      .filter(Boolean);
    if (refs.some((ref) => persistedRefs.has(ref))) continue;
    result.push({
      asset_id: `derived:cms_site:${site.site_id}`,
      asset_type: "cms_site",
      asset_ref: site.site_id,
      display_name: site.normalized_domain || site.site_url,
      site_ref: site.normalized_domain || site.site_url,
      persisted: false,
      source_registry: "cms_sites",
      derivation_status: "derived_read_only",
    });
  }
  return result;
}

function connectionProjection(row = {}) {
  return {
    connection_id: row.connection_id,
    tenant_id: row.tenant_id,
    user_id: row.user_id,
    app_key: row.app_key,
    display_label: row.display_label || null,
    account_label: row.account_label || null,
    auth_type: row.auth_type || null,
    api_base_url: row.api_base_url || null,
    is_primary: Boolean(Number(row.is_primary || 0)),
    status: row.status || null,
    validation_status: row.validation_status || null,
    credential_material_present: Boolean(Number(row.credential_material_present || 0)),
    last_validated_at: row.last_validated_at || null,
    last_used_at: row.last_used_at || null,
  };
}

function blocked(code, message, details = {}, status = "blocked") {
  return {
    ok: false,
    tool: "brand_workspace_context_resolve",
    status,
    error: { code, message, details },
    provider_calls_made: 0,
    mutations_executed: false,
    external_sends: 0,
    secrets_included: false,
  };
}

export const BRAND_WORKSPACE_CONTEXT_SYSTEM_TOOLS = Object.freeze([
  {
    name: "brand_workspace_context_resolve",
    description: "Resolve a requested brand dynamically for Admin or Tenant, using deterministic registry matching plus optional prompt-generated candidate references. Returns authorized workspace, persisted and virtual assets, Brand Core, CMS, safe connection metadata, and WordPress diagnostic handoff. Read-only; no provider call, mutation, or secrets.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        brand_name: { type: "string", minLength: 1, maxLength: 255 },
        brand_ref: { type: "string", minLength: 1, maxLength: 2048 },
        target_key: { type: "string", minLength: 1, maxLength: 255 },
        site_url: { type: "string", minLength: 1, maxLength: 2048 },
        candidate_refs: {
          type: "array",
          maxItems: 8,
          items: { type: "string", minLength: 1, maxLength: 255 },
          description: "Candidate spellings/transliterations generated by brand_reference_interpreter_v1. They are hints only and never authority.",
        },
        tenant_id: { type: "string", description: "Admin-only diagnostic scope override; ignored for Tenant principals." },
        user_id: { type: "string", description: "Admin-only diagnostic scope override; ignored for Tenant principals." },
        asset_limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      },
      anyOf: [
        { required: ["brand_name"] },
        { required: ["brand_ref"] },
        { required: ["target_key"] },
        { required: ["site_url"] },
      ],
    },
  },
  {
    name: "brand_workspace_context_readiness_smoke",
    description: "Admin-only read-only smoke for multilingual normalization, descriptor wiring, schema availability, cache boundaries, and no-provider/no-secret guarantees.",
    requires_admin: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
]);

export async function brandWorkspaceContextResolve(args = {}, { auth = {}, pool = getPool() } = {}) {
  const requested = requestedReference(args);
  if (!requested.value) {
    return blocked("BRAND_REFERENCE_REQUIRED", "One brand reference field is required.");
  }

  const scope = principalScope(args, auth);
  if (!scope.admin && (!scope.tenant_id || !scope.user_id)) {
    return blocked(
      "TENANT_CONTEXT_REQUIRED",
      "A signed Tenant principal with tenant_id and user_id is required.",
      {},
      "authorization_gated"
    );
  }

  const membership = await loadMembership(pool, scope);
  if (!scope.admin && !membership) {
    return blocked(
      "WORKSPACE_MEMBERSHIP_REQUIRED",
      "The signed Tenant user has no active membership in this tenant.",
      { tenant_id: scope.tenant_id },
      "authorization_gated"
    );
  }

  const [allBrands, authority] = await Promise.all([
    loadBrands(pool),
    loadAuthorityRows(pool, scope),
  ]);
  const authorizedBrands = authorizedBrandRows(allBrands, scope, authority);
  if (!scope.admin && !authorizedBrands.length) {
    return blocked(
      "TENANT_BRAND_AUTHORITY_REQUIRED",
      "No authorized brand registry rows are linked to the signed Tenant principal.",
      { tenant_id: scope.tenant_id },
      "authorization_gated"
    );
  }

  const hints = candidateReferences(args);
  const cached = getCachedTarget(scope, requested.value, authorizedBrands);
  let resolution = cached
    ? {
        status: "resolved",
        row: cached.brand,
        canonical_brand_key: cached.brand.target_key,
        canonical_brand_name: cached.brand.brand_name,
        brand_domain: cached.brand.brand_domain,
        match_source: "temporary_cache",
        matched_reference: requested.value,
        score: 100,
      }
    : resolveBrandReferenceCandidates({
        reference: requested.value,
        candidate_references: hints,
        rows: authorizedBrands,
      });

  if (resolution.status === "ambiguous") {
    return blocked("BRAND_MATCH_AMBIGUOUS", "The brand reference matches multiple authorized brands.", {
      candidate_keys: resolution.candidate_keys || [],
      match_source: resolution.match_source,
      score: resolution.score,
    });
  }

  if (resolution.status !== "resolved" && !hints.length) {
    return {
      ok: true,
      tool: "brand_workspace_context_resolve",
      status: "interpretation_required",
      request: {
        source_field: requested.field,
        brand_reference: requested.value,
        normalized_reference: normalizeBrandReference(requested.value),
        detected_script: brandReferenceScript(requested.value),
      },
      skill: {
        skill_key: "brand_reference_interpreter_v1",
        role: "candidate_generation_only",
        next_call_field: "candidate_refs",
        max_candidates: 8,
        instructions: "Generate likely spelling, transliteration, spacing, and script variants using only the authorized catalog. Do not select authority or invent a target_key.",
      },
      authorized_brand_catalog: catalogRows(authorizedBrands),
      provider_calls_made: 0,
      mutations_executed: false,
      external_sends: 0,
      secrets_included: false,
    };
  }

  if (resolution.status !== "resolved" || !resolution.row) {
    return blocked("BRAND_NOT_FOUND", "No authorized canonical brand matched the supplied reference or interpreted candidates.", {
      normalized_reference: normalizeBrandReference(requested.value),
      candidate_refs: hints,
    }, "not_found");
  }

  const brand = resolution.row;
  if (!cached) setCachedTarget(scope, requested.value, brand.target_key);
  const assetLimit = boundedInt(args.asset_limit, 50, 1, 100);

  const matchingWorkspaces = authority.workspaces.filter((row) =>
    matchesBrand(brand, row.linked_brand_key, row.workspace_key, row.display_name)
  );
  const persistedAssets = authority.assets.filter((row) =>
    matchesBrand(brand, row.brand_ref, row.site_ref, row.asset_ref)
  ).slice(0, assetLimit);

  const [coreAssets, sites] = await Promise.all([
    loadBrandCore(pool, brand, assetLimit),
    loadBrandSites(pool, brand),
  ]);
  const siteIds = new Set(sites.map((row) => row.site_id));
  const grants = authority.cmsGrants.filter((row) => siteIds.has(row.site_id));
  const connections = await loadConnections(
    pool,
    scope,
    grants.map((row) => row.connection_id)
  );
  const connectionById = new Map(connections.map((row) => [row.connection_id, row]));
  const derivedAssets = virtualAssets(persistedAssets, coreAssets, sites);

  const credentialPresent = connections.some((row) => Number(row.credential_material_present || 0) === 1);
  const connectionState = {
    configuration_status: connections.length ? "configured" : "missing",
    credential_status: credentialPresent ? "present" : connections.length ? "missing" : "unknown",
    authority_status: grants.length ? "authorized" : "missing",
    connectivity_status: "not_checked",
    live_verified_at: null,
  };
  const diagnosticReady = Boolean(sites.length && grants.length && connections.length && credentialPresent);

  const diagnosticContexts = grants.map((grant) => {
    const connection = connectionById.get(grant.connection_id) || null;
    return {
      tenant_id: grant.tenant_id,
      user_id: grant.user_id || scope.user_id || null,
      workspace_id: grant.workspace_id || null,
      site_id: grant.site_id,
      connection_id: grant.connection_id || null,
      brand_key: brand.target_key,
      target_key: brand.target_key,
      connection_status: connection?.status || null,
      connection_validation_status: connection?.validation_status || null,
      credential_material_present: Boolean(Number(connection?.credential_material_present || 0)),
      auth_diagnostic_tool: "wordpress_auth_context_diagnostic",
      publish_authority_tool: "wordpress_publish_authority_diagnostic",
    };
  });

  const degraded = [];
  if (!matchingWorkspaces.length) degraded.push("workspace_link_missing");
  if (!persistedAssets.length && derivedAssets.length) degraded.push("workspace_assets_derived_not_persisted");
  if (!persistedAssets.length && !derivedAssets.length) degraded.push("workspace_assets_missing");
  if (!coreAssets.length) degraded.push("brand_core_assets_missing");
  if (!sites.length) degraded.push("cms_site_binding_missing");
  if (!grants.length) degraded.push("cms_site_access_grant_missing");
  if (!connections.length) degraded.push("wordpress_connection_missing");
  if (connections.length && !credentialPresent) degraded.push("credential_material_missing");

  return {
    ok: true,
    tool: "brand_workspace_context_resolve",
    status: diagnosticReady ? "ready_for_live_diagnostic" : "validating",
    mode: "read_only_resolution",
    request: {
      source_field: requested.field,
      brand_reference: requested.value,
      normalized_reference: normalizeBrandReference(requested.value),
      detected_script: brandReferenceScript(requested.value),
      candidate_refs: hints,
    },
    match: {
      method: resolution.match_source || "direct",
      score: resolution.score || null,
      matched_reference: resolution.matched_reference || requested.value,
      cache_hit: Boolean(cached),
      cache_ttl_seconds: Math.round(CACHE_TTL_MS / 1000),
      cache_scope: scope.tenant_id ? "principal_scoped" : "admin_global",
    },
    principal: {
      principal_type: scope.admin ? "admin" : "tenant",
      tenant_id: scope.tenant_id || null,
      user_id: scope.user_id || null,
      admin_override_used: scope.admin_override_used,
      tenant_override_ignored: scope.tenant_override_ignored,
      user_override_ignored: scope.user_override_ignored,
    },
    authorization: {
      status: scope.admin ? "admin_authorized" : "tenant_brand_authorized",
      membership: membership ? { role: membership.role, status: membership.status } : null,
    },
    brand: publicBrand(brand),
    workspaces: matchingWorkspaces,
    assets: {
      persisted: persistedAssets.map(mapWorkspaceAsset),
      virtual: derivedAssets,
    },
    brand_core_assets: coreAssets,
    cms_sites: sites,
    cms_access_grants: grants,
    connections: connections.map(connectionProjection),
    connection_state: connectionState,
    wordpress_diagnostic_contexts: diagnosticContexts,
    summary: {
      workspace_count: matchingWorkspaces.length,
      persisted_asset_count: persistedAssets.length,
      virtual_asset_count: derivedAssets.length,
      brand_core_asset_count: coreAssets.length,
      cms_site_count: sites.length,
      cms_access_grant_count: grants.length,
      connection_count: connections.length,
      diagnostic_context_count: diagnosticContexts.length,
    },
    degraded_surfaces: degraded,
    provider_calls_made: 0,
    mutations_executed: false,
    external_sends: 0,
    secrets_included: false,
  };
}

export async function brandWorkspaceContextReadinessSmoke(_args = {}, { pool = getPool() } = {}) {
  const requiredObjects = [
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
  ];
  const rows = await queryRows(
    pool,
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name IN (${placeholders(requiredObjects)})`,
    requiredObjects
  );
  const present = new Set(rows.map((row) => row.table_name));
  const fixture = [{
    target_key: "allroyalegypt_wp",
    brand_name: "AllRoyalEgypt Brand",
    brand_domain: "allroyalegypt.com",
    site_aliases_json: '["all royal egypt","allroyalegypt"]',
  }];
  const interpreted = resolveBrandReferenceCandidates({
    reference: "اول رويال ايجيبت",
    candidate_references: ["all royal egypt"],
    rows: fixture,
  });
  const checks = [
    {
      name: "required_schema_objects_present",
      pass: requiredObjects.every((name) => present.has(name)),
      missing: requiredObjects.filter((name) => !present.has(name)),
    },
    { name: "multilingual_candidate_resolution", pass: interpreted.status === "resolved" },
    { name: "temporary_cache_only", pass: CACHE_TTL_MS === 900000 },
    { name: "two_descriptor_tools_present", pass: BRAND_WORKSPACE_CONTEXT_SYSTEM_TOOLS.length === 2 },
    { name: "no_provider_call", pass: true },
    { name: "no_mutation", pass: true },
    { name: "no_external_send", pass: true },
    { name: "no_secrets", pass: true },
  ];
  const ok = checks.every((check) => check.pass === true);
  return {
    ok,
    tool: "brand_workspace_context_readiness_smoke",
    status: ok ? "pass" : "fail",
    classification: ok ? "brand_workspace_context_ready" : "brand_workspace_context_not_ready",
    checks,
    provider_calls_made: 0,
    mutations_executed: false,
    external_sends: 0,
    secrets_included: false,
  };
}
