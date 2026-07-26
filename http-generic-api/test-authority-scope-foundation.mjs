import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AUTHORITY_SCOPE_TYPES,
  AuthorityScopeError,
  PLATFORM_AUTHORITY_SCOPE_KEY,
  authorityPrincipalDescriptor,
  isPlatformPrincipal,
  normalizeAuthorityScope,
  tenantAuthorityScopeKey,
} from "./src/domain/authorityScope/authorityScope.js";
import { createAuthorityScopeService } from "./src/application/authorityScope/authorityScopeService.js";
import {
  _testingAuthorityScopeRepository,
  createAuthorityScopeRepository,
} from "./src/infrastructure/authorityScope/authorityScopeRepository.js";

function expectAuthorityError(fn, code, status) {
  return assert.rejects(fn, (error) => {
    assert(error instanceof AuthorityScopeError);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    return true;
  });
}

const platformScope = {
  scopeId: "ascope_platform_root",
  scopeKey: PLATFORM_AUTHORITY_SCOPE_KEY,
  scopeType: AUTHORITY_SCOPE_TYPES.PLATFORM,
  tenantId: null,
  status: "active",
  version: 1,
};

const tenantScopeA = {
  scopeId: "ascope_tenant_a",
  scopeKey: "tenant:tenant-a",
  scopeType: AUTHORITY_SCOPE_TYPES.TENANT,
  tenantId: "tenant-a",
  status: "active",
  version: 1,
};

const tenantScopeB = {
  scopeId: "ascope_tenant_b",
  scopeKey: "tenant:tenant-b",
  scopeType: AUTHORITY_SCOPE_TYPES.TENANT,
  tenantId: "tenant-b",
  status: "active",
  version: 1,
};

assert.equal(tenantAuthorityScopeKey(" tenant-a "), "tenant:tenant-a");
assert.equal(isPlatformPrincipal({ is_admin: true }), true);
assert.equal(isPlatformPrincipal({ mode: "backend_api_key" }), true);
assert.equal(isPlatformPrincipal({ execution_class: "admin" }), false);
assert.deepEqual(authorityPrincipalDescriptor({ user_id: "user-a" }), {
  principalType: "tenant_member",
  principalId: "user-a",
});

assert.throws(
  () =>
    normalizeAuthorityScope({
      ...platformScope,
      tenantId: "tenant-a",
    }),
  (error) => error.code === "PLATFORM_SCOPE_TENANT_FORBIDDEN"
);
assert.throws(
  () =>
    normalizeAuthorityScope({
      ...tenantScopeA,
      tenantId: null,
    }),
  (error) => error.code === "TENANT_SCOPE_TENANT_REQUIRED"
);
assert.throws(
  () =>
    normalizeAuthorityScope({
      ...tenantScopeA,
      scopeKey: "tenant:wrong",
    }),
  (error) => error.code === "AUTHORITY_SCOPE_KEY_MISMATCH"
);

const rowsByKey = new Map([
  [platformScope.scopeKey, platformScope],
  [tenantScopeA.scopeKey, tenantScopeA],
  [tenantScopeB.scopeKey, tenantScopeB],
]);
const rowsByTenant = new Map([
  [tenantScopeA.tenantId, tenantScopeA],
  [tenantScopeB.tenantId, tenantScopeB],
]);

const service = createAuthorityScopeService({
  repository: {
    findByKey: async (scopeKey) => rowsByKey.get(scopeKey) || null,
    findByTenantId: async (tenantId) => rowsByTenant.get(tenantId) || null,
  },
});

const platformDecision = await service.preview({
  auth: { mode: "backend_api_key", is_admin: true },
});
assert.equal(platformDecision.scope.scopeKey, PLATFORM_AUTHORITY_SCOPE_KEY);
assert.equal(platformDecision.enforcementMode, "shadow_only");
assert.equal(platformDecision.authorityGranted, false);

const tenantDecision = await service.resolve({
  auth: { user_id: "user-a", tenant_id: "tenant-a" },
  tenantId: "tenant-a",
});
assert.equal(tenantDecision.scope.tenantId, "tenant-a");
assert.equal(tenantDecision.principal.principalType, "tenant_member");

await expectAuthorityError(
  () =>
    service.resolve({
      auth: { user_id: "user-a", tenant_id: "tenant-a" },
      tenantId: "tenant-b",
    }),
  "CROSS_TENANT_AUTHORITY_SCOPE_DENIED",
  403
);

await expectAuthorityError(
  () =>
    service.resolve({
      auth: { mode: "backend_api_key", is_admin: true },
      scopeKey: "tenant:tenant-a",
    }),
  "PLATFORM_TENANT_TARGET_REQUIRED",
  400
);

const explicitPlatformTenantDecision = await service.resolve({
  auth: { mode: "backend_api_key", is_admin: true },
  tenantId: "tenant-a",
  scopeKey: "tenant:tenant-a",
});
assert.equal(explicitPlatformTenantDecision.scope.tenantId, "tenant-a");
assert.equal(explicitPlatformTenantDecision.authorityGranted, false);

await expectAuthorityError(
  () =>
    service.resolve({
      auth: { user_id: "user-a", tenant_id: "tenant-a", execution_class: "admin" },
      scopeKey: PLATFORM_AUTHORITY_SCOPE_KEY,
    }),
  "PLATFORM_SCOPE_FORBIDDEN",
  403
);

rowsByKey.set("tenant:tenant-suspended", {
  scopeId: "ascope_tenant_suspended",
  scopeKey: "tenant:tenant-suspended",
  scopeType: "tenant",
  tenantId: "tenant-suspended",
  status: "suspended",
  version: 1,
});
await expectAuthorityError(
  () =>
    service.resolve({
      auth: { user_id: "user-s", tenant_id: "tenant-suspended" },
      scopeKey: "tenant:tenant-suspended",
    }),
  "AUTHORITY_SCOPE_INACTIVE",
  409
);

const sqlCalls = [];
const repository = createAuthorityScopeRepository({
  resolvePool: async () => ({
    execute: async (sql, params) => {
      sqlCalls.push({ sql, params });
      return [[{
        scope_id: "ascope_tenant_a",
        scope_key: "tenant:tenant-a",
        scope_type: "tenant",
        tenant_id: "tenant-a",
        status: "active",
        version: 1,
        metadata_json: "{\"shadow_only\":true}",
        created_at: "2026-06-28T00:00:00.000Z",
        updated_at: "2026-06-28T00:00:00.000Z",
      }]];
    },
  }),
});

const repositoryScope = await repository.findByTenantId("tenant-a");
assert.equal(repositoryScope.scopeKey, "tenant:tenant-a");
assert.deepEqual(repositoryScope.metadata, { shadow_only: true });
assert.equal(sqlCalls.length, 1);
assert(sqlCalls[0].sql.includes("FROM authority_scope_registry"));
assert(sqlCalls[0].sql.includes("tenant_id = ?"));
assert.deepEqual(sqlCalls[0].params, ["tenant-a"]);

assert.equal(_testingAuthorityScopeRepository.parseMetadata("not-json"), null);

const migration = readFileSync(
  "migrations/20260628_authority_scope_registry_foundation.sql",
  "utf8"
);
assert(migration.includes("CREATE TABLE IF NOT EXISTS `authority_scope_registry`"));
assert(migration.includes("chk_authority_scope_tenant_consistency"));
assert(migration.includes("'platform:root'"));
assert(migration.includes("FROM `tenants` t"));
assert(!/ALTER\s+TABLE\s+`?(?:containers|container_role_assignments|container_resource_bindings)`?/i.test(migration));

const domainSource = readFileSync(
  "src/domain/authorityScope/authorityScope.js",
  "utf8"
);
const applicationSource = readFileSync(
  "src/application/authorityScope/authorityScopeService.js",
  "utf8"
);
const repositorySource = readFileSync(
  "src/infrastructure/authorityScope/authorityScopeRepository.js",
  "utf8"
);

const sqlPattern = /\b(?:SELECT|INSERT\s+INTO|UPDATE\s+[A-Za-z_]|DELETE\s+FROM|CREATE\s+TABLE)\b/i;
assert(!sqlPattern.test(domainSource), "domain layer must not contain SQL");
assert(!sqlPattern.test(applicationSource), "application layer must not contain SQL");
assert(sqlPattern.test(repositorySource), "infrastructure repository must own SQL");
assert(!domainSource.includes("express"), "domain must not depend on Express");
assert(!applicationSource.includes("express"), "application must not depend on Express");
assert(!applicationSource.includes("db.js"), "application must not import the database");
assert(!domainSource.includes("execution_class"), "domain authority must not derive authority from execution class");

console.log("authority scope foundation tests passed");
