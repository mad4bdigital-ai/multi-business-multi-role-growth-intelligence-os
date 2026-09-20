# Managed Google OAuth Broker

## Purpose

This broker supports the WordPress Site Control Plane authentication mode:

`managed_google`

It lets a governed WordPress site connect Google Drive without storing a Google OAuth Client ID or Client Secret on that WordPress site.

The WordPress-side contract is implemented in repository `mad4bdigital-ai/WordPress`, PR #11.

## Public routes

The broker exposes exactly:

```text
POST /v1/google/oauth/session
GET  /v1/google/oauth/callback
POST /v1/google/oauth/redeem
POST /v1/google/oauth/refresh
```

These routes are not GPT tools and do not grant MAD4B write authority.

## Contracts

Session:

`mad4b.google-managed-oauth-session.v1`

Redemption request:

`mad4b.google-managed-oauth-redeem-request.v1`

Redemption response:

`mad4b.google-managed-oauth-redemption.v1`

Refresh request:

`mad4b.google-managed-oauth-refresh-request.v1`

Refresh response:

`mad4b.google-managed-oauth-refresh.v1`

## Server configuration

The broker is disabled unless:

```text
MANAGED_GOOGLE_OAUTH_ENABLED=true
```

Required when enabled:

```text
MANAGED_GOOGLE_OAUTH_CLIENT_ID
MANAGED_GOOGLE_OAUTH_CLIENT_SECRET
MANAGED_GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY
MANAGED_GOOGLE_OAUTH_REDIRECT_URI
MANAGED_GOOGLE_OAUTH_SITE_BINDINGS_JSON
MANAGED_GOOGLE_OAUTH_SITE_SECRETS_JSON
```

Production redirect:

```text
https://auth.mad4b.com/v1/google/oauth/callback
```

Staging redirect:

```text
https://dev.mad4b.com/v1/google/oauth/callback
```

Production and Staging must use different Google OAuth Web clients and different secrets.

## Site binding authority

The broker never trusts caller-supplied `site_uuid`, `origin`, or `callback_uri` by themselves.

Every WordPress site must be present in the server-owned allowlist:

```json
[
  {
    "site_uuid": "<exact-site-profile-uuid>",
    "origin": "https://site.example",
    "callback_uri": "https://site.example/wp-admin/admin-post.php?action=mad4b_context_google_managed_callback",
    "key_id": "site-example-v1",
    "environment": "staging",
    "status": "active"
  }
]
```

The tuple:

```text
site_uuid + origin + callback_uri
```

must match exactly.

Every active binding also carries a unique non-secret `key_id`. The matching HMAC secret is stored only in the server-side registry:

```text
MANAGED_GOOGLE_OAUTH_SITE_SECRETS_JSON
```

Example:

```json
{
  "site-example-v1": "<32+-character-random-site-broker-secret>"
}
```

WordPress stores the matching broker credential in `wp-config.php`:

```php
define( 'MAD4B_GOOGLE_MANAGED_OAUTH_SITE_KEY_ID', 'site-example-v1' );
define( 'MAD4B_GOOGLE_MANAGED_OAUTH_SITE_SECRET', '<same-32+-character-random-site-broker-secret>' );
```

This secret authenticates the WordPress site to the MAD4B broker. It is **not** a Google OAuth Client Secret.

For `POST /session`, `POST /redeem`, and `POST /refresh`, WordPress sends:

- `X-MAD4B-Site-Key-ID`
- `X-MAD4B-Site-Timestamp`
- `X-MAD4B-Site-Nonce`
- `X-MAD4B-Site-Signature`

The signature is HMAC-SHA256 over the exact method, broker path, Unix timestamp, nonce, and SHA-256 of canonical JSON. The broker requires a ±300 second clock window and atomically consumes every nonce. Replay fails closed.

The binding registry is all-or-nothing: a malformed, inactive, cross-origin, incomplete, or duplicated active binding blocks Managed Google OAuth configuration rather than being silently ignored.

This environment allowlist is the v1 authority. It can later be replaced by a canonical Site Profile registry without changing the WordPress protocol.

## Google OAuth client

Create a dedicated Google OAuth Web application for the broker.

Do not reuse:

- Tenant GPT OAuth credentials;
- Gmail member OAuth credentials;
- Remote MCP OAuth credentials;
- Production Google OAuth credentials in Staging.

Enable Google Drive API.

Allowed Drive scopes are exact:

```text
read_only  -> https://www.googleapis.com/auth/drive.readonly
read_write -> https://www.googleapis.com/auth/drive
```

No extra Google scope is accepted.

## Flow

### 1. WordPress creates a broker session

WordPress sends:

- exact Site Profile UUID;
- canonical origin;
- exact callback URI;
- requested access mode and scope;
- random WordPress state;
- SHA-256 verifier challenge.

The broker validates the exact server-owned site binding, creates a short-lived DB session and returns a Google authorization URL.

The browser receives no Google token.

### 2. Google returns to the broker

Google returns to:

`/v1/google/oauth/callback`

The broker:

1. resolves the hashed broker state;
2. validates the pending session and TTL;
3. exchanges the Google authorization code using the broker-only Google Client Secret;
4. verifies the exact returned scope;
5. encrypts the Google token envelope with AES-256-GCM;
6. creates a random one-time handoff code;
7. stores only the handoff hash;
8. redirects the browser to the exact WordPress callback with:
   - `handoff_code`
   - original WordPress `state`

Tokens never appear in redirect URLs.

### 3. WordPress redeems the handoff

WordPress calls:

`POST /v1/google/oauth/redeem`

It presents:

- one-time handoff code;
- session ID;
- original verifier;
- exact Site UUID/origin/callback.

The SQL store uses `SELECT ... FOR UPDATE`, verifies all bindings, marks the handoff redeemed and clears the encrypted token envelope in the same transaction that writes the redemption audit evidence.

Replay fails closed.

### 4. Token refresh

Managed WordPress sites do not possess the Google Client Secret.

When a Google access token expires, WordPress sends its encrypted-at-rest refresh token server-to-server to:

`POST /v1/google/oauth/refresh`

The broker validates:

- active Site binding;
- access-mode/scope exactness;
- request rate limit.

The broker exchanges the refresh token against Google and returns a new access token.

No scope escalation is accepted.

## Persistence

Apply migration:

`http-generic-api/migrations/20260920_managed_google_oauth_broker_v1.sql`

Tables:

- `managed_google_oauth_sessions`
- `managed_google_oauth_request_nonces`
- `managed_google_oauth_audit`

No plaintext access-token or refresh-token DB columns exist.

Transient Google tokens are stored only inside:

`token_envelope`

using AES-256-GCM and are erased atomically on successful redemption.

The WordPress site then stores the redeemed tokens in its existing site-bound encrypted token envelope.

## Rate limiting

The broker counts recent safe audit events by Site UUID.

Default bounded limits:

- session creation: 20/minute/site;
- redemption: 40/minute/site;
- refresh: 60/minute/site.

Rate limiting does not log tokens or Client Secrets.

## Audit

Safe audit events include:

- session creation;
- Google callback authorized/denied;
- redemption;
- refresh.

Audit payloads may contain:

- Site UUID;
- session ID;
- outcome;
- bounded reason;
- origin SHA-256;
- scope hash prefix;
- access-mode metadata.

They must never contain:

- Google Client Secret;
- access token;
- refresh token;
- handoff code;
- verifier;
- WordPress state.

## WordPress configuration

On the WordPress host configure:

```php
define( 'MAD4B_GOOGLE_MANAGED_OAUTH_BROKER_URL', 'https://dev.mad4b.com' );
define( 'MAD4B_GOOGLE_MANAGED_OAUTH_SITE_KEY_ID', 'etg-staging-v1' );
define( 'MAD4B_GOOGLE_MANAGED_OAUTH_SITE_SECRET', '<staging-site-broker-secret>' );
```

for Staging, or:

```php
define( 'MAD4B_GOOGLE_MANAGED_OAUTH_BROKER_URL', 'https://auth.mad4b.com' );
define( 'MAD4B_GOOGLE_MANAGED_OAUTH_SITE_KEY_ID', '<production-site-key-id>' );
define( 'MAD4B_GOOGLE_MANAGED_OAUTH_SITE_SECRET', '<production-site-broker-secret>' );
```

for Production.

No Google Client ID or Google Client Secret is required on the WordPress site in managed mode. The per-site MAD4B broker signing secret is still required and must be unique per Site Profile/environment.

## Deployment order

1. Merge code to `main`.
2. Apply the managed OAuth migration through the governed migration path.
3. Create separate Google OAuth Web client for the target environment.
4. Add exact broker callback to Google Authorized redirect URIs.
5. Add exact Site Profile binding to the environment secret/config store.
6. Configure client ID, Client Secret and independent token-encryption key.
7. Keep `MANAGED_GOOGLE_OAUTH_ENABLED=false`.
8. Run Production/Staging configuration preflight.
9. Enable the feature only after DB and environment readback succeed.
10. Configure WordPress `MAD4B_GOOGLE_MANAGED_OAUTH_BROKER_URL`.
11. Select **Sign in with Google — Recommended** in Context Authority.
12. Connect Read-only first.
13. Verify Drive browse/read behavior.
14. Upgrade to Read + Write only when governed Drive mutation authority is intentionally required.

## Safety boundaries

Managed Google Sign-In does not imply:

- Site Profile write enablement;
- Context source authority;
- mandatory Brand Context;
- Skill activation;
- Google Drive write authority;
- MAD4B NHI grants;
- approval;
- Production mutation.

Changing between `managed_google` and `custom_credentials` requires the current Google grant to be disconnected and revoked first.

## Verification

Repository regression:

```bash
node http-generic-api/test-managed-google-oauth-broker.mjs
```

Production config regression:

```bash
node http-generic-api/test-production-config-preflight.mjs
```

The managed OAuth test covers:

- exact Site binding;
- encrypted transient token envelope;
- one-time handoff;
- S256 verifier binding;
- replay denial;
- scope-escalation denial;
- unlisted-origin denial;
- Google denial redirect;
- broker-mediated refresh;
- route and migration presence.
