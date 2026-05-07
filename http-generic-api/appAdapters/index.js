// appAdapters/index.js — Adapter registry + shared token refresh logic.
//
// Each adapter exposes:
//   getDefaultGrants()           → [{ action_key, auto_approve }]
//   buildAuthUrl(config, state)  → string (OAuth apps only)
//   exchangeCode(code, config)   → { access_token, refresh_token?, expires_in?, scope? }
//   refreshAccessToken(creds, config) → { access_token, expires_in? }
//   call(action_key, args, creds, connection) → { ok, result, error? }
//   testConnection(creds, connection) → { ok, account_label?, account_metadata? }

import { googleDriveAdapter }  from "./googleDrive.js";
import { notionAdapter }       from "./notion.js";
import { githubAdapter }       from "./github.js";
import { slackAdapter }        from "./slack.js";
import { webhookAdapter }      from "./webhook.js";
import { apiKeyAdapter }       from "./apiKey.js";
import { mcpAdapter }          from "./mcp.js";
import { makecomAdapter }      from "./makecom.js";
import { n8nAdapter }          from "./n8n.js";
import { makecomMcpAdapter } from "./makecomMcp.js";
import { decryptCredentials, encryptCredentials } from "../tokenEncryption.js";
import { getPool }             from "../db.js";

const REGISTRY = {
  google_drive: googleDriveAdapter,
  notion:       notionAdapter,
  github:       githubAdapter,
  slack:        slackAdapter,
  webhook:      webhookAdapter,
  api_key:      apiKeyAdapter,
  mcp:          mcpAdapter,
  makecom:      makecomAdapter,
  n8n:          n8nAdapter,
  makecom_mcp: makecomMcpAdapter,
};

export function getAdapter(app_key) {
  return REGISTRY[app_key] || null;
}

// ── OAuth app config from env ─────────────────────────────────────────────────
// Env convention: {APP_KEY_UPPER}_CLIENT_ID, {APP_KEY_UPPER}_CLIENT_SECRET
// e.g. GOOGLE_DRIVE_CLIENT_ID, NOTION_CLIENT_ID

export function getOAuthConfig(app_key) {
  const prefix = app_key.toUpperCase().replace(/-/g, "_");
  return {
    client_id:     process.env[`${prefix}_CLIENT_ID`]     || "",
    client_secret: process.env[`${prefix}_CLIENT_SECRET`] || "",
    redirect_uri:  `${process.env.APP_OAUTH_REDIRECT_BASE || ""}/app-integrations/${app_key}/callback`,
  };
}

// ── Token refresh (shared) ────────────────────────────────────────────────────
// Checks expiry and refreshes if needed. Updates DB and returns fresh creds.

export async function ensureFreshCredentials(connection) {
  const creds = decryptCredentials(connection.encrypted_credentials);
  if (!creds) throw new Error("No credentials stored for this connection");

  if (!creds.refresh_token) return creds; // non-OAuth — no refresh needed

  const expiresAt = connection.token_expires_at
    ? new Date(connection.token_expires_at).getTime()
    : null;
  const BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

  if (expiresAt && Date.now() < expiresAt - BUFFER_MS) return creds; // still valid

  const adapter = getAdapter(connection.app_key);
  if (!adapter?.refreshAccessToken) return creds;

  const config    = getOAuthConfig(connection.app_key);
  const refreshed = await adapter.refreshAccessToken(creds, config);

  const newCreds = { ...creds, ...refreshed };
  const newExpiry = refreshed.expires_in
    ? new Date(Date.now() + refreshed.expires_in * 1000)
    : null;

  await getPool().query(
    `UPDATE \`user_app_connections\`
       SET encrypted_credentials = ?, token_expires_at = ?, last_used_at = NOW()
     WHERE connection_id = ?`,
    [encryptCredentials(newCreds), newExpiry?.toISOString().slice(0, 19).replace("T", " ") || null, connection.connection_id]
  ).catch(() => {}); // non-blocking — don't fail the call if DB update fails

  return newCreds;
}

// ── Execute an action via a connection ────────────────────────────────────────

export async function executeAppAction(connection, action_key, args = {}) {
  const adapter = getAdapter(connection.app_key);
  if (!adapter) throw new Error(`No adapter for app '${connection.app_key}'`);

  const creds = await ensureFreshCredentials(connection);

  await getPool().query(
    "UPDATE `user_app_connections` SET last_used_at = NOW() WHERE connection_id = ?",
    [connection.connection_id]
  ).catch(() => {});

  return adapter.call(action_key, args, creds, connection);
}
