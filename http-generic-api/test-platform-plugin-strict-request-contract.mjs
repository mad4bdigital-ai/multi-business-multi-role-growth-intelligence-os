import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  resolvePlatformPluginExecution,
  validateCapabilitySelectorContract,
} from "./platformPluginResolver.js";
import { _testingPlatformPluginRoutes } from "./routes/platformPluginRoutes.js";

function makePool() {
  return {
    async query() {
      throw new Error("selector contract failures must stop before database access");
    },
  };
}

{
  await assert.rejects(
    () => resolvePlatformPluginExecution({ pool: makePool(), pluginKey: "github" }),
    (err) => err?.code === "MISSING_CAPABILITY_SELECTOR" && err?.status === 400,
  );
}

{
  await assert.rejects(
    () => resolvePlatformPluginExecution({
      pool: makePool(),
      pluginKey: "github",
      actionKey: "github.repo.read",
      toolKey: "github.repo.read",
    }),
    (err) => err?.code === "AMBIGUOUS_CAPABILITY_SELECTOR" && err?.status === 400,
  );
}

{
  const action = validateCapabilitySelectorContract({ actionKey: "github.repo.read" });
  assert.deepEqual(action.selector, { type: "action_key", value: "github.repo.read" });
  assert.equal(action.toolKey, null);

  const tool = validateCapabilitySelectorContract({ toolKey: "credential_effective_status" });
  assert.deepEqual(tool.selector, { type: "tool_key", value: "credential_effective_status" });
  assert.equal(tool.actionKey, null);
}

{
  const contract = _testingPlatformPluginRoutes.parsePlatformPluginResolveContract({
    plugin_key: "github",
    actionKey: "github.repo.read",
    tenant_id: "tenant-1",
  });
  assert.equal(contract.pluginKey, "github");
  assert.equal(contract.selector.actionKey, "github.repo.read");
  assert.equal(contract.selector.toolKey, null);
  assert.deepEqual(contract.selector.selector, { type: "action_key", value: "github.repo.read" });
  assert.equal(contract.compatibilityTelemetry.legacy_selector_alias_used, true);
  assert.deepEqual(contract.compatibilityTelemetry.legacy_fields, ["actionKey"]);
  assert.equal(contract.compatibilityTelemetry.contract_version, "one-selector-v1");
}

{
  assert.throws(
    () => _testingPlatformPluginRoutes.parsePlatformPluginResolveContract({
      plugin_key: "github",
      action_key: "github.repo.read",
      tool_key: "credential_effective_status",
    }),
    (err) => err?.code === "AMBIGUOUS_CAPABILITY_SELECTOR" && err?.status === 400,
  );
}

{
  assert.throws(
    () => _testingPlatformPluginRoutes.parsePlatformPluginResolveContract({
      plugin_key: "github",
      action_key: "github.repo.read",
      unsafe_override: true,
    }),
    (err) => err?.code === "UNKNOWN_SECURITY_CONTRACT_FIELD"
      && err?.status === 400
      && err?.details?.fields?.includes("unsafe_override"),
  );
}

{
  const openapi = readFileSync("openapi.yaml", "utf8");
  const tenantOpenapi = readFileSync("openapi.tenant-gpt.auth.yaml", "utf8");
  const migration = readFileSync("migrations/1031_sprint69_strict_platform_plugin_resolve_contract.sql", "utf8");
  const notes = readFileSync("docs/platform-plugin-resolver-notes.md", "utf8");
  assert.match(openapi, /\/platform\/plugins\/resolve:[\s\S]*oneOf:/);
  assert.match(openapi, /\/tenant\/platform\/plugins\/resolve:[\s\S]*oneOf:/);
  assert.match(openapi, /compatibility_telemetry:/);
  assert.match(tenantOpenapi, /\/tenant\/platform\/plugins\/resolve:[\s\S]*oneOf:/);
  assert.match(tenantOpenapi, /compatibility_telemetry:/);
  assert.match(migration, /oneOf/);
  assert.match(migration, /additionalProperties', false/);
  assert.match(migration, /tenant_platform_endpoint_tools/);
  assert.match(notes, /Exactly one selector is required/);
  assert.doesNotMatch(notes, /first available binding as a preview/);
}

console.log("platform plugin strict request contract tests passed");
