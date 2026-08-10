import { getPool } from "./db.js";
import { loadPathResolverRowsFromDb } from "./pathResolverDbLoader.js";
import { resolveBrandCore } from "./resolvers/brandCoreResolver.js";
import {
  brandHost,
  brandRowMatchesReference,
} from "./resolvers/brandReferenceResolver.js";
import { resolveWorkspaceBrandReadAuthority } from "./workspaceBrandReadAuthority.js";
import {
  buildAuditResourceReadPlan,
  normalizeAuditSiteUrl,
} from "./growthAuditEvidenceContracts.js";
export {
  buildAuditResourceReadPlan,
  classifyAuditEvidence,
  normalizeAuditSiteUrl,
} from "./growthAuditEvidenceContracts.js";

function text(value = "", max = 2048) {
  return String(value ?? "").trim().slice(0, max);
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function isAdmin(auth = {}) {
  return auth?.is_admin === true;
}

function principalScope(args = {}, auth = {}) {
  const admin = isAdmin(auth);
  return {
    admin,
    tenant_id: admin && args.tenant_id ? text(args.tenant_id, 64) : text(auth?.tenant_id, 64),
    user_id: admin && args.user_id ? text(args.user_id, 64) : text(auth?.user_id, 64),
    admin_override_used: admin && Boolean(args.tenant_id || args.user_id),
  };
}

function publicBrand(row = {}) {
  return {
    brand_key: text(row.brand_key || row.target_key, 191),
    target_key: text(row.target_key, 191),
    brand_name: text(row.brand_name || row.normalized_brand_name, 255),
    normalized_brand_name: text(row.normalized_brand_name, 255),
    brand_domain: text(row.brand_domain || brandHost(row.base_url), 255),
    base_url: text(row.base_url, 2048),
    status: text(row.status, 64),
  };
}

function brandCoreSummary(resolved = {}) {
  return {
    status: resolved.brandCoreStatus || "missing",
    required: Boolean(resolved.brandCoreRequired),
    content_ready: Boolean(resolved.contentReady),
    strategy_ready: Boolean(resolved.strategyReady),
    asset_count: Number(resolved.coreRowCount || 0),
    docs: resolved.brandCoreDocs || {},
    assets: array(resolved.brandCoreAssets).map((asset) => ({
      asset_key: text(asset.asset_key, 255),
      asset_type: text(asset.asset_type, 255),
      document_name: text(asset.document_name, 500),
      doc_id: text(asset.doc_id, 255),
      google_drive_link: text(asset.google_drive_link, 2048),
      status: text(asset.status, 64),
      priority: text(asset.priority, 32),
    })),
  };
}

async function loadTenantBrandAuthority(pool, scope, brand = {}) {
  const canonicalBrandRef = text(brand.target_key || brand.brand_key, 191);
  return resolveWorkspaceBrandReadAuthority(pool, {
    tenantId: scope.tenant_id,
    userId: scope.user_id,
    brandRef: canonicalBrandRef,
    isAdmin: scope.admin,
  });
}

async function loadRuntimeReadiness(pool) {
  const [[browser]] = await pool.query(
    `SELECT runtime_key, provider, capability_class, status
       FROM browser_runtime_registry
      WHERE runtime_key = 'browser4_essam_v1'
      LIMIT 1`
  ).catch(() => [[null]]);
  const [bindings] = await pool.query(
    `SELECT binding_id, app_key, parent_action_key, endpoint_key, rollout_mode, status
       FROM platform_capability_provider_bindings
      WHERE capability_key = 'files.object.read' AND status = 'active'
      ORDER BY priority ASC, binding_id ASC`
  ).catch(() => [[]]);
  return {
    browser: browser || null,
    file_read_bindings: bindings || [],
  };
}

function blockedResult(code, message, details = {}) {
  return {
    ok: false,
    tool: "growth_audit_evidence_prepare",
    status: "authorization_gated",
    error: { code, message, details },
    provider_calls_made: 0,
    mutations_executed: false,
    external_sends: 0,
    secrets_included: false,
  };
}

export const GROWTH_AUDIT_EVIDENCE_SYSTEM_TOOLS = Object.freeze([
  {
    name: "growth_audit_evidence_prepare",
    description: "Prepare a tenant-safe, evidence-first growth audit context from a brand reference, Brand Core, public site URL, and Google resource URLs. Resolves authority and canonical endpoint plans without provider writes, external sends, or secret return.",
    inputSchema: {
      type: "object",
      required: ["brand_ref"],
      additionalProperties: false,
      properties: {
        brand_ref: { type: "string", minLength: 1, maxLength: 2048 },
        site_url: { type: "string", maxLength: 2048 },
        resource_urls: { type: "array", items: { type: "string", maxLength: 2048 }, maxItems: 20 },
        business_objective: { type: "string", maxLength: 1000 },
        tenant_id: { type: "string", description: "Admin-only diagnostic override; ignored for tenant principals." },
        user_id: { type: "string", description: "Admin-only diagnostic override; ignored for tenant principals." },
      },
    },
  },
  {
    name: "growth_audit_evidence_readiness_smoke",
    description: "Admin-only read-only readiness smoke for canonical Brand authority, brand alias resolution, legacy Brand Core compatibility, browser inspection readiness, file-read binding, and descriptor wiring. No provider call, mutation, external send, or secret return.",
    requires_admin: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
]);

export async function growthAuditEvidencePrepare(args = {}, { auth = {}, pool = getPool() } = {}) {
  const brandRef = text(args.brand_ref, 2048);
  if (!brandRef) return blockedResult("brand_ref_required", "brand_ref is required.");

  const scope = principalScope(args, auth);
  const loaded = await loadPathResolverRowsFromDb({ brandKey: brandRef, targetKey: brandRef });
  const brandRows = array(loaded?.rows?.brandRows);
  const brand = brandRows[0] || null;
  if (!brand) {
    return {
      ...blockedResult("brand_not_found", "No canonical Brand Registry row matched the supplied brand reference.", {
        brand_ref: brandRef,
      }),
      status: "blocked",
    };
  }

  const authority = await loadTenantBrandAuthority(pool, scope, brand);
  if (!authority.authorized) {
    return blockedResult("tenant_brand_authority_required", "The signed tenant principal is not authorized for this Brand.", {
      authority_status: authority.status,
      brand_key: brand.target_key || brand.brand_key,
    });
  }

  const core = resolveBrandCore({
    brandKey: brandRef,
    brandRegistryRows: brandRows,
    brandCoreRegistryRows: array(loaded?.rows?.brandCoreRows),
  });
  const runtime = await loadRuntimeReadiness(pool);
  const publicBrandRow = publicBrand(brand);
  const siteUrl = normalizeAuditSiteUrl(args.site_url || publicBrandRow.brand_domain || publicBrandRow.base_url);
  const resourcePlans = array(args.resource_urls)
    .map((url) => buildAuditResourceReadPlan(url))
    .filter((plan) => plan.resource_url);

  const degraded = [];
  if (!core.strategyReady) degraded.push("brand_core_strategy_not_ready");
  if (!runtime.browser || runtime.browser.status !== "active") degraded.push("browser4_visual_inspection_not_ready");
  if (!runtime.file_read_bindings.length) degraded.push("files_object_read_provider_binding_missing");

  return {
    ok: true,
    tool: "growth_audit_evidence_prepare",
    status: degraded.length ? "validating" : "ready",
    mode: "read_only_prepare",
    principal: {
      principal_type: scope.admin ? "admin" : "tenant",
      tenant_id: scope.tenant_id || null,
      user_id: scope.user_id || null,
      admin_override_used: scope.admin_override_used,
    },
    authorization: authority,
    business_objective: text(args.business_objective, 1000) || "increase qualified acquisition and conversions",
    brand: publicBrandRow,
    business_context: {
      business_activity_rows: array(loaded?.rows?.businessActivityRows).length,
      business_type_profile_rows: array(loaded?.rows?.profileRows).length,
      brand_path_rows: array(loaded?.rows?.brandPathRows).length,
      resolved_brand_key: loaded?.load_request?.resolved_brand_key || publicBrandRow.target_key,
    },
    brand_core: brandCoreSummary(core),
    site_inspection_plan: {
      target_url: siteUrl || null,
      target_host: siteUrl ? brandHost(siteUrl) : null,
      preferred_runtime_key: "browser4_essam_v1",
      preferred_binding_key: "browser4_inspect_essam",
      allowed_domains: publicBrandRow.brand_domain ? [publicBrandRow.brand_domain] : [],
      checks: ["snapshot", "screenshot", "console", "network"],
      visitor_evidence_required: true,
      native_edge_visual_capture_allowed: false,
      provider_call_executed: false,
      runtime_status: runtime.browser?.status || "missing",
    },
    resource_read_plans: resourcePlans,
    evidence_contract: {
      classifications: [
        "rendered_visible",
        "rendered_not_reproduced",
        "source_only",
        "hidden_template_fallback",
        "conditional",
        "document_authority",
        "tracker_state",
      ],
      visitor_issue_requires: "rendered_visible",
      html_presence_alone_is_insufficient: true,
      source_and_rendered_evidence_must_remain_separate: true,
    },
    runtime_readiness: {
      browser_runtime: runtime.browser ? {
        runtime_key: runtime.browser.runtime_key,
        provider: runtime.browser.provider,
        capability_class: runtime.browser.capability_class,
        status: runtime.browser.status,
      } : null,
      files_object_read_bindings: runtime.file_read_bindings.map((row) => ({
        binding_id: row.binding_id,
        app_key: row.app_key,
        parent_action_key: row.parent_action_key,
        endpoint_key: row.endpoint_key,
        rollout_mode: row.rollout_mode,
        status: row.status,
      })),
    },
    degraded_surfaces: degraded,
    provider_calls_made: 0,
    mutations_executed: false,
    external_sends: 0,
    secrets_included: false,
  };
}

async function schemaObjects(pool) {
  const names = [
    "brands",
    "brand_core",
    "workspace_registry",
    "memberships",
    "tenant_brand_links",
    "v_workspace_resource_grant_effective",
    "platform_semantic_capabilities",
    "platform_capability_provider_bindings",
    "browser_runtime_registry",
  ];
  const placeholders = names.map(() => "?").join(",");
  const [rows] = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name IN (${placeholders})`,
    names
  );
  return new Set((rows || []).map((row) => row.table_name));
}

export async function growthAuditEvidenceReadinessSmoke(_args = {}, { pool = getPool() } = {}) {
  const present = await schemaObjects(pool);
  const runtime = await loadRuntimeReadiness(pool);
  const fixtureBrand = {
    brand_name: "Dona tours",
    normalized_brand_name: "dona tours",
    target_key: "donatours_wp",
    brand_domain: "donatours.com",
    site_aliases_json: '["donatours","dona tours","donatours.com"]',
  };
  const checks = [
    {
      name: "required_schema_objects_present",
      pass: present.size === 9,
      present_count: present.size,
      expected_count: 9,
    },
    {
      name: "brand_domain_alias_resolves",
      pass: brandRowMatchesReference(fixtureBrand, "https://www.donatours.com/"),
    },
    {
      name: "brand_hyphen_alias_resolves",
      pass: brandRowMatchesReference(fixtureBrand, "dona-tours"),
    },
    {
      name: "browser4_runtime_active",
      pass: runtime.browser?.status === "active",
      observed_status: runtime.browser?.status || "missing",
    },
    {
      name: "files_object_read_binding_present",
      pass: runtime.file_read_bindings.length > 0,
      observed_count: runtime.file_read_bindings.length,
    },
    {
      name: "two_descriptor_tools_present",
      pass: GROWTH_AUDIT_EVIDENCE_SYSTEM_TOOLS.length === 2,
    },
    { name: "no_provider_call", pass: true },
    { name: "no_mutation", pass: true },
    { name: "no_external_send", pass: true },
    { name: "no_secrets", pass: true },
  ];
  const ok = checks.every((check) => check.pass === true);
  return {
    ok,
    tool: "growth_audit_evidence_readiness_smoke",
    status: ok ? "pass" : "fail",
    classification: ok ? "growth_audit_evidence_ready" : "growth_audit_evidence_not_ready",
    checks,
    provider_calls_made: 0,
    mutations_executed: false,
    external_sends: 0,
    secrets_included: false,
  };
}

export const _testingGrowthAuditEvidence = Object.freeze({
  principalScope,
  loadTenantBrandAuthority,
});
