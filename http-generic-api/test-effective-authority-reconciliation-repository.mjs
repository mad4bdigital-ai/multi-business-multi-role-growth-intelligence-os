import assert from "node:assert/strict";
import {
  _testingEffectiveAuthorityReconciliationRepository,
  createEffectiveAuthorityReconciliationRepository,
} from "./src/infrastructure/effectiveAuthority/effectiveAuthorityReconciliationRepository.js";

const executions = [];
const pool = {
  async execute(sql, params) {
    executions.push({ sql, params });
    return [[
      {
        scope_id: "scope-platform",
        scope_key: "platform:root",
        scope_type: "platform",
        tenant_id: null,
        status: "active",
        version: 4,
        updated_at: "2026-07-24 00:00:00",
      },
      {
        scope_id: "scope-tenant-1",
        scope_key: "tenant:tenant-1",
        scope_type: "tenant",
        tenant_id: "tenant-1",
        status: "active",
        version: 2,
        updated_at: "2026-07-24 00:00:01",
      },
      {
        scope_id: "scope-tenant-2",
        scope_key: "tenant:tenant-2",
        scope_type: "tenant",
        tenant_id: "tenant-2",
        status: "active",
        version: 1,
        updated_at: "2026-07-24 00:00:02",
      },
    ]];
  },
};
const repository = createEffectiveAuthorityReconciliationRepository({
  resolvePool: async () => pool,
});
const page = await repository.listScopes({ limit: 2, afterScopeKey: "scope:a" });
assert.equal(executions.length, 1);
assert.match(executions[0].sql, /FROM authority_scope_registry/);
assert.match(executions[0].sql, /scope_type IN \('platform','tenant'\)/);
assert.deepEqual(executions[0].params, ["scope:a", "scope:a", 3]);
assert.equal(page.scopes.length, 2);
assert.equal(page.scopes[0].scopeType, "platform");
assert.equal(page.scopes[0].tenantId, null);
assert.equal(page.scopes[1].scopeType, "tenant");
assert.equal(page.scopes[1].tenantId, "tenant-1");
assert.equal(page.page.hasMore, true);
assert.equal(page.page.nextScopeKey, "tenant:tenant-1");

assert.throws(
  () => _testingEffectiveAuthorityReconciliationRepository.normalizeLimit(0),
  /between 1 and 200/
);
assert.throws(
  () =>
    _testingEffectiveAuthorityReconciliationRepository.mapScope({
      scope_id: "bad",
      scope_key: "tenant:bad",
      scope_type: "tenant",
      tenant_id: null,
    }),
  /requires tenant_id/
);

console.log("effective authority reconciliation repository tests passed");
