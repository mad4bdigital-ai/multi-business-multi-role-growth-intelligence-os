import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyUserJwtAuthorization } from "./userJwtAuth.js";
import { HARDENED_AUTH_FILES, hardenedFileViolations } from "./scripts/user-jwt-auth-governance.mjs";

const routePath = "http-generic-api/routes/activationAwarenessRoutes.js";
const source = readFileSync(routePath, "utf8");

assert.equal(source.includes('import jwt from "jsonwebtoken"'), false);
assert.equal(source.includes("development_fallback_secret_only"), false);
assert.match(source, /import \{ createUserJwtMiddleware \} from "\.\.\/userJwtAuth\.js";/);
assert.match(source, /const requireCanonicalUserJwt = createUserJwtMiddleware\(\);/);
assert.equal(source.includes('req.auth?.mode === "user_jwt" ? req.auth : verifyUserJwt'), false);
assert.match(source, /req\.auth\?\.mode === "user_jwt" \? req\.auth : null/);

const tenantRouteLines = source.split("\n").filter((line) => /router\.(?:get|post|patch|put|delete)\("\/tenant\//.test(line));
assert.ok(tenantRouteLines.length >= 10, `expected tenant route surface, found ${tenantRouteLines.length}`);
for (const line of tenantRouteLines) {
  assert.match(line, /requireCanonicalUserJwt, requireTenantUserJwt/, `tenant route bypasses canonical User JWT middleware: ${line.trim()}`);
}

assert.ok(HARDENED_AUTH_FILES.includes(routePath));
assert.deepEqual(hardenedFileViolations(), []);

let verifyCalled = false;
const unavailable = verifyUserJwtAuthorization("Bearer attacker-controlled-token", {
  env: {},
  verifyToken() { verifyCalled = true; throw new Error("must not run without configured secret"); },
});
assert.equal(unavailable.ok, false);
assert.equal(unavailable.status, 503);
assert.equal(unavailable.code, "user_jwt_verifier_unavailable");
assert.equal(verifyCalled, false);

const algorithmProbe = verifyUserJwtAuthorization("Bearer token", {
  env: { JWT_SECRET: "configured-secret" },
  verifyToken(_token, _secret, options) {
    assert.deepEqual(options.algorithms, ["HS256"]);
    return { user_id: "user-1", tenant_id: "stale-token-tenant", role: "owner" };
  },
});
assert.equal(algorithmProbe.ok, true);
assert.equal(algorithmProbe.claims.user_id, "user-1");

assert.match(source, /fetchActiveMembership\(\{ userId: payload\.user_id, tenantId: requestedTenantId \}\)/);
assert.match(source, /tenant_id: membership\.tenant_id/);
assert.match(source, /tenant_role: membership\.role/);

console.log("activation awareness canonical User JWT boundary tests passed");
