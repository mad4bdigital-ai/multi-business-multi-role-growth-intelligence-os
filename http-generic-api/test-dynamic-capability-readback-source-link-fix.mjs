import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  new URL("./migrations/20260702_dynamic_capability_readback_source_link_fix.sql", import.meta.url),
  "utf8",
);

for (const marker of [
  "INSERT INTO platform_capability_source_links",
  "VALUES (",
  "platform_capability_governance_compile_persist",
  "readback_contract_registry",
  "platform_capability_readback_contracts",
  "ON DUPLICATE KEY UPDATE",
  "canonical_capability_key",
  "no_provider_call=true",
  "no_credential_payload_read=true",
  "no_raw_secrets=true",
  "no_external_send=true",
  "no_external_write=true",
  "secrets_included=false",
]) {
  assert(migration.includes(marker), marker);
}

assert(!migration.includes("FROM platform_plugin_capabilities"));
assert(!migration.includes("dynamic.capability.tool_bus"));
assert.equal((migration.match(/INSERT INTO platform_capability_source_links/g) || []).length, 1);
assert.equal((migration.match(/platform_capability_governance_compile_persist/g) || []).length >= 2, true);

console.log("dynamic capability readback source-link fix tests passed");
