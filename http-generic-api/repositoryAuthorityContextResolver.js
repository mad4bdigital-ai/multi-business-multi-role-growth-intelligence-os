import { createHash } from "node:crypto";
import { getPool } from "./db.js";

const SCOPE_ORDER = Object.freeze({
  platform: 100,
  tenant: 200,
  workspace: 300,
  brand: 400,
  app: 500,
  repository: 600,
  environment: 700,
});

function text(value = "", max = 2048) {
  return String(value ?? "").trim().slice(0, max);
}

function normalize(value = "") {
  return text(value, 2048)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .replace(/[^a-z0-9._:/-]+/g, "");
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function unique(values = []) {
  return [...new Set(values.map((value) => text(value)).filter(Boolean))];
}

function placeholders(values = []) {
  return values.map(() => "?").join(",");
}

async function queryRows(pool, sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return Array.isArray(rows) ? rows : [];
}

function resolverError(code, message, status = 409, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = { ...details, secrets_included: false };
  return error;
}

function mergeLayer(target, source, sourceMap, sourceLabel, path = "") {
  const output = isObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(isObject(source) ? source : {})) {
    const nextPath = path ? `${path}.${key}` : key;
    if (isObject(value)) {
      output[key] = mergeLayer(isObject(output[key]) ? output[key] : {}, value, sourceMap, sourceLabel, nextPath);
    } else {
      output[key] = Array.isArray(value) ? [...value] : value;
      sourceMap[nextPath] = sourceLabel;
    }
  }
  return output;
}

function layerMatches(layer, authority) {
  const rawScopeRef = text(layer.scope_ref, 255);
  const scopeRef = normalize(rawScopeRef);
  switch (layer.scope_type) {
    case "platform": return rawScopeRef === "*";
    case "tenant": return scopeRef === normalize(authority.tenant_id);
    case "workspace": return Boolean(authority.workspace_id) && scopeRef === normalize(authority.workspace_id);
    case "brand": return Boolean(authority.brand_target_key) && scopeRef === normalize(authority.brand_target_key);
    case "app": return scopeRef === normalize(authority.app_key);
    case "repository": return scopeRef === normalize(authority.binding_key);
    case "environment": return scopeRef === normalize(authority.environment);
    default: return false;
  }
}

function resolveCapabilityConfiguration(capability, layers, authority) {
  const sourceMap = {};
  let configuration = mergeLayer({}, parseJson(capability.configuration_json, {}), sourceMap, "capability_binding");
  const appliedLayers = layers
    .filter((layer) => layer.lifecycle_status === "active" && layerMatches(layer, authority))
    .sort((left, right) => {
      const leftOrder = Number(left.precedence || SCOPE_ORDER[left.scope_type] || 999);
      const rightOrder = Number(right.precedence || SCOPE_ORDER[right.scope_type] || 999);
      return leftOrder - rightOrder || String(left.layer_id).localeCompare(String(right.layer_id));
    });
  for (const layer of appliedLayers) {
    configuration = mergeLayer(
      configuration,
      parseJson(layer.configuration_json, {}),
      sourceMap,
      `${layer.scope_type}:${layer.scope_ref}`,
    );
  }
  return {
    configuration,
    source_map: sourceMap,
    layers: appliedLayers.map((layer) => ({
      layer_id: layer.layer_id,
      scope_type: layer.scope_type,
      scope_ref: layer.scope_ref,
      precedence: Number(layer.precedence || 0),
      layer_version: Number(layer.layer_version || 0),
      lock_version: Number(layer.lock_version || 0),
    })),
  };
}

function authorityReferences(authority, aliases = []) {
  return unique([
    authority.binding_key,
    authority.binding_id,
    authority.repository_node_id,
    authority.repository_external_id,
    authority.canonical_owner,
    authority.canonical_name,
    `${authority.canonical_owner}/${authority.canonical_name}`,
    `github.com/${authority.canonical_owner}/${authority.canonical_name}`,
    ...aliases.map((alias) => alias.alias_value),
    ...aliases.map((alias) => alias.normalized_alias),
  ]);
}

function grantRefs(resourceGrants, type) {
  return new Set(
    resourceGrants
      .filter((grant) => grant.resource_type === type)
      .map((grant) => normalize(grant.resource_ref))
      .filter(Boolean),
  );
}

function authorizationSource(authority, aliases, scope, membership, resourceGrants) {
  if (scope.admin && !scope.tenant_id) return "platform_admin";
  if (scope.tenant_id && authority.tenant_id !== scope.tenant_id) return null;
  if (scope.admin) return "admin_tenant_scope";
  if (["owner", "admin"].includes(text(membership?.role, 64).toLowerCase())) return "tenant_membership";

  const repositoryRefs = grantRefs(resourceGrants, "repository");
  if (authorityReferences(authority, aliases).map(normalize).some((value) => repositoryRefs.has(value))) {
    return "direct_repository_grant";
  }
  const workspaceRefs = grantRefs(resourceGrants, "workspace");
  if (authority.workspace_id && workspaceRefs.has(normalize(authority.workspace_id))) return "inherited_workspace_grant";
  const brandRefs = grantRefs(resourceGrants, "brand");
  if (authority.brand_target_key && brandRefs.has(normalize(authority.brand_target_key))) return "inherited_brand_grant";
  const appRefs = grantRefs(resourceGrants, "app");
  if (appRefs.has(normalize(authority.app_key))) return "inherited_app_grant";
  return null;
}

function authorityFingerprint(authority, aliases) {
  return sha256({
    binding_id: authority.binding_id,
    binding_key: authority.binding_key,
    tenant_id: authority.tenant_id,
    workspace_id: authority.workspace_id || null,
    brand_target_key: authority.brand_target_key || null,
    app_key: authority.app_key,
    system_id: authority.system_id,
    installation_id: authority.installation_id || null,
    connection_id: authority.connection_id || null,
    provider_key: authority.provider_key,
    repository_external_id: authority.repository_external_id,
    repository_node_id: authority.repository_node_id,
    canonical_owner: authority.canonical_owner,
    canonical_name: authority.canonical_name,
    default_branch: authority.default_branch,
    environment: authority.environment,
    system_binding_mode: authority.system_binding_mode,
    authority_version: Number(authority.authority_version || 0),
    lock_version: Number(authority.lock_version || 0),
    aliases: aliases
      .filter((alias) => alias.lifecycle_status === "active")
      .map((alias) => ({ type: alias.alias_type, value: alias.normalized_alias }))
      .sort((a, b) => `${a.type}:${a.value}`.localeCompare(`${b.type}:${b.value}`)),
  });
}

function capabilityFingerprint(capability, authoritySha, resolvedConfiguration) {
  return sha256({
    repository_binding_id: capability.repository_binding_id,
    capability_binding_id: capability.capability_binding_id,
    capability_binding_key: capability.capability_binding_key,
    capability_key: capability.capability_key,
    operation_intent: capability.operation_intent,
    business_activity_type_key: capability.business_activity_type_key || null,
    adapter_key: capability.adapter_key,
    policy_key: capability.policy_key || null,
    readback_contract_key: capability.readback_contract_key || null,
    credential_ref: capability.credential_ref || null,
    effect_class: capability.effect_class,
    capability_version: Number(capability.capability_version || 0),
    lock_version: Number(capability.lock_version || 0),
    repository_authority_sha256: authoritySha,
    configuration: resolvedConfiguration.configuration,
    layers: resolvedConfiguration.layers,
  });
}

function publicCapability(capability, authoritySha, layers, authority) {
  const resolved = resolveCapabilityConfiguration(capability, layers, authority);
  return {
    capability_binding_id: capability.capability_binding_id,
    capability_binding_key: capability.capability_binding_key,
    capability_key: capability.capability_key,
    operation_intent: capability.operation_intent,
    business_activity_type_key: capability.business_activity_type_key || null,
    adapter_key: capability.adapter_key,
    policy_key: capability.policy_key || null,
    readback_contract_key: capability.readback_contract_key || null,
    effect_class: capability.effect_class,
    configuration: resolved.configuration,
    configuration_source_map: resolved.source_map,
    applied_policy_layers: resolved.layers,
    capability_sha256: capabilityFingerprint(capability, authoritySha, resolved),
    credential_reference_present: Boolean(capability.credential_ref),
    readiness_status: capability.readiness_status,
    issue_code: capability.issue_code || null,
    lifecycle_status: capability.lifecycle_status,
    secrets_included: false,
  };
}

function publicAuthority(authority, aliases, capabilities, authorization) {
  const authoritySha = authorityFingerprint(authority, aliases);
  return {
    binding_id: authority.binding_id,
    binding_key: authority.binding_key,
    resource_uri: `repository-binding://${encodeURIComponent(authority.binding_key)}`,
    binding_sha256: authoritySha,
    tenant_id: authority.tenant_id,
    workspace_id: authority.workspace_id || null,
    brand_target_key: authority.brand_target_key || null,
    app_key: authority.app_key,
    system_id: authority.system_id,
    installation_id: authority.installation_id || null,
    connection_id: authority.connection_id || null,
    provider_key: authority.provider_key,
    repository_external_id: authority.repository_external_id,
    repository_node_id: authority.repository_node_id,
    canonical_owner: authority.canonical_owner,
    canonical_name: authority.canonical_name,
    full_name: `${authority.canonical_owner}/${authority.canonical_name}`,
    default_branch: authority.default_branch,
    environment: authority.environment,
    system_binding_mode: authority.system_binding_mode,
    authority_version: Number(authority.authority_version || 0),
    lock_version: Number(authority.lock_version || 0),
    is_primary: Number(authority.is_primary || 0) === 1,
    readiness_status: authority.readiness_status,
    issue_code: authority.issue_code || null,
    authorization_source: authorization,
    aliases: aliases
      .filter((alias) => alias.lifecycle_status === "active")
      .map((alias) => ({ alias_type: alias.alias_type, alias_value: alias.alias_value })),
    capabilities: capabilities.map((capability) => publicCapability(capability.row, authoritySha, capability.layers, authority)),
    secrets_included: false,
  };
}

async function loadState(pool, tenantId = "") {
  const tenantClause = tenantId ? "WHERE authority.tenant_id = ?" : "";
  const authorities = await queryRows(
    pool,
    `SELECT authority.*,
            brand.brand_name,
            workspace.workspace_key,
            workspace.display_name AS workspace_name,
            app.display_name AS app_display_name,
            system.system_key,
            system.provider_family,
            system.connector_family,
            connection.display_label AS connection_label,
            connection.validation_status AS connection_validation_status
       FROM v_repository_authority_binding_readiness authority
       LEFT JOIN brands brand ON brand.target_key COLLATE utf8mb4_unicode_ci = authority.brand_target_key COLLATE utf8mb4_unicode_ci
       LEFT JOIN workspace_registry workspace ON workspace.workspace_id COLLATE utf8mb4_unicode_ci = authority.workspace_id COLLATE utf8mb4_unicode_ci
       LEFT JOIN app_integrations app ON app.app_key COLLATE utf8mb4_unicode_ci = authority.app_key COLLATE utf8mb4_unicode_ci
       LEFT JOIN connected_systems system ON system.system_id COLLATE utf8mb4_unicode_ci = authority.system_id COLLATE utf8mb4_unicode_ci
       LEFT JOIN user_app_connections connection ON connection.connection_id COLLATE utf8mb4_unicode_ci = authority.connection_id COLLATE utf8mb4_unicode_ci
       ${tenantClause}
      ORDER BY authority.is_primary DESC, authority.binding_key ASC
      LIMIT 1000`,
    tenantId ? [tenantId] : [],
  );
  if (!authorities.length) return { authorities: [], aliases: [], capabilities: [], layers: [] };
  const bindingIds = authorities.map((row) => row.binding_id);
  const aliases = await queryRows(
    pool,
    `SELECT alias_id, binding_id, alias_type, alias_value, normalized_alias, lifecycle_status
       FROM repository_authority_aliases
      WHERE binding_id IN (${placeholders(bindingIds)})
        AND lifecycle_status = 'active'
      ORDER BY binding_id, alias_type, normalized_alias`,
    bindingIds,
  );
  const capabilities = await queryRows(
    pool,
    `SELECT * FROM v_repository_capability_binding_readiness
      WHERE repository_binding_id IN (${placeholders(bindingIds)})
        AND lifecycle_status = 'active'
      ORDER BY repository_binding_id, is_primary DESC, capability_binding_key`,
    bindingIds,
  );
  const capabilityIds = capabilities.map((row) => row.capability_binding_id);
  const layers = capabilityIds.length
    ? await queryRows(
        pool,
        `SELECT layer_id, capability_binding_id, scope_type, scope_ref, precedence,
                configuration_json, lifecycle_status, layer_version, lock_version
           FROM repository_capability_policy_layers
          WHERE capability_binding_id IN (${placeholders(capabilityIds)})
            AND lifecycle_status = 'active'
          ORDER BY capability_binding_id, precedence, layer_id`,
        capabilityIds,
      )
    : [];
  return { authorities, aliases, capabilities, layers };
}

export async function loadAuthorizedRepositoryContext({
  pool = getPool(),
  scope = {},
  membership = null,
  resourceGrants = [],
} = {}) {
  const tenantId = scope.admin ? text(scope.tenant_id, 64) : text(scope.tenant_id, 64);
  const state = await loadState(pool, tenantId);
  const aliasesByBinding = new Map();
  for (const alias of state.aliases) {
    const rows = aliasesByBinding.get(alias.binding_id) || [];
    rows.push(alias);
    aliasesByBinding.set(alias.binding_id, rows);
  }
  const layersByCapability = new Map();
  for (const layer of state.layers) {
    const rows = layersByCapability.get(layer.capability_binding_id) || [];
    rows.push(layer);
    layersByCapability.set(layer.capability_binding_id, rows);
  }
  const capabilitiesByBinding = new Map();
  for (const capability of state.capabilities) {
    const rows = capabilitiesByBinding.get(capability.repository_binding_id) || [];
    rows.push({ row: capability, layers: layersByCapability.get(capability.capability_binding_id) || [] });
    capabilitiesByBinding.set(capability.repository_binding_id, rows);
  }

  const repositories = [];
  for (const authority of state.authorities) {
    const aliases = aliasesByBinding.get(authority.binding_id) || [];
    const authorization = authorizationSource(authority, aliases, scope, membership, resourceGrants);
    if (!authorization) continue;
    repositories.push(publicAuthority(
      authority,
      aliases,
      capabilitiesByBinding.get(authority.binding_id) || [],
      authorization,
    ));
  }
  return {
    repositories,
    summary: {
      repository_count: repositories.length,
      capability_count: repositories.reduce((sum, repository) => sum + repository.capabilities.length, 0),
      ready_repository_count: repositories.filter((repository) => repository.readiness_status === "ready").length,
      ready_capability_count: repositories.reduce(
        (sum, repository) => sum + repository.capabilities.filter((capability) => capability.readiness_status === "ready").length,
        0,
      ),
    },
    secrets_included: false,
  };
}

export function repositoryResourceRecords(repositoryContext = {}) {
  return (repositoryContext.repositories || []).map((repository) => ({
    type: "repository",
    key: repository.binding_key,
    label: repository.full_name,
    references: unique([
      repository.binding_key,
      repository.binding_id,
      repository.repository_node_id,
      repository.repository_external_id,
      repository.full_name,
      repository.canonical_owner,
      repository.canonical_name,
      `github.com/${repository.full_name}`,
      ...repository.aliases.map((alias) => alias.alias_value),
    ]),
    row: repository,
  }));
}

export function repositoryRelatedContext(repositoryContext = {}, repositoryRef = "") {
  const wanted = normalize(repositoryRef);
  const matches = (repositoryContext.repositories || []).filter((repository) =>
    repositoryResourceRecords({ repositories: [repository] })[0].references
      .map(normalize)
      .includes(wanted),
  );
  if (!matches.length) return { status: "not_found", repositories: [], repository_capabilities: [] };
  if (matches.length > 1) {
    return {
      status: "ambiguous",
      candidates: matches.map((repository) => ({ binding_key: repository.binding_key, full_name: repository.full_name })),
      repositories: [],
      repository_capabilities: [],
    };
  }
  return {
    status: "resolved",
    repositories: matches,
    repository_capabilities: matches[0].capabilities,
  };
}

export async function resolveRepositoryCapabilityAuthority({
  bindingKey,
  capabilityKey,
  expectedBindingSha256 = "",
  expectedCapabilitySha256 = "",
  pool = getPool(),
} = {}) {
  const bindingRows = await queryRows(
    pool,
    `SELECT * FROM v_repository_authority_binding_readiness
      WHERE binding_key = ? AND lifecycle_status = 'active'
      LIMIT 2`,
    [text(bindingKey, 191)],
  );
  if (bindingRows.length !== 1) {
    throw resolverError(
      bindingRows.length ? "repository_authority_binding_ambiguous" : "repository_authority_binding_not_found",
      "A unique active repository authority binding is required.",
      bindingRows.length ? 409 : 404,
      { binding_key: text(bindingKey, 191), binding_count: bindingRows.length },
    );
  }
  const authority = bindingRows[0];
  if (authority.readiness_status !== "ready") {
    throw resolverError("repository_authority_binding_not_ready", "Repository authority binding is not ready.", 409, {
      binding_key: authority.binding_key,
      issue_code: authority.issue_code,
    });
  }
  const aliases = await queryRows(
    pool,
    `SELECT alias_id, binding_id, alias_type, alias_value, normalized_alias, lifecycle_status
       FROM repository_authority_aliases
      WHERE binding_id = ? AND lifecycle_status = 'active'
      ORDER BY alias_type, normalized_alias`,
    [authority.binding_id],
  );
  const authoritySha = authorityFingerprint(authority, aliases);
  if (expectedBindingSha256 && expectedBindingSha256 !== authoritySha) {
    throw resolverError("repository_authority_binding_drifted", "Repository authority binding changed after planning.", 409, {
      binding_key: authority.binding_key,
      expected_binding_sha256: expectedBindingSha256,
      current_binding_sha256: authoritySha,
    });
  }
  const capabilityRows = await queryRows(
    pool,
    `SELECT * FROM v_repository_capability_binding_readiness
      WHERE repository_binding_id = ? AND capability_key = ? AND lifecycle_status = 'active'
      LIMIT 2`,
    [authority.binding_id, text(capabilityKey, 191)],
  );
  if (capabilityRows.length !== 1) {
    throw resolverError(
      capabilityRows.length ? "repository_capability_binding_ambiguous" : "repository_capability_binding_not_found",
      "A unique active repository capability binding is required.",
      capabilityRows.length ? 409 : 404,
      { binding_key: authority.binding_key, capability_key: text(capabilityKey, 191), capability_count: capabilityRows.length },
    );
  }
  const capability = capabilityRows[0];
  if (capability.readiness_status !== "ready") {
    throw resolverError("repository_capability_binding_not_ready", "Repository capability binding is not ready.", 409, {
      capability_binding_key: capability.capability_binding_key,
      issue_code: capability.issue_code,
    });
  }
  const layers = await queryRows(
    pool,
    `SELECT layer_id, capability_binding_id, scope_type, scope_ref, precedence,
            configuration_json, lifecycle_status, layer_version, lock_version
       FROM repository_capability_policy_layers
      WHERE capability_binding_id = ? AND lifecycle_status = 'active'
      ORDER BY precedence, layer_id`,
    [capability.capability_binding_id],
  );
  const resolved = resolveCapabilityConfiguration(capability, layers, authority);
  const capabilitySha = capabilityFingerprint(capability, authoritySha, resolved);
  if (expectedCapabilitySha256 && expectedCapabilitySha256 !== capabilitySha) {
    throw resolverError("repository_capability_binding_drifted", "Repository capability binding changed after planning.", 409, {
      capability_binding_key: capability.capability_binding_key,
      expected_capability_sha256: expectedCapabilitySha256,
      current_capability_sha256: capabilitySha,
    });
  }
  return {
    authority,
    aliases,
    binding_sha256: authoritySha,
    resource_uri: `repository-binding://${encodeURIComponent(authority.binding_key)}`,
    capability,
    capability_sha256: capabilitySha,
    configuration: resolved.configuration,
    configuration_source_map: resolved.source_map,
    applied_policy_layers: resolved.layers,
    credential_ref: capability.credential_ref || null,
    secrets_included: false,
  };
}

export const __test__ = {
  normalize,
  mergeLayer,
  resolveCapabilityConfiguration,
  authorityFingerprint,
  capabilityFingerprint,
  authorizationSource,
};
