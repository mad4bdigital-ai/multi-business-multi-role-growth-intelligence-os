// Auto-extracted from server.js — do not edit manually, use domain logic here.
import crypto from "node:crypto";
import { policyValue } from "./registryPolicyAccess.js";

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    const err = new Error(`Missing required environment variable: ${name}`);
    err.code = "missing_env";
    err.status = 500;
    throw err;
  }
  return value;
}

export function jsonParseSafe(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function boolFromSheet(value) {
  return String(value || "").trim().toUpperCase() === "TRUE";
}

export function asBool(value) {
  return String(value || "").trim().toUpperCase() === "TRUE";
}

export function rowToObject(header, row) {
  const out = {};
  for (let i = 0; i < header.length; i += 1) {
    out[header[i]] = row[i] ?? "";
  }
  return out;
}

export function toUpper(value) {
  return String(value || "").trim().toUpperCase();
}

export function normalizeMethod(method) {
  const m = toUpper(method);
  const allowed = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  if (!allowed.includes(m)) {
    const err = new Error(`Method not allowed: ${m}`);
    err.code = "method_not_allowed";
    err.status = 403;
    throw err;
  }
  return m;
}

export function normalizePath(path) {
  if (!path || typeof path !== "string" || !path.startsWith("/")) {
    const err = new Error("path must be a relative path starting with '/'.");
    err.code = "path_not_allowed";
    err.status = 400;
    throw err;
  }
  if (/^https?:\/\//i.test(path)) {
    const err = new Error("Full URLs are not allowed.");
    err.code = "path_not_allowed";
    err.status = 403;
    throw err;
  }
  return path;
}

export function normalizeProviderDomain(providerDomain) {
  if (!providerDomain || typeof providerDomain !== "string") {
    const err = new Error("provider_domain is required.");
    err.code = "invalid_request";
    err.status = 400;
    throw err;
  }

  let url;
  try {
    url = new URL(providerDomain);
  } catch {
    const err = new Error("provider_domain must be a valid absolute URL.");
    err.code = "invalid_request";
    err.status = 400;
    throw err;
  }

  if (!["https:", "http:"].includes(url.protocol)) {
    const err = new Error("provider_domain must use http or https.");
    err.code = "invalid_request";
    err.status = 400;
    throw err;
  }

  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

export function safeNormalizeProviderDomain(value) {
  try {
    return value ? normalizeProviderDomain(value) : "";
  } catch {
    return "";
  }
}

export function normalizeEndpointProviderDomain(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return normalizeProviderDomain(v);
  return normalizeProviderDomain(`https://${v}`);
}

export function isVariablePlaceholder(value, policies = []) {
  const v = String(value || "").trim();
  const dynamicPlaceholder = String(
    policyValue(
      policies,
      "HTTP Execution Governance",
      "Dynamic Provider Domain Placeholder",
      "target_resolved"
    )
  ).trim();

  return /^\{[^}]+\}$/.test(v) || v === dynamicPlaceholder;
}

export function sanitizeCallerHeaders(headers = {}) {
  const forbidden = ["proxy-authorization", "host"];
  const clean = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const lower = String(key).toLowerCase();
    if (forbidden.includes(lower)) {
      const err = new Error(`Forbidden header: ${key}`);
      err.code = "forbidden_header";
      err.status = 403;
      throw err;
    }
    if (lower === "authorization") {
      continue;
    }
    clean[key] = value;
  }
  return clean;
}

export function buildUrl(providerDomain, path) {
  const normalizedPath = normalizePath(path);
  const base = new URL(providerDomain);
  const basePath = base.pathname.replace(/\/+$/, "");
  const relativePath = normalizedPath.replace(/^\/+/, "");
  const joinedPath = `${basePath}/${relativePath}`.replace(/\/+/g, "/");
  base.pathname = joinedPath;
  base.search = "";
  return base.toString();
}

export function appendQuery(url, query) {
  const u = new URL(url);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null) {
      u.searchParams.set(key, String(value));
    }
  }
  return u.toString();
}

export function createExecutionTraceId() {
  return `trace_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function toSheetCellValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

export function toA1Start(sheetName) {
  return toValuesApiRange(sheetName, "A1");
}

export function columnLetter(colIndex) {
  let letter = "";
  while (colIndex > 0) {
    let temp = (colIndex - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    colIndex = (colIndex - temp - 1) / 26;
  }
  return letter;
}

export function nowIso() {
  return new Date().toISOString();
}

export function normalizeJobId(value = "") {
  return String(value || "").trim();
}

export function normalizeJobStatus(value = "") {
  return String(value || "").trim().toLowerCase();
}

export function normalizeWebhookUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

export function normalizeMaxAttempts(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_JOB_MAX_ATTEMPTS;
  return Math.min(Math.floor(n), 10);
}

export function nextRetryDelayMs(attemptCount) {
  const idx = Math.max(0, Number(attemptCount || 1) - 1);
  if (idx < JOB_RETRY_DELAYS_MS.length) return JOB_RETRY_DELAYS_MS[idx];
  return JOB_RETRY_DELAYS_MS[JOB_RETRY_DELAYS_MS.length - 1];
}

export function buildJobId() {
  return `job_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function resolveRequestedBy(req) {
  const byHeader =
    req.header("X-Requested-By") ||
    req.header("X-Requester-Id") ||
    "";

  return String(byHeader || req.ip || "unknown").trim();
}

export function makeIdempotencyLookupKey(requestedBy, idempotencyKey) {
  const key = String(idempotencyKey || "").trim();
  if (!key) return "";
  return `${String(requestedBy || "").trim()}::${key}`;
}

export function buildExecutionPayloadFromJobRequest(body = {}) {
  const nested =
    body.request_payload &&
      typeof body.request_payload === "object" &&
      !Array.isArray(body.request_payload)
      ? { ...body.request_payload }
      : null;

  const topLevelPayload = { ...(body || {}) };
  delete topLevelPayload.request_payload;
  delete topLevelPayload.job_type;
  delete topLevelPayload.max_attempts;
  delete topLevelPayload.webhook_url;
  delete topLevelPayload.callback_secret;
  delete topLevelPayload.idempotency_key;

  return nested || topLevelPayload;
}

export function validateAsyncJobRequest(payload = {}) {
  const errors = [];
  const allowedMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return ["request payload must be an object."];
  }

  if (!String(payload.parent_action_key || "").trim()) {
    errors.push("parent_action_key is required.");
  }

  if (!String(payload.endpoint_key || "").trim()) {
    errors.push("endpoint_key is required.");
  }

  if (payload.target_key !== undefined && typeof payload.target_key !== "string") {
    errors.push("target_key must be a string when provided.");
  }

  if (payload.brand !== undefined && typeof payload.brand !== "string") {
    errors.push("brand must be a string when provided.");
  }

  if (payload.brand_domain !== undefined && typeof payload.brand_domain !== "string") {
    errors.push("brand_domain must be a string when provided.");
  }

  if (payload.provider_domain !== undefined && typeof payload.provider_domain !== "string") {
    errors.push("provider_domain must be a string when provided.");
  }

  if (payload.parent_action_key !== undefined && typeof payload.parent_action_key !== "string") {
    errors.push("parent_action_key must be a string when provided.");
  }

  if (payload.endpoint_key !== undefined && typeof payload.endpoint_key !== "string") {
    errors.push("endpoint_key must be a string when provided.");
  }

  if (payload.method !== undefined) {
    if (typeof payload.method !== "string") {
      errors.push("method must be a string when provided.");
    } else {
      const normalizedMethod = String(payload.method).trim().toUpperCase();
      if (!allowedMethods.has(normalizedMethod)) {
        errors.push("method must be one of GET, POST, PUT, PATCH, DELETE.");
      }
    }
  }

  if (payload.path !== undefined) {
    if (typeof payload.path !== "string") {
      errors.push("path must be a string when provided.");
    } else {
      const trimmedPath = String(payload.path).trim();
      if (!trimmedPath.startsWith("/")) {
        errors.push("path must start with '/'.");
      }
      if (/^https?:\/\//i.test(trimmedPath)) {
        errors.push("path must be a relative path, not a full URL.");
      }
    }
  }

  if (
    payload.path_params !== undefined &&
    (
      !payload.path_params ||
      typeof payload.path_params !== "object" ||
      Array.isArray(payload.path_params)
    )
  ) {
    errors.push("path_params must be an object when provided.");
  }

  if (
    payload.query !== undefined &&
    (
      !payload.query ||
      typeof payload.query !== "object" ||
      Array.isArray(payload.query)
    )
  ) {
    errors.push("query must be an object when provided.");
  }

  if (
    payload.headers !== undefined &&
    (
      !payload.headers ||
      typeof payload.headers !== "object" ||
      Array.isArray(payload.headers)
    )
  ) {
    errors.push("headers must be an object when provided.");
  }

  if (payload.headers && typeof payload.headers === "object" && !Array.isArray(payload.headers)) {
    for (const [key, value] of Object.entries(payload.headers)) {
      if (typeof value !== "string") {
        errors.push(`headers.${key} must be a string.`);
      }
      if (String(key).toLowerCase() === "authorization") {
        errors.push("headers.Authorization must not be supplied by caller.");
      }
    }
  }

  if (
    payload.readback !== undefined &&
    (
      !payload.readback ||
      typeof payload.readback !== "object" ||
      Array.isArray(payload.readback)
    )
  ) {
    errors.push("readback must be an object when provided.");
  }

  if (payload.readback && typeof payload.readback === "object" && !Array.isArray(payload.readback)) {
    if (
      payload.readback.required !== undefined &&
      typeof payload.readback.required !== "boolean"
    ) {
      errors.push("readback.required must be a boolean when provided.");
    }

    if (payload.readback.mode !== undefined) {
      const allowedModes = new Set(["none", "echo", "location_followup"]);
      if (typeof payload.readback.mode !== "string") {
        errors.push("readback.mode must be a string when provided.");
      } else if (!allowedModes.has(String(payload.readback.mode).trim())) {
        errors.push("readback.mode must be one of none, echo, location_followup.");
      }
    }
  }

  if (
    payload.expect_json !== undefined &&
    typeof payload.expect_json !== "boolean"
  ) {
    errors.push("expect_json must be a boolean when provided.");
  }

  if (
    payload.force_refresh !== undefined &&
    typeof payload.force_refresh !== "boolean"
  ) {
    errors.push("force_refresh must be a boolean when provided.");
  }

  if (payload.timeout_seconds !== undefined) {
    if (
      typeof payload.timeout_seconds !== "number" ||
      !Number.isInteger(payload.timeout_seconds)
    ) {
      errors.push("timeout_seconds must be an integer when provided.");
    } else {
      if (payload.timeout_seconds < 1) {
        errors.push("timeout_seconds must be at least 1.");
      }
      if (payload.timeout_seconds > MAX_TIMEOUT_SECONDS) {
        errors.push(`timeout_seconds must be <= ${MAX_TIMEOUT_SECONDS}.`);
      }
    }
  }

  return errors;
}

export function createHttpError(code, message, status = 400, details) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (details !== undefined) err.details = details;
  return err;
}

export function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => String(item || "").trim())
    .filter(Boolean);
}

export function buildRecordFromHeaderAndRow(header = [], row = []) {
  const record = {};
  header.forEach((key, idx) => {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) return;
    record[normalizedKey] = row[idx] ?? "";
  });
  return record;
}

export function buildSheetRowFromColumns(columns = [], row = {}) {
  return columns.map(column => toSheetCellValue(row[column]));
}

export function normalizeLooseHostname(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

export function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export function sleep(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function chunkArray(items = [], size = 20) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function nowIsoSafe() {
  try {
    return new Date().toISOString();
  } catch {
    return "";
  }
}

export function extractJsonAssetPayloadBody(args = {}) {
  const body = args.response_body;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    if (Object.prototype.hasOwnProperty.call(body, "data")) {
      return body.data;
    }
  }
  return body ?? null;
}

export function normalizeJsonObjectOrEmpty(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

export function isWordpressCptSchemaPreflightEndpoint(endpointKey = "") {
  const key = String(endpointKey || "").trim();
  return new Set([
    "wordpress_get_cpt_runtime_type",
    "jetengine_get_post_type_config",
    "jetengine_get_meta_boxes",
    "wordpress_get_cpt_sample_pattern",
    "wordpress_get_taxonomy_runtime",
    "wordpress_list_taxonomy_terms",
    "wordpress_get_tag_terms",
    "wordpress_get_category_terms"
  ]).has(key);
}

export function buildWordpressCptSchemaPreflightAssetKey(args = {}) {
  const brandNormalized = String(
    args.normalized_brand_name || args.brand_name || "unknown_brand"
  )
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "unknown_brand";

  const targetKey =
    String(args.target_key || "unknown_target").trim() || "unknown_target";
  const cptSlug =
    String(args.cpt_slug || args.post_type || args.type || args.rest_base || "unknown_cpt")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_") || "unknown_cpt";

  return `${brandNormalized}__${targetKey}__${cptSlug}__wordpress_cpt_schema_preflight_v1`;
}

export function buildWordpressCptSchemaPreflightPayload(args = {}) {
  const rawPayload = extractJsonAssetPayloadBody(args);
  const payloadObject =
    rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)
      ? rawPayload
      : {};

  const identity = {
    brand_name: String(args.brand_name || "").trim(),
    brand_domain: String(args.brand_domain || "").trim(),
    target_key: String(args.target_key || "").trim(),
    base_url: String(args.base_url || "").trim(),
    site_type: "wordpress",
    cpt_slug: String(args.cpt_slug || args.post_type || args.type || "").trim(),
    rest_base: String(args.rest_base || "").trim(),
    asset_key: buildWordpressCptSchemaPreflightAssetKey(args)
  };

  const source_resolution = {
    brand_registry_resolved: !!args.brand_name || !!args.target_key,
    site_runtime_inventory_resolved: !!args.base_url,
    wordpress_rest_type_resolved:
      String(args.endpoint_key || "").trim() === "wordpress_get_cpt_runtime_type" ||
      payloadObject.wordpress_rest_type_resolved === true,
    jetengine_config_resolved:
      String(args.endpoint_key || "").trim() === "jetengine_get_post_type_config" ||
      payloadObject.jetengine_config_resolved === true,
    taxonomy_runtime_resolved:
      String(args.endpoint_key || "").trim() === "wordpress_get_taxonomy_runtime" ||
      payloadObject.taxonomy_runtime_resolved === true,
    sample_pattern_mode: String(
      args.sample_pattern_mode || payloadObject.sample_pattern_mode || ""
    ).trim(),
    sample_pattern_used:
      String(args.endpoint_key || "").trim() === "wordpress_get_cpt_sample_pattern" ||
      payloadObject.sample_pattern_used === true
  };

  const playbook_inference = {
    brand_playbook_asset_key: String(args.brand_playbook_asset_key || "").trim(),
    brand_playbook_sheet_gid: String(args.brand_playbook_sheet_gid || "").trim(),
    playbook_coverage_status: String(args.playbook_coverage_status || "not_applicable").trim(),
    playbook_backfill_required: String(args.playbook_backfill_required || "FALSE").trim(),
    fallback_template_mode: String(args.fallback_template_mode || "runtime_contract_only").trim(),
    coverage_gap_notes: String(args.coverage_gap_notes || "").trim()
  };

  return {
    identity,
    source_resolution,
    field_contract: normalizeJsonObjectOrEmpty(
      args.field_contract || payloadObject.field_contract || payloadObject.fields
    ),
    taxonomy_contract: normalizeJsonObjectOrEmpty(
      args.taxonomy_contract || payloadObject.taxonomy_contract
    ),
    formatter_hints: normalizeJsonObjectOrEmpty(
      args.formatter_hints || payloadObject.formatter_hints
    ),
    playbook_inference,
    readiness_result: normalizeJsonObjectOrEmpty(
      args.readiness_result || payloadObject.readiness_result
    )
  };
}

export function matchesHostingerSshTarget(rowObj, input = {}) {
  if ((rowObj.hosting_provider || "").trim().toLowerCase() !== "hostinger") {
    return false;
  }

  const targetKey = String(input.target_key || "").trim();
  const hostingAccountKey = String(input.hosting_account_key || "").trim();
  const accountIdentifier = String(input.account_identifier || "").trim();
  const siteUrl = String(input.site_url || "").trim().toLowerCase();

  if (hostingAccountKey && rowObj.hosting_account_key === hostingAccountKey) {
    return true;
  }

  if (accountIdentifier && rowObj.account_identifier === accountIdentifier) {
    return true;
  }

  const resolverTargetKeys = jsonParseSafe(rowObj.resolver_target_keys_json, []);
  if (
    targetKey &&
    Array.isArray(resolverTargetKeys) &&
    resolverTargetKeys.includes(targetKey)
  ) {
    return true;
  }

  const brandSites = jsonParseSafe(rowObj.brand_sites_json, []);
  if (
    siteUrl &&
    Array.isArray(brandSites) &&
    brandSites.some(
      x => String(x?.site || "").trim().toLowerCase() === siteUrl
    )
  ) {
    return true;
  }

  return false;
}
