export const DEFAULT_DEVICE_HEARTBEAT_MAX_AGE_MS = 10 * 60 * 1000;

function text(value) {
  return String(value ?? "").trim();
}

function optionalIso(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function denial(code, message, evidence = {}) {
  return {
    ok: false,
    code,
    message,
    evidence: { ...evidence, secrets_included: false },
  };
}

export function evaluateLocalConnectorDeviceTrust({
  config,
  userId,
  tenantId,
  deviceId,
  capabilityKey = null,
  capabilitySupported = true,
  now = Date.now(),
  heartbeatMaxAgeMs = DEFAULT_DEVICE_HEARTBEAT_MAX_AGE_MS,
} = {}) {
  const expected = {
    user_id: text(userId) || null,
    tenant_id: text(tenantId) || null,
    device_id: text(deviceId) || null,
    capability_key: text(capabilityKey) || null,
  };

  if (!expected.device_id) {
    return denial("missing_device_id", "device_id is required for device-scoped capabilities.", expected);
  }
  if (!config) {
    return denial("local_device_not_found", "No local connector device matches the requested principal and device.", expected);
  }

  const actual = {
    config_id: text(config.config_id) || null,
    user_id: text(config.user_id) || null,
    tenant_id: text(config.tenant_id) || null,
    device_id: text(config.device_id) || null,
  };
  const enabled = config.is_enabled === true || Number(config.is_enabled) === 1;
  const lifecycleState = text(config.lifecycle_state).toLowerCase() || (enabled ? "active" : "disabled");
  const evidence = {
    ...expected,
    ...actual,
    lifecycle_state: lifecycleState,
    revoked_at: optionalIso(config.revoked_at),
    archived_at: optionalIso(config.archived_at),
  };

  if (actual.device_id !== expected.device_id) {
    return denial("local_device_identity_mismatch", "The resolved device does not match the requested device_id.", evidence);
  }
  if (expected.tenant_id && actual.tenant_id !== expected.tenant_id) {
    return denial("local_device_tenant_mismatch", "The device is not owned by the requesting tenant.", evidence);
  }
  if (expected.user_id && actual.user_id !== expected.user_id) {
    return denial("local_device_user_mismatch", "The device is not owned by the requesting user.", evidence);
  }
  if (!new Set(["active", "disabled", "revoked", "archived"]).has(lifecycleState)) {
    return denial("local_device_lifecycle_invalid", "The local connector device lifecycle state is invalid.", evidence);
  }
  if (lifecycleState === "revoked") {
    return denial("local_device_revoked", "The local connector device has been revoked.", evidence);
  }
  if (lifecycleState === "archived") {
    return denial("local_device_archived", "The local connector device has been archived.", evidence);
  }
  if (lifecycleState === "disabled" || !enabled) {
    return denial("local_device_disabled", "The local connector device is disabled.", evidence);
  }
  if (!text(config.connector_secret)) {
    return denial("local_device_connector_identity_missing", "The device has no active connector identity binding.", evidence);
  }

  const heartbeatAt = config.last_health_at ? new Date(config.last_health_at).getTime() : NaN;
  if (!config.last_health_at) {
    return denial("local_device_heartbeat_missing", "The device has not reported a heartbeat.", evidence);
  }
  if (!Number.isFinite(heartbeatAt)) {
    return denial("local_device_heartbeat_invalid", "The device heartbeat timestamp is invalid.", evidence);
  }

  const maxAge = Number.isFinite(Number(heartbeatMaxAgeMs)) && Number(heartbeatMaxAgeMs) > 0
    ? Number(heartbeatMaxAgeMs)
    : DEFAULT_DEVICE_HEARTBEAT_MAX_AGE_MS;
  const heartbeatAgeMs = Math.max(0, Number(now) - heartbeatAt);
  const heartbeatEvidence = {
    ...evidence,
    heartbeat_at: new Date(heartbeatAt).toISOString(),
    heartbeat_age_ms: heartbeatAgeMs,
    heartbeat_max_age_ms: maxAge,
  };
  if (heartbeatAgeMs > maxAge) {
    return denial("local_device_heartbeat_stale", "The device heartbeat is too old for execution.", heartbeatEvidence);
  }
  if (capabilityKey && capabilitySupported !== true) {
    return denial("local_device_capability_unsupported", "The device does not support the requested capability.", heartbeatEvidence);
  }

  return {
    ok: true,
    code: "local_device_trusted",
    evidence: { ...heartbeatEvidence, secrets_included: false },
  };
}

export function assertLocalConnectorDeviceTrust(input) {
  const decision = evaluateLocalConnectorDeviceTrust(input);
  if (decision.ok) return decision;
  const error = new Error(decision.message);
  error.code = decision.code;
  error.status = ["missing_device_id"].includes(decision.code) ? 400 : 403;
  error.device_trust = decision.evidence;
  throw error;
}
