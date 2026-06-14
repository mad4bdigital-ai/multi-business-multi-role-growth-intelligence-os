function normalizedStatus(value = "") {
  return String(value || "").trim().toLowerCase();
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
