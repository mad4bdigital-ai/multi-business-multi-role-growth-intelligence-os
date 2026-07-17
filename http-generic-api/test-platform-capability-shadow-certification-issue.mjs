import assert from "node:assert/strict";
import fs from "node:fs";
import {
  PLATFORM_CAPABILITY_SHADOW_CERTIFICATION_CONFIRM,
  issuePlatformCapabilityShadowCertification,
  _testingPlatformCapabilityShadowCertification,
} from "./platformCapabilityShadowCertificationIssuer.js";

assert.equal(_testingPlatformCapabilityShadowCertification.CAPABILITY_KEY, "tenant_tool.tenant_connection_effective_credential_plan_view");
assert.equal(_testingPlatformCapabilityShadowCertification.CONTRACT_KEY, "tenant_connection_effective_credential_plan_view_readback_v1");
assert.equal(_testingPlatformCapabilityShadowCertification.ADAPTER_KEY, "tenant_connection_self_repair_routes_v1");
assert.equal(_testingPlatformCapabilityShadowCertification.FIXED_PLAN.contract_status_required, "shadow");
assert.equal(_testingPlatformCapabilityShadowCertification.FIXED_PLAN.certification_status, "shadow_certified");
assert.equal(_testingPlatformCapabilityShadowCertification.FIXED_PLAN.contract_certification_status_after, "certified");
assert.notEqual(
  _testingPlatformCapabilityShadowCertification.FIXED_PLAN.contract_certification_status_after,
  _testingPlatformCapabilityShadowCertification.FIXED_PLAN.certification_status,
);
assert.equal(_testingPlatformCapabilityShadowCertification.FIXED_PLAN.runtime_dispatch_changed, false);

const fakePool = {
  async query(sql) {
    const value = String(sql);
    if (value.includes("FROM platform_resource_adapters")) {
      return [[{ adapter_key: "tenant_connection_self_repair_routes_v1", supports_read: 1, supports_write: 0, status: "active", metadata_json: "{}" }], []];
    }
    if (value.includes("FROM platform_capability_readback_contracts")) {
      return [[{
        contract_id: "contract-1",
        contract_key: "tenant_connection_effective_credential_plan_view_readback_v1",
        contract_version: 1,
        capability_key: "tenant_tool.tenant_connection_effective_credential_plan_view",
        adapter_key: "tenant_connection_self_repair_routes_v1",
        expected_effect_class: "read_only",
        certification_status: "pending",
        status: "shadow",
        is_current: 1,
        secrets_included: 0,
      }], []];
    }
    if (value.includes("FROM tenant_platform_endpoint_tools")) {
      return [[{ tool_key: "tenant_connection_effective_credential_plan_view", is_enabled: 0 }], []];
    }
    if (value.includes("FROM platform_capability_certifications")) return [[], []];
    if (value.includes("FROM platform_evidence_events")) return [[], []];
    if (value.includes("FROM platform_plugin_capability_exports")) return [[], []];
    if (value.includes("FROM runtime_dispatch_certification_registry")) return [[], []];
    throw new Error(`Unexpected SQL: ${value.slice(0, 180)}`);
  },
};

const preview = await issuePlatformCapabilityShadowCertification({ mode: "dry_run" }, { pool: fakePool });
assert.equal(preview.ok, true);
assert.equal(preview.mode, "dry_run");
assert.equal(preview.apply_ready, true);
assert.equal(preview.current_state.tool_enabled, false);
assert.equal(preview.current_state.active_tenant_export_count, 0);
assert.equal(preview.current_state.runtime_dispatch_allowed_count, 0);
assert.equal(preview.mutations_performed, false);
assert.equal(preview.runtime_dispatch_changed, false);
assert.equal(preview.provider_calls_performed, false);
assert.match(preview.plan_hash, /^[0-9a-f]{64}$/);
assert.equal(preview.expected_confirmation, PLATFORM_CAPABILITY_SHADOW_CERTIFICATION_CONFIRM);

await assert.rejects(
  () => issuePlatformCapabilityShadowCertification({ mode: "apply", confirm: "WRONG" }, { pool: fakePool }),
  (error) => error?.code === "platform_capability_shadow_certification_confirmation_required",
);

const safeReadback = _testingPlatformCapabilityShadowCertification.verifyReadback({
  adapter: { adapter_key: "tenant_connection_self_repair_routes_v1", supports_read: 1, supports_write: 0, status: "active" },
  contract: {
    contract_key: "tenant_connection_effective_credential_plan_view_readback_v1",
    capability_key: "tenant_tool.tenant_connection_effective_credential_plan_view",
    adapter_key: "tenant_connection_self_repair_routes_v1",
    expected_effect_class: "read_only",
    certification_status: "certified",
    status: "shadow",
    secrets_included: 0,
  },
  tool: { tool_key: "tenant_connection_effective_credential_plan_view", is_enabled: 0 },
  certification: {
    capability_key: "tenant_tool.tenant_connection_effective_credential_plan_view",
    certification_type: "shadow_read_only",
    certification_status: "shadow_certified",
    secrets_included: 0,
  },
  evidence: { evidence_status: "passed", secrets_included: 0 },
  active_exports: [],
  runtime_certifications: [],
});
assert.equal(safeReadback.ok, true);
assert.equal(safeReadback.contract_status, "shadow");
assert.equal(safeReadback.tool_enabled, false);
assert.equal(safeReadback.runtime_dispatch_allowed_count, 0);

const migration = fs.readFileSync(
  new URL("./migrations/20260715_platform_capability_shadow_certification_issue.sql", import.meta.url),
  "utf8",
);
for (const marker of [
  "platform_capability_shadow_certification_issue",
  "ISSUE_SHADOW_CERTIFICATION_TENANT_CONNECTION_EFFECTIVE_CREDENTIAL_PLAN_VIEW",
  "tenant_tool.tenant_connection_effective_credential_plan_view",
  "tenant_connection_effective_credential_plan_view_readback_v1",
  "shadow_certified",
  "contract_status_after','shadow",
  "runtime_dispatch_change_forbidden',true",
  "no_provider_call",
  "no_external_write",
  "secrets_included=false",
]) {
  assert(migration.includes(marker), marker);
}
assert.doesNotMatch(migration, /UPDATE\s+`?tenant_platform_endpoint_tools`?\s+SET\s+`?is_enabled`?\s*=\s*1/i);
assert.doesNotMatch(migration, /INSERT\s+INTO\s+`?platform_capability_certifications`?/i);

const routeSource = fs.readFileSync(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8");
assert(routeSource.includes("name: \"platform_capability_shadow_certification_issue\""));
assert(routeSource.includes("toolKey === \"platform_capability_shadow_certification_issue\""));
assert(routeSource.includes("issuePlatformCapabilityShadowCertification"));

console.log("platform capability shadow certification issue tests passed");
