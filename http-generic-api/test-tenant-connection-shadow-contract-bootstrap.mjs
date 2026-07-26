import assert from "node:assert/strict";
import fs from "node:fs";
import {
  TENANT_CONNECTION_SHADOW_ADAPTER,
  TENANT_CONNECTION_SHADOW_CONTRACTS,
  TENANT_CONNECTION_SHADOW_CONTRACT_BOOTSTRAP_CONFIRM,
  bootstrapTenantConnectionShadowContracts,
  _testingTenantConnectionShadowContractBootstrap,
} from "./tenantConnectionShadowContractBootstrap.js";

assert.equal(TENANT_CONNECTION_SHADOW_ADAPTER.adapter_key, "tenant_connection_self_repair_routes_v1");
assert.equal(TENANT_CONNECTION_SHADOW_ADAPTER.supports_write, false);
assert.equal(TENANT_CONNECTION_SHADOW_ADAPTER.metadata.shadow_only, true);
assert.equal(TENANT_CONNECTION_SHADOW_ADAPTER.metadata.provider_calls_allowed, false);
assert.equal(TENANT_CONNECTION_SHADOW_ADAPTER.metadata.external_writes_allowed, false);
assert.equal(TENANT_CONNECTION_SHADOW_CONTRACTS.length, 9);
assert.equal(new Set(TENANT_CONNECTION_SHADOW_CONTRACTS.map((item) => item.contract_key)).size, 9);
assert.equal(new Set(TENANT_CONNECTION_SHADOW_CONTRACTS.map((item) => item.capability_key)).size, 9);
assert.equal(_testingTenantConnectionShadowContractBootstrap.TOOL_KEYS.length, 9);
for (const contract of TENANT_CONNECTION_SHADOW_CONTRACTS) {
  assert.equal(contract.adapter_key, TENANT_CONNECTION_SHADOW_ADAPTER.adapter_key);
  assert.equal(contract.status, "shadow");
  assert.equal(contract.certification_status, "pending");
  assert.equal(contract.observed_state_schema.properties.secrets_included.const, false);
  assert.equal(contract.provider_binding_constraints.no_raw_secret_return, true);
  assert.equal(contract.provider_binding_constraints.active_export_creation_forbidden, true);
  const serialized = JSON.stringify(contract);
  assert.doesNotMatch(serialized, /access_token|refresh_token|password|private_key|credential_value/i);
}

const fakePool = {
  async query(sql) {
    const value = String(sql);
    if (value.includes("FROM platform_resource_adapters")) return [[], []];
    if (value.includes("FROM platform_capability_readback_contracts")) return [[], []];
    if (value.includes("FROM tenant_platform_endpoint_tools")) {
      return [[..._testingTenantConnectionShadowContractBootstrap.TOOL_KEYS].map((tool_key) => ({ tool_key, is_enabled: 0 }))];
    }
    if (value.includes("FROM platform_plugin_capability_exports")) return [[], []];
    throw new Error(`Unexpected SQL: ${value.slice(0, 160)}`);
  },
};

const preview = await bootstrapTenantConnectionShadowContracts({ mode: "dry_run" }, { pool: fakePool });
assert.equal(preview.ok, true);
assert.equal(preview.mode, "dry_run");
assert.equal(preview.contract_count, 9);
assert.equal(preview.current_state.enabled_tool_count, 0);
assert.equal(preview.current_state.active_tenant_export_count, 0);
assert.equal(preview.mutations_performed, false);
assert.equal(preview.provider_calls_performed, false);
assert.equal(preview.external_writes_performed, false);
assert.match(preview.plan_hash, /^[0-9a-f]{64}$/);
assert.equal(preview.expected_confirmation, TENANT_CONNECTION_SHADOW_CONTRACT_BOOTSTRAP_CONFIRM);

await assert.rejects(
  () => bootstrapTenantConnectionShadowContracts({ mode: "apply", confirm: "WRONG" }, { pool: fakePool }),
  (error) => error?.code === "tenant_connection_shadow_contract_confirmation_required",
);

const migration = fs.readFileSync(
  new URL("./migrations/20260714_tenant_connection_shadow_contract_bootstrap.sql", import.meta.url),
  "utf8",
);
for (const marker of [
  "tenant_connection_shadow_contract_bootstrap",
  "BOOTSTRAP_TENANT_CONNECTION_SHADOW_CONTRACTS",
  "tenant_connection_self_repair_routes_v1",
  "platform_resource_adapters",
  "platform_capability_readback_contracts",
  "adapter_supports_write',false",
  "tenant_tool_enablement_forbidden',true",
  "no_provider_call",
  "no_external_write",
  "secrets_included=false",
]) {
  assert(migration.includes(marker), marker);
}
assert.doesNotMatch(migration, /UPDATE\s+`?tenant_platform_endpoint_tools`?\s+SET\s+`?is_enabled`?\s*=\s*1/i);
assert.doesNotMatch(migration, /INSERT\s+INTO\s+`?platform_capability_readback_contracts`?/i);

console.log("tenant connection shadow contract bootstrap core tests passed");
