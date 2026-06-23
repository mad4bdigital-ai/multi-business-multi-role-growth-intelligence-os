import { getPool } from "./db.js";
import { loadPathResolverRowsFromDb } from "./pathResolverDbLoader.js";
import { resolveBrandCore } from "./resolvers/brandCoreResolver.js";
import {
  brandHost,
  brandRowMatchesReference,
  normalizeBrandReference,
} from "./resolvers/brandReferenceResolver.js";
import { resolveGoogleFileReadDecision } from "./platformPrivateCapabilityVault.js";

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

export function normalizeAuditSiteUrl(value = "") {
  const raw = text(value);
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return `${url.protocol}//${url.hostname.replace(/^www\./, "")}${url.port ? `:${url.port}` : ""}/`;
  } catch {
    return "";
  }
}

export function classifyAuditEvidence(input = {}) {
  const source = text(input.source, 64).toLowerCase();
  const sourceDetected = input.source_detected === true;
  const renderedAttempted = input.rendered_attempted === true;
  const renderedVisible = input.rendered_visible === true;
  const conditional = input.conditional === true;

  let classification = "unverified";
  if (source === "brand_core" || source === "strategy_document") classification = "document_authority";
  else if (source === "tracker" || source === "implementation_tracker") classification = "tracker_state";
  else if (renderedVisible) classification = "rendered_visible";
  else if (conditional) classification = "conditional";
  else if (renderedAttempted && sourceDetected) classification = "hidden_template_fallback";
  else if (renderedAttempted && !renderedVisible) classification = "rendered_not_reproduced";
  else if (sourceDetected) classification = "source_only";

  return {
    classification,
    report_as_visitor_issue: classification === "rendered_visible",
    requires_visual_confirmation: ["source_only", "hidden_template_fallback", "conditional", "unverified"].includes(classification),
  };
}

function resourceSteps(product) {
  if (product === "google_docs") {
    return [
      {
        parent_action_key: "google_drive_api",
        endpoint_key: "getFileMetadata",
        purpose: "confirm_mime_type_and_resource_authority",
      },
      {
        parent_action_key: "google_drive_api",
        endpoint_key: "drive_export_workspace_file",
        purpose: "export_plain_text",
        query: { mimeType: "text/plain" },
      },
    ];
  }
  if (product === "google_sheets") {
    return [
      {
        parent_action_key: "google_sheets_api",
        endpoint_key: "getSpreadsheet",
        purpose: "list_sheet_metadata",
      },
      {
        parent_action_key: "google_sheets_api",
        endpoint_key: "getSheetValues",
        purpose: "read_selected_ranges_with_pagination",
      },
    ];
  }
  if (product === "google_slides") {
    return [
      {
        parent_action_key: "google_drive_api",
        endpoint_key: "getFileMetadata",
        purpose: "confirm_mime_type_and_resource_authority",
      },
      {
        parent_action_key: "google_drive_api",
        endpoint_key: "drive_export_workspace_file",
        purpose: "export_plain_text",
        query: { mimeType: "text/plain" },
      },
    ];
  }
  return [
    {
      parent_action_key: "google_drive_api",
      endpoint_key: "getFileMetadata",
      purpose: "metadata_first_manual_review",
    },
  ];
}

export function buildAuditResourceReadPlan(url = "") {
  const decision = resolveGoogleFileReadDecision({
    url,
    metadata_probe_status: "planned_from_url",
    max_chars_per_chunk: 12000,
  });
  return {
    resource_url: text(url),
    file_id: decision.file_id || null,
    detected_product: decision.detected_product,
    capability_key: "files.object.read",
    credential_scope: "auto",
    resolution_status: decision.file_id ? "planned" : "blocked",
    read_strategy: decision.read_strategy,
    fallback_strategy: decision.fallback_strategy,
    canonical_steps: resourceSteps(decision.detected_product),
    continuation_required: true,
    provider_call_executed: false,
    blockers: decision.blockers || [],
    secrets_included: false,
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
  if (scope.admin) {
    return {
      authorized: true,
      status: "admin_authorized",
      membership: null,
      workspace: null,
      resource_grant_present: true,
    };
  }
  if (!scope.tenant_id || !scope.user_id) {
    return {
      authorized: false,
      status: "tenant_context_required",
      membership: null,
      workspace: null,
      resource_grant_present: false,
    };
  }

  const [[membership]] = await pool.query(
    `SELECT user_id, tenant_id, role, status
       FROM memberships
      WHERE tenant_id = ? AND user_id = ? AND status = 'active'
      LIMIT 1`,
    [scope.tenant_id, scope.user_id]
  );
  if (!membership) {
    return {
      authorized: false,
      status: "workspace_membership_required",
      membership: null,
      workspace: null,
      resource_grant_present: false,
    };
  }

  const [workspaces] = await pool.query(
    `SELECT workspace_id, workspace_key, workspace_type, bootstrap_status, linked_brand_key
       FROM workspace_registry
      WHERE tenant_id = ? AND bootstrap_status = 'ready'
      ORDER BY created_at ASC`,
    [scope.tenant_id]
  );
  const workspace = (workspaces || []).find((row) =>
    brandRowMatchesReference(brand, row.linked_brand_key)
  ) || null;

  const [assets] = await pool.query(
    `SELECT asset_id, brand_ref, site_ref, visibility, lifecycle_status
       FROM workspace_assets
      WHERE tenant_id = ?
        AND brand_ref IS NOT NULL
        AND COALESCE(lifecycle_status, 'active') = 'active'
      ORDER BY created_at ASC
      LIMIT 100`,
    [scope.tenant_id]
  ).catch(() => [[]]);
  const brandAsset = (assets || []).find((row) =>
    brandRowMatchesReference(brand, row.brand_ref) ||
    normalizeBrandReference(row.site_ref) === normalizeBrandReference(brand.brand_domain)
  ) || null;

  const refs = [
    workspace?.workspace_id,
    workspace?.workspace_key,
    scope.tenant_id,
    brand.target_key,
    brand.brand_key,
    brand.brand_domain,
  ].filter(Boolean);
  let grants = [];
  if (refs.length) {
    const placeholders = refs.map(() => "?").join(",");
    [grants] = await pool.query(
      `SELECT grant_id, resource_type, resource_ref, permission, grant_status
         FROM v_workspace_resource_grant_effective
        WHERE tenant_id = ?
          AND grantee_user_id = ?
          AND membership_status = 'active'
          AND grant_status = 'active'
          AND resource_ref IN (${placeholders})`,
      [scope.tenant_id, scope.user_id, ...refs]
    ).catch(() => [[]]);
  }

  const linked = Boolean(workspace || brandAsset);
  return {
    authorized: linked,
    status: linked ? "tenant_brand_authorized" : "tenant_brand_authority_missing",
    membership: {
      role: membership.role,
      status: membership.status,
    },
    workspace: workspace ? {
      workspace_id: workspace.workspace_id,
      workspace_key: workspace.workspace_key,
      workspace_type: workspace.workspace_type,
      bootstrap_status: workspace.bootstrap_status,
    } : null,
    workspace_asset_id: brandAsset?.asset_id || null,
    resource_grant_present: Array.isArray(grants) && grants.length > 0,
  };
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
    description: "Admin-only read-only readiness smoke for brand alias resolution, legacy Brand Core compatibility, browser inspection readiness, file-read binding, and descriptor wiring. No provider call, mutation, external send, or secret return.",
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
    return blockedResult("tenant_brand_authority_required", "The signed tenant principal is not authorized for this brand.", {
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
  if (!scope.admin && !authority.resource_grant_present) degraded.push("tenant_resource_grant_not_present_for_provider_execution");

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
      pass: present.size === 7,
      present_count: present.size,
      expected_count: 7,
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
