import assert from "node:assert/strict";
import { createActivationEffectiveAuthorityProjectionService } from "./src/application/effectiveAuthority/activationEffectiveAuthorityProjectionService.js";
import { createEffectiveAuthorityRepository } from "./src/infrastructure/effectiveAuthority/effectiveAuthorityRepository.js";

const executions = [];
const pool = {
  async execute(sql, params) {
    executions.push({ sql, params });
    assert.match(sql, /FROM connected_systems cs/);
    assert.match(sql, /LEFT JOIN installations i/);
    return [[{
      registered_count: 12,
      authorized_count: 3,
      projected_count: 3,
      executable_candidate_count: 1,
    }]];
  },
};
const repository = createEffectiveAuthorityRepository({
  resolvePool: async () => pool,
});
const service = createActivationEffectiveAuthorityProjectionService({
  repository,
  now: () => new Date("2026-07-24T00:03:00.000Z"),
});

const projection = await service.project({
  scope: {
    scopeId: "scope-tenant-2",
    scopeKey: "tenant:tenant-2",
    scopeType: "tenant",
    tenantId: "tenant-2",
    version: 5,
  },
});
assert.equal(executions.length, 1);
assert.ok(executions[0].params.length >= 1);
assert.ok(executions[0].params.every((value) => value === "tenant-2"));
assert.equal(projection.status, "active");
assert.equal(projection.subject_scope.tenantId, "tenant-2");
assert.equal(projection.registered_count, 12);
assert.equal(projection.authorized_count, 3);
assert.equal(projection.projected_count, 3);
assert.equal(projection.executable_candidate_count, 1);
assert.equal(projection.drift_detected, false);
assert.equal(projection.authority_granted, false);
assert.equal(projection.execution_authority_changed, false);
assert.equal(projection.secrets_included, false);

console.log("Activation effective-authority projection integration tests passed");
