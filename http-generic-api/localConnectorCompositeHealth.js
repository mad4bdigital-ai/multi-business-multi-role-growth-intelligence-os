function normalizedStatus(value = "") {
  return String(value || "").trim().toLowerCase();
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

export const DEFAULT_LOCAL_CONNECTOR_HEALTH_RETRY_POLICY = Object.freeze({
  policy_key: "cloudflare_1033_retry_before_repair_v1",
  max_attempts: 3,
  base_delay_ms: 750,
  max_delay_ms: 2000,
  retryable_http_statuses: Object.freeze([502, 503, 504, 530]),
});

export function isRetryableLocalConnectorHealthProbe(probe = {}, policy = DEFAULT_LOCAL_CONNECTOR_HEALTH_RETRY_POLICY) {
  if (probe?.status === "transport_error") return true;
  if (probe?.status !== "http_error") return false;
  return (policy.retryable_http_statuses || []).includes(Number(probe?.http_status));
}

export async function probeLocalConnectorPublicHealth({ tunnelUrl, fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const baseUrl = String(tunnelUrl || "").trim().replace(/\/$/, "");
  if (!baseUrl) {
    return {
      status: "not_attempted",
      http_status: null,
      reason: "tunnel_url_missing",
      secrets_included: false,
    };
  }
  try {
    const response = await fetchImpl(`${baseUrl}/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(Math.max(1000, Math.min(Number(timeoutMs) || 8000, 30000))),
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      return {
        status: "authorization_gated",
        http_status: response.status,
        service: body?.service || null,
        hostname: body?.hostname || null,
        platform: body?.platform || null,
        secrets_included: false,
      };
    }
    if (!response.ok || body?.ok === false) {
      return {
        status: "http_error",
        http_status: response.status,
        service: body?.service || null,
        hostname: body?.hostname || null,
        platform: body?.platform || null,
        secrets_included: false,
      };
    }
    return {
      status: "pass",
      http_status: response.status,
      service: body?.service || null,
      hostname: body?.hostname || null,
      platform: body?.platform || null,
      uptime: Number.isFinite(Number(body?.uptime)) ? Number(body.uptime) : null,
      secrets_included: false,
    };
  } catch (error) {
    return {
      status: "transport_error",
      http_status: null,
      error_code: error?.name === "TimeoutError" ? "connector_health_timeout" : "connector_health_transport_error",
      message: String(error?.message || "Connector health probe failed.").slice(0, 240),
      secrets_included: false,
    };
  }
}

export async function probeLocalConnectorPublicHealthWithRetry({
  tunnelUrl,
  fetchImpl = fetch,
  timeoutMs = 8000,
  maxAttempts = DEFAULT_LOCAL_CONNECTOR_HEALTH_RETRY_POLICY.max_attempts,
  baseDelayMs = DEFAULT_LOCAL_CONNECTOR_HEALTH_RETRY_POLICY.base_delay_ms,
  maxDelayMs = DEFAULT_LOCAL_CONNECTOR_HEALTH_RETRY_POLICY.max_delay_ms,
  sleepImpl = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
} = {}) {
  const policy = {
    ...DEFAULT_LOCAL_CONNECTOR_HEALTH_RETRY_POLICY,
    max_attempts: boundedInteger(maxAttempts, DEFAULT_LOCAL_CONNECTOR_HEALTH_RETRY_POLICY.max_attempts, 1, 5),
    base_delay_ms: boundedInteger(baseDelayMs, DEFAULT_LOCAL_CONNECTOR_HEALTH_RETRY_POLICY.base_delay_ms, 0, 5000),
    max_delay_ms: boundedInteger(maxDelayMs, DEFAULT_LOCAL_CONNECTOR_HEALTH_RETRY_POLICY.max_delay_ms, 0, 10000),
  };
  const attempts = [];
  let finalProbe = null;

  for (let attempt = 1; attempt <= policy.max_attempts; attempt += 1) {
    finalProbe = await probeLocalConnectorPublicHealth({ tunnelUrl, fetchImpl, timeoutMs });
    const retryable = isRetryableLocalConnectorHealthProbe(finalProbe, policy);
    const attemptEvidence = {
      attempt,
      status: finalProbe.status,
      http_status: finalProbe.http_status ?? null,
      error_code: finalProbe.error_code || null,
      retryable,
    };
    attempts.push(attemptEvidence);

    if (!retryable || attempt >= policy.max_attempts) break;

    const delayMs = Math.min(policy.max_delay_ms, policy.base_delay_ms * (2 ** (attempt - 1)));
    attemptEvidence.delay_before_next_ms = delayMs;
    await sleepImpl(delayMs);
  }

  const retryableFinal = isRetryableLocalConnectorHealthProbe(finalProbe, policy);
  return {
    ...(finalProbe || {
      status: "not_attempted",
      http_status: null,
      reason: "health_probe_not_executed",
      secrets_included: false,
    }),
    retry_evidence: {
      policy_key: policy.policy_key,
      attempt_count: attempts.length,
      max_attempts: policy.max_attempts,
      recovered_on_retry: attempts.length > 1 && !retryableFinal,
      retry_exhausted: attempts.length >= policy.max_attempts && retryableFinal,
      retryable_http_statuses: [...policy.retryable_http_statuses],
      attempts,
      secrets_included: false,
    },
  };
}

export function classifyLocalConnectorCompositeHealth({ tunnelStatus, publicProbe } = {}) {
  const tunnel = normalizedStatus(tunnelStatus);
  const probe = publicProbe || { status: "not_attempted" };
  const tunnelHealthy = ["healthy", "active", "up"].includes(tunnel);
  const tunnelUnhealthy = ["down", "inactive", "degraded", "error", "unhealthy"].includes(tunnel);

  if (probe.status === "pass") {
    return {
      status: "active",
      repair_required: false,
      likely_cause: null,
      tunnel_status: tunnelStatus || null,
      public_probe_status: probe.status,
      secrets_included: false,
    };
  }
  if (probe.status === "authorization_gated") {
    return {
      status: "authorization_gated",
      repair_required: false,
      likely_cause: "connector health endpoint is reachable but requires authorization",
      tunnel_status: tunnelStatus || null,
      public_probe_status: probe.status,
      secrets_included: false,
    };
  }
  if (tunnelUnhealthy) {
    return {
      status: "degraded_tunnel",
      repair_required: true,
      likely_cause: "Cloudflare tunnel is not healthy",
      tunnel_status: tunnelStatus || null,
      public_probe_status: probe.status,
      secrets_included: false,
    };
  }
  if (tunnelHealthy && ["http_error", "transport_error"].includes(probe.status)) {
    return {
      status: "degraded_local_service",
      repair_required: true,
      likely_cause: "Cloudflare tunnel is healthy but the local Node connector health endpoint is unavailable",
      tunnel_status: tunnelStatus || null,
      public_probe_status: probe.status,
      secrets_included: false,
    };
  }
  return {
    status: "validating",
    repair_required: true,
    likely_cause: "connector health is incomplete because tunnel or local service evidence is unavailable",
    tunnel_status: tunnelStatus || null,
    public_probe_status: probe.status,
    secrets_included: false,
  };
}
