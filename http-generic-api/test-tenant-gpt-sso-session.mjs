import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TENANT_GPT_SSO_SESSION_COOKIE,
  TENANT_GPT_SSO_SESSION_DEFAULT_TTL_SECONDS,
  TENANT_GPT_SSO_SESSION_MAX_TTL_SECONDS,
  buildTenantGptSsoClearCookieHeader,
  buildTenantGptSsoCookieHeader,
  issueTenantGptSsoSession,
  parseTenantGptSsoCookie,
  resolveTenantGptSsoSessionTtlSeconds,
  validateTenantGptSsoSessionTtlSeconds,
  verifyTenantGptSsoSession,
} from "./tenantGptSsoSession.js";

const jwtSecret = "test-only-tenant-gpt-sso-secret-32-chars";
const input = {
  user_id: "user-1",
  tenant_id: "tenant-1",
  email: "user@example.com",
  client_id: "mad4b-tenant-gpt",
  scopes: ["tenant.status", "tenant.links"],
  jwtSecret,
  nowSeconds: 1_700_000_000,
};

assert.equal(resolveTenantGptSsoSessionTtlSeconds({}), TENANT_GPT_SSO_SESSION_DEFAULT_TTL_SECONDS);
assert.equal(validateTenantGptSsoSessionTtlSeconds(TENANT_GPT_SSO_SESSION_MAX_TTL_SECONDS), TENANT_GPT_SSO_SESSION_MAX_TTL_SECONDS);
assert.throws(() => validateTenantGptSsoSessionTtlSeconds(TENANT_GPT_SSO_SESSION_MAX_TTL_SECONDS + 1), /TTL/iu);
assert.throws(() => validateTenantGptSsoSessionTtlSeconds(59), /TTL/iu);

const token = issueTenantGptSsoSession(input);
const verified = verifyTenantGptSsoSession(token, { jwtSecret, expectedClientId: input.client_id, nowSeconds: input.nowSeconds + 10 });
assert.equal(verified.ok, true);
assert.deepEqual(verified.claims.scopes, ["tenant.links", "tenant.status"]);
assert.equal(verified.claims.tenant_id, input.tenant_id);
assert.equal(verifyTenantGptSsoSession(token, { jwtSecret, expectedClientId: "other-client" }).ok, false);
assert.equal(verifyTenantGptSsoSession(token, { jwtSecret: "wrong-secret" }).ok, false);

const cookie = buildTenantGptSsoCookieHeader(token, { ttlSeconds: 3600 });
assert.match(cookie, new RegExp(`^${TENANT_GPT_SSO_SESSION_COOKIE}=`));
assert.match(cookie, /Domain=\.mad4b\.com/iu);
assert.match(cookie, /HttpOnly/iu);
assert.match(cookie, /Secure/iu);
assert.equal(parseTenantGptSsoCookie(`other=value; ${cookie}`), token);
assert.match(buildTenantGptSsoClearCookieHeader(), /Max-Age=0/iu);

const authRoutes = readFileSync("./routes/authRoutes.js", "utf8");
const ssoModule = readFileSync("./tenantGptSsoSession.js", "utf8");
assert.match(authRoutes, /parseTenantGptSsoCookie/u);
assert.match(authRoutes, /expectedClientId: resourceProfile\.client_id/u);
assert.match(authRoutes, /req\.query\.prompt !== "login"/u);
assert.match(ssoModule, /Domain=\.mad4b\.com/u);
assert.doesNotMatch(authRoutes, /USER_TOKEN_TTL_SECONDS\s*\*\s*1000[\s\S]{0,200}issueTenantGptSsoSession/u);

console.log("Tenant GPT SSO session tests passed.");
