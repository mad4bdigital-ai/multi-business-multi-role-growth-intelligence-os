import assert from "node:assert/strict";
import {
  TENANT_GPT_OAUTH_CODE_CONSUMPTION_OUTCOMES,
  consumeTenantGptOAuthAuthorizationCode,
  inspectTenantGptOAuthAuthorizationCode,
  persistTenantGptOAuthAuthorizationCode,
} from "./tenantGptOAuthAuthorizationCodeStore.js";

const NOW_MS = Date.parse("2026-08-04T00:00:00.000Z");
const FUTURE = new Date("2030-01-01T00:00:00.000Z");
const CALLBACK = "https://chatgpt.com/aip/g-test/oauth/callback";
const CLIENT = "mad4b-tenant-gpt";

function createStoreQuery() {
  const rows = new Map();
  const calls = [];
  const query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes("CREATE TABLE IF NOT EXISTS `tenant_gpt_oauth_authorization_codes`")) {
      return [{ affectedRows: 0 }];
    }
    if (sql.includes("INSERT INTO `tenant_gpt_oauth_authorization_codes`")) {
      rows.set(params[0], {
        code_jti_hash: params[0],
        user_id: params[1],
        tenant_id: params[2],
        client_id: params[3],
        redirect_uri_hash: params[4],
        status: "issued",
        expires_at: params[5],
        consumed_at: null,
      });
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("UPDATE `tenant_gpt_oauth_authorization_codes`")) {
      const row = rows.get(params[0]);
      const eligible = row
        && row.client_id === params[1]
        && row.redirect_uri_hash === params[2]
        && row.status === "issued"
        && !row.consumed_at
        && new Date(row.expires_at).getTime() > NOW_MS;
      if (eligible) {
        row.status = "consumed";
        row.consumed_at = new Date(NOW_MS);
      }
      return [{ affectedRows: eligible ? 1 : 0 }];
    }
    if (sql.includes("SELECT status, expires_at, consumed_at")) {
      const row = rows.get(params[2]);
      return [[row ? {
        status: row.status,
        expires_at: row.expires_at,
        consumed_at: row.consumed_at,
        client_matches: row.client_id === params[0] ? 1 : 0,
        redirect_matches: row.redirect_uri_hash === params[1] ? 1 : 0,
        expired_by_store: new Date(row.expires_at).getTime() <= NOW_MS ? 1 : 0,
      } : undefined].filter(Boolean)];
    }
    throw new Error(`Unexpected authorization-code query: ${sql}`);
  };
  return { query, rows, calls };
}

async function captureConsumptionFailure(work, expectedCode) {
  let captured = null;
  await assert.rejects(
    work,
    error => {
      captured = error;
      return error?.code === expectedCode;
    },
  );
  assert.ok(captured?.oauth_consumption, "store failure must carry bounded consumption readback");
  assert.equal(Object.isFrozen(captured.oauth_consumption), true);
  assert.equal(captured.oauth_consumption.secrets_included, false);
  return captured.oauth_consumption;
}

assert.equal(TENANT_GPT_OAUTH_CODE_CONSUMPTION_OUTCOMES.includes("consumption_outcome_unknown"), true);
assert.equal(TENANT_GPT_OAUTH_CODE_CONSUMPTION_OUTCOMES.includes("store_unavailable_code_still_issued"), true);

const store = createStoreQuery();
const persisted = await persistTenantGptOAuthAuthorizationCode({
  query: store.query,
  jti: "code-jti",
  user_id: "user-1",
  tenant_id: "tenant-1",
  client_id: CLIENT,
  redirect_uri: CALLBACK,
  expires_at: FUTURE,
});
assert.equal(persisted.stored, true);
assert.equal(persisted.table_recovered, false);
assert.equal(persisted.secrets_included, false);
assert.equal(store.calls[0].params[0].length, 64);
assert.equal(store.calls[0].params[1], "user-1");
assert.equal(store.calls[0].params[3], CLIENT);
assert.equal(store.calls[0].params[4].length, 64);
assert.equal(store.calls[0].params.includes("code-jti"), false);

const issuedReadback = await inspectTenantGptOAuthAuthorizationCode({
  query: store.query,
  jti: "code-jti",
  client_id: CLIENT,
  redirect_uri: CALLBACK,
});
assert.equal(issuedReadback.outcome, "issued_not_consumed");
assert.equal(issuedReadback.secrets_included, false);

const firstConsume = await consumeTenantGptOAuthAuthorizationCode({
  query: store.query,
  jti: "code-jti",
  client_id: CLIENT,
  redirect_uri: CALLBACK,
});
assert.deepEqual(firstConsume, {
  consumed: true,
  outcome: "consumed",
  readback_outcome: "already_consumed",
  replay_allowed: false,
  store_error_code: null,
  table_recovered: false,
  secrets_included: false,
});

const replayConsume = await consumeTenantGptOAuthAuthorizationCode({
  query: store.query,
  jti: "code-jti",
  client_id: CLIENT,
  redirect_uri: CALLBACK,
});
assert.equal(replayConsume.consumed, false);
assert.equal(replayConsume.outcome, "already_consumed");
assert.equal(replayConsume.replay_allowed, false);
assert.equal(store.calls.some((call) => call.sql.includes("consumed_at IS NULL")), true);
assert.equal(store.calls.some((call) => call.sql.includes("expires_at > UTC_TIMESTAMP(3)")), true);
assert.equal(store.calls.some((call) => call.sql.includes("expires_at <= UTC_TIMESTAMP(3)")), true);

await persistTenantGptOAuthAuthorizationCode({
  query: store.query,
  jti: "binding-code",
  user_id: "user-1",
  client_id: CLIENT,
  redirect_uri: CALLBACK,
  expires_at: FUTURE,
});
const bindingMismatch = await consumeTenantGptOAuthAuthorizationCode({
  query: store.query,
  jti: "binding-code",
  client_id: "wrong-client",
  redirect_uri: CALLBACK,
});
assert.equal(bindingMismatch.outcome, "binding_mismatch");
assert.equal(bindingMismatch.consumed, false);

await persistTenantGptOAuthAuthorizationCode({
  query: store.query,
  jti: "expired-code",
  user_id: "user-1",
  client_id: CLIENT,
  redirect_uri: CALLBACK,
  expires_at: new Date("2020-01-01T00:00:00.000Z"),
});
const expired = await consumeTenantGptOAuthAuthorizationCode({
  query: store.query,
  jti: "expired-code",
  client_id: CLIENT,
  redirect_uri: CALLBACK,
});
assert.equal(expired.outcome, "expired");
assert.equal(expired.consumed, false);

await persistTenantGptOAuthAuthorizationCode({
  query: store.query,
  jti: "race-code",
  user_id: "user-1",
  client_id: CLIENT,
  redirect_uri: CALLBACK,
  expires_at: FUTURE,
});
const raceResults = await Promise.all([
  consumeTenantGptOAuthAuthorizationCode({ query: store.query, jti: "race-code", client_id: CLIENT, redirect_uri: CALLBACK }),
  consumeTenantGptOAuthAuthorizationCode({ query: store.query, jti: "race-code", client_id: CLIENT, redirect_uri: CALLBACK }),
]);
assert.equal(raceResults.filter((result) => result.consumed).length, 1);
assert.equal(raceResults.filter((result) => result.outcome === "already_consumed").length, 1);

let committedStatus = "issued";
const commitThenDisconnectQuery = async (sql, params = []) => {
  if (sql.includes("UPDATE `tenant_gpt_oauth_authorization_codes`")) {
    committedStatus = "consumed";
    const error = new Error("connection dropped after commit");
    error.code = "ECONNRESET";
    throw error;
  }
  if (sql.includes("SELECT status, expires_at, consumed_at")) {
    return [[{
      status: committedStatus,
      expires_at: FUTURE,
      consumed_at: committedStatus === "consumed" ? new Date(NOW_MS) : null,
      client_matches: 1,
      redirect_matches: 1,
      expired_by_store: 0,
    }]];
  }
  throw new Error(`Unexpected ambiguous query: ${sql} ${JSON.stringify(params)}`);
};
const committedUnknown = await captureConsumptionFailure(
  () => consumeTenantGptOAuthAuthorizationCode({
    query: commitThenDisconnectQuery,
    jti: "ambiguous-code",
    client_id: CLIENT,
    redirect_uri: CALLBACK,
  }),
  "ECONNRESET",
);
assert.equal(committedUnknown.consumed, false);
assert.equal(committedUnknown.outcome, "consumption_outcome_unknown");
assert.equal(committedUnknown.readback_outcome, "already_consumed");
assert.equal(committedUnknown.replay_allowed, false);
assert.equal(committedUnknown.store_error_code, "ECONNRESET");

const disconnectBeforeCommitQuery = async (sql) => {
  if (sql.includes("UPDATE `tenant_gpt_oauth_authorization_codes`")) {
    const error = new Error("connection dropped before commit");
    error.code = "ETIMEDOUT";
    throw error;
  }
  if (sql.includes("SELECT status, expires_at, consumed_at")) {
    return [[{
      status: "issued",
      expires_at: FUTURE,
      consumed_at: null,
      client_matches: 1,
      redirect_matches: 1,
      expired_by_store: 0,
    }]];
  }
  throw new Error(`Unexpected pre-commit query: ${sql}`);
};
const stillIssued = await captureConsumptionFailure(
  () => consumeTenantGptOAuthAuthorizationCode({
    query: disconnectBeforeCommitQuery,
    jti: "still-issued-code",
    client_id: CLIENT,
    redirect_uri: CALLBACK,
  }),
  "ETIMEDOUT",
);
assert.equal(stillIssued.outcome, "store_unavailable_code_still_issued");
assert.equal(stillIssued.readback_outcome, "issued_not_consumed");
assert.equal(stillIssued.replay_allowed, true);
assert.equal(stillIssued.store_error_code, "ETIMEDOUT");

const unreadableOutcome = await captureConsumptionFailure(
  () => consumeTenantGptOAuthAuthorizationCode({
    query: async () => {
      const error = new Error("store and readback unavailable");
      error.code = "ECONNREFUSED";
      throw error;
    },
    jti: "unreadable-code",
    client_id: CLIENT,
    redirect_uri: CALLBACK,
  }),
  "ECONNREFUSED",
);
assert.equal(unreadableOutcome.outcome, "consumption_outcome_unknown");
assert.equal(unreadableOutcome.readback_outcome, null);
assert.equal(unreadableOutcome.replay_allowed, false);
assert.equal(unreadableOutcome.store_error_code, "ECONNREFUSED");

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
  client_id: CLIENT,
  redirect_uri: CALLBACK,
  expires_at: FUTURE,
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
    client_id: CLIENT,
    redirect_uri: CALLBACK,
    expires_at: FUTURE,
  }),
  (error) => error?.code === "ECONNREFUSED",
);
assert.equal(unexpectedCreate, false);

await assert.rejects(
  () => persistTenantGptOAuthAuthorizationCode({ query: store.query, jti: "", user_id: "user-1", client_id: "client", redirect_uri: "https://example.com", expires_at: FUTURE }),
  /jti is required/,
);

const serializedResults = JSON.stringify({
  firstConsume,
  replayConsume,
  bindingMismatch,
  expired,
  raceResults,
  committedUnknown,
  stillIssued,
  unreadableOutcome,
});
for (const raw of ["code-jti", "binding-code", "expired-code", "race-code", "ambiguous-code", "still-issued-code", "unreadable-code"]) {
  assert.equal(serializedResults.includes(raw), false, `${raw} must not be returned in consumption evidence`);
}

console.log("PASS tenant-gpt-oauth-authorization-code-store");
