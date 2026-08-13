function flag(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

export function buildTrustedIngressReadiness(env = process.env) {
  const environment = String(env?.NODE_ENV || env?.REMOTE_MCP_ENVIRONMENT || "staging").trim().toLowerCase();
  const productionLike = ["production", "prod", "canary"].includes(environment);
  const proxyHeadersEnabled = flag(env?.REMOTE_MCP_TRUST_PROXY_HOST_HEADERS);
  const ingressAttested = flag(env?.REMOTE_MCP_TRUSTED_INGRESS_ATTESTED);
  const stripCallerHeaders = flag(env?.REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS);
  const ready = proxyHeadersEnabled && ingressAttested && stripCallerHeaders;
  return {
    ready,
    environment,
    production_like: productionLike,
    proxy_headers_enabled: proxyHeadersEnabled,
    ingress_attested: ingressAttested,
    caller_headers_stripped: stripCallerHeaders,
    required_for_production: true,
    failure_mode: ready ? "accepted" : (productionLike ? "fail_closed" : "staging_attestation_pending"),
    secrets_included: false,
  };
}

export function assertTrustedIngressReadyForProduction(env = process.env) {
  const readiness = buildTrustedIngressReadiness(env);
  if (readiness.production_like && !readiness.ready) {
    const error = new Error("Trusted ingress attestation is required before production or canary OAuth metadata is served.");
    error.status = 503;
    error.code = "TRUSTED_INGRESS_ATTESTATION_REQUIRED";
    error.details = readiness;
    throw error;
  }
  return readiness;
}
