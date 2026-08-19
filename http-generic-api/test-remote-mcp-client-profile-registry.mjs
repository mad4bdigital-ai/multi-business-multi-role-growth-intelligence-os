import assert from "node:assert/strict";
import {
  getRemoteMcpClientProfile,
  listRemoteMcpClientProfiles,
  loadRemoteMcpClientProfileRegistry,
  normalizeRemoteMcpProfileRedirectUris,
  remoteMcpProfileConfigKey,
  remoteMcpProfileRegistryPath,
  remoteMcpProfileSecretRef,
} from "./remoteMcpClientProfileRegistry.js";

const registry = loadRemoteMcpClientProfileRegistry();
const profiles = listRemoteMcpClientProfiles();
const keys = profiles.map((profile) => profile.profile_key);
const storageSuffixes = profiles.map((profile) => profile.storage_suffix);

assert.equal(registry.contract, "mad4b.remote-mcp-client-profile-registry.v1");
assert.equal(new Set(keys).size, keys.length);
assert.equal(new Set(storageSuffixes).size, storageSuffixes.length);
for (const profile of profiles) {
  assert.match(profile.callback.source_url, /^https:\/\//u);
  assert.equal(profile.token_endpoint_auth_method, "client_secret_basic");
  assert.equal(profile.scope_policy, "read_only_catalog");
  assert.equal(profile.readback_evidence.includes("profile_key"), true);
}
assert.deepEqual(
  ["anthropic_claude", "openai_chatgpt", "google_gemini_enterprise", "manus_remote_mcp", "generic_remote_mcp_client"],
  keys,
);
assert.equal(remoteMcpProfileRegistryPath().endsWith("remote-mcp-client-profile-registry.json"), true);

assert.deepEqual(
  normalizeRemoteMcpProfileRedirectUris(["https://claude.ai/api/mcp/auth_callback"], "anthropic_claude"),
  ["https://claude.ai/api/mcp/auth_callback"],
);
assert.deepEqual(
  normalizeRemoteMcpProfileRedirectUris(["https://chatgpt.com/connector_platform_oauth_redirect"], "openai_chatgpt"),
  ["https://chatgpt.com/connector_platform_oauth_redirect"],
);
assert.deepEqual(
  normalizeRemoteMcpProfileRedirectUris(["https://chatgpt.com/connector/oauth/callback-123"], "openai_chatgpt"),
  ["https://chatgpt.com/connector/oauth/callback-123"],
);
assert.deepEqual(
  normalizeRemoteMcpProfileRedirectUris(["https://vertexaisearch.cloud.google.com/oauth-redirect"], "google_gemini_enterprise"),
  ["https://vertexaisearch.cloud.google.com/oauth-redirect"],
);
assert.deepEqual(
  normalizeRemoteMcpProfileRedirectUris(["https://manus.example.test/oauth/callback"], "manus_remote_mcp"),
  ["https://manus.example.test/oauth/callback"],
);

assert.throws(
  () => normalizeRemoteMcpProfileRedirectUris(["https://evil.example.test/callback"], "openai_chatgpt"),
);
assert.throws(
  () => normalizeRemoteMcpProfileRedirectUris(["http://localhost:3000/callback"], "manus_remote_mcp"),
);
assert.throws(() => getRemoteMcpClientProfile("not_registered"), (error) => error.code === "remote_mcp_client_profile_unknown");

assert.notEqual(remoteMcpProfileConfigKey("staging", "anthropic_claude"), remoteMcpProfileConfigKey("staging", "openai_chatgpt"));
assert.notEqual(remoteMcpProfileSecretRef("staging", "anthropic_claude"), remoteMcpProfileSecretRef("staging", "openai_chatgpt"));
assert.equal(remoteMcpProfileConfigKey("staging", "generic_remote_mcp_client"), "remote_mcp.oauth.client.staging");
assert.equal(remoteMcpProfileSecretRef("staging", "generic_remote_mcp_client"), "platform_secret:REMOTE_MCP_STAGING_OAUTH_CLIENT_SECRET");

console.log(JSON.stringify({
  ok: true,
  contract: registry.contract,
  profile_count: profiles.length,
  profiles: keys,
  namespaces_are_unique: true,
  secrets_included: false,
}));
