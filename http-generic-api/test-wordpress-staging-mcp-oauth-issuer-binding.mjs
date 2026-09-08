import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./routes/wordpressStagingMcpOAuthRoutes.js", import.meta.url),
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
assert.doesNotMatch(
  source,
  /client_id_metadata_document_supported:\s*true/u,
  "CIMD must not be advertised until URL client identifiers are safely persisted and resolved.",
);

console.log("WordPress staging MCP OAuth issuer binding contract passed.");
