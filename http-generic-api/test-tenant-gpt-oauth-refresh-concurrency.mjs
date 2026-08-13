import assert from "node:assert/strict";
import { rotateTenantGptOAuthGrant } from "./tenantGptOAuthGrantStore.js";

const state = { locked: false, waiters: [], active: true, rotated: 0 };
function makeConnection() {
  let ownsLock = false;
  return {
    async beginTransaction() {},
    async query(sql) {
      if (sql.includes("FOR UPDATE")) {
        if (state.locked) await new Promise((resolve) => state.waiters.push(resolve));
        state.locked = true;
        ownsLock = true;
        return state.active ? [[{
          grant_id: "grant-current",
          access_jti: "access-current",
          refresh_token_hash: "hash-current",
          client_id: "mad4b-tenant-gpt",
          user_id: "user-1",
          tenant_id: "tenant-1",
          resource: "https://auth.mad4b.com",
          scopes_json: JSON.stringify(["tenant.links"]),
          status: "active",
          access_expires_at: new Date(),
          refresh_expires_at: new Date(Date.now() + 3600000),
        }]] : [[]];
      }
      if (sql.includes("INSERT INTO tenant_gpt_oauth_grants")) return [{ affectedRows: 1 }];
      if (sql.includes("UPDATE tenant_gpt_oauth_grants")) {
        if (!state.active) return [{ affectedRows: 0 }];
        state.active = false;
        state.rotated += 1;
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected refresh SQL: ${sql}`);
    },
    async commit() {},
    async rollback() {},
    release() {
      if (!ownsLock) return;
      ownsLock = false;
      state.locked = false;
      const waiter = state.waiters.shift();
      if (waiter) waiter();
    },
  };
}

const pool = { getConnection: async () => makeConnection() };
const results = await Promise.all([
  rotateTenantGptOAuthGrant({ pool, refreshToken: "refresh-token", accessJti: "access-next-1", accessExpiresAt: new Date() }),
  rotateTenantGptOAuthGrant({ pool, refreshToken: "refresh-token", accessJti: "access-next-2", accessExpiresAt: new Date() }),
]);
assert.equal(results.filter(Boolean).length, 1);
assert.equal(results.filter((value) => value === null).length, 1);
assert.equal(state.rotated, 1);
console.log("Tenant GPT OAuth refresh concurrency tests passed.");
