import assert from "node:assert/strict";
import {
  listRemoteMcpOAuthClientProvisioningStatus,
  provisionRemoteMcpOAuthClient,
  reconcileStagingChatGPTCallback,
  readRemoteMcpOAuthClientProvisioningStatus,
} from "./remoteMcpOAuthClientProvisioning.js";

process.env.TOKEN_ENCRYPTION_KEY = "11".repeat(32);

const state = {
  configs: new Map(),
  clients: new Map(),
  secrets: new Map(),
};

let failCasOnce = false;

function result(affectedRows = 1) {
  return [{ affectedRows }, []];
}

function createConnection() {
  return {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sqlValue, params = []) {
      const sql = String(sqlValue);
      if (sql.includes("SELECT config_json, status, updated_at") && sql.includes(["platform_runtime_", "config"].join(""))) {
        const config = state.configs.get(params[0]);
        return [config ? [{ config_json: JSON.stringify(config.config), status: "active", updated_at: config.updated_at }] : [], []];
      }
      if (sql.includes("SELECT client_id, client_name") && sql.includes("remote_mcp_oauth_clients")) {
        const client = state.clients.get(params[0]);
        return [client ? [client] : [], []];
      }
      if (sql.includes("SELECT secret_key, storage_backend") && sql.includes("platform_secrets")) {
        const secret = state.secrets.get(params[0]);
        return [secret ? [secret] : [], []];
      }
      if (sql.includes("INSERT INTO platform_secrets")) {
        state.secrets.set(params[0], {
          secret_key: params[0],
          storage_backend: "db_encrypted",
          value_sha256: params[1],
          value_ciphertext: params[2],
          metadata_json: params[3],
          status: "active",
          updated_at: new Date().toISOString(),
        });
        return result();
      }
      if (sql.includes("INSERT INTO remote_mcp_oauth_clients")) {
        state.clients.set(params[0], {
          client_id: params[0],
          client_name: params[1],
          client_profile_key: params[2],
          token_endpoint_auth_method: params[3],
          client_secret_hash: params[4],
          redirect_uris_json: params[5],
          allowed_scopes_json: params[6],
          status: "active",
          expires_at: null,
        });
        return result();
      }
      if (sql.startsWith("UPDATE remote_mcp_oauth_clients SET redirect_uris_json")) {
        const [newUris, clientId, oldUris, hash] = params;
        const client = state.clients.get(clientId);
        if (failCasOnce) { failCasOnce = false; return result(0); }
        if (!client || client.status !== "active" || client.redirect_uris_json !== oldUris ||
            client.client_secret_hash !== hash) return result(0);
        client.redirect_uris_json = newUris;
        return result();
      }
      if (sql.startsWith("UPDATE platform_runtime_config SET config_json")) {
        const [newJson, key, oldJson] = params;
        const config = state.configs.get(key);
        if (!config || JSON.stringify(config.config) !== oldJson) return result(0);
        config.config = JSON.parse(newJson);
        return result();
      }
      if (sql.includes("UPDATE remote_mcp_oauth_clients")) {
        const client = state.clients.get(params[6]);
        assert(client, "expected existing client during update");
        Object.assign(client, {
          client_name: params[0],
          client_profile_key: params[1],
          token_endpoint_auth_method: params[2],
          client_secret_hash: params[3],
          redirect_uris_json: params[4],
          allowed_scopes_json: params[5],
          status: "active",
        });
        return result();
      }
      if (sql.includes(["INSERT INTO platform_runtime_", "config"].join(""))) {
        state.configs.set(params[0], {
          config: JSON.parse(params[1]),
          updated_at: new Date().toISOString(),
        });
        return result();
      }
      throw new Error(`Unhandled SQL in provisioning test: ${sql}`);
    },
  };
}

const pool = {
  async getConnection() {
    return createConnection();
  },
};

const stagingEnv = {
  REMOTE_MCP_ENVIRONMENT: "staging",
  REMOTE_MCP_RESOURCE_URL: "https://mcp-dev.mad4b.com",
  REMOTE_MCP_AUTHORIZATION_SERVER_URL: "https://dev.mad4b.com/auth/mcp",
  REMOTE_MCP_OAUTH_ALLOWED_REDIRECT_ORIGINS: "https://chatgpt.com",
};

const staging = await provisionRemoteMcpOAuthClient({
  env: stagingEnv,
  pool,
  environment: "staging",
  client_name: "Staging ChatGPT Remote MCP",
  redirect_uris: ["https://chatgpt.com/aip/oauth/callback"],
  scopes: ["workspaces.read", "brands.read"],
});
assert.equal(staging.ok, true);
assert.match(staging.client_id, /^mcp_stg_[A-Za-z0-9_-]{16,}$/u);
assert.equal(staging.client_secret.length >= 32, true);
assert.equal(staging.secrets_included, true);
assert.equal(staging.scope_authority, "https://auth.mad4b.com/scopes/*");
assert.equal(state.configs.get("remote_mcp.oauth.client.staging").config.client_secret, undefined);
assert.equal(state.secrets.get("REMOTE_MCP_STAGING_OAUTH_CLIENT_SECRET").value_ciphertext.length > 0, true);

const stagingStatus = await readRemoteMcpOAuthClientProvisioningStatus({ env: stagingEnv, pool });
assert.equal(stagingStatus.ok, true);
assert.equal(stagingStatus.environment, "staging");
assert.equal(stagingStatus.client_id, staging.client_id);
assert.equal(stagingStatus.secret_present, true);
assert.equal(stagingStatus.secrets_included, false);
assert.equal("client_secret" in stagingStatus, false);

const stagingClaude = await provisionRemoteMcpOAuthClient({
  env: stagingEnv,
  pool,
  environment: "staging",
  profile_key: "anthropic_claude",
  redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
  scopes: ["workspaces.read"],
});
assert.equal(stagingClaude.ok, true);
assert.equal(stagingClaude.profile_key, "anthropic_claude");
assert.match(stagingClaude.client_id, /^mcp_stg_[A-Za-z0-9_-]{16,}$/u);
assert.equal(stagingClaude.client_secret.length >= 32, true);
assert.notEqual(stagingClaude.client_id, staging.client_id);
assert.equal(state.configs.get("remote_mcp.oauth.client.staging.anthropic_claude").config.profile_key, "anthropic_claude");
assert.equal(state.secrets.get("REMOTE_MCP_STAGING_ANTHROPIC_CLAUDE_OAUTH_CLIENT_SECRET").value_ciphertext.length > 0, true);

const stagingChatGPT = await provisionRemoteMcpOAuthClient({
  env: stagingEnv,
  pool,
  environment: "staging",
  profile_key: "openai_chatgpt",
  redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
  scopes: ["brands.read"],
});
assert.equal(stagingChatGPT.ok, true);
assert.equal(stagingChatGPT.profile_key, "openai_chatgpt");
assert.notEqual(stagingChatGPT.client_id, stagingClaude.client_id);
assert.notEqual(stagingChatGPT.client_secret, stagingClaude.client_secret);
assert.equal(state.configs.get("remote_mcp.oauth.client.staging.openai_chatgpt").config.profile_key, "openai_chatgpt");
assert.equal(state.secrets.get("REMOTE_MCP_STAGING_OPENAI_CHATGPT_OAUTH_CLIENT_SECRET").value_ciphertext.length > 0, true);

const stagingClaudeStatus = await readRemoteMcpOAuthClientProvisioningStatus({
  env: { ...stagingEnv, REMOTE_MCP_CLIENT_PROFILE_KEY: "anthropic_claude" },
  pool,
});
assert.equal(stagingClaudeStatus.profile_key, "anthropic_claude");
assert.equal(stagingClaudeStatus.client_id, stagingClaude.client_id);
assert.equal(stagingClaudeStatus.secrets_included, false);
assert.equal("client_secret" in stagingClaudeStatus, false);

const allStagingStatus = await listRemoteMcpOAuthClientProvisioningStatus({ env: stagingEnv, pool });
assert.equal(allStagingStatus.environment, "staging");
assert.equal(allStagingStatus.profiles.length >= 5, true);
assert.equal(allStagingStatus.secrets_included, false);
for (const profileStatus of allStagingStatus.profiles) assert.equal("client_secret" in profileStatus, false);

const stagingSecondRun = await provisionRemoteMcpOAuthClient({
  env: stagingEnv,
  pool,
  environment: "staging",
  redirect_uris: ["https://chatgpt.com/aip/oauth/callback"],
  scopes: ["workspaces.read", "brands.read"],
});
assert.equal(stagingSecondRun.client_id, staging.client_id);
assert.equal(stagingSecondRun.client_secret, null);
assert.equal(stagingSecondRun.client_secret_created, false);
assert.equal(stagingSecondRun.secrets_included, false);
assert.deepEqual(stagingSecondRun.allowed_scopes, ["workspaces.read", "brands.read"]);
assert.deepEqual(stagingSecondRun.redirect_uris, ["https://chatgpt.com/aip/oauth/callback"]);

const productionEnv = {
  REMOTE_MCP_ENVIRONMENT: "production",
  REMOTE_MCP_RESOURCE_URL: "https://mcp.mad4b.com",
  REMOTE_MCP_AUTHORIZATION_SERVER_URL: "https://auth.mad4b.com/auth/mcp",
  REMOTE_MCP_OAUTH_ALLOWED_REDIRECT_ORIGINS: "https://claude.ai",
};
const production = await provisionRemoteMcpOAuthClient({
  env: productionEnv,
  pool,
  environment: "production",
  client_name: "Production Claude Remote MCP",
  redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
  scopes: ["workspaces.read"],
});
assert.equal(production.ok, true);
assert.match(production.client_id, /^mcp_prd_[A-Za-z0-9_-]{16,}$/u);
assert.notEqual(production.client_id, staging.client_id);
assert.notEqual(production.client_secret, staging.client_secret);
assert.equal(production.scope_authority, "https://auth.mad4b.com/scopes/*");

await assert.rejects(
  provisionRemoteMcpOAuthClient({
    env: productionEnv,
    pool,
    environment: "production",
    client_id: staging.client_id,
    redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
  }),
  (error) => error.code === "remote_mcp_client_environment_mismatch",
);

await assert.rejects(
  provisionRemoteMcpOAuthClient({
    env: stagingEnv,
    pool,
    environment: "staging",
    client_secret: "too-short",
    redirect_uris: ["https://chatgpt.com/aip/oauth/callback"],
  }),
  (error) => error.code === "remote_mcp_client_secret_too_short",
);


const callbackEnv = {
  ...stagingEnv,
  DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker",
  REMOTE_MCP_CLIENT_PROFILE_KEY: "openai_chatgpt",
};
const callback = "https://chatgpt.com/connector/oauth/Gid2Qc_xY8pe";
const secretDigest = state.secrets.get("REMOTE_MCP_STAGING_OPENAI_CHATGPT_OAUTH_CLIENT_SECRET").value_sha256;
const before = await reconcileStagingChatGPTCallback({
  env: callbackEnv, pool, callback_uri: callback,
  expected_client_id: stagingChatGPT.client_id,
});
assert.equal(before.mutation_performed, false);
assert.equal(before.registered_redirect_uri_count, 2);
assert.equal(JSON.parse(state.clients.get(stagingChatGPT.client_id).redirect_uris_json).length, 1);
await assert.rejects(
  reconcileStagingChatGPTCallback({
    env: callbackEnv, pool, callback_uri: callback,
    apply: true, expected_client_id: stagingChatGPT.client_id,
  }),
  (e) => e.code === "STAGING_CALLBACK_EXPLICIT_CONFIRMATION_REQUIRED",
);
await assert.rejects(
  reconcileStagingChatGPTCallback({
    env: { ...callbackEnv, DEPLOYMENT_ENVIRONMENT: "production_hostinger_autodeploy" },
    pool, callback_uri: callback,
  }),
  (e) => e.code === "STAGING_CALLBACK_ENVIRONMENT_NOT_PROVEN",
);
await assert.rejects(
  reconcileStagingChatGPTCallback({
    env: callbackEnv, pool, callback_uri: "https://evil.example/connector/oauth/Gid2Qc_xY8pe",
  }),
);
await assert.rejects(
  reconcileStagingChatGPTCallback({
    env: callbackEnv, pool, callback_uri: "https://chatgpt.com/connector/oauth/../../wrong",
  }),
);
await assert.rejects(
  reconcileStagingChatGPTCallback({
    env: callbackEnv, pool, callback_uri: callback,
    expected_client_id: "mcp_stg_incorrect_id",
  }),
  (e) => e.code === "STAGING_CALLBACK_CLIENT_IDENTITY_MISMATCH",
);
failCasOnce = true;
await assert.rejects(
  reconcileStagingChatGPTCallback({
    env: callbackEnv, pool, callback_uri: callback,
    expected_client_id: stagingChatGPT.client_id,
    apply: true, confirmation: "APPEND_STAGING_CHATGPT_CALLBACK",
  }),
  (e) => e.code === "STAGING_CALLBACK_CONCURRENT_CLIENT_CHANGE",
);
assert.equal(JSON.parse(state.clients.get(stagingChatGPT.client_id).redirect_uris_json).length, 1);
const appended = await reconcileStagingChatGPTCallback({
  env: callbackEnv, pool, callback_uri: callback,
  expected_client_id: stagingChatGPT.client_id,
  apply: true, confirmation: "APPEND_STAGING_CHATGPT_CALLBACK",
});
assert.equal(appended.mutation_performed, true);
assert.equal(appended.client_secret_rotated, false);
assert.equal(appended.registered_redirect_uri_count, 2);
assert.equal(state.secrets.get("REMOTE_MCP_STAGING_OPENAI_CHATGPT_OAUTH_CLIENT_SECRET").value_sha256, secretDigest);
assert.equal(state.configs.get("remote_mcp.oauth.client.staging.openai_chatgpt").config.redirect_uris.length, 2);
const repeated = await reconcileStagingChatGPTCallback({
  env: callbackEnv, pool, callback_uri: callback,
  expected_client_id: stagingChatGPT.client_id,
  apply: true, confirmation: "APPEND_STAGING_CHATGPT_CALLBACK",
});
assert.equal(repeated.already_registered, true);
assert.equal(repeated.mutation_performed, false);

console.log("remote MCP client provisioning tests passed");
