import crypto from "node:crypto";

export const CMS_AUTHORITY_RECONCILIATION_CONFIRMATION = "APPLY_CMS_AUTHORITY_RECONCILIATION";

function randomId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function hasAdminLikeRole(roles) {
  return asArray(roles).some((role) => ["administrator", "editor", "shop_manager"].includes(String(role).toLowerCase()));
}

export function deriveCmsCapabilitiesFromClaim(claim = {}) {
  const roles = parseJsonArray(claim.cms_roles_json).map((role) => String(role).toLowerCase());
  return {
    edit_posts: hasAdminLikeRole(roles),
    publish_posts: roles.includes("administrator") || roles.includes("editor"),
    delete_posts: roles.includes("administrator"),
  };
}

function siteKey(row = {}) {
  return `${row.app_key || "wordpress_rest"}:${String(row.normalized_domain || "").toLowerCase()}`;
}

function bindingKey(row = {}) {
  return `${row.site_id || ""}:${row.target_key || ""}`;
}

function latestClaimBySiteKey(claims) {
  const byKey = new Map();
  for (const claim of claims) {
    const key = siteKey(claim);
    if (!claim.normalized_domain || !claim.app_key) continue;
    const current = byKey.get(key);
    const currentTime = current ? Date.parse(current.updated_at || current.created_at || 0) : -1;
    const claimTime = Date.parse(claim.updated_at || claim.created_at || 0);
    if (!current || claimTime >= currentTime) byKey.set(key, claim);
  }
  return byKey;
}

export function buildCmsAuthorityReconciliationPlan({
  claims = [],
  sites = [],
  grants = [],
  brandBindings = [],
  idFactory = randomId,
} = {}) {
  const approvedClaims = asArray(claims).filter((claim) => {
    return claim?.verification_status === "approved" && claim?.approved_at && claim?.normalized_domain;
  });
  const sitesByKey = new Map(asArray(sites).map((site) => [siteKey(site), site]));
  const grantsByClaimId = new Map(asArray(grants).filter((grant) => grant.claim_id).map((grant) => [grant.claim_id, grant]));
  const bindingKeys = new Set(asArray(brandBindings).map(bindingKey));
  const latestClaims = latestClaimBySiteKey(approvedClaims);
  const plannedSitesByKey = new Map();
  const operations = [];

  for (const [key, claim] of latestClaims.entries()) {
    if (sitesByKey.has(key)) continue;
    const siteId = idFactory("cms_site", claim);
    const site = {
      site_id: siteId,
      app_key: claim.app_key,
      normalized_domain: claim.normalized_domain,
      site_url: claim.site_url,
      wp_json_base: claim.wp_json_base,
      canonical_target_key: claim.matched_target_key || null,
      platform_status: "active",
      source_claim_id: claim.claim_id,
    };
    plannedSitesByKey.set(key, site);
    operations.push({
      op: "create_cms_site",
      risk_level: "medium",
      idempotency_key: key,
      site,
    });
  }

  for (const claim of approvedClaims) {
    if (grantsByClaimId.has(claim.claim_id)) continue;
    const site = sitesByKey.get(siteKey(claim)) || plannedSitesByKey.get(siteKey(claim));
    if (!site) {
      operations.push({
        op: "manual_review",
        risk_level: "high",
        reason: "approved_claim_has_no_resolvable_site",
        claim_id: claim.claim_id,
        app_key: claim.app_key,
        normalized_domain: claim.normalized_domain,
      });
      continue;
    }
    const capabilities = deriveCmsCapabilitiesFromClaim(claim);
    operations.push({
      op: "create_cms_site_access_grant",
      risk_level: "medium",
      idempotency_key: claim.claim_id,
      grant: {
        grant_id: idFactory("cms_site_access_grant", claim),
        site_id: site.site_id,
        tenant_id: claim.tenant_id,
        user_id: claim.user_id,
        workspace_id: null,
        connection_id: claim.connection_id,
        claim_id: claim.claim_id,
        scope: claim.requested_scope || "personal",
        capabilities_json: JSON.stringify(capabilities),
        draft_allowed: capabilities.edit_posts ? 1 : 0,
        publish_allowed: capabilities.publish_posts ? 1 : 0,
        destructive_allowed: 0,
        status: "active",
        approved_by: claim.approved_by || claim.user_id,
        approved_at: claim.approved_at,
      },
    });
  }

  for (const [key, site] of plannedSitesByKey.entries()) {
    const claim = latestClaims.get(key);
    if (!claim?.matched_target_key) continue;
    const targetBindingKey = `${site.site_id}:${claim.matched_target_key}`;
    if (bindingKeys.has(targetBindingKey)) continue;
    operations.push({
      op: "create_brand_site_binding",
      risk_level: "low",
      idempotency_key: targetBindingKey,
      binding: {
        binding_id: idFactory("brand_site_binding", claim),
        site_id: site.site_id,
        target_key: claim.matched_target_key,
        brand_name: claim.matched_brand_key || null,
        relationship_type: "primary",
        status: "active",
        created_by: `cms_reconcile:${claim.claim_id}`,
      },
    });
  }

  const actionable = operations.filter((operation) => operation.op !== "manual_review");
  const manualReview = operations.filter((operation) => operation.op === "manual_review");

  return {
    ok: manualReview.length === 0,
    mode: "plan",
    summary: {
      approved_claims: approvedClaims.length,
      existing_sites: sites.length,
      existing_grants: grants.length,
      existing_brand_bindings: brandBindings.length,
      operations: operations.length,
      actionable_operations: actionable.length,
      manual_review_operations: manualReview.length,
      create_cms_site: operations.filter((operation) => operation.op === "create_cms_site").length,
      create_cms_site_access_grant: operations.filter((operation) => operation.op === "create_cms_site_access_grant").length,
      create_brand_site_binding: operations.filter((operation) => operation.op === "create_brand_site_binding").length,
    },
    operations,
    secrets_included: false,
  };
}

export function assertCmsAuthorityApplyAllowed({ apply = false, confirm } = {}) {
  if (!apply) {
    return {
      allowed: false,
      mode: "dry_run",
      required_confirmation: CMS_AUTHORITY_RECONCILIATION_CONFIRMATION,
    };
  }
  if (confirm !== CMS_AUTHORITY_RECONCILIATION_CONFIRMATION) {
    const err = new Error(`Apply requires --confirm ${CMS_AUTHORITY_RECONCILIATION_CONFIRMATION}.`);
    err.code = "CMS_AUTHORITY_RECONCILIATION_CONFIRMATION_REQUIRED";
    throw err;
  }
  return { allowed: true, mode: "apply" };
}
