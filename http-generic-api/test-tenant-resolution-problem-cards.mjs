import assert from "node:assert/strict";
import {
  _testingTenantResolutionProjection,
  readTenantResolutionProblemCards,
} from "./tenantResolutionProjectionService.js";

const { classifyTenantProblemRootFamily, projectOperationalAlertToProblemCard } = _testingTenantResolutionProjection;

const alert = {
  alert_key: "alert.wpml",
  source_type: "execution_log",
  tenant_id: "tenant_1",
  workspace_id: "workspace_1",
  severity: "critical",
  title: "wpml_v1_website_contexts execution is failed",
  occurrence_count: 2,
  first_seen_at: "2026-07-09T10:00:00Z",
  last_seen_at: "2026-07-09T11:00:00Z",
};

assert.equal(classifyTenantProblemRootFamily(alert), "wordpress_site_health");

const card = projectOperationalAlertToProblemCard(alert);
assert.equal(card.root_family, "wordpress_site_health");
assert.equal(card.recommended_playbook_key, "wordpress_site_doctor_v1");
assert.equal(card.resource_ref, "workspace://workspace_1");
assert.equal(card.apply_enabled, false);
assert.equal(card.provider_call_allowed, false);
assert.equal(card.secrets_included, false);
assert.ok(card.problem_key.startsWith("problem."));
assert.ok(card.root_fingerprint_sha256.match(/^[a-f0-9]{64}$/));

const projected = await readTenantResolutionProblemCards({
  explicitSubject: { is_admin: false, tenant_id: "tenant_1", user_id: "user_1" },
  readAlerts: async () => ({
    ok: true,
    subject: { is_admin: false, tenant_id: "tenant_1", user_id: "user_1" },
    final_result: [alert],
    source_health: [],
  }),
});

assert.equal(projected.activation_layer, "tenant_resolution_problem_cards");
assert.equal(projected.source_authority, "tenant_scoped_operational_alerts_projection");
assert.equal(projected.items.length, 1);
assert.equal(projected.items[0].apply_enabled, false);
assert.equal(projected.items[0].provider_call_allowed, false);
assert.equal(projected.policy.diagnostic_only, true);
assert.equal(projected.policy.apply_enabled, false);
assert.equal(projected.policy.provider_call_allowed, false);
assert.equal(projected.policy.case_creation_deferred_to_next_child_pr, true);
assert.equal(projected.secrets_included, false);

console.log("tenant resolution problem card projection smoke passed");
