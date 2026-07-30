import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  acquireRepositoryOperationLease,
  normalizeRepositoryOperationLeaseInput,
  releaseRepositoryOperationLease,
  repositoryOperationLeaseResourceKey,
} from "./repositoryOperationLeaseService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function scriptedConnection(steps) {
  const calls = [];
  let committed = 0;
  let rolledBack = 0;
  let released = 0;
  return {
    calls,
    get committed() { return committed; },
    get rolledBack() { return rolledBack; },
    get released() { return released; },
    async beginTransaction() { calls.push({ kind: "begin" }); },
    async commit() { committed += 1; calls.push({ kind: "commit" }); },
    async rollback() { rolledBack += 1; calls.push({ kind: "rollback" }); },
    release() { released += 1; calls.push({ kind: "release" }); },
    async query(sql, params = []) {
      calls.push({ kind: "query", sql, params });
      assert.ok(steps.length > 0, `Unexpected query: ${sql}`);
      const step = steps.shift();
      if (step instanceof Error) throw step;
      if (typeof step === "function") return step(sql, params);
      return step;
    },
  };
}

function poolWithConnection(connection) {
  return { async getConnection() { return connection; } };
}

const baseInput = {
  repository_owner: "mad4bdigital-ai",
  repository_name: "multi-business-multi-role-growth-intelligence-os",
  branch_name: "gpt/repository-operation-leases-20260701",
  operation_key: "repo.pr.reconcile_and_finalize",
  holder_run_id: "reconcile-run-123",
  holder_actor_type: "platform_orchestrator",
  holder_actor_id: "admin-gpt",
  operation_fingerprint: "a".repeat(64),
  ttl_seconds: 600,
};

const normalized = normalizeRepositoryOperationLeaseInput(baseInput);
assert.equal(
  normalized.resource_key,
  "github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/branch/gpt/repository-operation-leases-20260701"
);
assert.match(normalized.resource_fingerprint, /^[0-9a-f]{64}$/);
assert.equal(normalized.lease_mode, "exclusive_mutation");
assert.equal(
  repositoryOperationLeaseResourceKey(baseInput),
  normalized.resource_key
);

assert.throws(
  () => normalizeRepositoryOperationLeaseInput({ ...baseInput, branch_name: "main" }),
  (error) => error?.code === "repository_operation_lease_protected_branch" && error?.status === 403
);
assert.throws(
  () => normalizeRepositoryOperationLeaseInput({ ...baseInput, branch_name: "gpt/bad..branch" }),
  (error) => error?.code === "repository_operation_lease_invalid_branch"
);
assert.throws(
  () => normalizeRepositoryOperationLeaseInput({ ...baseInput, ttl_seconds: 10 }),
  (error) => error?.code === "repository_operation_lease_invalid_input"
);

const createdRow = {
  lease_id: "11111111-1111-4111-8111-111111111111",
  ...normalized,
  status: "active",
  acquired_at: "2026-07-01T12:00:00.000Z",
  renewed_at: null,
  expires_at: "2026-07-01T12:10:00.000Z",
  released_at: null,
  release_reason: null,
};
const createConnection = scriptedConnection([
  [{ affectedRows: 0 }],
  [[]],
  [{ affectedRows: 1 }],
  [[createdRow]],
]);
const acquired = await acquireRepositoryOperationLease(baseInput, {
  pool: poolWithConnection(createConnection),
  uuid: () => createdRow.lease_id,
});
assert.equal(acquired.ok, true);
assert.equal(acquired.reused, false);
assert.equal(acquired.lease.lease_id, createdRow.lease_id);
assert.equal(createConnection.committed, 1);
assert.equal(createConnection.rolledBack, 0);
assert.equal(createConnection.released, 1);

const conflictingRow = {
  ...createdRow,
  lease_id: "22222222-2222-4222-8222-222222222222",
  holder_run_id: "another-run",
  resource_fingerprint: "b".repeat(64),
};
const conflictConnection = scriptedConnection([
  [{ affectedRows: 0 }],
  [[conflictingRow]],
]);
await assert.rejects(
  acquireRepositoryOperationLease(baseInput, {
    pool: poolWithConnection(conflictConnection),
    uuid: () => "33333333-3333-4333-8333-333333333333",
  }),
  (error) => error?.code === "repository_operation_lease_conflict" && error?.status === 409
);
assert.equal(conflictConnection.committed, 0);
assert.equal(conflictConnection.rolledBack, 1);
assert.equal(conflictConnection.released, 1);

const renewedRow = {
  ...createdRow,
  renewed_at: "2026-07-01T12:05:00.000Z",
  expires_at: "2026-07-01T12:15:00.000Z",
};
const reuseConnection = scriptedConnection([
  [{ affectedRows: 0 }],
  [[createdRow]],
  [{ affectedRows: 1 }],
  [[renewedRow]],
]);
const reused = await acquireRepositoryOperationLease(baseInput, {
  pool: poolWithConnection(reuseConnection),
  uuid: () => "44444444-4444-4444-8444-444444444444",
});
assert.equal(reused.reused, true);
assert.equal(reused.lease.renewed_at, renewedRow.renewed_at);
assert.equal(reuseConnection.committed, 1);

const releasedRow = {
  ...renewedRow,
  status: "released",
  released_at: "2026-07-01T12:06:00.000Z",
  release_reason: "operation_complete",
};
const releaseConnection = scriptedConnection([
  [[renewedRow]],
  [{ affectedRows: 1 }],
  [[releasedRow]],
]);
const releaseResult = await releaseRepositoryOperationLease({
  lease_id: renewedRow.lease_id,
  holder_run_id: renewedRow.holder_run_id,
  resource_fingerprint: renewedRow.resource_fingerprint,
  release_reason: "operation_complete",
}, {
  pool: poolWithConnection(releaseConnection),
});
assert.equal(releaseResult.ok, true);
assert.equal(releaseResult.lease.status, "released");
assert.equal(releaseConnection.committed, 1);

const migration = fs.readFileSync(
  path.join(__dirname, "migrations", "20260701_repository_operation_leases.sql"),
  "utf8"
);
for (const token of [
  "CREATE TABLE IF NOT EXISTS `repository_operation_leases`",
  "`active_resource_key`",
  "GENERATED ALWAYS AS",
  "UNIQUE KEY `uq_repository_operation_leases_active_resource`",
  "repository_operation_lease_foundation_v1",
  "foundation_not_yet_wired",
  "mutation_tools_not_yet_wired",
]) {
  assert.ok(migration.includes(token), `migration missing ${token}`);
}
assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i);

await import("./test-repository-reconciliation-lease-control.mjs");

console.log("repository operation lease service tests passed");
