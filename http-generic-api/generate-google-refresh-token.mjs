#!/usr/bin/env node
/**
 * generate-google-refresh-token.mjs
 *
 * Generates a Google OAuth2 refresh token using the googleapis package.
 * Two modes:
 *
 *   Auto mode (recommended — opens a browser):
 *     node http-generic-api/generate-google-refresh-token.mjs
 *     Requires: http://localhost:3000/oauth2callback in your Google Cloud Console
 *               Authorised Redirect URIs list.
 *
 *   Manual mode (headless / SSH):
 *     node http-generic-api/generate-google-refresh-token.mjs --print-url
 *     node http-generic-api/generate-google-refresh-token.mjs --code=<AUTH_CODE>
 *     Requires: urn:ietf:wg:oauth:2.0:oob in Authorised Redirect URIs.
 *
 * Google Cloud Console path:
 *   APIs & Services → Credentials → your OAuth 2.0 Client ID → Authorised redirect URIs
 */

import { createServer }                from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname }            from "node:path";
import { fileURLToPath }               from "node:url";
import { exec }                        from "node:child_process";
import { google }                      from "googleapis";
import { managedGoogleCapabilityRegistry } from "./managedGoogleOAuthCapabilityRegistry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH  = resolve(__dirname, ".env");

// ── Load .env ─────────────────────────────────────────────────────────────────
try {
  const env = readFileSync(ENV_PATH, "utf8");
  for (const line of env.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (k && !process.env[k]) process.env[k] = v;
  }
} catch { /* no .env */ }

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("ERROR: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set in .env");
  process.exit(1);
}

const registry = managedGoogleCapabilityRegistry();
const fullOwnerCapabilities = registry.profiles.full_owner;
const SCOPES = [...new Set(fullOwnerCapabilities.map((capabilityId) => registry.capabilities[capabilityId]?.scope).filter(Boolean))];

// ── Helpers ───────────────────────────────────────────────────────────────────

function writeTokenToEnv(token) {
  let content = readFileSync(ENV_PATH, "utf8");
  if (/^GOOGLE_REFRESH_TOKEN\s*=/m.test(content)) {
    content = content.replace(/^(GOOGLE_REFRESH_TOKEN\s*=).*/m, `$1${token}`);
  } else {
    content += `\nGOOGLE_REFRESH_TOKEN=${token}\n`;
  }
  writeFileSync(ENV_PATH, content, "utf8");
}

function printSuccess(token) {
  console.log(`\n✅ GOOGLE_REFRESH_TOKEN written to .env`);
  console.log(`\n   Next steps:`);
  console.log(`   1. Restart the server:  node http-generic-api/server.js`);
  console.log(`   2. Sync Sheets → DB:    node http-generic-api/migrate-sheets-to-sql.mjs --apply`);
  console.log(`\n   Token preview: ${token.slice(0, 40)}...`);
}

// ── CLI arg parsing ───────────────────────────────────────────────────────────

const args     = process.argv.slice(2);
const codeArg  = args.find(a => a.startsWith("--code="));
const printUrl = args.includes("--print-url");

// ── Manual mode: exchange an auth code ───────────────────────────────────────
if (codeArg) {
  const code   = codeArg.slice("--code=".length).trim();
  const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, "urn:ietf:wg:oauth:2.0:oob");
  try {
    const { tokens } = await oauth2.getToken(code);
    if (!tokens.refresh_token) {
      console.error(
        "\nERROR: No refresh_token returned.\n" +
        "Revoke the app at https://myaccount.google.com/permissions then re-run.\n"
      );
      process.exit(1);
    }
    writeTokenToEnv(tokens.refresh_token);
    printSuccess(tokens.refresh_token);
  } catch (err) {
    console.error("Token exchange failed:", err.message);
    process.exit(1);
  }
  process.exit(0);
}

// ── Print URL only (headless / SSH) ──────────────────────────────────────────
if (printUrl) {
  const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, "urn:ietf:wg:oauth:2.0:oob");
  const url    = oauth2.generateAuthUrl({ access_type: "offline", scope: SCOPES, prompt: "consent", include_granted_scopes: true });
  console.log("\n=== Google OAuth2 — Manual Mode ===\n");
  console.log("1. Open this URL in your browser:\n");
  console.log(url);
  console.log("\n2. Authorize and copy the auth code.");
  console.log("3. Run:");
  console.log("     node http-generic-api/generate-google-refresh-token.mjs --code=<AUTH_CODE>\n");
  process.exit(0);
}

// ── Auto mode: local callback server ─────────────────────────────────────────
const PORT         = 3000;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const oauth2       = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
const authUrl      = oauth2.generateAuthUrl({ access_type: "offline", scope: SCOPES, prompt: "consent", include_granted_scopes: true });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== "/oauth2callback") { res.writeHead(404).end(); return; }

  const error = url.searchParams.get("error");
  if (error) {
    res.writeHead(400, { "content-type": "text/html" }).end(
      `<h2>Authorization denied</h2><p>${error}</p><p>You can close this tab.</p>`
    );
    console.error(`\n❌ Authorization denied: ${error}`);
    server.close();
    process.exit(1);
  }

  const code = url.searchParams.get("code");
  if (!code) { res.writeHead(400).end("Missing code"); return; }

  try {
    const { tokens } = await oauth2.getToken(code);

    if (!tokens.refresh_token) {
      res.writeHead(400, { "content-type": "text/html" }).end(
        `<h2>No refresh_token returned</h2>
         <p>Revoke access at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>
         then re-run this script.</p>`
      );
      console.error("\n❌ No refresh_token. Revoke app access and retry.");
      server.close();
      process.exit(1);
    }

    writeTokenToEnv(tokens.refresh_token);
    res.writeHead(200, { "content-type": "text/html" }).end(
      `<h2>✅ Success!</h2>
       <p>GOOGLE_REFRESH_TOKEN has been written to your <code>.env</code>.</p>
       <p>You can close this tab and restart the server.</p>`
    );
    printSuccess(tokens.refresh_token);
    server.close();
  } catch (err) {
    res.writeHead(500, { "content-type": "text/html" }).end(
      `<h2>Token exchange failed</h2><pre>${err.message}</pre>`
    );
    console.error("\n❌ Token exchange failed:", err.message);
    server.close();
    process.exit(1);
  }
});

server.on("error", err => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n❌ Port ${PORT} is busy. Use --print-url for manual mode instead.`);
  } else {
    console.error("\n❌ Server error:", err.message);
  }
  process.exit(1);
});

server.listen(PORT, "localhost", () => {
  console.log(`\n=== Google OAuth2 Token Generator ===`);
  console.log(`\nIMPORTANT — Add this Authorised Redirect URI in Google Cloud Console:`);
  console.log(`  ${REDIRECT_URI}`);
  console.log(`  Path: APIs & Services → Credentials → OAuth 2.0 Client → Authorised redirect URIs\n`);

  const cmd =
    process.platform === "win32"  ? `start "" "${authUrl}"` :
    process.platform === "darwin" ? `open "${authUrl}"` :
    `xdg-open "${authUrl}"`;
  exec(cmd, () => {});

  console.log(`Opening browser... if it doesn't open, visit:\n  ${authUrl}\n`);
  console.log(`Waiting for Google callback on http://localhost:${PORT} ...\n`);
});
