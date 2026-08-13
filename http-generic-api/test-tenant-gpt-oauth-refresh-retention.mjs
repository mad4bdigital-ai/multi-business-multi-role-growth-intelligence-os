import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TENANT_GPT_REFRESH_TOKEN_TTL_SECONDS,
  tenantGptRefreshTokensEnabled,
  tenantGptRefreshReady,
} from "./tenantGptOAuthGrantStore.js";

const route = readFileSync("./routes/tenantGptOAuthTokenExchangeRoutes.js", "utf8");
const metadata = readFileSync("./routes/tenantGptOAuthMetadataRoutes.js", "utf8");
const migration = readFileSync("./migrations/20260813_tenant_gpt_oauth_grants_v1.sql", "utf8");

assert.equal(TENANT_GPT_REFRESH_TOKEN_TTL_SECONDS, 30 * 24 * 60 * 60);
assert.equal(tenantGptRefreshTokensEnabled({}), false);
assert.equal(tenantGptRefreshTokensEnabled({ TENANT_GPT_REFRESH_TOKENS_ENABLED: "true" }), true);
assert.equal((await tenantGptRefreshReady({}, null)).ready, false);
const readyProbe = await tenantGptRefreshReady({ TENANT_GPT_REFRESH_TOKENS_ENABLED: "true", JWT_SECRET: "test-refresh-secret-32-characters-long" }, { query: async () => [[{ present: 1 }]] });
assert.equal(readyProbe.ready, true);
assert.equal(readyProbe.secret_ready, true);
assert.equal(readyProbe.transaction_probe_ready, true);
assert.match(route, /grantType === "refresh_token"/u);
assert.match(route, /rotateTenantGptOAuthGrant/u);
assert.match(route, /refresh_token_expires_in/u);
assert.match(route, /tenantGptRefreshTokensEnabled/u);
assert.match(route, /expires_in: accessTokenTtlSeconds/u);
assert.match(metadata, /const refreshReady = await tenantGptRefreshReady\(env/u);
assert.match(metadata, /grant_types_supported: \["authorization_code", \.\.\.\(refreshReady\.ready/u);
assert.match(metadata, /refresh_ready: refreshReady\.ready/u);
assert.match(metadata, /transaction_probe_ready/u);
assert.match(route, /tenantGptRefreshReady/u);
assert.match(readFileSync("./tenantGptOAuthGrantStore.js", "utf8"), /await connection\.rollback\(\);\s*return null/u);
assert.match(migration, /CREATE TABLE IF NOT EXISTS `tenant_gpt_oauth_grants`/u);
assert.match(migration, /refresh_token_hash/u);
assert.match(migration, /refresh_expires_at/u);
assert.match(migration, /status` ENUM\('active','rotated','revoked'\)/u);
assert.match(migration, /TENANT_GPT_REFRESH_TOKENS_ENABLED=true/u);

console.log("Tenant GPT OAuth refresh retention tests passed.");
