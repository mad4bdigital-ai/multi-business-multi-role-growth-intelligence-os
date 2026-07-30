import { getPool } from "./db.js";

function text(value = "", max = 2048) {
  return String(value ?? "").trim().slice(0, max);
}

function normalize(value = "") {
  return text(value).toLowerCase().replace(/\/$/, "");
}

function unique(values = []) {
  return [...new Set(values.map((value) => text(value)).filter(Boolean))];
}

function resourceCandidates(resourceRef = "") {
  const raw = text(resourceRef);
  const values = [raw, normalize(raw)];
  try {
    const url = new URL(raw);
    values.push(url.hostname, url.origin, url.pathname.replace(/^\/+|\/+$/g, ""));
  } catch {
    // Non-URL resource keys are expected.
  }
  return unique(values.map(normalize)).slice(0, 8);
}

async function rows(pool, sql, params = []) {
  const [result] = await pool.query(sql, params);
  return Array.isArray(result) ? result : [];
}

function placeholders(values = []) {
  return values.map(() => "?").join(",");
}

export async function resolveExactResourceConnection({
  tenantId,
  userId,
  workspaceId,
  appKey,
  resourceRef,
  requestedConnectionId = "",
}, { pool = getPool() } = {}) {
  const scope = {
    tenant_id: text(tenantId, 64),
    user_id: text(userId, 64),
    workspace_id: text(workspaceId, 64),
    app_key: text(appKey, 128),
    resource_ref: text(resourceRef, 2048),
    requested_connection_id: text(requestedConnectionId, 64),
  };
  if (!scope.tenant_id || !scope.workspace_id || !scope.app_key) {
    return {
      ok: false,
      status: "resource_binding_context_required",
      error: { code: "RESOURCE_BINDING_CONTEXT_REQUIRED", message: "Tenant, Workspace, and app context are required." },
      secrets_included: false,
    };
  }
  if (!scope.resource_ref) {
    return {
      ok: false,
      status: "resource_ref_required",
      error: { code: "RESOURCE_REF_REQUIRED", message: "resource_ref is required for connection-backed capabilities." },
      secrets_included: false,
    };
  }

  const refs = resourceCandidates(scope.resource_ref);
  try {
    const linked = await rows(
      pool,
      `SELECT uac.connection_id, uac.validation_status, uac.status, uac.is_primary, uac.last_validated_at
         FROM workspace_app_links wal
         JOIN user_app_connections uac
           ON uac.connection_id COLLATE utf8mb4_unicode_ci = wal.connection_id COLLATE utf8mb4_unicode_ci
        WHERE wal.tenant_id = ?
          AND wal.workspace_id = ?
          AND wal.app_key = ?
          AND wal.status = 'active'
          AND uac.tenant_id = ?
          AND uac.status = 'active'
        ORDER BY uac.is_primary DESC, uac.last_validated_at DESC, uac.connection_id`,
      [scope.tenant_id, scope.workspace_id, scope.app_key, scope.tenant_id]
    );
    const linkedIds = new Set(linked.map((row) => text(row.connection_id, 64)));
    const sources = new Map();
    const add = (connectionId, source, resource) => {
      const id = text(connectionId, 64);
      if (!id || !linkedIds.has(id)) return;
      if (!sources.has(id)) sources.set(id, { connection_id: id, sources: [], resources: [] });
      const entry = sources.get(id);
      if (!entry.sources.includes(source)) entry.sources.push(source);
      if (resource && !entry.resources.includes(resource)) entry.resources.push(resource);
    };

    if (refs.length) {
      const credentialRows = await rows(
        pool,
        `SELECT connection_id, target_key
           FROM credential_bindings
          WHERE tenant_id = ?
            AND status = 'active'
            AND connection_id IS NOT NULL
            AND LOWER(COALESCE(target_key, '')) IN (${placeholders(refs)})
          ORDER BY resolution_priority DESC, updated_at DESC`,
        [scope.tenant_id, ...refs]
      );
      for (const row of credentialRows) add(row.connection_id, "credential_bindings.target_key", normalize(row.target_key));

      const cmsRows = await rows(
        pool,
        `SELECT DISTINCT g.connection_id, s.site_id, s.normalized_domain, s.site_url,
                s.canonical_target_key, b.target_key AS brand_target_key
           FROM cms_site_access_grants g
           JOIN cms_sites s ON s.site_id = g.site_id
           LEFT JOIN brand_site_bindings b ON b.site_id = s.site_id AND b.status = 'active'
          WHERE g.tenant_id = ?
            AND g.status = 'active'
            AND (g.expires_at IS NULL OR g.expires_at > NOW())
            AND (g.workspace_id IS NULL OR g.workspace_id = ?)
            AND (g.user_id IS NULL OR g.user_id = ?)
            AND s.app_key = ?
            AND (
              LOWER(COALESCE(s.site_id, '')) IN (${placeholders(refs)})
              OR LOWER(COALESCE(s.normalized_domain, '')) IN (${placeholders(refs)})
              OR LOWER(TRIM(TRAILING '/' FROM COALESCE(s.site_url, ''))) IN (${placeholders(refs)})
              OR LOWER(COALESCE(s.canonical_target_key, '')) IN (${placeholders(refs)})
              OR LOWER(COALESCE(b.target_key, '')) IN (${placeholders(refs)})
            )`,
        [scope.tenant_id, scope.workspace_id, scope.user_id || "", scope.app_key, ...refs, ...refs, ...refs, ...refs, ...refs]
      );
      for (const row of cmsRows) {
        add(
          row.connection_id,
          "cms_site_access_grants",
          normalize(row.canonical_target_key || row.brand_target_key || row.normalized_domain || row.site_id)
        );
      }
    }

    const bound = [...sources.values()].sort((a, b) => a.connection_id.localeCompare(b.connection_id));
    const requested = scope.requested_connection_id;
    if (requested && !linkedIds.has(requested)) {
      return {
        ok: false,
        status: "connection_not_linked_to_workspace",
        error: { code: "CONNECTION_NOT_LINKED_TO_WORKSPACE", message: "The requested connection is not linked to the Workspace." },
        bound_connections: bound,
        secrets_included: false,
      };
    }
    if (requested && !sources.has(requested)) {
      return {
        ok: false,
        status: "connection_resource_mismatch",
        error: { code: "CONNECTION_RESOURCE_MISMATCH", message: "The requested connection is not bound to the selected resource." },
        bound_connections: bound,
        secrets_included: false,
      };
    }
    if (!bound.length) {
      return {
        ok: false,
        status: "connection_resource_binding_missing",
        error: { code: "CONNECTION_RESOURCE_BINDING_MISSING", message: "No active connection binding matched the selected resource." },
        bound_connections: [],
        secrets_included: false,
      };
    }
    if (!requested && bound.length > 1) {
      return {
        ok: false,
        status: "ambiguous_resource_connection",
        error: { code: "AMBIGUOUS_RESOURCE_CONNECTION", message: "Multiple resource-bound connections require an explicit connection choice." },
        bound_connections: bound,
        secrets_included: false,
      };
    }

    const selectedConnectionId = requested || bound[0].connection_id;
    return {
      ok: true,
      status: "resource_connection_bound",
      selected_connection_id: selectedConnectionId,
      selection_reason: requested ? "explicit_resource_bound_connection" : "single_resource_bound_connection",
      resource_ref: scope.resource_ref,
      bound_connections: bound,
      linked_connection_count: linked.length,
      secrets_included: false,
    };
  } catch (error) {
    return {
      ok: false,
      status: "resource_binding_check_failed",
      error: {
        code: "RESOURCE_BINDING_CHECK_FAILED",
        message: "Resource-to-connection binding could not be verified.",
        details: { reason_code: error?.code || "query_failed" },
      },
      secrets_included: false,
    };
  }
}
