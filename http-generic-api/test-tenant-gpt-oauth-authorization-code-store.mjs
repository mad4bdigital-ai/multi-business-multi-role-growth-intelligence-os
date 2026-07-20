import assert from "node:assert/strict";
import {
  consumeTenantGptOAuthAuthorizationCode,
  persistTenantGptOAuthAuthorizationCode,
} from "./tenantGptOAuthAuthorizationCodeStore.js";

const calls = [];
const query = async (sql, params) => {
  calls.push({ sql, params });
  if (sql.includes("UPDATE `tenant_gpt_oauth_authorization_codes`")) {
    return [{ affectedRows: calls.filter((item) => item.sql.includes("UPDATE `tenant_gpt_oauth_authorization_codes`")).length === 1 ? 1 : 0 }];
  }
  return [{ affectedRows: 1 }];
};

const expiresAt = new Date("2030-01-01T00:00:00.000Z");
const persisted = await persistTenantGptOAuthAuthorizationCode({
  query,
  jti: "code-jti",
  user_id: "user-1",
  tenant_id: "tenant-1",
  client_id: "mad4b-tenant-gpt",
  redirect_uri: "https://chatgpt.com/aip/g-test/oauth/callback",
  expires_at: expiresAt,
});
assert.equal(persisted.stored, true);
assert.equal(persisted.table_recovered, false);
assert.equal(calls[0].params[0].length, 64);
assert.equal(calls[0].params[1], "user-1");
assert.equal(calls[0].params[3], "mad4b-tenant-gpt");
assert.equal(calls[0].params[4].length, 64);
assert.equal(calls[0].params.includes("code-jti"), false);

const firstConsume = await consumeTenantGptOAuthAuthorizationCode({
  query,
  jti: "code-jti",
  client_id: "mad4b-tenant-gpt",
  redirect_uri: "https://chatgpt.com/aip/g-test/oauth/callback",
});
assert.equal(firstConsume.consumed, true);

const replayConsume = await consumeTenantGptOAuthAuthorizationCode({
  query,
  jti: "code-jti",
  client_id: "mad4b-tenant-gpt",
  redirect_uri: "https://chatgpt.com/aip/g-test/oauth/callback",
});
assert.equal(replayConsume.consumed, false);
assert.equal(calls.at(-1).sql.includes("consumed_at IS NULL"), true);
assert.equal(calls.at(-1).sql.includes("expires_at > CURRENT_TIMESTAMP"), true);

const recoveryCalls = [];
let firstRecoveredInsert = true;
const recoveryQuery = async (sql, params) => {
  recoveryCalls.push({ sql, params });
  if (sql.includes("INSERT INTO `tenant_gpt_oauth_authorization_codes`") && firstRecoveredInsert) {
    firstRecoveredInsert = false;
    const error = new Error("Table 'platform.tenant_gpt_oauth_authorization_codes' doesn't exist");
    error.code = "ER_NO_SUCH_TABLE";
    error.errno = 1146;
    throw error;
  }
  return [{ affectedRows: 1 }];
};
const recoveredPersist = await persistTenantGptOAuthAuthorizationCode({
  query: recoveryQuery,
  jti: "recovered-code-jti",
  user_id: "user-1",
  tenant_id: "tenant-1",
  client_id: "mad4b-tenant-gpt",
  redirect_uri: "https://chatgpt.com/aip/g-test/oauth/callback",
  expires_at: expiresAt,
});
assert.equal(recoveredPersist.stored, true);
assert.equal(recoveredPersist.table_recovered, true);
assert.equal(recoveryCalls.filter((call) => call.sql.includes("INSERT INTO `tenant_gpt_oauth_authorization_codes`")).length, 2);
assert.equal(recoveryCalls.filter((call) => call.sql.includes("CREATE TABLE IF NOT EXISTS `tenant_gpt_oauth_authorization_codes`")).length, 1);
assert.equal(recoveryCalls.some((call) => String(call.sql).includes("PRIMARY KEY (`code_jti_hash`)")), true);

let unexpectedCreate = false;
await assert.rejects(
  () => persistTenantGptOAuthAuthorizationCode({
    query: async (sql) => {
      if (sql.includes("CREATE TABLE")) unexpectedCreate = true;
      const error = new Error("database connection unavailable");
      error.code = "ECONNREFUSED";
      throw error;
    },
    jti: "failed-code-jti",
    user_id: "user-1",
    client_id: "mad4b-tenant-gpt",
    redirect_uri: "https://chatgpt.com/aip/g-test/oauth/callback",
    expires_at: expiresAt,
  }),
  (error) => error?.code === "ECONNREFUSED",
);
assert.equal(unexpectedCreate, false);

await assert.rejects(
  () => persistTenantGptOAuthAuthorizationCode({ query, jti: "", user_id: "user-1", client_id: "client", redirect_uri: "https://example.com", expires_at: expiresAt }),
  /jti is required/,
);

console.log("PASS tenant-gpt-oauth-authorization-code-store");
