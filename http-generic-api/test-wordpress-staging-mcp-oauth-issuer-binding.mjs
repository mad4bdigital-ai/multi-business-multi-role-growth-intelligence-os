import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  wordpressStagingMcpDcrAdvertised,
  wordpressStagingMcpDcrEnabled,
} from "./wordpressStagingMcpOAuthProfile.js";

const source = readFileSync(
  new URL("./routes/wordpressStagingMcpOAuthRoutes.js", import.meta.url),
  "utf8",
);
const compositionSource = readFileSync(
  new URL("./routes/mcpRoutes.js", import.meta.url),
  "utf8",
);
const tokenSource = readFileSync(
  new URL("./wordpressStagingMcpOAuthTokens.js", import.meta.url),
  "utf8",
);

assert.match(
  source,
  /authorization_response_iss_parameter_supported:\s*true/u,
  "WordPress staging authorization-server metadata must advertise RFC 9207 issuer responses.",
);
assert.match(
  source,
  /protected_resources:\s*\[resource\]/u,
  "WordPress staging authorization-server metadata must bind itself to the exact RFC 9728 protected resource.",
);
assert.match(
  source,
  /iss:\s*resolveWordpressStagingMcpIssuer\(env\)/u,
  "The successful authorization response must return the exact issuer identifier to the client.",
);
assert.match(
  source,
  /wordpressStagingMcpDcrAdvertised\(env\)/u,
  "WordPress staging metadata must advertise registration only through the WordPress-specific DCR authority.",
);
assert.match(
  source,
  /wordpressStagingMcpDcrEnabled\(env\)/u,
  "WordPress staging registration must authorize DCR only through the WordPress-specific DCR authority.",
);
assert.doesNotMatch(
  source,
  /remoteMcpDynamicClientRegistration(?:Advertised|Enabled)\(env\)/u,
  "The isolated WordPress issuer must not inherit the primary Remote MCP DCR authority.",
);
assert.doesNotMatch(
  compositionSource,
  /REMOTE_MCP_OAUTH_DCR_ENABLED\s*:\s*env\.REMOTE_MCP_WORDPRESS_STAGING_DCR_ENABLED/u,
  "MCP composition must not project the WordPress DCR switch into the primary Remote MCP DCR variable.",
);
assert.doesNotMatch(
  tokenSource,
  /resolveRemoteMcpOAuthSigningSecret/u,
  "WordPress authorization-request integrity must not share the primary Remote MCP symmetric signing secret.",
);
assert.match(
  tokenSource,
  /purpose:\s*"wordpress_staging_mcp_authorization_request"[\s\S]*configuration\.privateKey[\s\S]*algorithm:\s*WORDPRESS_STAGING_MCP_ACCESS_TOKEN_ALG/u,
  "WordPress authorization requests must be signed by the dedicated asymmetric authority.",
);
assert.match(
  tokenSource,
  /jwt\.verify\([\s\S]*configuration\.publicKey[\s\S]*algorithms:\s*\[WORDPRESS_STAGING_MCP_ACCESS_TOKEN_ALG\]/u,
  "WordPress authorization requests must verify only against the dedicated asymmetric public key.",
);
assert.doesNotMatch(
  source,
  /client_id_metadata_document_supported:\s*true/u,
  "CIMD must not be advertised until URL client identifiers are safely persisted and resolved.",
);

const dcrBaseEnv = {
  REMOTE_MCP_ENVIRONMENT: "staging",
  REMOTE_MCP_OAUTH_ENABLED: "true",
  REMOTE_MCP_AUTHORIZATION_SERVER_URL: "https://dev.example.test/auth/mcp",
  REMOTE_MCP_WORDPRESS_STAGING_OAUTH_ENABLED: "true",
  REMOTE_MCP_WORDPRESS_STAGING_RESOURCE_URL: "https://staging.example.test/wp-json/mcp/mad4b-read",
  REMOTE_MCP_OAUTH_ALLOWED_REDIRECT_ORIGINS: "https://chatgpt.com",
};
const primaryOnlyDcrEnv = {
  ...dcrBaseEnv,
  REMOTE_MCP_OAUTH_DCR_ENABLED: "true",
  REMOTE_MCP_WORDPRESS_STAGING_DCR_ENABLED: "false",
};
assert.equal(
  wordpressStagingMcpDcrEnabled(primaryOnlyDcrEnv),
  false,
  "Primary Remote MCP DCR must not enable WordPress staging DCR.",
);
assert.equal(
  wordpressStagingMcpDcrAdvertised(primaryOnlyDcrEnv),
  false,
  "Primary Remote MCP DCR must not make the WordPress registration endpoint discoverable.",
);

const wordpressOnlyDcrEnv = {
  ...dcrBaseEnv,
  REMOTE_MCP_OAUTH_DCR_ENABLED: "false",
  REMOTE_MCP_WORDPRESS_STAGING_DCR_ENABLED: "true",
};
assert.equal(
  wordpressStagingMcpDcrEnabled(wordpressOnlyDcrEnv),
  true,
  "WordPress staging DCR must be independently enabled by its dedicated switch.",
);
assert.equal(
  wordpressStagingMcpDcrAdvertised(wordpressOnlyDcrEnv),
  true,
  "WordPress staging DCR must be independently advertised when an approved redirect origin exists.",
);

console.log("WordPress staging MCP OAuth issuer binding contract passed.");
