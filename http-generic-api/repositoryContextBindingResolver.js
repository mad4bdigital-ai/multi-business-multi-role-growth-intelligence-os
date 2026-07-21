import { createHash } from "node:crypto";
import { getPool } from "./db.js";

function text(value = "", max = 2048) {
  return String(value ?? "").trim().slice(0, max);
}

function normalize(value = "") {
  return text(value, 2048).toLowerCase().replace(/^https?:\/\//, "").replace(/\.git$/, "").replace(/^github\.com\//, "").replace(/[^a-z0-9._/-]+/g, "");
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function unique(values = []) {
  return [...new Set(values.map((value) => text(value)).filter(Boolean))];
}

function bindingError(code, message, status = 409, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = { ...details, secrets_included: false };
  return error;
}

function canonicalResourceUri(bindingKey) {
  return `repository-binding://${encodeURIComponent(text(bindingKey, 191))}`;
}

function bindingFingerprint(row, events) {
  const stable = {
    binding_id: row.binding_id,
    binding_key: row.binding_key,
    tenant_id: row.tenant_id,
    workspace_id: row.workspace_id || null,
    brand_target_key: row.brand_target_key,
    app_key: row.app_key,
    system_id: row.system_id,
    installation_id: row.installation_id || null,
    connection_id: row.connection_id || null,
    repository_provider: row.repository_provider,
    repository_owner: row.repository_owner,
    repository_name: row.repository_name,
    repository_node_id: row.repository_node_id || null,
    default_branch: row.default_branch,
    environment: row.environment,
    webhook_callback_url: row.webhook_callback_url,
    webhook_events: events,
    webhook_secret_ref: row.webhook_secret_ref,
    is_primary: Number(row.is_primary || 0) === 1,
    status: row.status,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function publicBinding(row) {
  const events = unique(parseJson(row.webhook_events_json, [])).slice(0, 20);
  const resourceUri = canonicalResourceUri(row.binding_key);
  return {
    binding_id: row.binding_id,
    binding_key: row.binding_key,
    binding_sha256: bindingFingerprint(row, events),
    resource_uri: resourceUri,
    tenant_id: row.tenant_id,
    workspace_id: row.workspace_id || null,
    brand: {
      target_key: row.brand_target_key,
      name: row.brand_name || null,
      status: row.brand_status || null,
      core_ready: row.brand_core_ready || null,
    },
    application: {
      app_key: row.app_key,
      display_name: row.app_display_name || null,
      auth_type: row.app_auth_type || null,
      status: row.app_status || null,
      connection_id: row.connection_id || null,
      connection_status: row.connection_status || null,
      connection_validation_status: row.connection_validation_status || null,
    },
    system: {
      system_id: row.system_id,
      system_key: row.system_key || null,
      provider_family: row.system_provider_family || null,
      connector_family: row.system_connector_family || null,
      status: row.system_status || null,
      installation_id: row.installation_id || null,
      installation_status: row.installation_status || null,
    },
    repository: {
      provider: row.repository_provider,
      owner: row.repository_owner,
      name: row.repository_name,
      full_name: `${row.repository_owner}/${row.repository_name}`,
      node_id: row.repository_node_id || null,
      default_branch: row.default_branch,
      environment: row.environment,
    },
    webhook: {
      callback_url: row.webhook_callback_url,
      events,
      secret_ref: row.webhook_secret_ref,
    },
    authority: {
      readiness_status: row.readiness_status,
      issue_code: row.issue_code || null,
      brand_rows: Number(row.brand_rows || 0),
      app_rows: Number(row.app_rows || 0),
      workspace_rows: Number(row.workspace_rows || 0),
      workspace_app_link_rows: Number(row.workspace_app_link_rows || 0),
      system_rows: Number(row.system_rows || 0),
      installation_rows: Number(row.installation_rows || 0),
      connection_rows: Number(row.connection_rows || 0),
      secret_reference_rows: Number(row.secret_reference_rows || 0),
    },
    is_primary: Number(row.is_primary || 0) === 1,
    status: row.status,
    updated_at: row.updated_at || null,
    secrets_included: false,
  };
}

async function loadRows(pool, tenantId = "") {
  const params = [];
  let tenantClause = "";
  if (tenantId) {
    tenantClause = "WHERE binding.tenant_id = ?";
    params.push(tenantId);
  }
  const [rows] = await pool.query(
    `SELECT binding.*,
            brand.brand_name, brand.status AS brand_status, brand.brand_core_ready,
            app.display_name AS app_display_name, app.auth_type AS app_auth_type, app.status AS app_status,
            system.system_key, system.provider_family AS system_provider_family,
            system.connector_family AS system_connector_family, system.status AS system_status,
            installation.status AS installation_status,
            connection.status AS connection_status,
            connection.validation_status AS connection_validation_status
       FROM v_repository_context_binding_readiness binding
       LEFT JOIN brands brand
         ON brand.target_key COLLATE utf8mb4_unicode_ci = binding.brand_target_key COLLATE utf8mb4_unicode_ci
       LEFT JOIN app_integrations app
         ON app.app_key COLLATE utf8mb4_unicode_ci = binding.app_key COLLATE utf8mb4_unicode_ci
       LEFT JOIN connected_systems system
         ON system.system_id COLLATE utf8mb4_unicode_ci = binding.system_id COLLATE utf8mb4_unicode_ci
       LEFT JOIN installations installation
         ON installation.installation_id COLLATE utf8mb4_unicode_ci = binding.installation_id COLLATE utf8mb4_unicode_ci
       LEFT JOIN user_app_connections connection
         ON connection.connection_id COLLATE utf8mb4_unicode_ci = binding.connection_id COLLATE utf8mb4_unicode_ci
       ${tenantClause}
      ORDER BY binding.is_primary DESC, binding.binding_key ASC
      LIMIT 500`,
    params,
  );
  return Array.isArray(rows) ? rows : [];
}

function matches(row, args = {}) {
  const bindingKey = normalize(args.binding_key);
  const brandRef = normalize(args.brand_ref || args.brand_target_key);
  const appKey = normalize(args.app_key);
  const repositoryRef = normalize(args.repository_ref);
  const environment = normalize(args.environment);
  if (bindingKey && normalize(row.binding_key) !== bindingKey) return false;
  if (brandRef && ![row.brand_target_key, row.brand_name].map(normalize).includes(brandRef)) return false;
  if (appKey && normalize(row.app_key) !== appKey) return false;
  if (environment && normalize(row.environment) !== environment) return false;
  if (repositoryRef) {
    const repositoryRefs = [
      row.repository_name,
      `${row.repository_owner}/${row.repository_name}`,
      `github.com/${row.repository_owner}/${row.repository_name}`,
    ].map(normalize);
    if (!repositoryRefs.includes(repositoryRef)) return false;
  }
  return true;
}

function selectorPresent(args = {}) {
  return Boolean(text(args.binding_key) || text(args.brand_ref) || text(args.brand_target_key) || text(args.repository_ref) || text(args.app_key));
}

export async function resolveRepositoryContextBinding(args = {}, { auth = {}, pool = getPool(), allowPrimaryDefault = false, allowUnready = false } = {}) {
  const admin = auth?.is_admin === true;
  const requestedTenantId = text(args.tenant_id, 64);
  const tenantId = admin ? requestedTenantId : text(auth?.tenant_id, 64);
  if (!admin && !tenantId) {
    throw bindingError("repository_context_tenant_required", "A signed tenant context is required to resolve repository bindings.", 403);
  }
  if (!selectorPresent(args) && !allowPrimaryDefault) {
    throw bindingError("repository_context_selector_required", "A binding_key, brand_ref, app_key, or repository_ref is required.", 400);
  }

  const rows = await loadRows(pool, tenantId);
  let candidates = rows.filter((row) => row.status === "active" && matches(row, args));
  if (!selectorPresent(args) && allowPrimaryDefault) {
    candidates = rows.filter((row) => row.status === "active" && Number(row.is_primary || 0) === 1);
  }
  if (!candidates.length) {
    throw bindingError("repository_context_binding_not_found", "No active repository context binding matched the supplied selector.", 404, {
      binding_key: text(args.binding_key, 191) || null,
      brand_ref: text(args.brand_ref || args.brand_target_key, 255) || null,
      app_key: text(args.app_key, 64) || null,
      repository_ref: text(args.repository_ref, 255) || null,
      tenant_id: tenantId || null,
    });
  }
  if (candidates.length !== 1) {
    throw bindingError("repository_context_binding_ambiguous", "The selector matched multiple repository context bindings.", 409, {
      candidates: candidates.slice(0, 20).map((row) => ({ binding_key: row.binding_key, repository: `${row.repository_owner}/${row.repository_name}`, environment: row.environment })),
    });
  }
  const binding = publicBinding(candidates[0]);
  if (!allowUnready && binding.authority.readiness_status !== "ready") {
    throw bindingError("repository_context_binding_not_ready", "The repository context binding failed authority readiness checks.", 409, {
      binding_key: binding.binding_key,
      issue_code: binding.authority.issue_code,
      authority: binding.authority,
    });
  }
  return binding;
}

export async function repositoryContextBindingResolve(args = {}, deps = {}) {
  const binding = await resolveRepositoryContextBinding(args, deps);
  return {
    ok: true,
    status: "resolved",
    mode: "read_only_repository_context",
    binding,
    provider_calls_made: 0,
    mutations_executed: false,
    external_sends: 0,
    secrets_included: false,
  };
}

export async function repositoryContextBindingCatalog(args = {}, { auth = {}, pool = getPool() } = {}) {
  const admin = auth?.is_admin === true;
  const tenantId = admin ? text(args.tenant_id, 64) : text(auth?.tenant_id, 64);
  if (!admin && !tenantId) throw bindingError("repository_context_tenant_required", "A signed tenant context is required.", 403);
  const rows = await loadRows(pool, tenantId);
  const search = normalize(args.search);
  const appKey = normalize(args.app_key);
  const brandRef = normalize(args.brand_ref);
  const environment = normalize(args.environment);
  const filtered = rows.filter((row) => {
    if (appKey && normalize(row.app_key) !== appKey) return false;
    if (brandRef && ![row.brand_target_key, row.brand_name].map(normalize).includes(brandRef)) return false;
    if (environment && normalize(row.environment) !== environment) return false;
    if (search && ![row.binding_key, row.brand_target_key, row.brand_name, row.app_key, row.repository_owner, row.repository_name, `${row.repository_owner}/${row.repository_name}`].map(normalize).some((value) => value.includes(search))) return false;
    return true;
  });
  const cursor = Math.max(0, Number.parseInt(args.cursor, 10) || 0);
  const limit = Math.min(Math.max(Number.parseInt(args.limit, 10) || 25, 1), 100);
  const items = filtered.slice(cursor, cursor + limit).map(publicBinding);
  const nextCursor = cursor + items.length;
  return {
    ok: true,
    status: "resolved",
    mode: "read_only_repository_context_catalog",
    items,
    page: {
      cursor,
      limit,
      next_cursor: nextCursor < filtered.length ? nextCursor : null,
      has_more: nextCursor < filtered.length,
      total_count: filtered.length,
    },
    provider_calls_made: 0,
    mutations_executed: false,
    external_sends: 0,
    secrets_included: false,
  };
}

export async function repositoryContextBindingReadinessSmoke(_args = {}, { pool = getPool() } = {}) {
  const [[objects]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'repository_context_bindings') AS table_rows,
       (SELECT COUNT(*) FROM information_schema.views WHERE table_schema = DATABASE() AND table_name = 'v_repository_context_binding_readiness') AS view_rows`
  );
  let readyBindings = 0;
  let issueBindings = 0;
  if (Number(objects?.table_rows || 0) === 1 && Number(objects?.view_rows || 0) === 1) {
    const [[counts]] = await pool.query(
      `SELECT
         SUM(CASE WHEN readiness_status = 'ready' THEN 1 ELSE 0 END) AS ready_bindings,
         SUM(CASE WHEN readiness_status <> 'ready' THEN 1 ELSE 0 END) AS issue_bindings
       FROM v_repository_context_binding_readiness
       WHERE status = 'active'`
    );
    readyBindings = Number(counts?.ready_bindings || 0);
    issueBindings = Number(counts?.issue_bindings || 0);
  }
  const checks = [
    { check: "repository_context_binding_table", pass: Number(objects?.table_rows || 0) === 1 },
    { check: "repository_context_binding_readiness_view", pass: Number(objects?.view_rows || 0) === 1 },
    { check: "repository_context_ready_binding_available", pass: readyBindings > 0 },
    { check: "repository_context_active_binding_issues_absent", pass: issueBindings === 0 },
  ];
  const pass = checks.every((row) => row.pass === true);
  return {
    ok: pass,
    status: pass ? "pass" : "fail",
    classification: pass ? "repository_context_binding_ready" : "repository_context_binding_blocked",
    checks,
    ready_binding_count: readyBindings,
    issue_binding_count: issueBindings,
    provider_calls_made: 0,
    mutations_executed: false,
    external_sends: 0,
    secrets_included: false,
  };
}

export const REPOSITORY_CONTEXT_BINDING_SYSTEM_TOOLS = Object.freeze([
  {
    name: "repository_context_binding_resolve",
    description: "Resolve one governed repository context dynamically from a DB binding that links tenant, workspace, brand, app, system, installation or connection, repository, webhook policy, and secret reference. Read-only and no secrets.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        binding_key: { type: "string", minLength: 1, maxLength: 191 },
        brand_ref: { type: "string", minLength: 1, maxLength: 255 },
        app_key: { type: "string", minLength: 1, maxLength: 64 },
        repository_ref: { type: "string", minLength: 1, maxLength: 255 },
        environment: { type: "string", minLength: 1, maxLength: 32 },
        tenant_id: { type: "string", description: "Admin-only tenant override." },
      },
      anyOf: [
        { required: ["binding_key"] },
        { required: ["brand_ref"] },
        { required: ["repository_ref"] },
        { required: ["app_key"] }
      ],
    },
  },
  {
    name: "repository_context_binding_catalog",
    description: "List authorized repository context bindings with safe brand, app, system, repository, webhook, authority, and fingerprint metadata. Read-only and no secrets.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        search: { type: "string", maxLength: 255 },
        brand_ref: { type: "string", maxLength: 255 },
        app_key: { type: "string", maxLength: 64 },
        environment: { type: "string", maxLength: 32 },
        tenant_id: { type: "string", description: "Admin-only tenant override." },
        cursor: { type: "integer", minimum: 0, default: 0 },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 25 }
      },
    },
  },
  {
    name: "repository_context_binding_readiness_smoke",
    description: "Admin-only readiness smoke for the repository context binding registry and all active binding authority graphs. No provider call, mutation, or secrets.",
    requires_admin: true,
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
]);

export const __test__ = {
  canonicalResourceUri,
  bindingFingerprint,
  publicBinding,
  matches,
};
