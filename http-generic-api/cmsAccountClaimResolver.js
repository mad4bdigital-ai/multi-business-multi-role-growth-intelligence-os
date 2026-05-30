/**
 * CMS Account Claim Resolver
 *
 * Verifies a user's WordPress application-password credentials against
 * /wp/v2/users/me, stores credentials in the existing encrypted user app
 * connection store, and creates a claim record that gates workspace/tenant
 * sharing behind approval.
 *
 * This module deliberately does not log or return the password.
 */
import crypto from "node:crypto";

const APP_KEY = "wordpress_rest";
const DEFAULT_TIMEOUT_MS = 15000;

export class CmsClaimError extends Error {
  constructor(code, message, status = 400, details = []) {
    super(message);
    this.name = "CmsClaimError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function redact(value) {
  if (!value) return value;
  return "[REDACTED]";
}

function randomId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

export function normalizeUrl(input) {
  if (!input || typeof input !== "string") {
    throw new CmsClaimError("VALIDATION_ERROR", "site_url is required.", 400, [
      { field: "site_url", issue: "required" },
    ]);
  }

  const withScheme = /^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`;
  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new CmsClaimError("VALIDATION_ERROR", "site_url must be a valid URL or domain.", 400, [
      { field: "site_url", issue: "invalid_url" },
    ]);
  }

  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");

  const normalizedDomain = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const origin = `${parsed.protocol}//${parsed.hostname}`;
  const wpJsonBase = `${origin}/wp-json`;

  return { siteUrl: origin, wpJsonBase, normalizedDomain };
}

function basicAuthHeader(username, applicationPassword) {
  const raw = `${username}:${applicationPassword}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

function assertClaimInput({ tenantId, userId, username, applicationPassword, requestedScope }) {
  const details = [];
  if (!tenantId) details.push({ field: "tenant_id", issue: "required_from_authenticated_session" });
  if (!userId) details.push({ field: "user_id", issue: "required_from_authenticated_session" });
  if (!username || typeof username !== "string") details.push({ field: "username", issue: "required" });
  if (!applicationPassword || typeof applicationPassword !== "string") {
    details.push({ field: "application_password", issue: "required" });
  }
  if (requestedScope && !["personal", "workspace", "tenant_brand"].includes(requestedScope)) {
    details.push({ field: "requested_scope", issue: "unsupported_value" });
  }
  if (details.length) {
    throw new CmsClaimError("VALIDATION_ERROR", "One or more fields are invalid.", 400, details);
  }
}

export async function fetchWordPressMe({ fetchImpl, wpJsonBase, username, applicationPassword, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${wpJsonBase}/wp/v2/users/me?context=edit`, {
      method: "GET",
      headers: {
        Authorization: basicAuthHeader(username, applicationPassword),
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text.slice(0, 300) };
    }

    if (!response.ok) {
      throw new CmsClaimError(
        "CMS_CREDENTIAL_VALIDATION_FAILED",
        "The CMS account could not be verified.",
        response.status === 401 || response.status === 403 ? 422 : 502,
        [
          {
            field: "application_password",
            issue: response.status === 401 || response.status === 403
              ? "wordpress_rejected_credentials"
              : `wordpress_status_${response.status}`,
          },
        ]
      );
    }

    return {
      id: body && body.id != null ? String(body.id) : null,
      username: body && (body.username || body.slug || body.name) ? String(body.username || body.slug || body.name) : null,
      email: body && body.email ? String(body.email) : null,
      roles: Array.isArray(body && body.roles) ? body.roles : [],
      raw: body,
    };
  } catch (err) {
    if (err instanceof CmsClaimError) throw err;
    if (err.name === "AbortError") {
      throw new CmsClaimError("CMS_TIMEOUT", "Timed out while verifying the CMS account.", 504, [
        { field: "site_url", issue: "wordpress_timeout" },
      ]);
    }
    throw new CmsClaimError("CMS_VERIFICATION_UNAVAILABLE", "Could not reach the CMS verification endpoint.", 502, [
      { field: "site_url", issue: err.message || "network_error" },
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function hasAdminLikeRole(roles) {
  return (roles || []).some((role) => ["administrator", "editor", "shop_manager"].includes(String(role).toLowerCase()));
}

async function findBrandMatch({ db, tenantId, normalizedDomain, cmsUser }) {
  try {
    const [rows] = await db.query(
      `SELECT brand_name, target_key, brand_domain, base_url, default_wp_api_base
         FROM \`brands\`
        WHERE LOWER(REPLACE(COALESCE(brand_domain, ''), 'www.', '')) = ?
           OR LOWER(COALESCE(base_url, '')) LIKE ?
           OR LOWER(COALESCE(default_wp_api_base, '')) LIKE ?
        LIMIT 1`,
      [normalizedDomain, `%${normalizedDomain}%`, `%${normalizedDomain}%`]
    );
    if (rows && rows[0]) {
      const roleBoost = hasAdminLikeRole(cmsUser.roles);
      return {
        matchedBrandKey: rows[0].brand_name || rows[0].target_key || null,
        matchedTargetKey: rows[0].target_key || null,
        matchConfidence: roleBoost ? "high" : "medium",
      };
    }
  } catch {
    // Ignore schema mismatch and keep claim creation available.
  }

  const email = cmsUser && cmsUser.email ? String(cmsUser.email).toLowerCase() : "";
  if (email.endsWith(`@${normalizedDomain}`)) {
    return { matchedBrandKey: null, matchedTargetKey: null, matchConfidence: "low" };
  }

  return { matchedBrandKey: null, matchedTargetKey: null, matchConfidence: "none" };
}

function capabilityFlags(cmsUser = {}) {
  const caps = cmsUser.raw?.capabilities && typeof cmsUser.raw.capabilities === "object" ? cmsUser.raw.capabilities : {};
  const roles = Array.isArray(cmsUser.roles) ? cmsUser.roles.map((role) => String(role).toLowerCase()) : [];
  return {
    edit_posts: Boolean(caps.edit_posts || hasAdminLikeRole(roles)),
    publish_posts: Boolean(caps.publish_posts || roles.includes("administrator") || roles.includes("editor")),
    delete_posts: Boolean(caps.delete_posts || roles.includes("administrator")),
  };
}

async function upsertCmsSite({ db, siteId, normalizedDomain, siteUrl, wpJsonBase, match }) {
  await db.query(
    `
      INSERT INTO \`cms_sites\` (
        site_id, app_key, normalized_domain, site_url, wp_json_base,
        canonical_target_key, platform_status, first_claimed_at, last_verified_at,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'active', NOW(), NOW(), NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        site_url = VALUES(site_url),
        wp_json_base = VALUES(wp_json_base),
        canonical_target_key = COALESCE(VALUES(canonical_target_key), canonical_target_key),
        platform_status = 'active',
        last_verified_at = NOW(),
        updated_at = NOW()
    `,
    [siteId, APP_KEY, normalizedDomain, siteUrl, wpJsonBase, match.matchedTargetKey || null]
  );
  const [rows] = await db.query(
    `SELECT site_id FROM \`cms_sites\` WHERE app_key = ? AND normalized_domain = ? LIMIT 1`,
    [APP_KEY, normalizedDomain]
  );
  return rows?.[0]?.site_id || siteId;
}

async function createUserAppConnection({
  db, connectionId, tenantId, userId, normalizedDomain, wpJsonBase,
  username, applicationPassword, encryptCredentials,
}) {
  const encryptedCredentials = await encryptCredentials({
    auth_type: "basic_auth_app_password",
    site_url: wpJsonBase.replace(/\/wp-json$/, ""),
    wp_json_base: wpJsonBase,
    username,
    application_password: applicationPassword,
  });

  const displayLabel = `WordPress REST - ${normalizedDomain}`;

  await db.query(
    `
      INSERT INTO \`user_app_connections\` (
        connection_id, tenant_id, user_id, app_key, auth_type, display_label,
        encrypted_credentials, status, last_validated_at, validation_status,
        connected_at, last_used_at
      )
      VALUES (?, ?, ?, ?, 'basic_auth', ?, ?, 'active', NOW(), 'verified', NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        encrypted_credentials = VALUES(encrypted_credentials),
        status = 'active',
        last_validated_at = NOW(),
        validation_status = 'verified',
        last_used_at = NOW()
    `,
    [
      connectionId, tenantId, userId, APP_KEY, displayLabel,
      typeof encryptedCredentials === "string" ? encryptedCredentials : JSON.stringify(encryptedCredentials),
    ]
  );

  return connectionId;
}

async function createPrivateCredentialBinding({
  db, bindingId, tenantId, userId, connectionId, targetKey, normalizedDomain,
}) {
  const credentialRef = `user_app_connection:${connectionId}:encrypted_credentials.application_password`;
  await db.query(
    `
      INSERT INTO \`credential_bindings\` (
        binding_id, tenant_id, owner_type, owner_id, user_id, connection_id,
        action_key, target_key, credential_role, credential_ref,
        resolution_priority, status, created_by, created_at, updated_at
      )
      VALUES (?, ?, 'connection', ?, ?, ?, 'wordpress_rest', ?, 'wordpress_app_password', ?, 10, 'active', ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        credential_ref = VALUES(credential_ref),
        resolution_priority = VALUES(resolution_priority),
        status = 'active',
        updated_at = NOW()
    `,
    [
      bindingId, tenantId, connectionId, userId, connectionId,
      targetKey || normalizedDomain, credentialRef, userId,
    ]
  );
}

async function createSiteAccessGrant({
  db, grantId, siteId, tenantId, userId, connectionId, claimId, cmsUser, requestedScope, approvalRequired,
}) {
  const caps = capabilityFlags(cmsUser);
  const status = approvalRequired ? "pending_approval" : "active";
  await db.query(
    `
      INSERT INTO \`cms_site_access_grants\` (
        grant_id, site_id, tenant_id, user_id, workspace_id, connection_id, claim_id,
        scope, capabilities_json, draft_allowed, publish_allowed, destructive_allowed,
        status, approved_by, approved_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 0, ?, ?, IF(? = 'active', NOW(), NULL), NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        connection_id = VALUES(connection_id),
        claim_id = VALUES(claim_id),
        capabilities_json = VALUES(capabilities_json),
        draft_allowed = VALUES(draft_allowed),
        publish_allowed = VALUES(publish_allowed),
        status = VALUES(status),
        approved_by = VALUES(approved_by),
        approved_at = VALUES(approved_at),
        updated_at = NOW()
    `,
    [
      grantId, siteId, tenantId, userId, connectionId, claimId, requestedScope,
      JSON.stringify(caps), caps.edit_posts ? 1 : 0, caps.publish_posts ? 1 : 0,
      status, status === "active" ? userId : null, status,
    ]
  );
  return { status, capabilities: caps };
}

async function insertClaim({
  db, claimId, tenantId, userId, connectionId, siteUrl, wpJsonBase,
  normalizedDomain, cmsUser, match, requestedScope,
}) {
  const approvalRequired = requestedScope !== "personal" || !!match.matchedBrandKey;

  await db.query(
    `
      INSERT INTO \`cms_account_claims\` (
        claim_id, tenant_id, user_id, connection_id, app_key, site_url,
        wp_json_base, normalized_domain, claimed_username, claimed_email,
        cms_user_id, cms_roles_json, matched_brand_key, matched_target_key,
        match_confidence, verification_status, requested_scope,
        approval_required, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?, NOW(), NOW())
    `,
    [
      claimId, tenantId, userId, connectionId, APP_KEY, siteUrl, wpJsonBase,
      normalizedDomain, cmsUser.username, cmsUser.email, cmsUser.id,
      JSON.stringify(cmsUser.roles || []), match.matchedBrandKey,
      match.matchedTargetKey, match.matchConfidence, requestedScope,
      approvalRequired ? 1 : 0,
    ]
  );

  return approvalRequired;
}

export async function createWordPressAccountClaim({
  db, fetchImpl = globalThis.fetch, encryptCredentials,
  tenantId, userId, siteUrl, username, applicationPassword,
  requestedScope = "personal",
}) {
  assertClaimInput({ tenantId, userId, username, applicationPassword, requestedScope });

  if (!db || typeof db.query !== "function") {
    throw new CmsClaimError("INTERNAL_CONFIG_ERROR", "Database adapter is not configured.", 500);
  }
  if (!fetchImpl) {
    throw new CmsClaimError("INTERNAL_CONFIG_ERROR", "Fetch implementation is not configured.", 500);
  }
  if (typeof encryptCredentials !== "function") {
    throw new CmsClaimError("INTERNAL_CONFIG_ERROR", "Credential encryption function is not configured.", 500);
  }

  const normalized = normalizeUrl(siteUrl);
  const cmsUser = await fetchWordPressMe({
    fetchImpl,
    wpJsonBase: normalized.wpJsonBase,
    username,
    applicationPassword,
  });

  const match = await findBrandMatch({
    db,
    tenantId,
    normalizedDomain: normalized.normalizedDomain,
    cmsUser,
  });

  const claimId = randomId();
  const connectionId = randomId();
  const bindingId = randomId();
  const grantId = randomId();
  const siteId = await upsertCmsSite({
    db,
    siteId: randomId(),
    normalizedDomain: normalized.normalizedDomain,
    siteUrl: normalized.siteUrl,
    wpJsonBase: normalized.wpJsonBase,
    match,
  });

  await createUserAppConnection({
    db, connectionId, tenantId, userId,
    normalizedDomain: normalized.normalizedDomain,
    wpJsonBase: normalized.wpJsonBase,
    username, applicationPassword, encryptCredentials,
  });

  await createPrivateCredentialBinding({
    db, bindingId, tenantId, userId, connectionId,
    targetKey: match.matchedTargetKey,
    normalizedDomain: normalized.normalizedDomain,
  });

  const approvalRequired = await insertClaim({
    db, claimId, tenantId, userId, connectionId,
    siteUrl: normalized.siteUrl,
    wpJsonBase: normalized.wpJsonBase,
    normalizedDomain: normalized.normalizedDomain,
    cmsUser, match, requestedScope,
  });
  const grant = await createSiteAccessGrant({
    db, grantId, siteId, tenantId, userId, connectionId, claimId,
    cmsUser, requestedScope, approvalRequired,
  });

  return {
    status: "verified",
    claim_id: claimId,
    site_id: siteId,
    grant_id: grantId,
    grant_status: grant.status,
    connection_id: connectionId,
    app_key: APP_KEY,
    normalized_domain: normalized.normalizedDomain,
    matched_brand_key: match.matchedBrandKey,
    matched_target_key: match.matchedTargetKey,
    match_confidence: match.matchConfidence,
    approval_required: approvalRequired,
    next_action: approvalRequired ? "request_approval" : "ready_personal_use",
  };
}

export function toErrorEnvelope(err, requestId) {
  const status = err instanceof CmsClaimError ? err.status : 500;
  const code = err instanceof CmsClaimError ? err.code : "INTERNAL_SERVER_ERROR";
  const message = err instanceof CmsClaimError ? err.message : "Unexpected server failure.";
  const details = err instanceof CmsClaimError ? err.details : [];

  return {
    status,
    body: { error: { code, message, details, requestId } },
  };
}

export { APP_KEY };
