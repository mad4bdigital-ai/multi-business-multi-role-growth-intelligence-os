import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildDynamicCapabilityGovernancePreview,
  classifyCapabilityEffect,
  classifyCapabilityRisk,
  compileCapabilityManifest,
  compileCapabilityRequirements,
  DYNAMIC_CAPABILITY_GOVERNANCE_COMPILER_VERSION,
  stableCapabilityHash,
} from "./dynamicCapabilityGovernanceCompiler.js";

const rows = [
  {
    capability_key: "platform.capability.read",
    display_name: "Read Platform Capability",
    capability_family: "platform",
    source_table: "tenant_platform_endpoint_tools",
    source_key: "platform_capability_read",
    operation_class: "read_only",
    risk_class: "A",
    runtime_status: "read_only_certified",
    exposure_scope: "tenant",
    authority_requirement_type: "invocation",
    resource_authority_required: 0,
    discoverable: 1,
    registered: 1,
    exported: 1,
    routable: 1,
    authority_model_ready: 1,
    resource_binding_ready: 1,
    dispatchable: 1,
    applyable: 0,
    readback_contract_ready: 1,
    certified: 1,
    provenance_ready: 1,
    evidence_linked: 1,
    dispatch_allowed: 1,
    apply_allowed: 0,
    requires_audit_evidence: 0,
    requires_readback: 0,
    hard_block_count: 0,
  },
  {
    capability_key: "platform.alert.sync",
    display_name: "Synchronize Operational Alerts",
    capability_family: "operational_alerting",
    source_table: "admin_platform_endpoint_tools",
    source_key: "activation_operational_attention_sync_api",
    operation_class: "sync",
    risk_class: "B",
    runtime_status: "active",
    exposure_scope: "admin",
    authority_requirement_type: "none",
    resource_authority_required: 0,
    discoverable: 1,
    registered: 1,
    exported: 1,
    routable: 1,
    authority_model_ready: 1,
    resource_binding_ready: 1,
    dispatchable: 1,
    applyable: 0,
    readback_contract_ready: 0,
    certified: 0,
    provenance_ready: 1,
    evidence_linked: 0,
    dispatch_allowed: 1,
    apply_allowed: 0,
    requires_audit_evidence: 0,
    requires_readback: 0,
    hard_block_count: 0,
  },
  {
    capability_key: "content.article.create_draft",
    display_name: "Create WordPress Draft",
    capability_family: "wordpress",
    source_table: "platform_semantic_capabilities",
    source_key: "content.article.create_draft",
    operation_class: "create_draft",
    risk_class: "C",
    runtime_status: "shadow",
    exposure_scope: "tenant",
    authority_requirement_type: "combined",
    resource_authority_required: 1,
    discoverable: 1,
    registered: 1,
    exported: 0,
    routable: 0,
    authority_model_ready: 1,
    resource_binding_ready: 0,
    dispatchable: 0,
    applyable: 0,
    readback_contract_ready: 0,
    certified: 0,
    provenance_ready: 1,
    evidence_linked: 0,
    dispatch_allowed: 0,
    apply_allowed: 0,
    requires_audit_evidence: 1,
    requires_readback: 1,
    hard_block_count: 2,
  },
  {
    capability_key: "unsafe.tenant.admin.tool",
    display_name: "Unsafe Tenant Admin Tool",
    capability_family: "tooling",
    source_table: "admin_platform_endpoint_tools",
    source_key: "runtime_endpoint_call",
    operation_class: "execute",
    risk_class: "D",
    runtime_status: "active",
    exposure_scope: "tenant",
    authority_requirement_type: "combined",
    resource_authority_required: 1,
    discoverable: 1,
    registered: 1,
    exported: 1,
    routable: 1,
    authority_model_ready: 1,
    resource_binding_ready: 1,
    dispatchable: 1,
    applyable: 0,
    readback_contract_ready: 1,
    certified: 1,
    provenance_ready: 1,
    evidence_linked: 1,
    dispatch_allowed: 1,
    apply_allowed: 0,
    requires_audit_evidence: 1,
    requires_readback: 1,
    hard_block_count: 0,
  },
];

function createFakePool() {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      calls.push({ sql: normalized, params });
      assert.match(normalized, /FROM v_platform_capability_readiness_vector/);
      assert.match(normalized, /ORDER BY capability_key/);
      const limit = Number(params.at(-1));
      return [rows.slice(0, limit)];
    },
  };
}

assert.equal(classifyCapabilityEffect(rows[0]), "read_only");
assert.equal(classifyCapabilityEffect(rows[1]), "internal_write");
assert.equal(classifyCapabilityEffect(rows[2]), "external_write");
assert.equal(classifyCapabilityRisk(rows[2], "external_write"), "C");
assert.equal(classifyCapabilityRisk({ ...rows[2], operation_class: "publish" }, "external_write"), "D");

assert.equal(classifyCapabilityEffect({
  capability_key: "admin_tool.activation_drive_probe",
  display_name: "Probe Google Drive",
  capability_family: "admin_tool",
  source_key: "activation_drive_probe",
  operation_class: "tool_dispatch",
  risk_class: "D",
  apply_allowed: 0,
}), "read_only");
assert.equal(classifyCapabilityEffect({
  capability_key: "admin_tool.activation_github_validate",
  display_name: "Validate GitHub",
  capability_family: "admin_tool",
  source_key: "activation_github_validate",
  operation_class: "tool_dispatch",
  apply_allowed: 0,
}), "read_only");
assert.equal(classifyCapabilityEffect({
  capability_key: "admin_tool.cloudflare_tunnel_status",
  display_name: "Cloudflare Tunnel Status",
  capability_family: "admin_tool",
  source_key: "cloudflare_tunnel_status",
  operation_class: "tool_dispatch",
  apply_allowed: 0,
}), "read_only");
assert.equal(classifyCapabilityEffect({
  capability_key: "admin_tool.connector_registry_get_tool",
  display_name: "Get Connector Registry Entry",
  capability_family: "admin_tool",
  source_key: "connector_registry_get_tool",
  operation_class: "tool_dispatch",
  apply_allowed: 0,
}), "read_only");
assert.equal(classifyCapabilityEffect({
  capability_key: "admin_tool.browser_runtime_inspect_site",
  display_name: "Browser Runtime Inspect Site",
  capability_family: "admin_tool",
  source_key: "browser_runtime_inspect_site",
  operation_class: "tool_dispatch",
  apply_allowed: 0,
}), "read_only");
assert.equal(classifyCapabilityEffect({
  capability_key: "admin_tool.browser_runtime_extract_data",
  display_name: "Browser Runtime Extract Data",
  capability_family: "admin_tool",
  source_key: "browser_runtime_extract_data",
  operation_class: "tool_dispatch",
  apply_allowed: 0,
}), "read_only");
assert.equal(classifyCapabilityEffect({
  capability_key: "admin_tool.capability_resolution_dry_run",
  source_key: "capability_resolution_dry_run",
  operation_class: "dry_run",
  apply_allowed: 0,
}), "preview_only");
assert.equal(classifyCapabilityEffect({
  capability_key: "admin_tool.connected_execution_resume_action_enqueue_dry_run",
  source_key: "connected_execution_resume_action_enqueue_dry_run",
  operation_class: "dry_run",
  apply_allowed: 0,
}), "preview_only");
assert.equal(classifyCapabilityEffect({
  capability_key: "admin_tool.connector_browser",
  source_key: "connector_browser",
  operation_class: "connector",
  apply_allowed: 0,
}), "unclassified");
assert.equal(classifyCapabilityEffect({
  capability_key: "admin_tool.activation_run_ack_api",
  source_key: "activation_run_ack_api",
  operation_class: "ack",
  apply_allowed: 0,
}), "internal_write");

const sensitiveReadRequirements = compileCapabilityRequirements({
  capability_key: "admin_tool.activation_drive_probe",
  operation_class: "probe",
  risk_class: "D",
  authority_requirement_type: "invocation",
  resource_authority_required: 0,
  requires_audit_evidence: 0,
  requires_readback: 1,
}, "read_only", "D");
assert.equal(sensitiveReadRequirements.approval_mode, "none");
assert.equal(sensitiveReadRequirements.typed_confirmation, false);
assert.equal(sensitiveReadRequirements.idempotency, false);
assert.equal(sensitiveReadRequirements.certification, false);
assert.equal(sensitiveReadRequirements.readback, false);
assert.equal(sensitiveReadRequirements.rollback, false);
assert.equal(sensitiveReadRequirements.compensation, false);

const alertRequirements = compileCapabilityRequirements(rows[1], "internal_write", "B");
assert.equal(alertRequirements.capability_envelope, true);
assert.equal(alertRequirements.idempotency, true);
assert.equal(alertRequirements.audit, true);
assert.equal(alertRequirements.readback, true);

const wordpress = compileCapabilityManifest(rows[2]);
assert.equal(wordpress.manifest.status, "blocked");
assert.equal(wordpress.manifest.projection.tenant, "blocked");
assert.equal(wordpress.gaps.some((gap) => gap.gap_key === "RESOURCE_AUTHORITY_MISSING"), true);
assert.equal(wordpress.gaps.some((gap) => gap.gap_key === "CERTIFICATION_REQUIRED"), true);
assert.equal(wordpress.gaps.some((gap) => gap.gap_key === "READBACK_CONTRACT_REQUIRED"), true);
assert.equal(wordpress.gaps.some((gap) => gap.gap_key === "ACTIVE_EXPORT_MISSING"), true);

const unsafe = compileCapabilityManifest(rows[3]);
assert.equal(unsafe.gaps.some((gap) => gap.gap_key === "TENANT_TO_ADMIN_SURFACE_BLOCKED"), true);
assert.equal(unsafe.manifest.projection.tenant, "not_applicable");

const hashA = stableCapabilityHash({ b: 2, a: { z: 1, y: 2 } });
const hashB = stableCapabilityHash({ a: { y: 2, z: 1 }, b: 2 });
assert.equal(hashA, hashB);
assert.match(hashA, /^[0-9a-f]{64}$/);

const pool = createFakePool();
const preview = await buildDynamicCapabilityGovernancePreview(
  { limit: 10, gap_limit: 50 },
  { pool, now: () => "2026-06-29T00:00:00.000Z" }
);
assert.equal(preview.compiler_version, DYNAMIC_CAPABILITY_GOVERNANCE_COMPILER_VERSION);
assert.equal(preview.compiler_version, "dynamic-capability-governance-compiler-v2");
assert.equal(preview.report_type, "dynamic_capability_governance_compile_preview");
assert.equal(preview.mode, "dry_run");
assert.equal(preview.counts.source_rows, 4);
assert.equal(preview.counts.manifest_count, 4);
assert.equal(preview.counts.blocked_manifest_count >= 3, true);
assert.equal(preview.gaps.some((gap) => gap.gap_key === "MUTATION_POLICY_REQUIRED"), true);
assert.equal(preview.gaps.some((gap) => gap.gap_key === "TENANT_TO_ADMIN_SURFACE_BLOCKED"), true);
assert.equal(preview.distributions.effect_class.read_only, 1);
assert.equal(preview.distributions.effect_class.internal_write >= 1, true);
assert.equal(preview.guarantees.runtime_dispatch_performed, false);
assert.equal(preview.guarantees.mutations_performed, false);
assert.equal(preview.guarantees.provider_calls_performed, false);
assert.equal(preview.secrets_included, false);
assert.equal(preview.page.has_more, false);
assert.match(preview.source_revision_hash, /^[0-9a-f]{64}$/);

const previewRepeat = await buildDynamicCapabilityGovernancePreview(
  { limit: 10, gap_limit: 50 },
  { pool: createFakePool(), now: () => "2026-06-29T00:00:00.000Z" }
);
assert.deepEqual(
  preview.manifests.map((item) => item.manifest_hash),
  previewRepeat.manifests.map((item) => item.manifest_hash)
);
assert.equal(preview.source_revision_hash, previewRepeat.source_revision_hash);

const routesSource = fs.readFileSync(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8");
const toolKey = "platform_capability_governance_compile_preview";
assert.equal(routesSource.includes(`name: "${toolKey}"`), true);
assert.equal(routesSource.includes(`toolKey === "${toolKey}"`), true);
assert.equal(routesSource.includes("await buildDynamicCapabilityGovernancePreview(args)"), true);

console.log("dynamic capability governance compiler tests passed");
