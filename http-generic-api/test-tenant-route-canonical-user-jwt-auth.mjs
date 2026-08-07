import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import jwt from "jsonwebtoken";
import { _testingWorkspaceResourceRoutes } from "./routes/workspaceResourceRoutes.js";
import { _testingTenantPlatformPluginRoutes } from "./routes/tenantPlatformPluginRoutes.js";

const workspaceSource = readFileSync(new URL("./routes/workspaceResourceRoutes.js", import.meta.url), "utf8");
const pluginSource = readFileSync(new URL("./routes/tenantPlatformPluginRoutes.js", import.meta.url), "utf8");

for (const [name, source] of [["workspaceResourceRoutes", workspaceSource], ["tenantPlatformPluginRoutes", pluginSource]]) {
  assert.doesNotMatch(source, /development_fallback_secret_only/, `${name} must not contain a development JWT fallback secret`);
  assert.doesNotMatch(source, /import\s+jwt\s+from\s+["']jsonwebtoken["']/, `${name} must not own an ad-hoc JWT verifier`);
  assert.match(source, /createUserJwtMiddleware/, `${name} must use the canonical User JWT middleware`);
  assert.match(source, /requireCanonicalUserJwt/, `${name} must parse the bearer token before tenant scope guards`);
}

// Stale token claims must never become effective tenant authority. The canonical parser
// establishes identity only; both tenant-facing route families must resolve role/scope from
// authoritative membership state after parsing.
assert.match(
  pluginSource,
  /const requestedTenantId = payload\.tenant_id \|\| req\.headers\["x-tenant-id"\] \|\| null;/,
  "tenant platform routes must derive one requested tenant selector before membership lookup",
);
assert.match(
  pluginSource,
  /fetchActiveMembershipForTenant\(\{ userId: payload\.user_id, tenantId: requestedTenantId \}\)/,
  "tenant platform routes must resolve the parsed user against authoritative active membership",
);
assert.match(
  pluginSource,
  /tenant_id: membership\.tenant_id,[\s\S]*tenant_role: membership\.role/,
  "tenant platform effective tenant and role must come from DB membership, never stale JWT role claims",
);
assert.doesNotMatch(
  pluginSource,
  /tenant_role:\s*payload\.role/,
  "tenant platform routes must not promote token role claims into effective tenant authority",
);
assert.match(
  pluginSource,
  /tenantClause = "AND m\.tenant_id = \?";[\s\S]*params\.push\(tenantId\);/,
  "tenant platform membership lookup must bind an explicitly requested tenant instead of widening scope",
);
assert.match(
  pluginSource,
  /WHERE m\.user_id = \?[\s\S]*AND m\.status = 'active'[\s\S]*AND t\.status = 'active'/,
  "tenant platform membership lookup must require the parsed user plus active membership and tenant state",
);

assert.match(
  workspaceSource,
  /WHERE m\.user_id = \? AND m\.tenant_id = \?[\s\S]*\[req\.auth\.user_id, tenantId\]/,
  "workspace membership lookup must be object-scoped by parsed user_id and exact tenant_id",
);
assert.match(
  workspaceSource,
  /membership\.status !== "active" \|\| membership\.tenant_status !== "active"/,
  "workspace authority must reject inactive membership or tenant state",
);
assert.match(
  workspaceSource,
  /OWNER_ROLES\.has\(String\(membership\.role \|\| ""\)\.toLowerCase\(\)\)/,
  "workspace owner/admin authority must use the DB membership role rather than a stale JWT role claim",
);
assert.doesNotMatch(
  workspaceSource,
  /OWNER_ROLES\.has\(String\(req\.auth\.role/,
  "workspace owner/admin authority must not trust token role claims",
);

const originalSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = "tenant-canonical-auth-regression-secret-20260807";
try {
  const token = jwt.sign(
    { user_id: "user-regression-1", tenant_id: "tenant-regression-1", role: "owner" },
    process.env.JWT_SECRET,
    { algorithm: "HS256", expiresIn: "5m" },
  );
  const req = { headers: { authorization: `Bearer ${token}` } };
  const response = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  let parsed = false;
  await _testingWorkspaceResourceRoutes.requireCanonicalUserJwt(req, response, () => { parsed = true; });
  assert.equal(parsed, true, "canonical middleware must accept a valid configured User JWT");
  assert.equal(req.auth.mode, "user_jwt");
  assert.equal(req.auth.user_id, "user-regression-1");
  assert.equal(req.auth.tenant_id, "tenant-regression-1");
  assert.equal(req.auth.is_admin, false);

  let workspaceGuardPassed = false;
  _testingWorkspaceResourceRoutes.requireUserJwt(req, response, () => { workspaceGuardPassed = true; });
  assert.equal(workspaceGuardPassed, true, "workspace route guard must accept only the parsed User JWT principal");

  assert.equal(typeof _testingTenantPlatformPluginRoutes.requireCanonicalUserJwt, "function");
  assert.equal(typeof _testingTenantPlatformPluginRoutes.requireTenantUserJwt, "function");
} finally {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
}

const savedSecret = process.env.JWT_SECRET;
delete process.env.JWT_SECRET;
try {
  const req = { headers: { authorization: "Bearer not-a-valid-token" } };
  const response = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  let passed = false;
  await _testingWorkspaceResourceRoutes.requireCanonicalUserJwt(req, response, () => { passed = true; });
  assert.equal(passed, false);
  assert.equal(response.statusCode, 503, "missing JWT verifier configuration must fail closed");
  assert.equal(response.payload?.error?.code, "user_jwt_verifier_unavailable");
  assert.equal(response.payload?.secrets_included, false);
} finally {
  if (savedSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = savedSecret;
}

console.log("tenant canonical User JWT route auth tests passed");
