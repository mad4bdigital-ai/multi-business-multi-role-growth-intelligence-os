export function trustedProxyHostHeadersEnabled(env = process.env) {
  return String(env?.REMOTE_MCP_TRUST_PROXY_HOST_HEADERS || "").trim().toLowerCase() === "true";
}

export function headerValue(headers, name) {
  if (!headers || typeof headers !== "object") return "";
  const lowered = String(name || "").toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() !== lowered) continue;
    if (Array.isArray(value)) return value.length === 1 ? String(value[0] ?? "") : "";
    return String(value ?? "");
  }
  return "";
}

export function normalizeTrustedRequestHost(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.includes(",") || /[\s/?#@\\]/u.test(raw)) return "";
  try {
    const url = new URL(`https://${raw}`);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return "";
    return url.hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function resolveTrustedRequestHost(requestOrHeaders = {}, env = process.env) {
  const headers = requestOrHeaders?.headers || requestOrHeaders || {};

  if (trustedProxyHostHeadersEnabled(env)) {
    const originalHost = headerValue(headers, "x-original-host");
    if (originalHost) return normalizeTrustedRequestHost(originalHost);

    const forwardedHost = headerValue(headers, "x-forwarded-host");
    if (forwardedHost) return normalizeTrustedRequestHost(forwardedHost);
  }

  return normalizeTrustedRequestHost(
    headerValue(headers, ":authority") || headerValue(headers, "host"),
  );
}
