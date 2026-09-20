import crypto from "node:crypto";
import { getPool } from "./db.js";
import {
  buildEncryptedCredentialsForStorage,
  decryptUserAppCredentials,
} from "./userAppConnectionCredentials.js";

export const MANAGED_WORDPRESS_GOOGLE_OAUTH_STORE_CONTRACT =
  "mad4b.managed-wordpress-google-oauth-store.v1";

export const CREATE_MANAGED_WORDPRESS_GOOGLE_OAUTH_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`managed_wordpress_google_oauth_sessions\` (
  \`session_id\` VARCHAR(36) NOT NULL,
  \`site_uuid\` VARCHAR(64) NOT NULL,
  \`origin\` VARCHAR(512) NOT NULL,
  \`callback_uri\` VARCHAR(1024) NOT NULL,
  \`access_mode\` ENUM('read_only','read_write') NOT NULL,
  \`requested_scope\` VARCHAR(255) NOT NULL,
  \`state_hash\` CHAR(64) NOT NULL,
  \`verifier_challenge\` VARCHAR(128) NOT NULL,
  \`google_pkce_envelope\` LONGTEXT NOT NULL,
  \`handoff_code_hash\` CHAR(64) NULL,
  \`token_envelope\` LONGTEXT NULL,
  \`status\` ENUM('pending','claimed','authorized','consumed','denied','expired','failed') NOT NULL DEFAULT 'pending',
  \`failure_code\` VARCHAR(128) NULL,
  \`expires_at\` DATETIME(3) NOT NULL,
  \`handoff_expires_at\` DATETIME(3) NULL,
  \`claimed_at\` DATETIME(3) NULL,
  \`authorized_at\` DATETIME(3) NULL,
  \`consumed_at\` DATETIME(3) NULL,
  \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`session_id\`),
  UNIQUE KEY \`uq_managed_wordpress_google_handoff\` (\`handoff_code_hash\`),
  KEY \`idx_managed_wordpress_google_site_status\` (\`site_uuid\`, \`status\`, \`expires_at\`),
  KEY \`idx_managed_wordpress_google_created\` (\`created_at\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

function storeError(code, message, status = 409, details = {}) {
  const error = new Error(message);
  error.name = "ManagedWordpressGoogleOAuthStoreError";
  error.code = code;
  error.status = status;
  error.details = { ...details, secrets_included: false };
  return error;
}

function requiredText(value, name, max = 4096) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${name} is required.`);
  if (normalized.length > max) throw new TypeError(`${name} exceeds the maximum length.`);
  return normalized;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function rows(result) {
  if (!Array.isArray(result)) return [];
  return Array.isArray(result[0]) ? result[0] : [];
}

function mutationResult(result) {
  if (!Array.isArray(result)) return result || {};
  return result[0] || {};
}

function affectedRows(result) {
  const n = Number(mutationResult(result)?.affectedRows || 0);
  return Number.isFinite(n) ? n : 0;
}

function isMissingTable(error) {
  return error?.code === "ER_NO_SUCH_TABLE"
    || Number(error?.errno) === 1146
    || /managed_wordpress_google_oauth_sessions[^\n]*(?:doesn't exist|does not exist)/i.test(
      String(error?.message || ""),
    );
}

function normalizeDate(value, name) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} must be a valid date.`);
  return date;
}

function publicSession(row = {}) {
  return Object.freeze({
    contract: MANAGED_WORDPRESS_GOOGLE_OAUTH_STORE_CONTRACT,
    session_id: String(row.session_id || ""),
    site_uuid: String(row.site_uuid || ""),
    origin: String(row.origin || ""),
    callback_uri: String(row.callback_uri || ""),
    access_mode: String(row.access_mode || ""),
    requested_scope: String(row.requested_scope || ""),
    status: String(row.status || ""),
    expires_at: row.expires_at || null,
    handoff_expires_at: row.handoff_expires_at || null,
    claimed_at: row.claimed_at || null,
    authorized_at: row.authorized_at || null,
    consumed_at: row.consumed_at || null,
    failure_code: row.failure_code || null,
    secrets_included: false,
  });
}

export function createManagedWordpressGoogleOAuthStore({
  pool = null,
  resolvePool = null,
  maxActiveSessionsPerSite = 20,
} = {}) {
  if (!pool && typeof resolvePool !== "function") {
    resolvePool = async () => getPool();
  }
  if (!Number.isSafeInteger(maxActiveSessionsPerSite) || maxActiveSessionsPerSite < 1 || maxActiveSessionsPerSite > 100) {
    throw new TypeError("maxActiveSessionsPerSite must be between 1 and 100.");
  }

  async function executor() {
    const active = pool || await resolvePool();
    if (!active || typeof active.query !== "function") {
      throw new TypeError("Managed WordPress Google OAuth store requires a SQL pool.");
    }
    return active;
  }

  async function run(operation) {
    const active = await executor();
    try {
      return await operation(active);
    } catch (error) {
      if (!isMissingTable(error)) throw error;
      await active.query(CREATE_MANAGED_WORDPRESS_GOOGLE_OAUTH_TABLE_SQL);
      return operation(active);
    }
  }

  async function createSession(input = {}) {
    const sessionId = requiredText(input.sessionId, "sessionId", 36);
    const siteUuid = requiredText(input.siteUuid, "siteUuid", 64);
    const origin = requiredText(input.origin, "origin", 512);
    const callbackUri = requiredText(input.callbackUri, "callbackUri", 1024);
    const accessMode = requiredText(input.accessMode, "accessMode", 16);
    const requestedScope = requiredText(input.requestedScope, "requestedScope", 255);
    const state = requiredText(input.state, "state", 4096);
    const verifierChallenge = requiredText(input.verifierChallenge, "verifierChallenge", 128);
    const googlePkceVerifier = requiredText(input.googlePkceVerifier, "googlePkceVerifier", 128);
    const expiresAt = normalizeDate(input.expiresAt, "expiresAt");
    if (!["read_only", "read_write"].includes(accessMode)) {
      throw new TypeError("accessMode must be read_only or read_write.");
    }
    if (expiresAt.getTime() <= Date.now()) {
      throw new TypeError("expiresAt must be in the future.");
    }
    const googlePkceEnvelope = buildEncryptedCredentialsForStorage({
      google_pkce_verifier: googlePkceVerifier,
      purpose: "managed_wordpress_google_oauth",
    });

    return run(async active => {
      const [countRows] = await active.query(
        `SELECT COUNT(*) AS active_count
           FROM managed_wordpress_google_oauth_sessions
          WHERE site_uuid = ?
            AND status IN ('pending','claimed','authorized')
            AND created_at > UTC_TIMESTAMP(3) - INTERVAL 10 MINUTE`,
        [siteUuid],
      );
      const activeCount = Number(countRows?.[0]?.active_count || 0);
      if (activeCount >= maxActiveSessionsPerSite) {
        throw storeError(
          "managed_google_oauth_rate_limited",
          "Too many active Managed Google OAuth sessions exist for this site.",
          429,
          { site_uuid: siteUuid, active_count: activeCount },
        );
      }

      const result = await active.query(
        `INSERT INTO managed_wordpress_google_oauth_sessions
          (session_id, site_uuid, origin, callback_uri, access_mode, requested_scope,
           state_hash, verifier_challenge, google_pkce_envelope, status, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [
          sessionId,
          siteUuid,
          origin,
          callbackUri,
          accessMode,
          requestedScope,
          sha256(state),
          verifierChallenge,
          googlePkceEnvelope,
          expiresAt,
        ],
      );
      if (affectedRows(result) !== 1) {
        throw storeError(
          "managed_google_oauth_session_insert_failed",
          "Managed Google OAuth session was not inserted exactly once.",
          500,
        );
      }
      return Object.freeze({
        contract: MANAGED_WORDPRESS_GOOGLE_OAUTH_STORE_CONTRACT,
        session_id: sessionId,
        site_uuid: siteUuid,
        status: "pending",
        expires_at: expiresAt.toISOString(),
        secrets_included: false,
      });
    });
  }

  async function claimCallback({ sessionId, state, claimToken } = {}) {
    const sid = requiredText(sessionId, "sessionId", 36);
    const rawState = requiredText(state, "state", 4096);
    const rawClaimToken = requiredText(claimToken, "claimToken", 4096);
    const stateHash = sha256(rawState);
    const claimHash = sha256(rawClaimToken);

    return run(async active => {
      const result = await active.query(
        `UPDATE managed_wordpress_google_oauth_sessions
            SET status='claimed', claimed_at=UTC_TIMESTAMP(3),
                failure_code=NULL, updated_at=UTC_TIMESTAMP(3)
          WHERE session_id=?
            AND state_hash=?
            AND status='pending'
            AND expires_at > UTC_TIMESTAMP(3)`,
        [sid, stateHash],
      );
      if (affectedRows(result) !== 1) {
        throw storeError(
          "managed_google_oauth_callback_claim_conflict",
          "Managed Google OAuth callback could not claim the session exactly once.",
          409,
          { session_id: sid },
        );
      }
      const [resultRows] = await active.query(
        `SELECT session_id, site_uuid, origin, callback_uri, access_mode, requested_scope,
                verifier_challenge, google_pkce_envelope, status, expires_at
           FROM managed_wordpress_google_oauth_sessions
          WHERE session_id=? AND status='claimed'
          LIMIT 2`,
        [sid],
      );
      if (!Array.isArray(resultRows) || resultRows.length !== 1) {
        throw storeError(
          "managed_google_oauth_callback_claim_readback_failed",
          "Claimed Managed Google OAuth session failed same-cycle readback.",
          500,
          { session_id: sid },
        );
      }
      const row = resultRows[0];
      const decrypted = decryptUserAppCredentials(row.google_pkce_envelope) || {};
      const googlePkceVerifier = String(decrypted.google_pkce_verifier || "").trim();
      if (!googlePkceVerifier) {
        throw storeError(
          "managed_google_oauth_google_pkce_unreadable",
          "Managed Google OAuth Google-PKCE verifier could not be decrypted.",
          500,
          { session_id: sid },
        );
      }
      return Object.freeze({
        ...publicSession(row),
        google_pkce_verifier: googlePkceVerifier,
        claim_token_hash: claimHash,
      });
    });
  }

  async function authorizeClaimedSession({
    sessionId,
    handoffCode,
    tokenPayload,
    handoffExpiresAt,
  } = {}) {
    const sid = requiredText(sessionId, "sessionId", 36);
    const handoff = requiredText(handoffCode, "handoffCode", 4096);
    const expiresAt = normalizeDate(handoffExpiresAt, "handoffExpiresAt");
    if (expiresAt.getTime() <= Date.now()) {
      throw new TypeError("handoffExpiresAt must be in the future.");
    }
    const tokens = tokenPayload && typeof tokenPayload === "object" ? tokenPayload : {};
    if (!String(tokens.access_token || "").trim() || !String(tokens.refresh_token || "").trim()) {
      throw new TypeError("tokenPayload requires access_token and refresh_token.");
    }
    const tokenEnvelope = buildEncryptedCredentialsForStorage({
      access_token: String(tokens.access_token),
      refresh_token: String(tokens.refresh_token),
      expires_in: Number(tokens.expires_in || 3600),
      scope: String(tokens.scope || ""),
      token_type: String(tokens.token_type || "Bearer"),
      purpose: "managed_wordpress_google_oauth_handoff",
    });

    return run(async active => {
      const result = await active.query(
        `UPDATE managed_wordpress_google_oauth_sessions
            SET status='authorized',
                handoff_code_hash=?,
                token_envelope=?,
                google_pkce_envelope='',
                handoff_expires_at=?,
                authorized_at=UTC_TIMESTAMP(3),
                updated_at=UTC_TIMESTAMP(3)
          WHERE session_id=?
            AND status='claimed'
            AND expires_at > UTC_TIMESTAMP(3)`,
        [sha256(handoff), tokenEnvelope, expiresAt, sid],
      );
      if (affectedRows(result) !== 1) {
        throw storeError(
          "managed_google_oauth_authorize_conflict",
          "Claimed Managed Google OAuth session could not be finalized.",
          409,
          { session_id: sid },
        );
      }
      return Object.freeze({
        contract: MANAGED_WORDPRESS_GOOGLE_OAUTH_STORE_CONTRACT,
        session_id: sid,
        status: "authorized",
        handoff_expires_at: expiresAt.toISOString(),
        secrets_included: false,
      });
    });
  }

  async function denySession({ sessionId, failureCode = "provider_denied" } = {}) {
    const sid = requiredText(sessionId, "sessionId", 36);
    const code = requiredText(failureCode, "failureCode", 128);
    return run(async active => {
      await active.query(
        `UPDATE managed_wordpress_google_oauth_sessions
            SET status='denied', failure_code=?,
                google_pkce_envelope='', token_envelope=NULL,
                updated_at=UTC_TIMESTAMP(3)
          WHERE session_id=?
            AND status IN ('pending','claimed')`,
        [code, sid],
      );
      return Object.freeze({
        contract: MANAGED_WORDPRESS_GOOGLE_OAUTH_STORE_CONTRACT,
        session_id: sid,
        status: "denied",
        failure_code: code,
        secrets_included: false,
      });
    });
  }

  async function redeemHandoff({
    sessionId,
    handoffCode,
    verifier,
    siteUuid,
    origin,
    callbackUri,
  } = {}) {
    const sid = requiredText(sessionId, "sessionId", 36);
    const handoff = requiredText(handoffCode, "handoffCode", 4096);
    const rawVerifier = requiredText(verifier, "verifier", 256);
    const site = requiredText(siteUuid, "siteUuid", 64);
    const boundOrigin = requiredText(origin, "origin", 512);
    const callback = requiredText(callbackUri, "callbackUri", 1024);
    const verifierChallenge = crypto.createHash("sha256").update(rawVerifier, "utf8").digest("base64url");

    return run(async active => {
      const [resultRows] = await active.query(
        `SELECT session_id, site_uuid, origin, callback_uri, access_mode, requested_scope,
                verifier_challenge, token_envelope, status, expires_at, handoff_expires_at
           FROM managed_wordpress_google_oauth_sessions
          WHERE session_id=?
            AND handoff_code_hash=?
            AND status='authorized'
            AND expires_at > UTC_TIMESTAMP(3)
            AND handoff_expires_at > UTC_TIMESTAMP(3)
          LIMIT 2`,
        [sid, sha256(handoff)],
      );
      if (!Array.isArray(resultRows) || resultRows.length !== 1) {
        throw storeError(
          "managed_google_oauth_handoff_invalid_or_consumed",
          "Managed Google OAuth handoff is missing, expired, or already consumed.",
          400,
          { session_id: sid },
        );
      }
      const row = resultRows[0];
      if (
        String(row.site_uuid) !== site
        || String(row.origin) !== boundOrigin
        || String(row.callback_uri) !== callback
        || String(row.verifier_challenge) !== verifierChallenge
      ) {
        throw storeError(
          "managed_google_oauth_handoff_binding_mismatch",
          "Managed Google OAuth handoff binding does not match the original session.",
          400,
          { session_id: sid },
        );
      }
      const encrypted = String(row.token_envelope || "");
      if (!encrypted) {
        throw storeError(
          "managed_google_oauth_token_envelope_missing",
          "Managed Google OAuth handoff has no token envelope.",
          500,
          { session_id: sid },
        );
      }
      const result = await active.query(
        `UPDATE managed_wordpress_google_oauth_sessions
            SET status='consumed',
                consumed_at=UTC_TIMESTAMP(3),
                token_envelope=NULL,
                handoff_code_hash=NULL,
                updated_at=UTC_TIMESTAMP(3)
          WHERE session_id=?
            AND handoff_code_hash=?
            AND status='authorized'
            AND handoff_expires_at > UTC_TIMESTAMP(3)`,
        [sid, sha256(handoff)],
      );
      if (affectedRows(result) !== 1) {
        throw storeError(
          "managed_google_oauth_handoff_replay_or_race",
          "Managed Google OAuth handoff was consumed concurrently or is no longer eligible.",
          409,
          { session_id: sid },
        );
      }
      const token = decryptUserAppCredentials(encrypted);
      if (!token || !String(token.access_token || "").trim() || !String(token.refresh_token || "").trim()) {
        throw storeError(
          "managed_google_oauth_token_envelope_unreadable",
          "Managed Google OAuth token envelope could not be decrypted after atomic consumption.",
          500,
          { session_id: sid },
        );
      }
      return Object.freeze({
        contract: MANAGED_WORDPRESS_GOOGLE_OAUTH_STORE_CONTRACT,
        session: publicSession({ ...row, status: "consumed", consumed_at: new Date().toISOString() }),
        token: Object.freeze({
          access_token: String(token.access_token),
          refresh_token: String(token.refresh_token),
          expires_in: Number(token.expires_in || 3600),
          scope: String(token.scope || ""),
          token_type: String(token.token_type || "Bearer"),
        }),
      });
    });
  }

  async function inspectSession({ sessionId } = {}) {
    const sid = requiredText(sessionId, "sessionId", 36);
    return run(async active => {
      const [resultRows] = await active.query(
        `SELECT session_id, site_uuid, origin, callback_uri, access_mode, requested_scope,
                status, failure_code, expires_at, handoff_expires_at,
                claimed_at, authorized_at, consumed_at
           FROM managed_wordpress_google_oauth_sessions
          WHERE session_id=?
          LIMIT 2`,
        [sid],
      );
      if (!Array.isArray(resultRows) || resultRows.length !== 1) return null;
      return publicSession(resultRows[0]);
    });
  }

  return Object.freeze({
    createSession,
    claimCallback,
    authorizeClaimedSession,
    denySession,
    redeemHandoff,
    inspectSession,
  });
}

export const _testingManagedWordpressGoogleOAuthStore = Object.freeze({
  affectedRows,
  isMissingTable,
  publicSession,
  requiredText,
  sha256,
});
