import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DYNAMIC_CAPABILITY_PROJECTION_PREVIEW_VERSION,
  buildDynamicCapabilityProjectionPreview,
} from "./dynamicCapabilityProjectionPreview.js";

function manifestRow(manifest, overrides = {}) {
  return {
    manifest_id: overrides.manifest_id || `manifest-${manifest.capability_key}`,
    run_id: "run-1",
    capability_key: manifest.capability_key,
    manifest_version: 1,
    manifest_hash: manifest.manifest_hash,
    source_revision_hash: "a".repeat(64),
    compiler_version: "dynamic-capability-governance-compiler-v3",
    effect_class: manifest.effect_class,
    risk_class: manifest.risk_class,
    authority_requirement_type: "none",
    status: manifest.status,
    rollout_mode: "shadow",
    manifest_json: JSON.stringify(manifest),
    created_at: new Date("2026-06-30T00:00:00.000Z"),
    ...overrides,
  };
}

const strictSchema = JSON.stringify({
  type: "object",
  additionalProperties: false,
  properties: { resource_ref: { type: "string" } },
  required: ["resource_ref"],
});
const broadSchema = JSON.stringify({
  type: "object",
  additionalProperties: true,
  properties: { arbitrary: {} },
});

const manifests = [
  manifestRow({
    capability_key: "admin_tool.admin_read",
    display_name: "Admin Read",
    capability_family: "admin_tool",
    source: { table: "admin_platform_endpoint_tools", key: "admin_read" },
    effect_class: "read_only",
    risk_class: "A",
    requirements: { readback: false },
    projection: { admin: "candidate", tenant: "not_applicable" },
    status: "shadow_ready",
    manifest_hash: "1".repeat(64),
    secrets_included: false,
  }),
  manifestRow({
    capability_key: "tenant_tool.tenant_read",
    display_name: "Tenant Read",
    capability_family: "tenant_tool",
    source: { table: "tenant_platform_endpoint_tools", key: "tenant_read" },
    effect_class: "read_only",
    risk_class: "A",
    requirements: { readback: false },
    projection: { admin: "not_applicable", tenant: "candidate" },
    status: "shadow_ready",
    manifest_hash: "2".repeat(64),
    secrets_included: false,
  }),
  manifestRow({
    capability_key: "tenant_tool.tenant_broad",
    display_name: "Tenant Broad",
    capability_family: "tenant_tool",
    source: { table: "tenant_platform_endpoint_tools", key: "tenant_broad" },
    effect_class: "read_only",
    risk_class: "B",
    requirements: { readback: false },
    projection: { admin: "not_applicable", tenant: "candidate" },
    status: "shadow_ready",
    manifest_hash: "3".repeat(64),
    secrets_included: false,
  }),
  manifestRow({
    capability_key: "admin_tool.admin_inherited",
    display_name: "Admin Inherited",
    capability_family: "admin_tool",
    source: { table: "admin_platform_endpoint_tools", key: "admin_inherited" },
    effect_class: "read_only",
    risk_class: "B",
    requirements: { readback: false },
    projection: { admin: "candidate", tenant: "not_applicable" },
    status: "shadow_ready",
    manifest_hash: "4".repeat(64),
    secrets_included: false,
  }),
  manifestRow({
    capability_key: "admin_tool.blocked_admin",
    display_name: "Blocked Admin",
    capability_family: "admin_tool",
    source: { table: "admin_platform_endpoint_tools", key: "blocked_admin" },
    effect_class: "internal_write",
    risk_class: "C",
    requirements: { readback: true },
    projection: { admin: "blocked", tenant: "not_applicable" },
    status: "blocked",
    manifest_hash: "5".repeat(64),
    secrets_included: false,
  }),
];

const adminTools = [
  { tool_key: "admin_read", display_name: "Admin Read", http_method: "GET", http_path: "/admin/read", input_schema: strictSchema, tags: "read_only", is_enabled: 1 },
  { tool_key: "admin_inherited", display_name: "Admin Inherited", http_method: "GET", http_path: "/admin/inherited", input_schema: strictSchema, tags: "read_only", is_enabled: 1 },
  { tool_key: "blocked_admin", display_name: "Blocked Admin", http_method: "POST", http_path: "/admin/blocked", input_schema: strictSchema, tags: "mutation", is_enabled: 1 },
];
const tenantTools = [
  { tool_key: "tenant_read", display_name: "Tenant Read", http_method: "GET", http_path: "/me/read", input_schema: strictSchema, tags: "read_only", is_enabled: 1 },
  { tool_key: "tenant_broad", display_name: "Tenant Broad", http_method: "POST", http_path: "/me/broad", input_schema: broadSchema, tags: "preview", is_enabled: 1 },
  { tool_key: "admin_inherited", display_name: "Inherited", http_method: "GET", http_path: "/me/inherited", input_schema: strictSchema, tags: "read_only", is_enabled: 1 },
];
const exports = [
  { export_key: "tenant-admin-inherited", capability_key: "admin_tool.admin_inherited", export_surface: "tenant_tool", source_table: "tenant_platform_endpoint_tools", source_key: "admin_inherited", export_status: "active", exposure_scope: "tenant", http_method: "GET", http_path: "/me/inherited" },
  { export_key: "admin-blocked", capability_key: "admin_tool.blocked_admin", export_surface: "admin_virtual_tool", source_table: "admin_platform_endpoint_tools", source_key: "blocked_admin", export_status: "active", exposure_scope: "admin", http_method: "POST", http_path: "/admin/blocked" },
];

function createPool() {
  return {
    async query(sql) {
      const source = String(sql);
      if (source.includes("FROM platform_capability_compiled_manifests")) return [manifests];
      if (source.includes("FROM admin_platform_endpoint_tools")) return [adminTools];
      if (source.includes("FROM tenant_platform_endpoint_tools")) return [tenantTools];
      if (source.includes("FROM platform_plugin_capability_exports")) return [exports];
      if (source.includes("FROM v_platform_capability_export_reconciliation")) return [[]];
      throw new Error(`Unexpected SQL: ${source.slice(0, 120)}`);
    },
  };
}

const args = { target_scope: "all", limit: 20, gap_limit: 50 };
const deps = { pool: createPool(), now: () => "2026-06-30T00:00:00.000Z" };
const result = await buildDynamicCapabilityProjectionPreview(args, deps);
const repeat = await buildDynamicCapabilityProjectionPreview(args, deps);

assert.equal(result.ok, true);
assert.equal(result.preview_version, DYNAMIC_CAPABILITY_PROJECTION_PREVIEW_VERSION);
assert.equal(result.mode, "dry_run");
assert.equal(result.counts.manifest_rows, 5);
assert.equal(result.counts.admin_candidate_count, 2);
assert.equal(result.counts.tenant_candidate_count, 2);
assert.equal(result.counts.aligned_target_count, 3);
assert.equal(result.counts.unsafe_active_export_count, 2);
assert.equal(result.projection_revision_hash, repeat.projection_revision_hash);
assert.equal(result.catalog_snapshot_hash, repeat.catalog_snapshot_hash);

const adminRead = result.candidates.find((item) => item.capability_key === "admin_tool.admin_read");
assert.equal(adminRead.targets.admin.status, "aligned_existing");
assert.equal(adminRead.targets.admin.catalog.schema.strict_object, true);
assert.equal(adminRead.targets.admin.catalog.schema.property_count, 1);
assert.equal(Object.hasOwn(adminRead.targets.admin.catalog, "input_schema"), false);

const tenantRead = result.candidates.find((item) => item.capability_key === "tenant_tool.tenant_read");
assert.equal(tenantRead.targets.tenant.status, "aligned_existing");
assert.equal(tenantRead.targets.tenant.catalog.schema.schema_hash.length, 64);

const tenantBroad = result.candidates.find((item) => item.capability_key === "tenant_tool.tenant_broad");
assert.equal(tenantBroad.targets.tenant.status, "tenant_schema_not_strict");
assert.equal(tenantBroad.status, "blocked");

const inherited = result.candidates.find((item) => item.capability_key === "admin_tool.admin_inherited");
assert.equal(inherited.targets.tenant.status, "unsafe_active_export");
assert.equal(inherited.blockers.includes("TENANT_ADMIN_SOURCE_INHERITANCE_BLOCKED"), true);
assert.equal(inherited.blockers.includes("UNSAFE_ACTIVE_TENANT_EXPORT"), true);

const blockedAdmin = result.candidates.find((item) => item.capability_key === "admin_tool.blocked_admin");
assert.equal(blockedAdmin.targets.admin.status, "unsafe_active_export");
assert.equal(blockedAdmin.blockers.includes("UNSAFE_ACTIVE_ADMIN_EXPORT"), true);

for (const code of [
  "TENANT_PROJECTION_SCHEMA_NOT_STRICT",
  "TENANT_ADMIN_SOURCE_INHERITANCE_BLOCKED",
  "UNSAFE_ACTIVE_TENANT_EXPORT",
  "UNSAFE_ACTIVE_ADMIN_EXPORT",
]) {
  assert.equal(result.gaps.some((gap) => gap.gap_key === code), true, `missing ${code}`);
}

assert.equal(result.guarantees.persisted_manifests_only, true);
assert.equal(result.guarantees.admin_and_tenant_authority_separated, true);
assert.equal(result.guarantees.automatic_callable_export_performed, false);
assert.equal(result.guarantees.mutations_performed, false);
assert.equal(result.guarantees.provider_calls_performed, false);
assert.equal(result.guarantees.tenant_authority_changed, false);
assert.equal(result.guarantees.schemas_returned, false);
assert.equal(result.secrets_included, false);
assert.equal(JSON.stringify(result).includes("arbitrary"), false);

await assert.rejects(
  () => buildDynamicCapabilityProjectionPreview({ target_scope: "invalid" }, deps),
  (error) => error.code === "capability_projection_target_scope_invalid" && error.status === 400
);

const routesSource = readFileSync(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8");
assert.equal(routesSource.includes("platform_capability_projection_preview"), true);
assert.equal(routesSource.includes("buildDynamicCapabilityProjectionPreview"), true);
const manifestSource = readFileSync(new URL("./scripts/test-manifest.mjs", import.meta.url), "utf8");
assert.equal(manifestSource.includes("test-dynamic-capability-projection-preview.mjs"), true);

console.log("dynamic capability projection preview tests passed");
