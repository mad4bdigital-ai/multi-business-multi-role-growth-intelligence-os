import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  REMOTE_MCP_AUTHORIZATION_SERVER,
  REMOTE_MCP_RESOURCE,
  classifyRemoteMcpClientProfile,
  normalizeRemoteMcpRedirectUri,
  normalizeRemoteMcpScopes,
  normalizeTokenEndpointAuthMethod,
  remoteMcpDynamicClientRegistrationEnabled,
  remoteMcpDynamicRedirectUriAllowed,
  remoteMcpOAuthEnabled,
  resolveRemoteMcpAllowedRedirectOrigins,
  resolveRemoteMcpAuthorizationIssuer,
  resolveRemoteMcpOAuthResource,
  resolveRemoteMcpOAuthSigningSecret,
  verifyPkceS256,
} from "./remoteMcpOAuthProfile.js";

assert.equal(resolveRemoteMcpOAuthResource({}), REMOTE_MCP_RESOURCE);
assert.equal(resolveRemoteMcpAuthorizationIssuer({}), REMOTE_MCP_AUTHORIZATION_SERVER);
assert.equal(resolveRemoteMcpOAuthSigningSecret({}), "");
assert.equal(resolveRemoteMcpOAuthSigningSecret({ REMOTE_MCP_OAUTH_SIGNING_SECRET: "oauth-secret" }), "oauth-secret");
assert.equal(remoteMcpOAuthEnabled({ REMOTE_MCP_OAUTH_ENABLED: "true" }), true);
assert.equal(remoteMcpOAuthEnabled({ REMOTE_MCP_OAUTH_ENABLED: "false" }), false);
assert.equal(remoteMcpDynamicClientRegistrationEnabled({ REMOTE_MCP_OAUTH_DCR_ENABLED: "TRUE" }), true);

assert.equal(
  normalizeRemoteMcpRedirectUri("https://claude.ai/api/mcp/auth_callback"),
  "https://claude.ai/api/mcp/auth_callback",
);
assert.equal(normalizeRemoteMcpRedirectUri("http://evil.example/callback"), "");
assert.equal(
  normalizeRemoteMcpRedirectUri("http://127.0.0.1:7777/callback", { REMOTE_MCP_OAUTH_ALLOW_LOOPBACK: "true" }),
  "http://127.0.0.1:7777/callback",
);
assert.equal(normalizeRemoteMcpRedirectUri("https://user:pass@example.test/callback"), "");

const redirectEnv = {
  REMOTE_MCP_OAUTH_ALLOWED_REDIRECT_ORIGINS: "https://claude.ai, https://chatgpt.com",
};
assert.deepEqual(
  [...resolveRemoteMcpAllowedRedirectOrigins(redirectEnv)].sort(),
  ["https://chatgpt.com", "https://claude.ai"],
);
assert.equal(remoteMcpDynamicRedirectUriAllowed("https://claude.ai/api/mcp/auth_callback", redirectEnv), true);
assert.equal(remoteMcpDynamicRedirectUriAllowed("https://evil.example/callback", redirectEnv), false);
assert.equal(remoteMcpDynamicRedirectUriAllowed("https://claude.ai.evil.example/callback", redirectEnv), false);
assert.equal(remoteMcpDynamicRedirectUriAllowed("https://claude.ai/api/mcp/auth_callback", {}), false);
assert.equal(
  remoteMcpDynamicRedirectUriAllowed("http://127.0.0.1:7777/callback", { REMOTE_MCP_OAUTH_ALLOW_LOOPBACK: "true" }),
  true,
);
assert.equal(remoteMcpDynamicRedirectUriAllowed("http://127.0.0.1:7777/callback", {}), false);

assert.equal(classifyRemoteMcpClientProfile({ clientName: "Claude", redirectUris: [] }), "anthropic_claude");
assert.equal(classifyRemoteMcpClientProfile({ clientName: "ChatGPT", redirectUris: [] }), "openai_chatgpt");
assert.equal(classifyRemoteMcpClientProfile({ clientName: "Internal Agent", redirectUris: [] }), "generic_remote_mcp_client");

assert.deepEqual(normalizeRemoteMcpScopes("workspaces.read brands.read"), {
  ok: true,
  scopes: ["workspaces.read", "brands.read"],
});
assert.equal(normalizeRemoteMcpScopes("admin.write").ok, false);
assert.equal(normalizeTokenEndpointAuthMethod("none"), "none");
assert.equal(normalizeTokenEndpointAuthMethod("private_key_jwt"), "");

const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
assert.equal(verifyPkceS256(verifier, challenge), true);
assert.equal(verifyPkceS256(`${verifier}x`, challenge), false);
assert.equal(verifyPkceS256("short", challenge), false);

console.log("remote MCP OAuth 2.1 profile tests passed");
