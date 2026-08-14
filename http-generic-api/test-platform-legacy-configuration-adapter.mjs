import assert from "node:assert/strict";
import { createPlatformLegacyConfigurationAdapter } from "./platformLegacyConfigurationAdapter.js";

const pool = {
  async query(sql, params) {
    assert.match(sql, /FROM platform_runtime_config/);
    assert.deepEqual(params, ["operation.policy"]);
    return [[{ config_key: "operation.policy", config_json: JSON.stringify({ allow_write: false, max_resources: 2 }), status: "active", updated_at: "2026-08-15T00:00:00.000Z" }]];
  },
};
const adapter = createPlatformLegacyConfigurationAdapter({ pool });
const record = await adapter.read("operation.policy");
assert.equal(record.present, true);
assert.equal(record.authority, "legacy_compatibility_only");
assert.equal(record.value.max_resources, 2);
assert.equal(record.secrets_included, false);

const secretAdapter = createPlatformLegacyConfigurationAdapter({
  pool: { async query() { return [[{ config_json: JSON.stringify({ client_secret: "secret-raw-value" }), status: "active" }]]; } },
});
await assert.rejects(() => secretAdapter.read("oauth.client"), (error) => error.code === "LEGACY_CONFIG_SECRET_PRESENT" && !String(error).includes("secret-raw-value"));

const ambiguousAdapter = createPlatformLegacyConfigurationAdapter({
  pool: { async query() { return [[{ config_json: "{}" }, { config_json: "{}" }]]; } },
});
await assert.rejects(() => ambiguousAdapter.read("operation.policy"), (error) => error.code === "LEGACY_CONFIG_AMBIGUOUS");

console.log(JSON.stringify({ ok: true, contract: "mad4b.platform-legacy-configuration-adapter-regression.v1", cases: 3, runtime_mutation_allowed: false, secrets_included: false }));
