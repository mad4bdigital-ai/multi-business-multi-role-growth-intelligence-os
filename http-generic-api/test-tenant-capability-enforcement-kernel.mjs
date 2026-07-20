import assert from "node:assert/strict";
import fs from "node:fs";

const kernelSource = fs.readFileSync(new URL("./tenantCapabilityEnforcementKernel.js", import.meta.url), "utf8");
const systemLayer = fs.readFileSync(new URL("./routes/systemLayerRoutes.js", import.meta.url), "utf8");
const tasks = fs.readFileSync(new URL("../specs/006-adaptive-authorization-execution-governance/tasks.md", import.meta.url), "utf8");
const loop = fs.readFileSync(new URL("../specs/006-adaptive-authorization-execution-governance/remaining-task-loop-2026-07-07.md", import.meta.url), "utf8");

const {
  tenantCapabilityEnforcementPreview,
  tenantCapabilityEnforcementReadinessSmoke,
  TENANT_CAPABILITY_ENFORCEMENT_SYSTEM_TOOLS,
} = await import("./tenantCapabilityEnforcementKernel.js");

for (const phrase of [
  "deriveBoundaryPolicy",
  "deriveBoundaryFamily",
  "dynamic_policy_derived_from_resolver",
  "policy_derivation",
  "resolveTenantEffectiveCapability",
  "tenantEffectiveCapabilityReadinessSmoke",
  "shadow_only",
  "provider_apply_allowed: false",
  "mutations_executed: false",
  "no_enforcement_cutover",
]) {
  assert(kernelSource.includes(phrase), `kernel must retain invariant: ${phrase}`);
}

assert(!kernelSource.includes("PILOT_BOUNDARY_POLICIES"), "kernel must not use a static pilot policy map");
assert(!kernelSource.includes("three_pilot_boundaries_registered"), "readiness must not depend on a static pilot count");
for (const legacyStaticBoundary of ["activation.skills.read", "platform.output-artifact.write", "content.wordpress.publish"]) {
  assert(!kernelSource.includes(`enum: ["${legacyStaticBoundary}`), "descriptor must not hard-code pilot boundary enums");
}

for (const secretToken of ["encrypted_credentials", "access_token", "refresh_token", "private_key"]) {
  assert(!kernelSource.includes(secretToken), `kernel must not select or expose ${secretToken}`);
}

assert(systemLayer.includes("TENANT_CAPABILITY_ENFORCEMENT_SYSTEM_TOOLS"));
assert(systemLayer.includes("tenantCapabilityEnforcementPreview"));
assert(systemLayer.includes("tenantCapabilityEnforcementReadinessSmoke"));
assert(systemLayer.includes('source_key: "tenant_capability_enforcement_kernel_v1"'));
assert(systemLayer.includes('readiness_tool: "tenant_capability_enforcement_readiness_smoke"'));
assert(tasks.includes("- [x] T020 Implement the shared enforcement kernel for every pilot boundary."));
assert(loop.includes("dynamic resolver-derived"));

assert.equal(TENANT_CAPABILITY_ENFORCEMENT_SYSTEM_TOOLS.length, 2);
const previewDescriptor = TENANT_CAPABILITY_ENFORCEMENT_SYSTEM_TOOLS.find((tool) => tool.name === "tenant_capability_enforcement_preview");
assert(previewDescriptor);
assert.equal(previewDescriptor.inputSchema.required.includes("capability_key"), true);
assert.equal(previewDescriptor.inputSchema.required.includes("boundary_key"), false);
assert.equal(Array.isArray(previewDescriptor.inputSchema.properties.boundary_key.enum), false);

{
  const result = await tenantCapabilityEnforcementReadinessSmoke({}, {
    pool: {
      async query(sql) {
        const text = String(sql);
        if (text.includes("information_schema.tables")) {
          return [[
            { table_name: "platform_semantic_capabilities", table_type: "BASE TABLE" },
            { table_name: "platform_capability_provider_bindings", table_type: "BASE TABLE" },
            { table_name: "platform_endpoint_aliases", table_type: "BASE TABLE" },
            { table_name: "tenant_capability_shadow_decisions", table_type: "BASE TABLE" },
            { table_name: "v_platform_endpoint_canonical_identity", table_type: "VIEW" },
            { table_name: "v_platform_capability_export_projection", table_type: "VIEW" },
            { table_name: "v_platform_capability_export_reconciliation", table_type: "VIEW" },
            { table_name: "v_tenant_effective_capability_candidates", table_type: "VIEW" },
          ]];
        }
        if (text.includes("platform_semantic_capabilities")) return [[{ c: 8 }]];
        if (text.includes("platform_capability_provider_bindings") && text.includes("rollout_mode = 'shadow'")) return [[{ c: 4 }]];
        if (text.includes("platform_capability_provider_bindings")) return [[{ c: 4 }]];
        if (text.includes("platform_endpoint_aliases")) return [[{ c: 2 }]];
        throw new Error(`Unexpected readiness query: ${text}`);
      },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, "pass");
  assert.equal(result.policy_derivation, "dynamic_from_tenant_effective_capability_resolver_v1");
  assert.equal(result.provider_calls_made, 0);
  assert.equal(result.mutations_executed, false);
  assert.equal(result.secrets_included, false);
}

console.log("tenant capability enforcement kernel contract tests passed");
