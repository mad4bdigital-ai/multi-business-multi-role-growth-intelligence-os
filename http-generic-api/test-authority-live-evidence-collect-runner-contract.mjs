import assert from "node:assert/strict";
import { promises as fs } from "node:fs";

const runnerSource = await fs.readFile(
  new URL("./scripts/authority-live-evidence-collect.mjs", import.meta.url),
  "utf8",
);
const collectorsSource = await fs.readFile(
  new URL("./authorityLiveSourceCollectors.js", import.meta.url),
  "utf8",
);

assert.match(runnerSource, /\/admin\/cli\/control/);
assert.match(runnerSource, /tool:\s*"db"/);
assert.match(runnerSource, /action:\s*"run"/);
assert.match(runnerSource, /QUERY_KEY_SET\.has\(queryKey\)/);
assert.match(runnerSource, /\^SELECT\\b/i);
assert.match(runnerSource, /params\.length\s*===\s*0/);
assert.match(runnerSource, /MUTATION_TOKEN/);
assert.match(runnerSource, /adaptAuthorityLiveCensusObservation/);
assert.match(runnerSource, /collectGovernedAuthorityLiveEvidence/);
assert.match(runnerSource, /mode:\s*0o600/);
assert.match(runnerSource, /AUTHORITY_LIVE_EVIDENCE_PACKET_SHA256/);
assert.doesNotMatch(runnerSource, /request_body|provider\/|hostinger|credential_payload\s*:/i);

assert.match(collectorsSource, /AUTHORITY_LIVE_SOURCE_ROW_LIMIT\s*=\s*8192/);
assert.match(collectorsSource, /LIMIT 8193/g);
assert.match(collectorsSource, /admin_platform_endpoint_tools/);
assert.match(collectorsSource, /tenant_platform_endpoint_tools/);
assert.match(collectorsSource, /platform_endpoint_tool_exports/);
assert.match(collectorsSource, /app_integration_action_bindings/);
assert.match(collectorsSource, /app_integration_tool_bindings/);
assert.match(collectorsSource, /FROM endpoints/);
assert.match(collectorsSource, /FROM actions/);
assert.doesNotMatch(collectorsSource, /COLUMN_DEFAULT|VIEW_DEFINITION/);
assert.doesNotMatch(collectorsSource, /\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE)\b(?=[^"`]*")/i);

const expectedFamilies = [
  "system_tool_registry",
  "admin_endpoint_catalog",
  "direct_http_routes",
  "runtime_action_registry",
  "descriptor_catalog",
  "provider_binding_catalog",
  "local_device_catalog",
  "compatibility_alias_registry",
];
for (const family of expectedFamilies) {
  assert.match(collectorsSource, new RegExp(`\\b${family}\\b`));
}

for (const marker of [
  "read_only: true",
  "provider_calls: false",
  "credential_payload_read: false",
  "external_writes: false",
  "secrets_included: false",
]) {
  assert.ok(collectorsSource.includes(marker), `Missing safety marker: ${marker}`);
}

console.log("authority live evidence collection runner contract tests passed");
