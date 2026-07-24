import assert from "node:assert/strict";
import {
  GOVERNED_MIGRATION_RECONCILIATION_LOCK,
  runGovernedMigrationReconciliationRuntime,
} from "./governedMigrationReconciliationRuntime.js";

function createHarness({ acquired = 1, executorError = null } = {}) {
  const queries = [];
  let released = false;
  let executeCount = 0;
  const connection = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("GET_LOCK")) return [[{ acquired }]];
      if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }]];
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {
      released = true;
    },
  };
  const pool = {
    async getConnection() {
      return connection;
    },
  };
  const execFileAsync = async () => {
    executeCount += 1;
    if (executorError) throw executorError;
    return {
      stdout: JSON.stringify({
        ok: true,
        run_id: "test-run",
        mode: "dry_run",
        policy_available: true,
        migration_count: 0,
        items: [],
      }),
      stderr: "",
    };
  };
  return {
    pool,
    execFileAsync,
    queries,
    get released() { return released; },
    get executeCount() { return executeCount; },
  };
}

const busy = createHarness({ acquired: 0 });
const busyResult = await runGovernedMigrationReconciliationRuntime(
  { apply: false },
  { pool: busy.pool, execFileAsync: busy.execFileAsync },
);
assert.equal(busyResult.ok, true);
assert.equal(busyResult.skipped, true);
assert.equal(busyResult.reason, "governed_migration_reconciliation_lock_busy");
assert.equal(busyResult.lock_key, GOVERNED_MIGRATION_RECONCILIATION_LOCK);
assert.equal(busy.executeCount, 0);
assert.equal(busy.released, true);
assert.equal(busy.queries.some(({ sql }) => sql.includes("RELEASE_LOCK")), false);

const success = createHarness({ acquired: 1 });
const successResult = await runGovernedMigrationReconciliationRuntime(
  { apply: false },
  { pool: success.pool, execFileAsync: success.execFileAsync },
);
assert.equal(successResult.ok, true);
assert.equal(success.executeCount, 1);
assert.equal(success.released, true);
assert.equal(success.queries.some(({ sql }) => sql.includes("GET_LOCK")), true);
assert.equal(success.queries.some(({ sql }) => sql.includes("RELEASE_LOCK")), true);
assert.deepEqual(
  success.queries.find(({ sql }) => sql.includes("GET_LOCK")).params,
  [GOVERNED_MIGRATION_RECONCILIATION_LOCK],
);

const failure = createHarness({ acquired: 1, executorError: new Error("executor failed") });
const failureResult = await runGovernedMigrationReconciliationRuntime(
  { apply: true },
  { pool: failure.pool, execFileAsync: failure.execFileAsync },
);
assert.equal(failureResult.ok, false);
assert.equal(failureResult.error.code, "governed_migration_reconciliation_runtime_failed");
assert.equal(failure.released, true);
assert.equal(failure.queries.some(({ sql }) => sql.includes("RELEASE_LOCK")), true);

console.log("governed migration reconciliation runtime lock tests passed");
