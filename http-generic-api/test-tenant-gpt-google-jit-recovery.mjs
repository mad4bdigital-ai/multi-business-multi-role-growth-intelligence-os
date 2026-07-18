import assert from "node:assert/strict";
import {
  isDuplicateEntryError,
  recoverGoogleJitIdentityAfterDuplicate,
} from "./tenantGptGoogleJitRecovery.js";

assert.equal(isDuplicateEntryError({ code: "ER_DUP_ENTRY" }), true);
assert.equal(isDuplicateEntryError({ errno: 1062 }), true);
assert.equal(isDuplicateEntryError({ code: "OTHER" }), false);

const calls = [];
const connection = {
  async beginTransaction() { calls.push("begin"); },
  async query(sql, params) { calls.push({ sql, params }); return [[{ user_id: "user-1" }]]; },
  async commit() { calls.push("commit"); },
  async rollback() { calls.push("rollback"); },
  release() { calls.push("release"); },
};
const pool = {
  async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes("FROM `user_credentials`")) {
      return [[{ user_id: "user-1", email: "user@example.com", display_name: "User One", status: "active" }]];
    }
    throw new Error(`Unexpected query: ${sql}`);
  },
  async getConnection() { return connection; },
};
let workspaceCalls = 0;
const recovered = await recoverGoogleJitIdentityAfterDuplicate({
  pool,
  provider_id: "google-sub",
  email: "user@example.com",
  display_name: "User One",
  ensureWorkspace: async (_connection, input) => {
    workspaceCalls += 1;
    assert.equal(input.userId, "user-1");
    return { created: false, tenant_id: "tenant-1" };
  },
});
assert.equal(recovered.user_id, "user-1");
assert.equal(recovered.workspace.tenant_id, "tenant-1");
assert.equal(workspaceCalls, 1);
assert.equal(calls.some((entry) => typeof entry === "object" && entry.sql.includes("FOR UPDATE")), true);
assert.equal(calls.includes("commit"), true);
assert.equal(calls.includes("release"), true);

const blockedPool = {
  async query(sql) {
    if (sql.includes("FROM `user_credentials`")) {
      return [[{ user_id: "user-2", email: "blocked@example.com", display_name: "Blocked", status: "disabled" }]];
    }
    throw new Error(`Unexpected query: ${sql}`);
  },
  async getConnection() { throw new Error("blocked accounts must not enter workspace repair"); },
};
await assert.rejects(
  () => recoverGoogleJitIdentityAfterDuplicate({
    pool: blockedPool,
    provider_id: "blocked-sub",
    email: "blocked@example.com",
    display_name: "Blocked",
    ensureWorkspace: async () => ({ created: true }),
  }),
  (error) => error?.auth_code === "account_inactive" && error?.auth_status === 403,
);

console.log("PASS tenant-gpt-google-jit-recovery");
