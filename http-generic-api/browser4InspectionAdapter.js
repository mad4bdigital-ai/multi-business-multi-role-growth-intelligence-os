import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import {
  assertNoSecretLike,
  checkBrowserRuntimePolicyFromDb,
  getBrowserRuntime,
  loadBrowserRuntimeBinding,
} from "./browserRuntimeGovernance.js";

const DEFAULT_TIMEOUT_MS = 180000;
const MAX_TIMEOUT_MS = 300000;

function boundedTimeout(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.floor(n), 1000), MAX_TIMEOUT_MS);
}

function safeJson(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

async function upsertInspectionRun(pool, input, status) {
  await pool.query(
    `INSERT INTO \`browser_site_inspection_runs\`
       (inspection_key, binding_key, tenant_id, user_id, target_url, checks_json, policy_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       binding_key = VALUES(binding_key), tenant_id = VALUES(tenant_id), user_id = VALUES(user_id),
       target_url = VALUES(target_url), checks_json = VALUES(checks_json), policy_json = VALUES(policy_json),
       status = VALUES(status), updated_at = CURRENT_TIMESTAMP`,
    [input.inspection_key, input.binding_key, input.tenant_id || null, input.user_id || null, input.url || input.target_url, JSON.stringify(Array.isArray(input.checks) ? input.checks : []), JSON.stringify(input.policy || {}), status],
  );
}

async function updateInspectionResult(pool, inspectionKey, status, result, error = null) {
  await pool.query(
    `UPDATE \`browser_site_inspection_runs\`
        SET status = ?, result_json = ?, error_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE inspection_key = ?`,
    [status, result ? JSON.stringify(result) : null, error ? JSON.stringify(error) : null, inspectionKey],
  );
}

async function recordBrowserRuntimeEvent(pool, event) {
  await pool.query(
    `INSERT INTO \`browser_runtime_events\`
       (event_id, session_id, runtime_key, binding_key, tenant_id, user_id, event_type, url_host, actor, policy_result, event_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [event.event_id || randomUUID(), event.session_id || null, event.runtime_key || null, event.binding_key || null, event.tenant_id || null, event.user_id || null, event.event_type, event.url_host || null, event.actor || "browser_runtime_adapter", event.policy_result || null, JSON.stringify(event.event_json || {})],
  ).catch(() => null);
}

function internalHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: process.env.BACKEND_API_KEY ? `Bearer ${process.env.BACKEND_API_KEY}` : "",
  };
}

function connectorEndpoint(deviceId, baseUrl) {
  const base = String(baseUrl || process.env.INTERNAL_BASE_URL || `http://localhost:${process.env.PORT || 8080}`).replace(/\/$/, "");
  return `${base}/connector/${encodeURIComponent(deviceId)}/browser4`;
}

function sanitizeConnectorResult(data) {
  if (!data || typeof data !== "object") return { ok: false, raw_type: typeof data, secrets_included: false };
  return {
    ok: data.ok !== false,
    action: data.action || null,
    run_key: data.run_key || null,
    target_host: data.target_host || null,
    checks: Array.isArray(data.checks) ? data.checks : [],
    exit_code: data.exit_code ?? null,
    status: data.status || null,
    status_json: safeJson(data.status_json, null),
    artifacts: safeJson(data.artifacts, {}),
    stdout_preview: typeof data.stdout_preview === "string" ? data.stdout_preview.slice(0, 2000) : "",
    stderr_preview: typeof data.stderr_preview === "string" ? data.stderr_preview.slice(0, 2000) : "",
    connector_route: data.connector_route || null,
    secrets_included: false,
  };
}

export async function runBrowser4InspectionAdapter({ pool = getPool(), fetchImpl = fetch, input = {}, internalBaseUrl = null } = {}) {
  assertNoSecretLike(input, "browser4_inspection_adapter_input");
  const inspectionKey = input.inspection_key || input.inspectionKey || `browser4_inspect_${randomUUID()}`;
  const bindingKey = input.binding_key || input.bindingKey;
  const targetUrl = input.url || input.target_url || input.targetUrl;
  const checks = Array.isArray(input.checks) && input.checks.length ? input.checks.map(String) : ["snapshot"];

  if (!bindingKey || !targetUrl) {
    const err = new Error("binding_key and url are required.");
    err.status = 400;
    err.code = "browser4_inspection_missing_fields";
    throw err;
  }

  const binding = await loadBrowserRuntimeBinding({ pool, binding_key: bindingKey });
  const runtime = (await getBrowserRuntime({ pool, runtime_key: binding.runtime_key })).runtime;
  if (runtime.provider !== "browser4") {
    const err = new Error("The selected binding does not point to a Browser4 runtime.");
    err.status = 409;
    err.code = "browser4_runtime_required";
    err.details = { runtime_key: runtime.runtime_key, provider: runtime.provider };
    throw err;
  }
  if (!runtime.device_id) {
    const err = new Error("Browser4 runtime is missing device_id.");
    err.status = 409;
    err.code = "browser4_device_required";
    throw err;
  }

  const policy = await checkBrowserRuntimePolicyFromDb({
    pool,
    binding_key: bindingKey,
    input: { ...input, target_url: targetUrl, action: "inspect_site", use_case: input.use_case || "site_diagnostics" },
  });

  if (!policy.ok) {
    await upsertInspectionRun(pool, { inspection_key: inspectionKey, binding_key: bindingKey, url: targetUrl, checks, policy: input.policy || {}, tenant_id: input.tenant_id || input.tenantId || null, user_id: input.user_id || input.userId || null }, "policy_blocked");
    const result = { ok: false, inspection_key: inspectionKey, policy, error: { code: "browser_runtime_policy_blocked", message: "Browser4 inspection blocked by policy preflight." }, secrets_included: false };
    await updateInspectionResult(pool, inspectionKey, "policy_blocked", null, result.error);
    await recordBrowserRuntimeEvent(pool, { runtime_key: runtime.runtime_key, binding_key: bindingKey, event_type: "policy_block", url_host: policy.url_host, policy_result: policy.policy_result, event_json: result });
    return result;
  }

  await upsertInspectionRun(pool, { inspection_key: inspectionKey, binding_key: bindingKey, url: targetUrl, checks, policy: input.policy || {}, tenant_id: input.tenant_id || input.tenantId || null, user_id: input.user_id || input.userId || null }, "running");
  await recordBrowserRuntimeEvent(pool, { runtime_key: runtime.runtime_key, binding_key: bindingKey, event_type: "inspect_site_started", url_host: policy.url_host, policy_result: policy.policy_result, event_json: { inspection_key: inspectionKey, checks } });

  const response = await fetchImpl(connectorEndpoint(runtime.device_id, internalBaseUrl), {
    method: "POST",
    headers: internalHeaders(),
    signal: AbortSignal.timeout(boundedTimeout(input.timeout_ms || input.timeoutMs)),
    body: JSON.stringify({ action: "inspect_site", url: targetUrl, checks, inspection_key: inspectionKey, timeout_ms: boundedTimeout(input.timeout_ms || input.timeoutMs) }),
  });
  const body = await response.json().catch(() => ({ ok: false, error: { code: "browser4_connector_non_json", message: "Connector returned non-JSON response." } }));
  const connectorResult = sanitizeConnectorResult(body);
  const ok = response.ok && body?.ok !== false && Number(connectorResult.exit_code ?? 1) === 0;
  const status = ok ? "completed" : "failed";
  const error = ok ? null : (body?.error || { code: "browser4_connector_failed", message: `Browser4 connector returned HTTP ${response.status}.` });
  const result = { ok, inspection_key: inspectionKey, status, runtime_key: runtime.runtime_key, binding_key: bindingKey, policy, connector: connectorResult, error, secrets_included: false };
  await updateInspectionResult(pool, inspectionKey, status, result, error);
  await recordBrowserRuntimeEvent(pool, { runtime_key: runtime.runtime_key, binding_key: bindingKey, event_type: ok ? "inspect_site_completed" : "inspect_site_failed", url_host: policy.url_host, policy_result: policy.policy_result, event_json: result });
  return result;
}

export const _testingBrowser4InspectionAdapter = { boundedTimeout, connectorEndpoint, sanitizeConnectorResult };
