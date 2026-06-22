import { createHash, timingSafeEqual } from "node:crypto";

function text(value) {
  return String(value ?? "").trim();
}

function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function equalHex(left, right) {
  const a = Buffer.from(text(left));
  const b = Buffer.from(text(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function policyError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function parseAllowlist(value) {
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { parsed = []; }
  }
  return Array.isArray(parsed) ? parsed.map(text).filter(Boolean).slice(0, 50) : [];
}

function canonicalHttpsUrl(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw policyError("credential_intake_redirect_not_allowed", "Redirect must be an allowlisted HTTPS URL.");
  }
  return parsed.toString();
}

export function normalizeCredentialIntakeRedirect({ redirectUri, requestOrigin, registryAllowlist } = {}) {
  const raw = text(redirectUri);
  if (!raw) return null;
  if (raw.includes("\\") || raw.startsWith("//")) {
    throw policyError("credential_intake_redirect_not_allowed", "Redirect path is not allowed.");
  }
  if (raw.startsWith("/")) {
    const origin = requestOrigin ? new URL(requestOrigin).origin : "https://credential-intake.invalid";
    const parsed = new URL(raw, origin);
    if (parsed.origin !== origin) {
      throw policyError("credential_intake_redirect_not_allowed", "Redirect must remain on the request origin.");
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }

  let normalized;
  try { normalized = canonicalHttpsUrl(raw); }
  catch (error) {
    if (error?.code) throw error;
    throw policyError("credential_intake_redirect_not_allowed", "Redirect URL is invalid.");
  }
  const allowed = parseAllowlist(registryAllowlist)
    .map((entry) => { try { return canonicalHttpsUrl(entry); } catch { return null; } })
    .filter(Boolean);
  if (!allowed.includes(normalized)) {
    throw policyError("credential_intake_redirect_not_allowed", "Redirect URL is not registered for this integration.");
  }
  return normalized;
}

export function buildCredentialIntakeBinding({
  userId,
  tenantId,
  appKey,
  authType,
  connectionTargetRef,
  purpose,
  allowedRedirectUri = null,
  authoritySnapshotHash = null,
} = {}) {
  const payload = {
    subject_id: text(userId),
    tenant_id: text(tenantId),
    integration_key: text(appKey),
    auth_type: text(authType),
    connection_target_ref: text(connectionTargetRef),
    purpose: text(purpose),
    allowed_redirect_uri: text(allowedRedirectUri) || null,
    authority_snapshot_hash: text(authoritySnapshotHash) || null,
  };
  const missing = Object.entries(payload)
    .filter(([key, value]) => !value && !["allowed_redirect_uri", "authority_snapshot_hash"].includes(key))
    .map(([key]) => key);
  if (missing.length) {
    throw policyError("credential_intake_binding_context_required", `Credential intake binding is missing: ${missing.join(", ")}.`);
  }
  return { ...payload, binding_digest: hashJson(payload), secrets_included: false };
}

export function validateCredentialIntakeSessionBinding(session = {}) {
  const storedDigest = text(session.binding_digest);
  if (!storedDigest) {
    return { ok: true, code: "credential_intake_legacy_binding", legacy: true, secrets_included: false };
  }
  let expected;
  try {
    expected = buildCredentialIntakeBinding({
      userId: session.user_id,
      tenantId: session.tenant_id,
      appKey: session.app_key,
      authType: session.auth_type,
      connectionTargetRef: session.connection_target_ref,
      purpose: session.purpose,
      allowedRedirectUri: session.allowed_redirect_uri,
      authoritySnapshotHash: session.authority_snapshot_hash,
    }).binding_digest;
  } catch {
    return { ok: false, code: "credential_intake_binding_mismatch", legacy: false, secrets_included: false };
  }
  return {
    ok: equalHex(storedDigest, expected),
    code: equalHex(storedDigest, expected) ? "credential_intake_binding_valid" : "credential_intake_binding_mismatch",
    legacy: false,
    secrets_included: false,
  };
}

export function buildTenantCredentialIntakeAuthoritySnapshot({
  userId,
  tenantId,
  tenantRole,
  appKey,
  authType,
  sourceMode,
  fallbackAllowed = false,
  requiredForDeviceInstall = false,
  membershipStatus = "active",
  tenantStatus = "active",
  policyStatus = "active",
  appStatus = "active",
} = {}) {
  const payload = {
    user_id: text(userId),
    tenant_id: text(tenantId),
    tenant_role: text(tenantRole).toLowerCase(),
    app_key: text(appKey),
    auth_type: text(authType),
    source_mode: text(sourceMode),
    fallback_allowed: fallbackAllowed === true || Number(fallbackAllowed) === 1,
    required_for_device_install: requiredForDeviceInstall === true || Number(requiredForDeviceInstall) === 1,
    membership_status: text(membershipStatus).toLowerCase(),
    tenant_status: text(tenantStatus).toLowerCase(),
    policy_status: text(policyStatus).toLowerCase(),
    app_status: text(appStatus).toLowerCase(),
  };
  if (!payload.user_id || !payload.tenant_id || !payload.tenant_role || !payload.app_key || !payload.auth_type) {
    throw policyError("credential_intake_authority_context_required", "Credential intake authority context is incomplete.");
  }
  return {
    snapshot_hash: hashJson(payload),
    version: "tenant_credential_intake_authority_v1",
    payload,
    secrets_included: false,
  };
}

export async function validateCredentialIntakeSessionSecurity({ queryable, session } = {}) {
  const binding = validateCredentialIntakeSessionBinding(session);
  if (!binding.ok) return binding;
  const storedAuthorityHash = text(session?.authority_snapshot_hash);
  if (!storedAuthorityHash) {
    return { ok: true, code: binding.legacy ? "credential_intake_legacy_authority" : "credential_intake_authority_not_required", legacy: true, secrets_included: false };
  }
  if (!queryable || typeof queryable.query !== "function") {
    throw new TypeError("A queryable database connection is required for authority validation.");
  }
  const [rows] = await queryable.query(
    `SELECT m.role AS tenant_role, m.status AS membership_status,
            t.status AS tenant_status,
            p.source_mode, p.fallback_allowed, p.required_for_device_install,
            p.status AS policy_status,
            a.auth_type, a.status AS app_status
       FROM memberships m
       JOIN tenants t ON t.tenant_id = m.tenant_id
       JOIN tenant_integration_policies p ON p.tenant_id = m.tenant_id AND p.app_key = ?
       JOIN app_integrations a ON a.app_key = p.app_key
      WHERE m.user_id = ? AND m.tenant_id = ?
      LIMIT 1`,
    [session.app_key, session.user_id, session.tenant_id],
  );
  const current = rows?.[0] || null;
  if (!current) return { ok: false, code: "credential_intake_authority_revoked", secrets_included: false };
  const snapshot = buildTenantCredentialIntakeAuthoritySnapshot({
    userId: session.user_id,
    tenantId: session.tenant_id,
    tenantRole: current.tenant_role,
    appKey: session.app_key,
    authType: current.auth_type,
    sourceMode: current.source_mode,
    fallbackAllowed: current.fallback_allowed,
    requiredForDeviceInstall: current.required_for_device_install,
    membershipStatus: current.membership_status,
    tenantStatus: current.tenant_status,
    policyStatus: current.policy_status,
    appStatus: current.app_status,
  });
  const active = current.membership_status === "active"
    && current.tenant_status === "active"
    && current.policy_status === "active"
    && ["active", "beta"].includes(String(current.app_status || "").toLowerCase());
  const valid = active && equalHex(storedAuthorityHash, snapshot.snapshot_hash);
  return {
    ok: valid,
    code: valid ? "credential_intake_authority_valid" : "credential_intake_authority_revoked",
    authority_version: snapshot.version,
    secrets_included: false,
  };
}
