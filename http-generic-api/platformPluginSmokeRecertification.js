import { getPool } from "./db.js";
import { dispatchPlatformPluginRestAction } from "./platformPluginRestDispatch.js";
import { certifyPlatformPluginSmoke } from "./platformPluginSmokeCertification.js";
import { resolvePlatformPluginSmokeRecertificationPolicy } from "./platformPluginSmokeRecertificationPolicy.js";

function compact(value = "", max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function boundedInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function buildUrl({ baseUrl, path }) {
  const base = new URL(baseUrl);
  const rawPath = compact(path || "/", 1000) || "/";
  if (/^https:\/\//i.test(rawPath)) return new URL(rawPath);
  const basePath = base.pathname && base.pathname !== "/"
    ? `/${base.pathname.replace(/^\/+|\/+$/g, "")}`
    : "";
  const actionPath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  const joinedPath = `${basePath}${actionPath}`.replace(/\/+/g, "/");
  return new URL(joinedPath || "/", base.origin);
}

function parseDate(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function daysUntil(value) {
  const ms = parseDate(value);
  if (!ms) return null;
  return Math.ceil((ms - Date.now()) / (24 * 60 * 60 * 1000));
}

function classifyCertification(row, { policy = null, expiresSoonDays = 14 } = {}) {
  const effectivePolicy = policy || { expires_soon_days: expiresSoonDays, auto_recertification_enabled: false, max_batch_size: 5, certification_ttl_days: 90 };
  const effectiveExpiresSoonDays = boundedInt(effectivePolicy.expires_soon_days, expiresSoonDays, 1, 90);
  const reasons = [];
  const expiresInDays = daysUntil(row.certification_expires_at);
  const expired = expiresInDays !== null && expiresInDays <= 0;
  const expiresSoon = expiresInDays !== null && expiresInDays > 0 && expiresInDays <= effectiveExpiresSoonDays;
  let currentUrl = null;
  let currentUrlError = null;
  try {
    if (row.api_base_url && row.current_path) currentUrl = buildUrl({ baseUrl: row.api_base_url, path: row.current_path });
  } catch (err) {
    currentUrlError = err.message;
  }
  const currentMethod = String(row.current_method || "GET").toUpperCase();
  if (expired) reasons.push("expired");
  if (expiresSoon) reasons.push("expires_soon");
  if (!row.connection_id || !row.api_base_url) reasons.push("connection_missing");
  if (!row.current_endpoint_key || !row.current_path) reasons.push("endpoint_missing");
  if (currentUrlError) reasons.push("url_resolution_failed");
  if (currentUrl && row.url_origin && currentUrl.origin !== row.url_origin) reasons.push("origin_drift");
  if (currentUrl && row.url_path && currentUrl.pathname !== row.url_path) reasons.push("path_drift");
  if (row.http_method && currentMethod && String(row.http_method).toUpperCase() !== currentMethod) reasons.push("method_drift");
  const driftReasons = reasons.filter((reason) => ["origin_drift", "path_drift", "method_drift", "connection_missing", "endpoint_missing", "url_resolution_failed"].includes(reason));
  return {
    certification_id: row.certification_id,
    plugin_key: row.plugin_key,
    action_key: row.action_key,
    endpoint_key: row.endpoint_key,
    tenant_id: row.tenant_id,
    user_id: row.user_id,
    connection_id: row.connection_id,
    mock_provider: row.mock_provider,
    mock_resource: row.mock_resource,
    certification_status: row.certification_status,
    certified_at: row.certified_at,
    certification_expires_at: row.certification_expires_at,
    expires_in_days: expiresInDays,
    expired,
    expires_soon: expiresSoon,
    expected_origin: row.expected_origin,
    certified_url_origin: row.url_origin,
    certified_url_path: row.url_path,
    certified_method: row.http_method,
    current_url_origin: currentUrl?.origin || null,
    current_url_path: currentUrl?.pathname || null,
    current_method: currentMethod || null,
    last_smoke_execution_log_id: row.last_smoke_execution_log_id,
    last_response_status: row.last_response_status,
    last_response_ok: Boolean(row.last_response_ok),
    last_recertification_required_at: row.last_recertification_required_at || null,
    recertification_reason: row.recertification_reason || null,
    reasons,
    drift_reasons: driftReasons,
    recertification_required: reasons.some((reason) => reason !== "expires_soon"),
    recertification_due_soon: reasons.includes("expires_soon") && driftReasons.length === 0,
    automatic_recertification_supported: driftReasons.length === 0 && Boolean(row.tenant_id && row.user_id && row.expected_origin),
    secrets_included: false,
  };
}

async function loadRows(pool, input = {}) {
  const where = ["c.certification_status = 'certified'"];
  const params = [];
  const pluginKey = compact(input.plugin_key || input.pluginKey, 128);
  const actionKey = compact(input.action_key || input.actionKey, 128);
  const tenantId = compact(input.tenant_id || input.tenantId, 64);
  const mockProvider = compact(input.mock_provider || input.mockProvider || input.provider, 128);
  const mockResource = compact(input.mock_resource || input.mockResource || input.resource, 128);
  if (pluginKey) { where.push("c.plugin_key = ?"); params.push(pluginKey); }
  if (actionKey) { where.push("c.action_key = ?"); params.push(actionKey); }
  if (tenantId) { where.push("c.tenant_id = ?"); params.push(tenantId); }
  if (mockProvider) { where.push("c.mock_provider = ?"); params.push(mockProvider); }
  if (mockResource) { where.push("c.mock_resource = ?"); params.push(mockResource); }
  const limit = boundedInt(input.limit, 50, 1, 250);
  const [rows] = await pool.query(
    `SELECT c.certification_id, c.plugin_key, c.action_key, c.endpoint_key, c.tenant_id, c.user_id,
            c.connection_id, c.mock_provider, c.mock_resource, c.expected_origin, c.url_origin,
            c.url_path, c.http_method, c.last_smoke_status, c.last_response_status,
            c.last_response_ok, c.last_smoke_execution_log_id, c.last_smoke_trace_id,
            c.certification_status, c.certified_at, c.certification_expires_at,
            c.last_recertification_required_at, c.recertification_reason, c.secrets_included,
            u.api_base_url,
            e.endpoint_key AS current_endpoint_key,
            e.method AS current_method,
            e.endpoint_path_or_function AS current_path
       FROM platform_plugin_smoke_certifications c
       LEFT JOIN user_app_connections u ON u.connection_id = c.connection_id AND u.status = 'active'
       LEFT JOIN endpoints e ON (e.endpoint_key = c.endpoint_key OR e.parent_action_key = c.action_key)
        AND (e.status IS NULL OR e.status NOT IN ('deprecated','archived','disabled','inactive'))
      WHERE ${where.join(" AND ")}
      ORDER BY c.certification_expires_at ASC, c.certified_at ASC
      LIMIT ?`,
    [...params, limit]
  );
  return rows;
}

export async function listPlatformPluginSmokeRecertificationQueue(input = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const expiresSoonDays = boundedInt(input.expires_soon_days || input.expiresSoonDays, 14, 1, 90);
  const includeOk = input.include_ok === true || input.includeOk === true;
  const rows = await loadRows(pool, input);
  const items = rows.map((row) => classifyCertification(row, { expiresSoonDays }));
  const filtered = includeOk ? items : items.filter((item) => item.recertification_required || item.recertification_due_soon);
  return {
    ok: true,
    expires_soon_days: expiresSoonDays,
    count: filtered.length,
    total_checked: items.length,
    items: filtered,
    summary: {
      expired: filtered.filter((item) => item.expired).length,
      expires_soon: filtered.filter((item) => item.expires_soon).length,
      drift: filtered.filter((item) => item.drift_reasons.length > 0).length,
      automatic_supported: filtered.filter((item) => item.automatic_recertification_supported).length,
    },
    secrets_included: false,
  };
}

export async function runPlatformPluginSmokeRecertificationBatch(input = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const dryRun = input.dry_run === undefined ? input.dryRun !== false : input.dry_run !== false;
  const limit = boundedInt(input.limit, 5, 1, 10);
  const queue = await listPlatformPluginSmokeRecertificationQueue({ ...input, include_ok: false, limit }, { pool });
  const candidates = queue.items.filter((item) => item.automatic_recertification_supported && item.drift_reasons.length === 0).slice(0, limit);
  const results = [];
  for (const item of candidates) {
    if (dryRun) {
      results.push({
        ok: true,
        dry_run: true,
        would_recertify: true,
        plugin_key: item.plugin_key,
        action_key: item.action_key,
        certification_id: item.certification_id,
        reasons: item.reasons,
        expected_origin: item.expected_origin,
        secrets_included: false,
      });
      continue;
    }
    const dispatch = await dispatchPlatformPluginRestAction({
      pool,
      pluginKey: item.plugin_key,
      actionKey: item.action_key,
      tenantId: item.tenant_id,
      userId: item.user_id,
      agentId: input.agent_id || input.agentId || null,
      requestedCredentialScope: input.requested_credential_scope || input.requestedCredentialScope || "tenant_connection",
      input: input.input || {},
      dryRun: false,
      timeoutMs: boundedInt(input.timeout_ms || input.timeoutMs, 5000, 1000, 30000),
      enforceExecutionReadiness: input.enforce_execution_readiness === undefined ? input.enforceExecutionReadiness !== false : input.enforce_execution_readiness !== false,
      brandKey: input.brand_key || input.brandKey || null,
      businessTypeKey: input.business_type_key || input.businessTypeKey || null,
      businessActivityTypeKey: input.business_activity_type_key || input.businessActivityTypeKey || null,
      actorRole: input.actor_role || input.actorRole || null,
      governanceLevel: input.governance_level || input.governanceLevel || null,
      graphDepth: 1,
      graphLimit: 120,
      detailLimit: 3,
      edgeDetailLimit: 3,
      providerSmoke: true,
      providerSmokeExpectedOrigin: item.expected_origin,
      recertificationMode: true,
    });
    let certification = null;
    if (dispatch?.dispatched === true && dispatch?.success === true && dispatch?.execution_log?.id) {
      certification = await certifyPlatformPluginSmoke({
        pool,
        execution_log_id: dispatch.execution_log.id,
        certified_by: input.certified_by || input.certifiedBy || "platform_recertification_batch",
        notes: input.notes || "Automated smoke recertification batch. secrets_included=false.",
        certification_ttl_days: input.certification_ttl_days || input.certificationTtlDays || 90,
      });
    }
    results.push({
      ok: Boolean(certification?.certified),
      dry_run: false,
      plugin_key: item.plugin_key,
      action_key: item.action_key,
      certification_id: item.certification_id,
      reasons: item.reasons,
      dispatch: dispatch ? {
        dispatched: dispatch.dispatched,
        success: dispatch.success,
        reason: dispatch.reason || null,
        execution_log: dispatch.execution_log || null,
        request: dispatch.request || null,
      } : null,
      certification,
      secrets_included: false,
    });
  }
  return {
    ok: true,
    dry_run: dryRun,
    candidates_considered: queue.items.length,
    candidates_selected: candidates.length,
    results,
    skipped: queue.items.filter((item) => !candidates.includes(item)).map((item) => ({
      plugin_key: item.plugin_key,
      action_key: item.action_key,
      certification_id: item.certification_id,
      reasons: item.reasons,
      automatic_recertification_supported: item.automatic_recertification_supported,
      drift_reasons: item.drift_reasons,
      secrets_included: false,
    })),
    secrets_included: false,
  };
}
