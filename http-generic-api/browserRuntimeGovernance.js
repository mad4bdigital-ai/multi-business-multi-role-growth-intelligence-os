import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

const MAX_URL_LENGTH = 2048;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 250;

const HIGH_RISK_BROWSER_ACTIONS = new Set([
  "click_selector",
  "form_fill",
  "form_submit",
  "press_key",
  "select_option",
  "upload_allowlisted_file",
  "download_allowlisted_file",
]);

const DESTRUCTIVE_BROWSER_ACTIONS = new Set([
  "delete",
  "destroy",
  "remove",
  "archive",
  "purchase",
  "checkout",
  "payment_submit",
  "order_submit",
  "form_submit",
  "destructive_click",
]);

const SECRET_KEY_PATTERN = /^(authorization|cookie|set-cookie|password|secret|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|bearer|credential|credential_value)$/i;
const SECRET_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+\-/]+=*/i,
  /(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)=([^&\s]+)/i,
];

export const SEEDED_BROWSER_RUNTIMES = [
  {
    runtime_key: "native_essam_edge_connector_v1",
    provider: "windows_connector_browser",
    display_name: "Essam Native Edge Connector",
    device_id: "essam-pc",
    capability_class: "native_desktop_browser",
    capabilities: ["open_url", "launch_browser", "basic_screenshot_attempt"],
    degraded_capabilities: ["visual_screenshot", "remote_human_takeover", "inspect_data_extraction"],
    status: "active_open_url_degraded_visual_capture",
    metadata: {
      browser_alias: "edge",
      public_url_tested: "https://n8n.mad4b.com/",
      notes: "open_url succeeded, but screenshot returned blank/white because the connector service cannot reliably capture the interactive Windows desktop session.",
      use_only_for: ["open_url", "local_browser_presence_check"],
      do_not_use_for: ["visual_takeover", "primary_inspect", "primary_data_extraction"],
    },
  },
  {
    runtime_key: "browser4_essam_v1",
    provider: "browser4",
    display_name: "Browser4 Essam Extraction/Inspect Runtime",
    device_id: "essam-pc",
    capability_class: "structured_local_extraction",
    capabilities: ["extract_data", "inspect_site", "dom_snapshot", "network", "console", "screenshot"],
    degraded_capabilities: [],
    status: "planned",
    metadata: { use_case: "extraction_inspect", install_required: true },
  },
  {
    runtime_key: "auto_browser_essam_v1",
    provider: "auto_browser",
    display_name: "Auto Browser Essam Visual Takeover Runtime",
    device_id: "essam-pc",
    capability_class: "visual_takeover",
    capabilities: ["visual_takeover", "novnc", "open_url", "screenshot", "human_supervision"],
    degraded_capabilities: [],
    status: "planned",
    metadata: { use_case: "visual_takeover", install_required: true },
  },
  {
    runtime_key: "vessel_browser_essam_v1",
    provider: "vessel_browser",
    display_name: "Vessel Browser Essam Persistent Session Runtime",
    device_id: "essam-pc",
    capability_class: "persistent_agent_session",
    capabilities: ["persistent_session", "mcp", "authenticated_profile", "human_visible_ui"],
    degraded_capabilities: [],
    status: "planned",
    metadata: { use_case: "persistent_authenticated_session", install_required: true },
  },
  {
    runtime_key: "oxylabs_browser_agent_v1",
    provider: "oxylabs_browser_agent",
    display_name: "Oxylabs Browser Agent Cloud Extraction Runtime",
    device_id: null,
    capability_class: "cloud_public_extraction",
    capabilities: ["cloud_extraction", "public_scraping", "multi_step_browsing", "screenshot"],
    degraded_capabilities: [],
    status: "planned",
    metadata: { use_case: "cloud_public_extraction", credential_intake_required: true },
  },
];

export function safeJsonParse(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function jsonArray(value) {
  const parsed = safeJsonParse(value, value);
  return Array.isArray(parsed) ? parsed.filter((item) => item != null).map((item) => String(item)) : [];
}

function jsonObject(value) {
  const parsed = safeJsonParse(value, value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function boundedLimit(value, fallback = DEFAULT_LIMIT) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(n)));
}

function normalizeStatus(value, fallback = "planned") {
  const status = String(value || fallback).trim().toLowerCase();
  return status || fallback;
}

function normalizeAction(value) {
  return String(value || "open_url").trim().toLowerCase();
}

function normalizeHost(value) {
  return String(value || "").trim().toLowerCase().replace(/^\*\./, "").replace(/^\./, "");
}

export function normalizeBrowserRuntime(row = {}) {
  return {
    runtime_key: row.runtime_key,
    provider: row.provider || null,
    display_name: row.display_name || null,
    device_id: row.device_id || null,
    capability_class: row.capability_class || null,
    capabilities: jsonArray(row.capabilities_json ?? row.capabilities),
    degraded_capabilities: jsonArray(row.degraded_capabilities_json ?? row.degraded_capabilities),
    status: normalizeStatus(row.status),
    endpoint_url: row.endpoint_url || null,
    public_url: row.public_url || null,
    metadata: jsonObject(row.metadata_json ?? row.metadata),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    secrets_included: false,
  };
}

export function normalizeBrowserRuntimeBinding(row = {}) {
  return {
    binding_key: row.binding_key,
    runtime_key: row.runtime_key,
    use_case: row.use_case || null,
    tenant_id: row.tenant_id || null,
    user_id: row.user_id || null,
    allowed_brands: jsonArray(row.allowed_brands_json ?? row.allowed_brands),
    allowed_actions: jsonArray(row.allowed_actions_json ?? row.allowed_actions),
    domain_allowlist: jsonArray(row.domain_allowlist_json ?? row.domain_allowlist),
    policy: jsonObject(row.policy_json ?? row.policy),
    status: normalizeStatus(row.status, "active"),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    secrets_included: false,
  };
}

export function assertNoSecretLike(value, path = "payload") {
  if (value == null) return true;
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      const err = new Error(`Secret-like value is not allowed at ${path}.`);
      err.code = "browser_runtime_secret_value_rejected";
      err.status = 400;
      throw err;
    }
    return true;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretLike(item, `${path}[${index}]`));
    return true;
  }
  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        const err = new Error(`Secret-like field is not allowed at ${path}.${key}.`);
        err.code = "browser_runtime_secret_key_rejected";
        err.status = 400;
        throw err;
      }
      assertNoSecretLike(nested, `${path}.${key}`);
    }
  }
  return true;
}

export function parseBrowserUrl(input) {
  const url = String(input || "").trim();
  if (!url) {
    const err = new Error("A target URL is required for browser runtime policy checks.");
    err.code = "browser_runtime_url_required";
    err.status = 400;
    throw err;
  }
  if (url.length > MAX_URL_LENGTH) {
    const err = new Error("Browser runtime URL is too long.");
    err.code = "browser_runtime_url_too_long";
    err.status = 400;
    throw err;
  }
  let parsed;
  try { parsed = new URL(url); } catch {
    const err = new Error("Browser runtime URL must be an absolute http or https URL.");
    err.code = "browser_runtime_url_invalid";
    err.status = 400;
    throw err;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    const err = new Error("Browser runtime URL must use http or https.");
    err.code = "browser_runtime_url_scheme_blocked";
    err.status = 400;
    throw err;
  }
  return { url: parsed.toString(), host: parsed.hostname.toLowerCase(), protocol: parsed.protocol.replace(":", "") };
}

function hostAllowed(host, allowlist = []) {
  const normalizedHost = normalizeHost(host);
  return allowlist.some((entry) => {
    const allowed = normalizeHost(entry);
    return allowed && (normalizedHost === allowed || normalizedHost.endsWith(`.${allowed}`));
  });
}

function mergePolicy({ binding = {}, runtime = {}, inputPolicy = {} } = {}) {
  const bindingPolicy = jsonObject(binding.policy);
  const runtimePolicy = jsonObject(runtime.metadata?.policy || runtime.policy);
  return {
    domain_allowlist_required: true,
    no_credential_logging: true,
    no_cookie_token_echo: true,
    no_payment_submit: true,
    no_destructive_actions: true,
    no_form_submit: true,
    explicit_approval_required_for_login_reuse: true,
    screenshot_artifact_redaction: true,
    session_expiry_required: true,
    audit_required: true,
    ...runtimePolicy,
    ...bindingPolicy,
    ...jsonObject(inputPolicy),
  };
}

function deriveAllowlist({ binding = {}, policy = {}, input = {} } = {}) {
  return [
    ...jsonArray(binding.domain_allowlist),
    ...jsonArray(policy.domain_allowlist),
    ...jsonArray(policy.allowed_domains),
    ...jsonArray(input.domain_allowlist),
    ...jsonArray(input.allowed_domains),
  ].filter(Boolean);
}

export function checkBrowserRuntimePolicy({ runtime = null, binding = null, input = {} } = {}) {
  const action = normalizeAction(input.action || input.mode || input.requested_action || "open_url");
  const useCase = String(input.use_case || binding?.use_case || "").trim().toLowerCase();
  const target = parseBrowserUrl(input.target_url || input.url);
  const policy = mergePolicy({ binding: binding || {}, runtime: runtime || {}, inputPolicy: input.policy || {} });
  assertNoSecretLike({ input: { ...input, policy: undefined }, policy: { ...policy, allowed_domains: undefined, domain_allowlist: undefined } }, "browser_runtime_request");

  const reasons = [];
  const allowlist = deriveAllowlist({ binding: binding || {}, policy, input });
  if (policy.domain_allowlist_required !== false) {
    if (!allowlist.length) {
      reasons.push("domain_allowlist_missing");
    } else if (!hostAllowed(target.host, allowlist)) {
      reasons.push("domain_not_allowlisted");
    }
  }

  if (policy.no_destructive_actions !== false && DESTRUCTIVE_BROWSER_ACTIONS.has(action)) {
    reasons.push("destructive_action_blocked");
  }
  if (policy.no_payment_submit !== false && ["payment_submit", "checkout", "purchase", "order_submit"].includes(action)) {
    reasons.push("payment_or_checkout_blocked");
  }
  if (policy.no_form_submit !== false && action === "form_submit") {
    reasons.push("form_submit_blocked");
  }
  if (HIGH_RISK_BROWSER_ACTIONS.has(action) && input.explicit_approval !== true && input.approved !== true) {
    reasons.push("high_risk_action_requires_explicit_approval");
  }
  if (["login_reuse", "persistent_authenticated_session", "authenticated_extraction"].includes(useCase) && policy.explicit_approval_required_for_login_reuse !== false && input.session_reuse_approved !== true) {
    reasons.push("login_or_session_reuse_requires_approval");
  }

  const allowedActions = jsonArray(binding?.allowed_actions);
  if (allowedActions.length && !allowedActions.includes(action)) {
    reasons.push("action_not_allowed_by_binding");
  }

  return {
    ok: reasons.length === 0,
    policy_result: reasons.length === 0 ? "allowed" : "blocked",
    reasons,
    action,
    use_case: useCase || null,
    url_host: target.host,
    runtime_key: runtime?.runtime_key || binding?.runtime_key || input.runtime_key || null,
    binding_key: binding?.binding_key || input.binding_key || null,
    controls: {
      domain_allowlist_required: policy.domain_allowlist_required !== false,
      audit_required: policy.audit_required !== false,
      no_credential_logging: policy.no_credential_logging !== false,
      no_cookie_token_echo: policy.no_cookie_token_echo !== false,
      screenshot_artifact_redaction: policy.screenshot_artifact_redaction !== false,
      session_expiry_required: policy.session_expiry_required !== false,
    },
    secrets_included: false,
  };
}

export async function listBrowserRuntimes({ pool = getPool(), status = null, provider = null, capability_class = null, limit = DEFAULT_LIMIT } = {}) {
  const where = ["1=1"];
  const params = [];
  if (status) { where.push("status = ?"); params.push(status); }
  if (provider) { where.push("provider = ?"); params.push(provider); }
  if (capability_class) { where.push("capability_class = ?"); params.push(capability_class); }
  params.push(boundedLimit(limit));
  const [rows] = await pool.query(
    `SELECT * FROM \`browser_runtime_registry\` WHERE ${where.join(" AND ")} ORDER BY updated_at DESC LIMIT ?`,
    params,
  );
  return { ok: true, runtimes: rows.map(normalizeBrowserRuntime), count: rows.length, secrets_included: false };
}

export async function getBrowserRuntime({ pool = getPool(), runtime_key }) {
  if (!runtime_key) {
    const err = new Error("runtime_key is required.");
    err.code = "browser_runtime_key_required";
    err.status = 400;
    throw err;
  }
  const [rows] = await pool.query("SELECT * FROM `browser_runtime_registry` WHERE runtime_key = ? LIMIT 1", [runtime_key]);
  if (!rows.length) {
    const err = new Error("Browser runtime was not found.");
    err.code = "browser_runtime_not_found";
    err.status = 404;
    throw err;
  }
  return { ok: true, runtime: normalizeBrowserRuntime(rows[0]), secrets_included: false };
}

export async function loadBrowserRuntimeBinding({ pool = getPool(), binding_key }) {
  if (!binding_key) {
    const err = new Error("binding_key is required.");
    err.code = "browser_runtime_binding_key_required";
    err.status = 400;
    throw err;
  }
  const [rows] = await pool.query("SELECT * FROM `browser_runtime_bindings` WHERE binding_key = ? AND status <> 'archived' LIMIT 1", [binding_key]);
  if (!rows.length) {
    const err = new Error("Browser runtime binding was not found.");
    err.code = "browser_runtime_binding_not_found";
    err.status = 404;
    throw err;
  }
  return normalizeBrowserRuntimeBinding(rows[0]);
}

export async function upsertBrowserRuntimeBinding({ pool = getPool(), binding = {} } = {}) {
  assertNoSecretLike(binding, "browser_runtime_binding");
  const normalized = normalizeBrowserRuntimeBinding(binding);
  if (!normalized.binding_key || !normalized.runtime_key || !normalized.use_case) {
    const err = new Error("binding_key, runtime_key, and use_case are required.");
    err.code = "browser_runtime_binding_missing_fields";
    err.status = 400;
    throw err;
  }
  await getBrowserRuntime({ pool, runtime_key: normalized.runtime_key });
  await pool.query(
    `INSERT INTO \`browser_runtime_bindings\`
       (binding_key, runtime_key, use_case, tenant_id, user_id, allowed_brands_json,
        allowed_actions_json, domain_allowlist_json, policy_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       runtime_key = VALUES(runtime_key), use_case = VALUES(use_case), tenant_id = VALUES(tenant_id),
       user_id = VALUES(user_id), allowed_brands_json = VALUES(allowed_brands_json),
       allowed_actions_json = VALUES(allowed_actions_json), domain_allowlist_json = VALUES(domain_allowlist_json),
       policy_json = VALUES(policy_json), status = VALUES(status), updated_at = CURRENT_TIMESTAMP`,
    [
      normalized.binding_key,
      normalized.runtime_key,
      normalized.use_case,
      normalized.tenant_id,
      normalized.user_id,
      JSON.stringify(normalized.allowed_brands),
      JSON.stringify(normalized.allowed_actions),
      JSON.stringify(normalized.domain_allowlist),
      JSON.stringify(normalized.policy),
      normalized.status,
    ],
  );
  return { ok: true, binding: normalized, secrets_included: false };
}

export async function checkBrowserRuntimePolicyFromDb({ pool = getPool(), binding_key = null, runtime_key = null, input = {} } = {}) {
  let binding = null;
  if (binding_key) binding = await loadBrowserRuntimeBinding({ pool, binding_key });
  const runtimeKey = runtime_key || binding?.runtime_key;
  const runtimeResult = runtimeKey ? await getBrowserRuntime({ pool, runtime_key: runtimeKey }) : { runtime: null };
  return checkBrowserRuntimePolicy({ runtime: runtimeResult.runtime, binding, input: { ...input, binding_key, runtime_key: runtimeKey } });
}

export async function healthBrowserRuntime({ pool = getPool(), runtime_key = null, binding_key = null } = {}) {
  const binding = binding_key ? await loadBrowserRuntimeBinding({ pool, binding_key }) : null;
  const runtime = (await getBrowserRuntime({ pool, runtime_key: runtime_key || binding?.runtime_key })).runtime;
  const status = String(runtime.status || "planned");
  const executable = status.startsWith("active") && !status.includes("degraded_visual_capture");
  return {
    ok: true,
    runtime_key: runtime.runtime_key,
    binding_key: binding?.binding_key || null,
    provider: runtime.provider,
    status: runtime.status,
    health_status: status === "planned" ? "planned_not_executable" : (executable ? "registry_available" : "registry_available_with_degraded_capabilities"),
    capabilities: runtime.capabilities,
    degraded_capabilities: runtime.degraded_capabilities,
    executable,
    secrets_included: false,
  };
}

export async function createBrowserDataExtractionJob({ pool = getPool(), input = {} } = {}) {
  assertNoSecretLike(input, "browser_data_extraction_job");
  const jobKey = input.job_key || input.jobKey || `browser_extract_${randomUUID()}`;
  const bindingKey = input.binding_key || input.bindingKey;
  const targetUrl = input.target_url || input.targetUrl || input.url;
  const policyCheck = await checkBrowserRuntimePolicyFromDb({
    pool,
    binding_key: bindingKey,
    input: { ...input, target_url: targetUrl, action: "extract_data", use_case: input.use_case || "structured_extraction" },
  });
  if (!policyCheck.ok) {
    return { ok: false, job_key: jobKey, policy: policyCheck, error: { code: "browser_runtime_policy_blocked", message: "Browser data extraction policy preflight blocked this job." }, secrets_included: false };
  }
  await pool.query(
    `INSERT INTO \`browser_data_extraction_jobs\`
       (job_key, binding_key, tenant_id, user_id, target_url, extraction_mode, schema_json, policy_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'policy_allowed_pending_runtime')
     ON DUPLICATE KEY UPDATE
       binding_key = VALUES(binding_key), tenant_id = VALUES(tenant_id), user_id = VALUES(user_id),
       target_url = VALUES(target_url), extraction_mode = VALUES(extraction_mode), schema_json = VALUES(schema_json),
       policy_json = VALUES(policy_json), status = VALUES(status), updated_at = CURRENT_TIMESTAMP`,
    [
      jobKey,
      bindingKey,
      input.tenant_id || input.tenantId || null,
      input.user_id || input.userId || null,
      targetUrl,
      input.extraction_mode || input.extractionMode || "schema_based",
      JSON.stringify(input.schema || {}),
      JSON.stringify(input.policy || {}),
    ],
  );
  return { ok: true, job_key: jobKey, status: "policy_allowed_pending_runtime", policy: policyCheck, secrets_included: false };
}

export async function createBrowserSiteInspectionRun({ pool = getPool(), input = {} } = {}) {
  assertNoSecretLike(input, "browser_site_inspection_run");
  const inspectionKey = input.inspection_key || input.inspectionKey || `browser_inspect_${randomUUID()}`;
  const bindingKey = input.binding_key || input.bindingKey;
  const targetUrl = input.url || input.target_url || input.targetUrl;
  const policyCheck = await checkBrowserRuntimePolicyFromDb({
    pool,
    binding_key: bindingKey,
    input: { ...input, target_url: targetUrl, action: "inspect_site", use_case: input.use_case || "site_diagnostics" },
  });
  if (!policyCheck.ok) {
    return { ok: false, inspection_key: inspectionKey, policy: policyCheck, error: { code: "browser_runtime_policy_blocked", message: "Browser site inspection policy preflight blocked this run." }, secrets_included: false };
  }
  await pool.query(
    `INSERT INTO \`browser_site_inspection_runs\`
       (inspection_key, binding_key, tenant_id, user_id, target_url, checks_json, policy_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'policy_allowed_pending_runtime')
     ON DUPLICATE KEY UPDATE
       binding_key = VALUES(binding_key), tenant_id = VALUES(tenant_id), user_id = VALUES(user_id),
       target_url = VALUES(target_url), checks_json = VALUES(checks_json), policy_json = VALUES(policy_json),
       status = VALUES(status), updated_at = CURRENT_TIMESTAMP`,
    [
      inspectionKey,
      bindingKey,
      input.tenant_id || input.tenantId || null,
      input.user_id || input.userId || null,
      targetUrl,
      JSON.stringify(Array.isArray(input.checks) ? input.checks : []),
      JSON.stringify(input.policy || {}),
    ],
  );
  return { ok: true, inspection_key: inspectionKey, status: "policy_allowed_pending_runtime", policy: policyCheck, secrets_included: false };
}
