import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildCredentialIntakeBinding,
  buildTenantCredentialIntakeAuthoritySnapshot,
  normalizeCredentialIntakeRedirect,
  validateCredentialIntakeSessionBinding,
  validateCredentialIntakeSessionSecurity,
} from "./credentialIntakeBindingPolicy.js";

const relative = normalizeCredentialIntakeRedirect({
  redirectUri: "/settings/integrations?connected=1",
  requestOrigin: "https://auth.mad4b.com",
});
assert.equal(relative, "/settings/integrations?connected=1");
assert.throws(
  () => normalizeCredentialIntakeRedirect({ redirectUri: "//evil.example/path", requestOrigin: "https://auth.mad4b.com" }),
  (error) => error.code === "credential_intake_redirect_not_allowed" && error.status === 400,
);
assert.throws(
  () => normalizeCredentialIntakeRedirect({ redirectUri: "http://example.com/callback", registryAllowlist: ["http://example.com/callback"] }),
  (error) => error.code === "credential_intake_redirect_not_allowed",
);
assert.throws(
  () => normalizeCredentialIntakeRedirect({ redirectUri: "https://evil.example/callback", registryAllowlist: ["https://app.example/callback"] }),
  (error) => error.code === "credential_intake_redirect_not_allowed",
);
assert.equal(
  normalizeCredentialIntakeRedirect({
    redirectUri: "https://app.example/callback",
    registryAllowlist: ["https://app.example/callback"],
  }),
  "https://app.example/callback",
);

const authority = buildTenantCredentialIntakeAuthoritySnapshot({
  userId: "user-1",
  tenantId: "tenant-1",
  tenantRole: "owner",
  appKey: "github",
  authType: "api_key",
  sourceMode: "dedicated",
  fallbackAllowed: false,
  requiredForDeviceInstall: false,
});
assert.equal(authority.version, "tenant_credential_intake_authority_v1");
assert.equal(authority.secrets_included, false);

const binding = buildCredentialIntakeBinding({
  userId: "user-1",
  tenantId: "tenant-1",
  appKey: "github",
  authType: "api_key",
  connectionTargetRef: "tenant:tenant-1:integration:github",
  purpose: "connect repository",
  allowedRedirectUri: "/settings/integrations?connected=1",
  authoritySnapshotHash: authority.snapshot_hash,
});
const session = {
  user_id: "user-1",
  tenant_id: "tenant-1",
  app_key: "github",
  auth_type: "api_key",
  connection_target_ref: binding.connection_target_ref,
  purpose: binding.purpose,
  allowed_redirect_uri: binding.allowed_redirect_uri,
  authority_snapshot_hash: authority.snapshot_hash,
  binding_digest: binding.binding_digest,
};
assert.equal(validateCredentialIntakeSessionBinding(session).code, "credential_intake_binding_valid");
assert.equal(
  validateCredentialIntakeSessionBinding({ ...session, purpose: "different purpose" }).code,
  "credential_intake_binding_mismatch",
);
assert.equal(
  validateCredentialIntakeSessionBinding({ ...session, connection_target_ref: "tenant:other:integration:github" }).code,
  "credential_intake_binding_mismatch",
);
assert.equal(validateCredentialIntakeSessionBinding({}).code, "credential_intake_legacy_binding");

function authorityQueryable(overrides = {}) {
  return {
    async query(sql, params) {
      assert(sql.includes("tenant_integration_policies"));
      assert.deepEqual(params, ["github", "user-1", "tenant-1"]);
      return [[{
        tenant_role: "owner",
        membership_status: "active",
        tenant_status: "active",
        source_mode: "dedicated",
        fallback_allowed: 0,
        required_for_device_install: 0,
        policy_status: "active",
        auth_type: "api_key",
        app_status: "active",
        ...overrides,
      }]];
    },
  };
}

const validAuthority = await validateCredentialIntakeSessionSecurity({
  queryable: authorityQueryable(),
  session,
});
assert.equal(validAuthority.ok, true);
assert.equal(validAuthority.code, "credential_intake_authority_valid");
assert.equal(validAuthority.secrets_included, false);

for (const overrides of [
  { tenant_role: "member" },
  { membership_status: "revoked" },
  { tenant_status: "suspended" },
  { policy_status: "disabled" },
  { app_status: "deprecated" },
  { source_mode: "managed" },
]) {
  const decision = await validateCredentialIntakeSessionSecurity({
    queryable: authorityQueryable(overrides),
    session,
  });
  assert.equal(decision.ok, false, JSON.stringify(overrides));
  assert.equal(decision.code, "credential_intake_authority_revoked");
}

const missingAuthority = await validateCredentialIntakeSessionSecurity({
  queryable: { async query() { return [[]]; } },
  session,
});
assert.equal(missingAuthority.code, "credential_intake_authority_revoked");

const migration = readFileSync("migrations/1021_sprint69_credential_intake_binding_security.sql", "utf8");
for (const required of [
  "credential_intake_redirect_allowlist_json",
  "connection_target_ref",
  "allowed_redirect_uri",
  "binding_digest",
  "authority_snapshot_hash",
  "revoked_reason",
  "idx_credential_intake_binding",
]) {
  assert(migration.includes(required), `binding migration must include ${required}`);
}
assert.equal(migration.includes("DROP TABLE"), false);
assert.equal(migration.includes("DROP COLUMN"), false);

const routeSource = readFileSync("routes/credentialIntakeRoutes.js", "utf8");
assert(routeSource.includes("validateCredentialIntakeSessionSecurity"));
assert(routeSource.includes("validateSession: ({ connection, session })"));
assert(routeSource.includes("res.status(303).set(\"Location\", redirectLocation)"));
const tenantRouteSource = readFileSync("routes/tenantPlatformPluginRoutes.js", "utf8");
assert(tenantRouteSource.includes("buildTenantCredentialIntakeAuthoritySnapshot"));
assert(tenantRouteSource.includes("connectionTargetRef: `tenant:${req.auth.tenant_id}:integration:${policy.app_key}`"));
assert(tenantRouteSource.includes("redirectUri: input.redirect_uri || input.redirectUri || null"));

console.log("credential intake binding security tests passed");
