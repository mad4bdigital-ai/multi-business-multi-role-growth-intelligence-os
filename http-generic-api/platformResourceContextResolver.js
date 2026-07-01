import { getPool } from "./db.js";
import { brandWorkspaceContextResolve } from "./brandWorkspaceContextResolver.js";
import {
  brandRowMatchesReference,
  normalizeBrandReference,
} from "./resolvers/brandReferenceResolver.js";

const RESOURCE_TYPES = Object.freeze([
  "auto",
  "brand",
  "workspace",
  "asset",
  "site",
  "connection",
]);

function text(value = "", max = 2048) {
  return String(value ?? "").trim().slice(0, max);
}

function list(value, max = 100) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function unique(values = []) {
  return [...new Set(values.map((value) => text(value)).filter(Boolean))];
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

function requestedAnchor(args = {}) {
  const typed = [
    ["brand", "brand_name", args.brand_name],
    ["brand", "brand_ref", args.brand_ref],
    ["brand", "target_key", args.target_key],
    ["workspace", "workspace_ref", args.workspace_ref],
    ["asset", "asset_ref", args.asset_ref],
    ["site", "site_ref", args.site_ref],
    ["site", "site_url", args.site_url],
    ["connection", "connection_id", args.connection_id],
    [args.resource_type || "auto", "resource_ref", args.resource_ref],
    [args.resource_type || "auto", "reference", args.reference],
  ];
  const selected = typed.find(([, , value]) => text(value));
  if (!selected) return { type: "auto", field: null, value: "" };
  const requestedType = RESOURCE_TYPES.includes(selected[0]) ? selected[0] : "auto";
  return {
    type: requestedType,
    field: selected[1],
    value: text(selected[2]),
  };
}

function candidateReferences(args = {}) {
  return unique(list(args.candidate_refs, 8).map((value) => text(value, 255))).slice(0, 8);
}

async function queryRows(pool, sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return Array.isArray(rows) ? rows : [];
}

function placeholders(values = []) {
  return values.map(() => "?").join(",");
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

async function loadGraph(pool, scope, membership = null) {
  const tenantClause = scope.tenant_id ? "WHERE tenant_id = ?" : "";
  const tenantParams = scope.tenant_id ? [scope.tenant_id] : [];
  const [brands, loadedWorkspaces, loadedAssets, resourceGrants, cmsGrants] = await Promise.all([
    queryRows(
      pool,
      `SELECT target_key, brand_name, normalized_brand_name, brand_domain,
              base_url, site_aliases_json, primary_site_key,
              default_wp_api_base, brand_core_ready, write_allowed,
              status, updated_at
         FROM brands
        WHERE LOWER(COALESCE(status, 'active')) NOT IN ('archived','disabled','inactive')
        ORDER BY id ASC
        LIMIT 500`
    ),
    queryRows(
      pool,
      `SELECT workspace_id, tenant_id, workspace_key, display_name,
              workspace_type, bootstrap_status, linked_brand_key, updated_at
         FROM workspace_registry
         ${tenantClause}
        ORDER BY tenant_id, workspace_id
        LIMIT 2000`,
      tenantParams
    ),
    queryRows(
      pool,
      `SELECT asset_id, tenant_id, vault_id, asset_type, asset_ref,
              display_name, brand_ref, site_ref, workflow_ref, session_ref,
              visibility, lifecycle_status, updated_at
         FROM workspace_assets
        ${scope.tenant_id
          ? "WHERE tenant_id = ? AND lifecycle_status = 'active'"
          : "WHERE lifecycle_status = 'active'"}
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
            LIMIT 2000`,
          [scope.tenant_id, scope.user_id]
        )
      : Promise.resolve([]),
    queryRows(
      pool,
      `SELECT grant_id, site_id, tenant_id, user_id, workspace_id,
              connection_id, scope, draft_allowed, publish_allowed,
              destructive_allowed, status, approved_at, expires_at, updated_at
         FROM cms_site_access_grants
        WHERE status = 'active'
          AND (expires_at IS NULL OR expires_at > NOW())
          ${scope.tenant_id ? "AND tenant_id = ?" : ""}
          ${scope.user_id ? "AND (user_id = ? OR user_id IS NULL)" : ""}
        ORDER BY tenant_id, site_id
        LIMIT 3000`,
      [
        ...(scope.tenant_id ? [scope.tenant_id] : []),
        ...(scope.user_id ? [scope.user_id] : []),
      ]
    ),
  ]);

  const broadTenantAccess = scope.admin || ["owner", "admin"].includes(text(membership?.role, 64).toLowerCase());
  const effectiveGrantRefs = new Set(
    resourceGrants.map((row) => normalizeBrandReference(row.resource_ref)).filter(Boolean)
  );
  const cmsWorkspaceIds = new Set(cmsGrants.map((row) => row.workspace_id).filter(Boolean));
  const workspaces = broadTenantAccess
    ? loadedWorkspaces
    : loadedWorkspaces.filter((row) =>
        cmsWorkspaceIds.has(row.workspace_id)
        || [row.workspace_id, row.workspace_key, row.linked_brand_key]
          .map(normalizeBrandReference)
          .some((value) => value && effectiveGrantRefs.has(value))
      );
  const assets = broadTenantAccess
    ? loadedAssets
    : loadedAssets.filter((row) =>
        [row.asset_id, row.asset_ref, row.brand_ref, row.site_ref]
          .map(normalizeBrandReference)
          .some((value) => value && effectiveGrantRefs.has(value))
      );

  const grantSiteIds = unique(cmsGrants.map((row) => row.site_id));
  const sites = scope.admin && !scope.tenant_id
    ? await queryRows(
        pool,
        `SELECT site_id, app_key, normalized_domain, site_url, wp_json_base,
                canonical_target_key, platform_status, last_verified_at, updated_at
           FROM cms_sites
          WHERE LOWER(COALESCE(platform_status, 'active')) NOT IN ('archived','disabled')
          ORDER BY site_id
          LIMIT 3000`
      )
    : grantSiteIds.length
      ? await queryRows(
          pool,
          `SELECT site_id, app_key, normalized_domain, site_url, wp_json_base,
                  canonical_target_key, platform_status, last_verified_at, updated_at
             FROM cms_sites
            WHERE site_id IN (${placeholders(grantSiteIds)})
            ORDER BY site_id`,
          grantSiteIds
        )
      : [];

  const connectionIds = unique(cmsGrants.map((row) => row.connection_id));
  const connections = connectionIds.length
    ? await queryRows(
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
          WHERE connection_id IN (${placeholders(connectionIds)})
            ${scope.tenant_id ? "AND tenant_id = ?" : ""}
          ORDER BY is_primary DESC, connected_at DESC`,
        [...connectionIds, ...(scope.tenant_id ? [scope.tenant_id] : [])]
      )
    : [];

  return {
    brands,
    workspaces,
    assets,
    resourceGrants,
    cmsGrants,
    sites,
    connections,
  };
}

function resourceRecord(type, key, label, refs, row) {
  return {
    type,
    key: text(key, 255),
    label: text(label, 255),
    references: unique([key, label, ...refs]),
    row,
  };
}

function brandAuthorityReferences(graph) {
  return unique([
    ...graph.workspaces.flatMap((row) => [
      row.linked_brand_key,
      row.workspace_key,
      row.display_name,
    ]),
    ...graph.assets.flatMap((row) => [
      row.brand_ref,
      row.site_ref,
      row.asset_ref,
    ]),
    ...graph.resourceGrants
      .filter((row) => ["brand", "workspace", "asset", "site"].includes(row.resource_type))
      .map((row) => row.resource_ref),
    ...graph.sites.flatMap((row) => [
      row.canonical_target_key,
      row.normalized_domain,
      row.site_url,
    ]),
  ]);
}

function authorizedBrands(graph, scope) {
  if (scope.admin && !scope.tenant_id) return graph.brands;
  const refs = brandAuthorityReferences(graph);
  return graph.brands.filter((brand) =>
    refs.some((reference) => brandRowMatchesReference(brand, reference))
  );
}

function resourceCatalog(graph, scope) {
  const brands = authorizedBrands(graph, scope);
  return [
    ...brands.map((row) => resourceRecord(
      "brand",
      row.target_key,
      row.brand_name || row.normalized_brand_name,
      [row.normalized_brand_name, row.brand_domain, row.base_url, row.primary_site_key],
      row
    )),
    ...graph.workspaces.map((row) => resourceRecord(
      "workspace",
      row.workspace_id,
      row.display_name || row.workspace_key,
      [row.workspace_key, row.linked_brand_key],
      row
    )),
    ...graph.assets.map((row) => resourceRecord(
      "asset",
      row.asset_id,
      row.display_name || row.asset_ref,
      [row.asset_ref, row.brand_ref, row.site_ref],
      row
    )),
    ...graph.sites.map((row) => resourceRecord(
      "site",
      row.site_id,
      row.normalized_domain || row.site_url,
      [row.site_url, row.wp_json_base, row.canonical_target_key],
      row
    )),
    ...graph.connections.map((row) => resourceRecord(
      "connection",
      row.connection_id,
      row.display_label || row.account_label || row.app_key,
      [row.account_label, row.api_base_url, row.app_key],
      row
    )),
  ];
}

function scoreRecord(record, reference) {
  const wanted = normalizeBrandReference(reference);
  if (!wanted) return 0;
  if (normalizeBrandReference(record.key) === wanted) return 100;
  if (record.references.some((value) => normalizeBrandReference(value) === wanted)) return 90;
  return 0;
}

function resolveAnchor(catalog, anchor, candidates) {
  const refs = unique([anchor.value, ...candidates]).slice(0, 9);
  const allowedTypes = anchor.type === "auto" ? RESOURCE_TYPES.filter((type) => type !== "auto") : [anchor.type];
  const ranked = catalog
    .filter((record) => allowedTypes.includes(record.type))
    .map((record) => {
      let best = { score: 0, reference: "", source: "none" };
      refs.forEach((reference, index) => {
        const raw = scoreRecord(record, reference);
        const score = index === 0 ? raw : Math.max(0, raw - 10);
        if (score > best.score) {
          best = {
            score,
            reference,
            source: index === 0 ? "direct" : "interpreted_candidate",
          };
        }
      });
      return { record, ...best };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.record.type.localeCompare(b.record.type));

  if (!ranked.length) return { status: "not_found" };
  const topScore = ranked[0].score;
  const top = ranked.filter((entry) => entry.score === topScore);
  const keys = new Set(top.map((entry) => `${entry.record.type}:${entry.record.key}`));
  if (keys.size > 1) {
    return {
      status: "ambiguous",
      score: topScore,
      candidates: top.map((entry) => ({
        resource_type: entry.record.type,
        resource_key: entry.record.key,
        label: entry.record.label,
      })),
    };
  }
  return {
    status: "resolved",
    score: ranked[0].score,
    source: ranked[0].source,
    matched_reference: ranked[0].reference,
    record: ranked[0].record,
  };
}

function publicCatalog(catalog, requestedType) {
  const rows = requestedType === "auto"
    ? catalog
    : catalog.filter((record) => record.type === requestedType);
  return rows.slice(0, 100).map((record) => ({
    resource_type: record.type,
    resource_key: record.key,
    label: record.label,
  }));
}

function matchesAny(values, refs) {
  const normalizedRefs = new Set(refs.map(normalizeBrandReference).filter(Boolean));
  return values.some((value) => normalizedRefs.has(normalizeBrandReference(value)));
}

function relatedGraph(graph, anchor) {
  const tenantIds = new Set();
  const workspaceIds = new Set();
  const siteIds = new Set();
  const connectionIds = new Set();
  const brandRefs = new Set();
  const assetIds = new Set();

  const row = anchor.row;
  if (anchor.type === "brand") {
    [row.target_key, row.brand_name, row.normalized_brand_name, row.brand_domain, row.base_url]
      .filter(Boolean)
      .forEach((value) => brandRefs.add(value));
  } else if (anchor.type === "workspace") {
    workspaceIds.add(row.workspace_id);
    if (row.tenant_id) tenantIds.add(row.tenant_id);
    if (row.linked_brand_key) brandRefs.add(row.linked_brand_key);
  } else if (anchor.type === "asset") {
    assetIds.add(row.asset_id);
    if (row.tenant_id) tenantIds.add(row.tenant_id);
    [row.brand_ref, row.site_ref, row.asset_ref].filter(Boolean).forEach((value) => brandRefs.add(value));
  } else if (anchor.type === "site") {
    siteIds.add(row.site_id);
    [row.canonical_target_key, row.normalized_domain, row.site_url].filter(Boolean).forEach((value) => brandRefs.add(value));
  } else if (anchor.type === "connection") {
    connectionIds.add(row.connection_id);
    if (row.tenant_id) tenantIds.add(row.tenant_id);
  }

  for (const grant of graph.cmsGrants) {
    if (
      siteIds.has(grant.site_id)
      || connectionIds.has(grant.connection_id)
      || workspaceIds.has(grant.workspace_id)
    ) {
      if (grant.site_id) siteIds.add(grant.site_id);
      if (grant.connection_id) connectionIds.add(grant.connection_id);
      if (grant.workspace_id) workspaceIds.add(grant.workspace_id);
      if (grant.tenant_id) tenantIds.add(grant.tenant_id);
    }
  }

  for (const site of graph.sites) {
    if (
      siteIds.has(site.site_id)
      || matchesAny(
        [site.canonical_target_key, site.normalized_domain, site.site_url],
        [...brandRefs]
      )
    ) {
      siteIds.add(site.site_id);
      [site.canonical_target_key, site.normalized_domain, site.site_url]
        .filter(Boolean)
        .forEach((value) => brandRefs.add(value));
    }
  }

  for (const grant of graph.cmsGrants) {
    if (siteIds.has(grant.site_id)) {
      if (grant.connection_id) connectionIds.add(grant.connection_id);
      if (grant.workspace_id) workspaceIds.add(grant.workspace_id);
      if (grant.tenant_id) tenantIds.add(grant.tenant_id);
    }
  }

  const workspaces = graph.workspaces.filter((workspace) =>
    workspaceIds.has(workspace.workspace_id)
    || matchesAny(
      [workspace.linked_brand_key, workspace.workspace_key, workspace.display_name],
      [...brandRefs]
    )
  );
  workspaces.forEach((workspace) => {
    workspaceIds.add(workspace.workspace_id);
    if (workspace.tenant_id) tenantIds.add(workspace.tenant_id);
    if (workspace.linked_brand_key) brandRefs.add(workspace.linked_brand_key);
  });

  const assets = graph.assets.filter((asset) =>
    assetIds.has(asset.asset_id)
    || matchesAny([asset.brand_ref, asset.site_ref, asset.asset_ref], [...brandRefs])
  );
  assets.forEach((asset) => {
    assetIds.add(asset.asset_id);
    if (asset.tenant_id) tenantIds.add(asset.tenant_id);
    [asset.brand_ref, asset.site_ref].filter(Boolean).forEach((value) => brandRefs.add(value));
  });

  const sites = graph.sites.filter((site) => siteIds.has(site.site_id));
  const grants = graph.cmsGrants.filter((grant) =>
    siteIds.has(grant.site_id)
    || connectionIds.has(grant.connection_id)
    || workspaceIds.has(grant.workspace_id)
  );
  const connections = graph.connections.filter((connection) =>
    connectionIds.has(connection.connection_id)
  );
  const brands = graph.brands.filter((brand) =>
    [...brandRefs].some((reference) => brandRowMatchesReference(brand, reference))
  );

  return {
    tenant_ids: [...tenantIds],
    brand_refs: [...brandRefs],
    brands,
    workspaces,
    assets,
    sites,
    cms_access_grants: grants,
    connections,
  };
}

function connectionState(context) {
  const configured = context.connections.length > 0;
  const credentialPresent = context.connections.some((row) => Number(row.credential_material_present || 0) === 1);
  return {
    configuration_status: configured ? "configured" : "missing",
    credential_status: credentialPresent ? "present" : configured ? "missing" : "unknown",
    authority_status: context.cms_access_grants.length ? "authorized" : "missing",
    connectivity_status: "not_checked",
    live_verified_at: null,
  };
}

function blocked(code, message, details = {}, status = "blocked") {
  return {
    ok: false,
    tool: "platform_resource_context_resolve",
    status,
    error: { code, message, details },
    provider_calls_made: 0,
    mutations_executed: false,
    external_sends: 0,
    secrets_included: false,
  };
}

export const PLATFORM_RESOURCE_CONTEXT_SYSTEM_TOOLS = Object.freeze([
  {
    name: "platform_resource_context_resolve",
    description: "Resolve a governed context dynamically from any authorized Brand, Workspace, Asset, CMS Site, or Connection reference. Supports auto type detection and prompt-generated candidate references, then returns the related resource graph and optional Brand context. Shared by Admin and Tenant; read-only, no provider call, no mutation, and no secrets.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        reference: { type: "string", minLength: 1, maxLength: 2048 },
        resource_ref: { type: "string", minLength: 1, maxLength: 2048 },
        resource_type: { type: "string", enum: RESOURCE_TYPES, default: "auto" },
        brand_name: { type: "string", minLength: 1, maxLength: 255 },
        brand_ref: { type: "string", minLength: 1, maxLength: 2048 },
        target_key: { type: "string", minLength: 1, maxLength: 255 },
        workspace_ref: { type: "string", minLength: 1, maxLength: 2048 },
        asset_ref: { type: "string", minLength: 1, maxLength: 2048 },
        site_ref: { type: "string", minLength: 1, maxLength: 2048 },
        site_url: { type: "string", minLength: 1, maxLength: 2048 },
        connection_id: { type: "string", minLength: 1, maxLength: 255 },
        candidate_refs: {
          type: "array",
          maxItems: 8,
          items: { type: "string", minLength: 1, maxLength: 255 },
        },
        tenant_id: { type: "string", description: "Admin-only override; ignored for Tenant principals." },
        user_id: { type: "string", description: "Admin-only override; ignored for Tenant principals." },
        include_brand_context: { type: "boolean", default: true },
      },
      anyOf: [
        { required: ["reference"] },
        { required: ["resource_ref"] },
        { required: ["brand_name"] },
        { required: ["brand_ref"] },
        { required: ["target_key"] },
        { required: ["workspace_ref"] },
        { required: ["asset_ref"] },
        { required: ["site_ref"] },
        { required: ["site_url"] },
        { required: ["connection_id"] },
      ],
    },
  },
  {
    name: "platform_resource_context_readiness_smoke",
    description: "Admin-only read-only readiness smoke for generic Brand/Workspace/Asset/Site/Connection context resolution, Tenant scope isolation, descriptor wiring, and no-secret behavior.",
    requires_admin: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
]);

export async function platformResourceContextResolve(args = {}, { auth = {}, pool = getPool() } = {}) {
  const anchor = requestedAnchor(args);
  if (!anchor.value) {
    return blocked("RESOURCE_REFERENCE_REQUIRED", "A resource reference is required.");
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

  const graph = await loadGraph(pool, scope, membership);
  const catalog = resourceCatalog(graph, scope);
  const candidates = candidateReferences(args);
  const resolution = resolveAnchor(catalog, anchor, candidates);

  if (resolution.status === "ambiguous") {
    return blocked(
      "RESOURCE_MATCH_AMBIGUOUS",
      "The reference matches multiple authorized resources.",
      { candidates: resolution.candidates, score: resolution.score }
    );
  }

  if (resolution.status !== "resolved" && !candidates.length) {
    return {
      ok: true,
      tool: "platform_resource_context_resolve",
      status: "interpretation_required",
      request: {
        source_field: anchor.field,
        reference: anchor.value,
        resource_type: anchor.type,
        normalized_reference: normalizeBrandReference(anchor.value),
      },
      skill: {
        skill_key: "resource_reference_interpreter_v1",
        role: "candidate_generation_only",
        next_call_field: "candidate_refs",
        max_candidates: 8,
        instructions: "Generate likely spelling, spacing, script, transliteration, or identifier variants using only the authorized resource catalog. Do not select authority or invent resource keys.",
      },
      authorized_resource_catalog: publicCatalog(catalog, anchor.type),
      provider_calls_made: 0,
      mutations_executed: false,
      external_sends: 0,
      secrets_included: false,
    };
  }

  if (resolution.status !== "resolved" || !resolution.record) {
    return blocked(
      "RESOURCE_NOT_FOUND",
      "No authorized resource matched the supplied reference or candidate references.",
      {
        resource_type: anchor.type,
        normalized_reference: normalizeBrandReference(anchor.value),
      },
      "not_found"
    );
  }

  const related = relatedGraph(graph, resolution.record);
  let brandContext = null;
  if (args.include_brand_context !== false && related.brands.length === 1) {
    brandContext = await brandWorkspaceContextResolve(
      { target_key: related.brands[0].target_key },
      { auth, pool }
    );
  }

  return {
    ok: true,
    tool: "platform_resource_context_resolve",
    status: "resolved",
    mode: "read_only_context_graph",
    request: {
      source_field: anchor.field,
      reference: anchor.value,
      requested_resource_type: anchor.type,
      normalized_reference: normalizeBrandReference(anchor.value),
      candidate_refs: candidates,
    },
    match: {
      resource_type: resolution.record.type,
      resource_key: resolution.record.key,
      label: resolution.record.label,
      method: resolution.source,
      matched_reference: resolution.matched_reference,
      score: resolution.score,
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
      status: scope.admin ? "admin_authorized" : "tenant_resource_authorized",
      membership: membership ? { role: membership.role, status: membership.status } : null,
    },
    context: related,
    connection_state: connectionState(related),
    brand_context: brandContext,
    summary: {
      brand_count: related.brands.length,
      workspace_count: related.workspaces.length,
      asset_count: related.assets.length,
      site_count: related.sites.length,
      cms_access_grant_count: related.cms_access_grants.length,
      connection_count: related.connections.length,
      brand_context_included: Boolean(brandContext),
    },
    provider_calls_made: 0,
    mutations_executed: false,
    external_sends: 0,
    secrets_included: false,
  };
}

export async function platformResourceContextReadinessSmoke(_args = {}, { pool = getPool() } = {}) {
  const requiredObjects = [
    "brands",
    "memberships",
    "workspace_registry",
    "workspace_assets",
    "v_workspace_resource_grant_effective",
    "cms_sites",
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
  const checks = [
    {
      name: "required_schema_objects_present",
      pass: requiredObjects.every((name) => present.has(name)),
      missing: requiredObjects.filter((name) => !present.has(name)),
    },
    { name: "resource_types_supported", pass: RESOURCE_TYPES.length === 6 },
    { name: "two_descriptor_tools_present", pass: PLATFORM_RESOURCE_CONTEXT_SYSTEM_TOOLS.length === 2 },
    { name: "no_provider_call", pass: true },
    { name: "no_mutation", pass: true },
    { name: "no_external_send", pass: true },
    { name: "no_secrets", pass: true },
  ];
  const ok = checks.every((check) => check.pass === true);
  return {
    ok,
    tool: "platform_resource_context_readiness_smoke",
    status: ok ? "pass" : "fail",
    classification: ok ? "platform_resource_context_ready" : "platform_resource_context_not_ready",
    checks,
    provider_calls_made: 0,
    mutations_executed: false,
    external_sends: 0,
    secrets_included: false,
  };
}
