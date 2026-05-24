import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 180_000;

function safeJsonParse(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function redactSecretish(value = "") {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+\-/]+=*/gi, "Bearer [redacted]")
    .replace(/(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)=([^&\s]+)/gi, "$1=[redacted]");
}

function sanitizeTimeout(value) {
  const n = Number(value || DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS;
  return Math.max(1_000, Math.min(MAX_TIMEOUT_MS, Math.floor(n)));
}

function normalizePath(path = "") {
  const value = String(path || "").trim();
  if (!value) return "";
  return value.startsWith("/") ? value : `/${value}`;
}

function buildN8nWebhookUrl(binding, env = process.env) {
  const explicit = String(binding.n8n_webhook_url || "").trim();
  if (explicit) return explicit;
  const base = String(env.N8N_WEBHOOK_BASE_URL || env.N8N_BASE_URL || "").trim().replace(/\/+$/, "");
  const path = normalizePath(binding.n8n_webhook_path || "");
  if (!base || !path) {
    const err = new Error("n8n webhook URL is not configured. Set n8n_webhook_url or N8N_WEBHOOK_BASE_URL + n8n_webhook_path.");
    err.code = "n8n_webhook_url_missing";
    err.status = 400;
    throw err;
  }
  return `${base}${path}`;
}

function headerForAuth(binding, env = process.env) {
  const authMode = String(binding.auth_mode || "none").toLowerCase();
  if (authMode === "none") return {};
  const envVar = String(binding.credential_env_var || "").trim();
  if (!envVar) {
    const err = new Error("credential_env_var is required when auth_mode is not none.");
    err.code = "n8n_credential_env_var_missing";
    err.status = 400;
    throw err;
  }
  const secret = env[envVar];
  if (!secret) {
    const err = new Error(`Required n8n credential env var is not configured: ${envVar}`);
    err.code = "n8n_credential_missing";
    err.status = 503;
    throw err;
  }
  const headerName = String(binding.auth_header_name || "Authorization").trim() || "Authorization";
  if (authMode === "bearer_env") return { [headerName]: `Bearer ${secret}` };
  if (authMode === "header_env") return { [headerName]: secret };
  const err = new Error(`Unsupported n8n auth_mode: ${authMode}`);
  err.code = "n8n_auth_mode_unsupported";
  err.status = 400;
  throw err;
}

function coerceJsonSchema(schema) {
  const parsed = safeJsonParse(schema, null);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
}

function typeMatches(expected, value) {
  if (expected === "array") return Array.isArray(value);
  if (expected === "integer") return Number.isInteger(value);
  if (expected === "number") return typeof value === "number" && Number.isFinite(value);
  if (expected === "object") return value && typeof value === "object" && !Array.isArray(value);
  if (expected === "boolean") return typeof value === "boolean";
  if (expected === "string") return typeof value === "string";
  if (expected === "null") return value === null;
  return true;
}

export function validateBasicJsonSchema(schema, input, label = "input") {
  const spec = coerceJsonSchema(schema);
  if (!spec) return { ok: true, skipped: true };
  if (spec.type && !typeMatches(spec.type, input)) {
    return { ok: false, error: { code: `${label}_schema_type_mismatch`, message: `${label} must be ${spec.type}` } };
  }
  const required = Array.isArray(spec.required) ? spec.required : [];
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(input || {}, key)) {
      return { ok: false, error: { code: `${label}_schema_required_missing`, message: `${label}.${key} is required` } };
    }
  }
  const props = spec.properties && typeof spec.properties === "object" ? spec.properties : {};
  for (const [key, prop] of Object.entries(props)) {
    if (!Object.prototype.hasOwnProperty.call(input || {}, key)) continue;
    const allowedTypes = Array.isArray(prop.type) ? prop.type : [prop.type].filter(Boolean);
    if (allowedTypes.length && !allowedTypes.some((type) => typeMatches(type, input[key]))) {
      return { ok: false, error: { code: `${label}_schema_property_type_mismatch`, message: `${label}.${key} must be ${allowedTypes.join(" or ")}` } };
    }
  }
  return { ok: true, skipped: false };
}

export function normalizeWorkflowRuntimeBinding(row = {}) {
  return {
    binding_key: row.binding_key,
    workflow_key: row.workflow_key,
    runtime_type: row.runtime_type || "n8n",
    task_class: row.task_class || null,
    tenant_id: row.tenant_id || null,
    n8n_workflow_id: row.n8n_workflow_id || null,
    n8n_webhook_path: row.n8n_webhook_path || null,
    n8n_webhook_url: row.n8n_webhook_url || null,
    execution_mode: row.execution_mode || "sync",
    auth_mode: row.auth_mode || "none",
    credential_env_var: row.credential_env_var || null,
    auth_header_name: row.auth_header_name || "Authorization",
    input_schema_json: safeJsonParse(row.input_schema_json, row.input_schema_json || null),
    output_schema_json: safeJsonParse(row.output_schema_json, row.output_schema_json || null),
    timeout_ms: sanitizeTimeout(row.timeout_ms),
    status: row.status || "active",
    metadata_json: safeJsonParse(row.metadata_json, row.metadata_json || null),
  };
}

export async function loadWorkflowRuntimeBinding({ pool = getPool(), binding_key = null, workflow_key = null, tenant_id = null } = {}) {
  const clauses = ["status = 'active'", "runtime_type = 'n8n'"];
  const params = [];
  if (binding_key) { clauses.push("binding_key = ?"); params.push(binding_key); }
  if (workflow_key) { clauses.push("workflow_key = ?"); params.push(workflow_key); }
  if (tenant_id) { clauses.push("(tenant_id IS NULL OR tenant_id = ?)"); params.push(tenant_id); }
  if (!binding_key && !workflow_key) {
    const err = new Error("binding_key or workflow_key is required.");
    err.code = "workflow_runtime_binding_key_required";
    err.status = 400;
    throw err;
  }
  const [rows] = await pool.query(
    `SELECT * FROM \`workflow_runtime_bindings\` WHERE ${clauses.join(" AND ")} ORDER BY tenant_id IS NULL ASC, updated_at DESC LIMIT 1`,
    params
  );
  if (!rows.length) {
    const err = new Error("No active n8n workflow runtime binding found.");
    err.code = "workflow_runtime_binding_not_found";
    err.status = 404;
    throw err;
  }
  return normalizeWorkflowRuntimeBinding(rows[0]);
}

export async function upsertWorkflowRuntimeBinding({ pool = getPool(), binding }) {
  const b = normalizeWorkflowRuntimeBinding(binding || {});
  if (!b.binding_key || !b.workflow_key) {
    const err = new Error("binding_key and workflow_key are required.");
    err.code = "workflow_runtime_binding_missing_fields";
    err.status = 400;
    throw err;
  }
  if (b.runtime_type !== "n8n") {
    const err = new Error("Only runtime_type='n8n' is supported by this route.");
    err.code = "workflow_runtime_type_unsupported";
    err.status = 400;
    throw err;
  }
  await pool.query(
    `INSERT INTO \`workflow_runtime_bindings\`
       (binding_key, workflow_key, runtime_type, task_class, tenant_id,
        n8n_workflow_id, n8n_webhook_path, n8n_webhook_url, execution_mode,
        auth_mode, credential_env_var, auth_header_name, input_schema_json,
        output_schema_json, timeout_ms, status, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       workflow_key = VALUES(workflow_key), runtime_type = VALUES(runtime_type),
       task_class = VALUES(task_class), tenant_id = VALUES(tenant_id),
       n8n_workflow_id = VALUES(n8n_workflow_id), n8n_webhook_path = VALUES(n8n_webhook_path),
       n8n_webhook_url = VALUES(n8n_webhook_url), execution_mode = VALUES(execution_mode),
       auth_mode = VALUES(auth_mode), credential_env_var = VALUES(credential_env_var),
       auth_header_name = VALUES(auth_header_name), input_schema_json = VALUES(input_schema_json),
       output_schema_json = VALUES(output_schema_json), timeout_ms = VALUES(timeout_ms),
       status = VALUES(status), metadata_json = VALUES(metadata_json), updated_at = CURRENT_TIMESTAMP`,
    [
      b.binding_key, b.workflow_key, b.runtime_type, b.task_class, b.tenant_id,
      b.n8n_workflow_id, b.n8n_webhook_path, b.n8n_webhook_url, b.execution_mode,
      b.auth_mode, b.credential_env_var, b.auth_header_name,
      b.input_schema_json ? JSON.stringify(b.input_schema_json) : null,
      b.output_schema_json ? JSON.stringify(b.output_schema_json) : null,
      b.timeout_ms, b.status, b.metadata_json ? JSON.stringify(b.metadata_json) : null,
    ]
  );
  return { ok: true, binding: { ...b, n8n_webhook_url: b.n8n_webhook_url ? redactSecretish(b.n8n_webhook_url) : null } };
}

async function createWorkflowRun({ pool, run_id, tenant_id, user_id, workflow_key, input }) {
  if (!tenant_id) return false;
  await pool.query(
    `INSERT INTO \`workflow_runs\`
       (run_id, tenant_id, user_id, workflow_key, service_mode, status, input_json, started_at)
     VALUES (?, ?, ?, ?, 'automation', 'running', ?, NOW())`,
    [run_id, tenant_id, user_id || null, workflow_key, JSON.stringify(input || {})]
  ).catch(() => false);
  return true;
}

async function updateWorkflowRun({ pool, run_id, status, output = null, error = null }) {
  await pool.query(
    `UPDATE \`workflow_runs\`
       SET status = ?, output_json = ?, error_json = ?, completed_at = NOW()
     WHERE run_id = ?`,
    [status, output ? JSON.stringify(output) : null, error ? JSON.stringify(error) : null, run_id]
  ).catch(() => false);
}

export async function callN8nWorkflowBinding({ binding, input = {}, run_id = randomUUID(), tenant_id = null, user_id = null, fetchImpl = fetch, env = process.env } = {}) {
  if (!binding || binding.runtime_type !== "n8n") {
    const err = new Error("A normalized n8n binding is required.");
    err.code = "n8n_binding_required";
    err.status = 400;
    throw err;
  }
  const inputValidation = validateBasicJsonSchema(binding.input_schema_json, input, "input");
  if (!inputValidation.ok) {
    const err = new Error(inputValidation.error.message);
    err.code = inputValidation.error.code;
    err.status = 400;
    throw err;
  }

  const url = buildN8nWebhookUrl(binding, env);
  const authHeaders = headerForAuth(binding, env);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), sanitizeTimeout(binding.timeout_ms));

  const payload = {
    run_id,
    binding_key: binding.binding_key,
    workflow_key: binding.workflow_key,
    n8n_workflow_id: binding.n8n_workflow_id || null,
    task_class: binding.task_class || null,
    tenant_id,
    user_id,
    input,
    governance: {
      runtime_type: "n8n",
      secrets_included: false,
      callback_required: binding.execution_mode === "async",
    },
  };

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let result = safeJsonParse(text, { raw_text: text });
    if (!response.ok) {
      const err = new Error(`n8n workflow returned HTTP ${response.status}`);
      err.code = "n8n_workflow_http_error";
      err.status = response.status;
      err.result = result;
      throw err;
    }
    const outputValidation = validateBasicJsonSchema(binding.output_schema_json, result, "output");
    if (!outputValidation.ok) {
      const err = new Error(outputValidation.error.message);
      err.code = outputValidation.error.code;
      err.status = 502;
      err.result = result;
      throw err;
    }
    return {
      ok: true,
      run_id,
      binding_key: binding.binding_key,
      workflow_key: binding.workflow_key,
      runtime_type: "n8n",
      execution_mode: binding.execution_mode,
      result,
      secrets_included: false,
    };
  } catch (err) {
    if (err.name === "AbortError") {
      err.code = "n8n_workflow_timeout";
      err.status = 504;
      err.message = "n8n workflow timed out.";
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function runN8nWorkflowRuntime({ pool = getPool(), binding_key = null, workflow_key = null, tenant_id = null, user_id = null, input = {}, fetchImpl = fetch, env = process.env } = {}) {
  const binding = await loadWorkflowRuntimeBinding({ pool, binding_key, workflow_key, tenant_id });
  const run_id = randomUUID();
  await createWorkflowRun({ pool, run_id, tenant_id, user_id, workflow_key: binding.workflow_key, input });
  try {
    const result = await callN8nWorkflowBinding({ binding, input, run_id, tenant_id, user_id, fetchImpl, env });
    await updateWorkflowRun({ pool, run_id, status: binding.execution_mode === "async" ? "running" : "completed", output: result });
    return result;
  } catch (err) {
    const error = { code: err.code || "n8n_workflow_runtime_failed", message: redactSecretish(err.message), result: err.result || null };
    await updateWorkflowRun({ pool, run_id, status: "failed", error });
    return { ok: false, run_id, binding_key: binding.binding_key, workflow_key: binding.workflow_key, runtime_type: "n8n", error, secrets_included: false };
  }
}

export function redactWorkflowRuntimeBinding(binding = {}) {
  const b = normalizeWorkflowRuntimeBinding(binding);
  return {
    ...b,
    n8n_webhook_url: b.n8n_webhook_url ? redactSecretish(b.n8n_webhook_url) : null,
    credential_configured: b.credential_env_var ? Boolean(process.env[b.credential_env_var]) : false,
    secrets_included: false,
  };
}
