import assert from "node:assert/strict";
import { buildReleaseAdvisorPlan, classifyReleaseDrift } from "./releaseIntelligenceService.js";

const verified = classifyReleaseDrift({ expected_commit_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", deployed_commit_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
assert.equal(verified.classification, "verified");
assert.equal(verified.production_parity, "verified");

const mismatch = classifyReleaseDrift({ expected_commit_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", deployed_commit_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });
assert.equal(mismatch.classification, "approval_required");
assert.deepEqual(mismatch.blocking_reasons, ["deployed_commit_mismatch"]);

const tenantPlan = buildReleaseAdvisorPlan({ target_id: "tenant-prod-site", runtime_family: "hostinger_ssh", operation_type: "deploy_release", expected_commit_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", deployed_commit_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }, { scope_type: "tenant", tenant_id: "tenant-1", user_id: "user-1" });
assert.equal(tenantPlan.scope, "tenant");
assert.equal(tenantPlan.classification, "approval_required");
assert.equal(tenantPlan.required_controls.tenant_scope_filtering, true);
assert.equal(tenantPlan.secrets_included, false);

const blockedTenantPlan = buildReleaseAdvisorPlan({ runtime_family: "unknown" }, { scope_type: "tenant" });
assert.equal(blockedTenantPlan.classification, "blocked");
assert.ok(blockedTenantPlan.blocked_reasons.includes("tenant_scope_required"));
assert.ok(blockedTenantPlan.blocked_reasons.includes("target_id_required"));

const adminPlan = buildReleaseAdvisorPlan({ target_id: "auth-production", runtime_family: "hostinger_ssh", operation_type: "runtime_parity_recovery" }, { scope_type: "admin", user_id: "platform_admin" });
assert.equal(adminPlan.scope, "admin");
assert.equal(adminPlan.required_controls.admin_cross_tenant_audit, true);
assert.equal(adminPlan.secrets_included, false);

console.log("release intelligence service tests passed");
