import crypto from "node:crypto";
import {
  DEFAULT_JOB_MAX_ATTEMPTS,
  JOB_RETRY_DELAYS_MS,
  MAX_TIMEOUT_SECONDS
} from "./config.js";

export const TERMINAL_JOB_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
export const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "retrying"]);

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
    (!payload.path_params || typeof payload.path_params !== "object" || Array.isArray(payload.path_params))
  ) {
    errors.push("path_params must be an object when provided.");
  }

  if (
    payload.query !== undefined &&
    (!payload.query || typeof payload.query !== "object" || Array.isArray(payload.query))
  ) {
    errors.push("query must be an object when provided.");
  }

  if (
    payload.headers !== undefined &&
    (!payload.headers || typeof payload.headers !== "object" || Array.isArray(payload.headers))
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
    (!payload.readback || typeof payload.readback !== "object" || Array.isArray(payload.readback))
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

  if (payload.expect_json !== undefined && typeof payload.expect_json !== "boolean") {
    errors.push("expect_json must be a boolean when provided.");
  }

  if (payload.force_refresh !== undefined && typeof payload.force_refresh !== "boolean") {
    errors.push("force_refresh must be a boolean when provided.");
  }

  if (payload.timeout_seconds !== undefined) {
    if (typeof payload.timeout_seconds !== "number" || !Number.isInteger(payload.timeout_seconds)) {
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
