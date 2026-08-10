import assert from "node:assert/strict";
import {
  assertCmsAuthorityApplyAllowed,
  buildCmsAuthorityReconciliationPlan,
  CMS_AUTHORITY_RECONCILIATION_CONFIRMATION,
  deriveCmsCapabilitiesFromClaim,
} from "./cmsAuthorityReconciliation.js";

const approvedClaim = {
  claim_id: "claim_allroyal_1",
  tenant_id: "tenant_1",
  user_id: "user_1",
  connection_id: "connection_1",
  app_key: "wordpress_rest",
  site_url: "https://allroyalegypt.com",
  wp_json_base: "https://allroyalegypt.com/wp-json",
  normalized_domain: "allroyalegypt.com",
  cms_roles_json: JSON.stringify(["administrator"]),
  matched_brand_key: "All Royal Egypt",
  matched_target_key: "allroyalegypt_wp",
  verification_status: "approved",
  requested_scope: "tenant_brand",
  approved_by: "admin_1",
  approved_at: "2026-05-28T14:08:54.000Z",
  created_at: "2026-05-28T14:08:00.000Z",
  updated_at: "2026-05-28T14:08:54.000Z",
};

const plan = buildCmsAuthorityReconciliationPlan({
  claims: [approvedClaim],
  sites: [],
  grants: [],
  brandBindings: [],
  idFactory: (kind) => `${kind}_id`,
});

assert.equal(plan.ok, true, "resolvable CMS authority gaps should not require manual review");
assert.equal(plan.summary.approved_claims, 1);
assert.equal(plan.summary.create_cms_site, 1);
assert.equal(plan.summary.create_cms_site_access_grant, 1);
assert.equal(plan.summary.create_brand_site_binding, 1);
assert.equal(plan.summary.actionable_operations, 3);
assert.equal(plan.summary.connection_inventory_loaded, false);
assert.equal(plan.secrets_included, false);

const siteOperation = plan.operations.find((operation) => operation.op === "create_cms_site");
assert.equal(siteOperation.site.normalized_domain, "allroyalegypt.com");
assert.equal(siteOperation.site.canonical_target_key, "allroyalegypt_wp");

const grantOperation = plan.operations.find((operation) => operation.op === "create_cms_site_access_grant");
assert.equal(grantOperation.grant.claim_id, approvedClaim.claim_id);
assert.equal(grantOperation.grant.status, "active");
assert.equal(grantOperation.grant.publish_allowed, 1);
assert.equal(grantOperation.grant.destructive_allowed, 0);

const bindingOperation = plan.operations.find((operation) => operation.op === "create_brand_site_binding");
assert.equal(bindingOperation.binding.target_key, "allroyalegypt_wp");
assert.equal(bindingOperation.binding.created_by, "cms_reconcile:claim_allroyal_1");

const noOpPlan = buildCmsAuthorityReconciliationPlan({
  claims: [approvedClaim],
  sites: [{ site_id: "site_existing", app_key: "wordpress_rest", normalized_domain: "allroyalegypt.com" }],
  grants: [{ grant_id: "grant_existing", claim_id: approvedClaim.claim_id }],
  brandBindings: [{ binding_id: "binding_existing", site_id: "site_existing", target_key: "allroyalegypt_wp" }],
});
assert.equal(noOpPlan.summary.operations, 0, "existing site, grant, and brand binding should be idempotent no-op when no authoritative connection inventory is supplied");

const staleGrant = {
  grant_id: "grant_stale",
  site_id: "site_existing",
  tenant_id: "tenant_1",
  user_id: "user_1",
  connection_id: "connection_old",
  claim_id: "claim_old",
  scope: "tenant_brand",
  status: "active",
};
const stalePlan = buildCmsAuthorityReconciliationPlan({
  claims: [],
  sites: [{ site_id: "site_existing", app_key: "wordpress_rest", normalized_domain: "allroyalegypt.com" }],
  grants: [staleGrant],
  brandBindings: [],
  connections: [{ connection_id: "connection_1", tenant_id: "tenant_1", user_id: "user_1", app_key: "wordpress_rest", status: "active", validation_status: "validated" }],
});
assert.equal(stalePlan.summary.connection_inventory_loaded, true);
assert.equal(stalePlan.summary.revoke_stale_cms_site_access_grant, 1);
assert.equal(stalePlan.summary.actionable_operations, 1);
const staleOperation = stalePlan.operations.find((operation) => operation.op === "revoke_stale_cms_site_access_grant");
assert.equal(staleOperation.reason, "connection_missing");
assert.equal(staleOperation.grant.grant_id, "grant_stale");

const inactivePlan = buildCmsAuthorityReconciliationPlan({
  claims: [],
  sites: [{ site_id: "site_existing", app_key: "wordpress_rest", normalized_domain: "allroyalegypt.com" }],
  grants: [{ ...staleGrant, connection_id: "connection_old" }],
  brandBindings: [],
  connections: [{ connection_id: "connection_old", tenant_id: "tenant_1", user_id: "user_1", app_key: "wordpress_rest", status: "revoked" }],
});
assert.equal(inactivePlan.operations.find((operation) => operation.op === "revoke_stale_cms_site_access_grant")?.reason, "connection_inactive");

const validPlan = buildCmsAuthorityReconciliationPlan({
  claims: [approvedClaim],
  sites: [{ site_id: "site_existing", app_key: "wordpress_rest", normalized_domain: "allroyalegypt.com" }],
  grants: [{ grant_id: "grant_existing", site_id: "site_existing", tenant_id: "tenant_1", user_id: "user_1", connection_id: "connection_1", claim_id: approvedClaim.claim_id, scope: "tenant_brand", status: "active" }],
  brandBindings: [{ binding_id: "binding_existing", site_id: "site_existing", target_key: "allroyalegypt_wp" }],
  connections: [{ connection_id: "connection_1", tenant_id: "tenant_1", user_id: "user_1", app_key: "wordpress_rest", status: "active", validation_status: "validated" }],
});
assert.equal(validPlan.summary.revoke_stale_cms_site_access_grant, 0);
assert.equal(validPlan.summary.operations, 0);

const staleApprovedClaimPlan = buildCmsAuthorityReconciliationPlan({
  claims: [{ ...approvedClaim, connection_id: "connection_missing" }],
  sites: [{ site_id: "site_existing", app_key: "wordpress_rest", normalized_domain: "allroyalegypt.com" }],
  grants: [],
  brandBindings: [],
  connections: [],
});
assert.equal(staleApprovedClaimPlan.ok, false);
assert.equal(staleApprovedClaimPlan.operations.find((operation) => operation.op === "manual_review")?.reason, "approved_claim_connection_missing");
assert.equal(staleApprovedClaimPlan.summary.create_cms_site_access_grant, 0, "an unusable approved claim connection must not be recreated as a live grant");

const caps = deriveCmsCapabilitiesFromClaim({ cms_roles_json: JSON.stringify(["editor"]) });
assert.deepEqual(caps, {
  edit_posts: true,
  publish_posts: true,
  delete_posts: false,
});

const dryRunGate = assertCmsAuthorityApplyAllowed({ apply: false });
assert.equal(dryRunGate.allowed, false);
assert.equal(dryRunGate.required_confirmation, CMS_AUTHORITY_RECONCILIATION_CONFIRMATION);

assert.throws(
  () => assertCmsAuthorityApplyAllowed({ apply: true, confirm: "WRONG" }),
  /APPLY_CMS_AUTHORITY_RECONCILIATION/,
  "apply mode must require explicit confirmation"
);

const applyGate = assertCmsAuthorityApplyAllowed({
  apply: true,
  confirm: CMS_AUTHORITY_RECONCILIATION_CONFIRMATION,
});
assert.equal(applyGate.allowed, true);
assert.equal(applyGate.mode, "apply");

console.log("cms authority reconciliation tests passed");
