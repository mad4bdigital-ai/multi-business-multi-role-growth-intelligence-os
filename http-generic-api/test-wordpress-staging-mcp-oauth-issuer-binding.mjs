import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./routes/wordpressStagingMcpOAuthRoutes.js", import.meta.url),
  "utf8",
);
const compositionSource = readFileSync(
  new URL("./routes/mcpRoutes.js", import.meta.url),
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
  source,
  /client_id_metadata_document_supported:\s*true/u,
  "CIMD must not be advertised until URL client identifiers are safely persisted and resolved.",
);

console.log("WordPress staging MCP OAuth issuer binding contract passed.");
