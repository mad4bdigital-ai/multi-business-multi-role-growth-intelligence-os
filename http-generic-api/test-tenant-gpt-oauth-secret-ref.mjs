import assert from "node:assert/strict";
import { decryptToken } from "./tokenEncryption.js";
import {
  getTenantGptOAuthClientConfigStatus,
  readTenantGptOAuthClientConfig,
  TENANT_GPT_OAUTH_CLIENT_CONFIG_KEY,
  TENANT_GPT_OAUTH_CLIENT_SECRET_REF,
  upsertTenantGptOAuthClientConfig,
  validateTenantGptOAuthClientCredentials,
} from "./tenantGptOAuthClientConfig.js";

process.env.TOKEN_ENCRYPTION_KEY = "11".repeat(32);

const legacySecret = "m4b_tgpt_legacy_secret";
let runtimeConfig = {
  client_id: "mad4b-tenant-gpt",
  client_secret: legacySecret,
  callback_urls_to_allow: ["https://chat.openai.com/aip/oauth/callback"],
  created_at: "2026-06-01T00:00:00.000Z",
};
let platformSecret = null;
let transactionStarted = false;
let transactionCommitted = false;
let transactionRolledBack = false;

const pool = {
  async getConnection() {
    return {
      query: (sql, params) => pool.query(sql, params),
      async beginTransaction() {
        transactionStarted = true;
      },
      async commit() {
        transactionCommitted = true;
      },
      async rollback() {
        transactionRolledBack = true;
      },
      release() {},
    };
  },
  async query(sql, params = []) {
    const compact = String(sql).replace(/\s+/g, " ").trim();
    if (compact.includes("SELECT config_json") && compact.includes("FROM `platform_runtime_config`")) {
      return [[{ config_json: JSON.stringify(runtimeConfig) }]];
    }
    if (compact.startsWith("CREATE TABLE IF NOT EXISTS `platform_runtime_config`")) return [{ affectedRows: 0 }];
    if (compact.startsWith("INSERT INTO `platform_secrets`")) {
      platformSecret = {
        secret_key: params[0],
        secret_type: "oauth_client_secret",
        storage_backend: "db_encrypted",
        value_sha256: params[1],
        value_ciphertext: params[2],
        status: "active",
      };
      return [{ affectedRows: 1 }];
    }
    if (compact.startsWith("INSERT INTO `platform_runtime_config`")) {
      assert.equal(params[0], TENANT_GPT_OAUTH_CLIENT_CONFIG_KEY);
      runtimeConfig = JSON.parse(params[1]);
      return [{ affectedRows: 1 }];
    }
    if (compact.includes("FROM `platform_secrets`")) {
      return [[platformSecret].filter(Boolean)];
    }
    throw new Error(`Unexpected SQL in test: ${compact}`);
  },
};

const promoted = await upsertTenantGptOAuthClientConfig({ pool });
assert.equal(promoted.client_secret, legacySecret, "promotion must preserve the existing OAuth secret");
assert.equal(promoted.client_secret_ref, TENANT_GPT_OAUTH_CLIENT_SECRET_REF);
assert.equal(promoted.legacy_inline_secret_removed, true);
assert.equal(promoted.secret_storage_backend, "db_encrypted");
assert.equal(transactionStarted, true);
assert.equal(transactionCommitted, true);
assert.equal(transactionRolledBack, false);
assert.equal(runtimeConfig.client_secret, undefined, "runtime config must not retain inline client_secret");
assert.equal(runtimeConfig.client_secret_ref, TENANT_GPT_OAUTH_CLIENT_SECRET_REF);
assert.equal(platformSecret.secret_key, "TENANT_GPT_OAUTH_CLIENT_SECRET");
assert.equal(decryptToken(platformSecret.value_ciphertext), legacySecret);

const resolved = await readTenantGptOAuthClientConfig({
  query: (sql, params) => pool.query(sql, params),
  decryptToken,
});
assert.equal(resolved.ok, true);
assert.equal(resolved.source, "db_runtime_secret_ref");
assert.equal(resolved.config.client_secret, legacySecret);
assert.equal(resolved.config.client_secret_ref, TENANT_GPT_OAUTH_CLIENT_SECRET_REF);
assert.equal(resolved.config.legacy_inline_secret, false);

const validated = await validateTenantGptOAuthClientCredentials(
  { client_id: "mad4b-tenant-gpt", client_secret: legacySecret },
  { query: (sql, params) => pool.query(sql, params), decryptToken }
);
assert.equal(validated.ok, true);
assert.equal(validated.source, "db_runtime_secret_ref");

const status = await getTenantGptOAuthClientConfigStatus({ pool, decryptToken });
assert.equal(status.ok, true);
assert.equal(status.client_secret_ref, TENANT_GPT_OAUTH_CLIENT_SECRET_REF);
assert.equal(status.client_secret_ref_status, "resolved");
assert.equal(status.secret_storage_backend, "db_encrypted");
assert.equal(status.inline_secret_present, false);
assert.equal(status.migration_required, false);
assert.equal(status.secrets_included, false);
assert.equal("client_secret" in status, false);

const unresolved = await readTenantGptOAuthClientConfig({
  query: async (sql) => String(sql).includes("platform_runtime_config")
    ? [[{ config_json: JSON.stringify({ client_id: "mad4b-tenant-gpt", client_secret_ref: TENANT_GPT_OAUTH_CLIENT_SECRET_REF }) }]]
    : [[]],
  decryptToken,
});
assert.equal(unresolved.ok, false);
assert.equal(unresolved.error, "tenant_gpt_oauth_client_secret_ref_unresolved");

let rollbackCalled = false;
let releaseCalled = false;
const failingPool = {
  async query(sql) {
    if (String(sql).includes("CREATE TABLE IF NOT EXISTS")) return [{ affectedRows: 0 }];
    throw new Error("Unexpected pool query");
  },
  async getConnection() {
    return {
      async beginTransaction() {},
      async query(sql) {
        const compact = String(sql).replace(/\s+/g, " ").trim();
        if (compact.includes("SELECT config_json")) {
          return [[{ config_json: JSON.stringify({ client_id: "mad4b-tenant-gpt", client_secret: legacySecret }) }]];
        }
        if (compact.startsWith("INSERT INTO `platform_secrets`")) return [{ affectedRows: 1 }];
        if (compact.startsWith("INSERT INTO `platform_runtime_config`")) throw new Error("runtime config write failed");
        throw new Error(`Unexpected transaction SQL: ${compact}`);
      },
      async commit() {
        assert.fail("failed promotion must not commit");
      },
      async rollback() {
        rollbackCalled = true;
      },
      release() {
        releaseCalled = true;
      },
    };
  },
};
await assert.rejects(
  upsertTenantGptOAuthClientConfig({ pool: failingPool }),
  /runtime config write failed/
);
assert.equal(rollbackCalled, true, "failed promotion must roll back the encrypted secret write");
assert.equal(releaseCalled, true, "failed promotion must release its database connection");

console.log("tenant GPT OAuth secret reference tests passed");
