export function normalizeAuthEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

export function hasVerifiedGoogleIdentity(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  return Boolean(
    String(payload.sub || "").trim()
    && normalizeAuthEmail(payload.email)
    && payload.email_verified === true
  );
}
