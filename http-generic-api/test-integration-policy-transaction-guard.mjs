import assert from "node:assert/strict";
import {
  upsertTenantIntegrationPolicies,
  validateIntegrationModesObject,
} from "./hybridIntegrationPolicy.js";

assert.throws(
  () => validateIntegrationModesObject({ github: "unsupported_mode" }),
  (err) => err?.code === "invalid_integration_policy" && err?.status === 400,
  "invalid integration modes must fail before any DB write"
);

const failureEvents = [];
const failureConnection = {
  async beginTransaction() { failureEvents.push("begin"); },
  async query(_sql, params) {
    const appKey = params?.[1];
    failureEvents.push(`write:${appKey}`);
    if (appKey === "github") {
      const err = new Error("simulated schema failure");
      err.code = "ER_NO_SUCH_TABLE";
      throw err;
    }
    return [{ affectedRows: 1 }];
  },
  async commit() { failureEvents.push("commit"); },
  async rollback() { failureEvents.push("rollback"); },
  release() { failureEvents.push("release"); },
};

await assert.rejects(
  () => upsertTenantIntegrationPolicies({
    tenantId: "tenant-1",
    userId: "user-1",
    integrationModes: {
      google_drive: "managed",
      github: "dedicated",
    },
    source: "regression_test",
    pool: { async getConnection() { return failureConnection; } },
  }),
  (err) => {
    assert.equal(err?.code, "integration_policy_transaction_failed");
    assert.equal(err?.details?.original_code, "ER_NO_SUCH_TABLE");
    assert.equal(err?.details?.rollback_applied, true);
    assert.equal(err?.details?.committed, false);
    assert.equal(err?.details?.rows_written_before_failure, 1);
    return true;
  },
  "a later write failure must reject with rollback evidence"
);

assert.deepEqual(
  failureEvents,
  ["begin", "write:google_drive", "write:github", "rollback", "release"],
  "error_response_no_mutation contract requires rollback and forbids commit"
);

const successEvents = [];
const successConnection = {
  async beginTransaction() { successEvents.push("begin"); },
  async query(_sql, params) { successEvents.push(`write:${params?.[1]}`); return [{ affectedRows: 1 }]; },
  async commit() { successEvents.push("commit"); },
  async rollback() { successEvents.push("rollback"); },
  release() { successEvents.push("release"); },
};

const success = await upsertTenantIntegrationPolicies({
  tenantId: "tenant-1",
  userId: "user-1",
  integrationModes: { github: "managed", google_drive: "dedicated" },
  source: "regression_test",
  pool: { async getConnection() { return successConnection; } },
});

assert.equal(success.committed, true);
assert.equal(success.updated, 2);
assert.equal(success.secrets_included, false);
assert.deepEqual(successEvents, ["begin", "write:github", "write:google_drive", "commit", "release"]);

console.log("integration policy transaction guard passed");
