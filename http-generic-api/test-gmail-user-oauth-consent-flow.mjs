import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync("routes/memberGoogleOAuthRoutes.js", "utf8");
const routeIndex = readFileSync("routes/index.js", "utf8");
const liveSend = readFileSync("supportTicketExternalLiveSendService.js", "utf8");

for (const expected of [
  "GMAIL_SEND_SCOPE",
  "https://www.googleapis.com/auth/gmail.send",
  "GOOGLE_OAUTH_AUTHORIZE_URL",
  "https://accounts.google.com/o/oauth2/v2/auth",
  "GOOGLE_OAUTH_TOKEN_URL",
  "https://oauth2.googleapis.com/token",
  "access_type",
  "offline",
  "prompt",
  "consent",
  "include_granted_scopes",
  "signStatePayload",
  "verifyStateToken",
  "timingSafeEqual",
  "/admin/oauth/google/gmail-send/authorization-url",
  "/oauth/google/gmail-send/callback",
  "exchangeGmailAuthorizationCode",
  "upsertConnection",
  "credential_stored",
  "secret_value_included: false",
  "secrets_included: false",
]) {
  assert(route.includes(expected), `member Google OAuth route must include ${expected}`);
}

for (const forbidden of [
  "refresh_token: token.refresh_token,\n        client_secret: token.client_secret",
  "res.json(token)",
  "res.send(token)",
]) {
  assert(!route.includes(forbidden), `OAuth flow must not expose token material through ${forbidden}`);
}

for (const expected of [
  "gmail_user_oauth_adapter",
  "GMAIL_SEND_URL",
  "users/me/messages/send",
  "getGoogleAccessToken",
  "google_oauth_config_ref",
  "support_ticket_live_gmail_send_failed",
]) {
  assert(liveSend.includes(expected), `live send must include Gmail runtime ${expected}`);
}

console.log("gmail user OAuth consent flow tests passed");
