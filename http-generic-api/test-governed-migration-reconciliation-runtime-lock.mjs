import assert from "node:assert/strict";
import {
  GOVERNED_MIGRATION_RECONCILIATION_LOCK,
  runGovernedMigrationReconciliationRuntime,
} from "./governedMigrationReconciliationRuntime.js";

function createHarness({
  acquired = 1,
  releaseResult = 1,
  releaseError = null,
  executorError = null,
} = {}) {
  const queries = [];
  let released = false;
  let destroyed = false;
  let executeCount = 0;
  const connection = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("GET_LOCK")) return [[{ acquired }]];
      if (sql.includes("RELEASE_LOCK")) {
        if (releaseError) throw releaseError;
        return [[{ released: releaseResult }]];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {
      released = true;
    },
    destroy() {
      destroyed = true;
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
    get destroyed() { return destroyed; },
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
assert.equal(busy.destroyed, false);
assert.equal(busy.queries.some(({ sql }) => sql.includes("RELEASE_LOCK")), false);

const stringBusy = createHarness({ acquired: "0" });
const stringBusyResult = await runGovernedMigrationReconciliationRuntime(
  { apply: false },
  { pool: stringBusy.pool, execFileAsync: stringBusy.execFileAsync },
);
assert.equal(stringBusyResult.ok, true);
assert.equal(stringBusyResult.skipped, true);
assert.equal(stringBusy.executeCount, 0);

const indeterminate = createHarness({ acquired: null });
const indeterminateResult = await runGovernedMigrationReconciliationRuntime(
  { apply: false },
  { pool: indeterminate.pool, execFileAsync: indeterminate.execFileAsync },
);
assert.equal(indeterminateResult.ok, false);
assert.equal(
  indeterminateResult.error.code,
  "governed_migration_reconciliation_lock_failed",
);
assert.equal(indeterminate.executeCount, 0);
assert.equal(indeterminate.released, true);
assert.equal(indeterminate.destroyed, false);

const success = createHarness({ acquired: 1 });
const successResult = await runGovernedMigrationReconciliationRuntime(
  { apply: false },
  { pool: success.pool, execFileAsync: success.execFileAsync },
);
assert.equal(successResult.ok, true);
assert.equal(success.executeCount, 1);
assert.equal(success.released, true);
assert.equal(success.destroyed, false);
assert.equal(success.queries.some(({ sql }) => sql.includes("GET_LOCK")), true);
assert.equal(success.queries.some(({ sql }) => sql.includes("RELEASE_LOCK")), true);
assert.deepEqual(
  success.queries.find(({ sql }) => sql.includes("GET_LOCK")).params,
  [GOVERNED_MIGRATION_RECONCILIATION_LOCK],
);

const stringSuccess = createHarness({ acquired: "1" });
const stringSuccessResult = await runGovernedMigrationReconciliationRuntime(
  { apply: false },
  { pool: stringSuccess.pool, execFileAsync: stringSuccess.execFileAsync },
);
assert.equal(stringSuccessResult.ok, true);
assert.equal(stringSuccess.executeCount, 1);
assert.equal(stringSuccess.released, true);

const failure = createHarness({ acquired: 1, executorError: new Error("executor failed") });
const failureResult = await runGovernedMigrationReconciliationRuntime(
  { apply: true },
  { pool: failure.pool, execFileAsync: failure.execFileAsync },
);
assert.equal(failureResult.ok, false);
assert.equal(failureResult.error.code, "governed_migration_reconciliation_runtime_failed");
assert.equal(failure.released, true);
assert.equal(failure.destroyed, false);
assert.equal(failure.queries.some(({ sql }) => sql.includes("RELEASE_LOCK")), true);

const releaseFailure = createHarness({
  acquired: 1,
  releaseError: new Error("release query failed"),
});
const releaseFailureResult = await runGovernedMigrationReconciliationRuntime(
  { apply: false },
  { pool: releaseFailure.pool, execFileAsync: releaseFailure.execFileAsync },
);
assert.equal(releaseFailureResult.ok, false);
assert.equal(
  releaseFailureResult.error.code,
  "governed_migration_reconciliation_lock_release_failed",
);
assert.equal(releaseFailure.executeCount, 1);
assert.equal(releaseFailure.destroyed, true);
assert.equal(releaseFailure.released, false);

const releaseRejected = createHarness({ acquired: 1, releaseResult: 0 });
const releaseRejectedResult = await runGovernedMigrationReconciliationRuntime(
  { apply: false },
  { pool: releaseRejected.pool, execFileAsync: releaseRejected.execFileAsync },
);
assert.equal(releaseRejectedResult.ok, false);
assert.equal(
  releaseRejectedResult.error.code,
  "governed_migration_reconciliation_lock_release_failed",
);
assert.equal(releaseRejected.destroyed, true);
assert.equal(releaseRejected.released, false);

console.log("governed migration reconciliation runtime lock tests passed");
