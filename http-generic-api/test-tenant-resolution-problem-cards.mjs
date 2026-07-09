import assert from "node:assert/strict";
import {
  _testingTenantResolutionProjection,
  readTenantResolutionProblemCards,
} from "./tenantResolutionProjectionService.js";

const {
  classifyTenantProblemRootFamily,
  projectOperationalAlertToProblemCard,
  mergeProblemCards,
  sanitizeValue,
} = _testingTenantResolutionProjection;

assert.equal(classifyTenantProblemRootFamily({ title: "wpml_v1_website_contexts execution is failed" }), "wordpress_site_health");
assert.equal(classifyTenantProblemRootFamily({ source_type: "v_activation_agent_skill_grants", title: "WordPress Write requires approval" }), "tenant_skill_approval");
assert.equal(classifyTenantProblemRootFamily({ source_type: "source_data_quality", title: "Pending task source contains malformed rows" }), "task_source_quality");
assert.equal(classifyTenantProblemRootFamily({ title: "Google Ads budget preflight not ready" }), "provider_setup_ads");
assert.equal(classifyTenantProblemRootFamily({ source_type: "connected_systems", title: "Local connector is pending" }), "connector_runtime_readiness");

const wordpressAlert = {
  alert_key: "alert.wpml",
  source_type: "execution_log",
  source_ref: "execution-log://1",
  tenant_id: "tenant_1",
  workspace_id: "workspace_1",
  severity: "critical",
  title: "wpml_v1_website_contexts execution is failed",
  reason_code: "execution_failed",
  occurrence_count: 3,
  first_seen_at: "2026-07-09T10:00:00Z",
  last_seen_at: "2026-07-09T11:00:00Z",
  evidence: { credential_payload: "must_not_leak", operation_key: "wpml_v1_website_contexts" },
};

const wordpressCard = projectOperationalAlertToProblemCard(wordpressAlert);
assert.equal(wordpressCard.root_family, "wordpress_site_health");
assert.equal(wordpressCard.recommended_playbook_key, "wordpress_site_doctor_v1");
assert.equal(wordpressCard.resource_ref, "workspace://workspace_1");
assert.equal(wordpressCard.apply_enabled, false);
assert.equal(wordpressCard.provider_call_allowed, false);
assert.equal(wordpressCard.secrets_included, false);
assert.ok(wordpressCard.problem_key.startsWith("problem."));

const sanitized = sanitizeValue({ api_key: "redacted", safe: "visible", nested: { password: "redacted", reason: "ok" } });
assert.deepEqual(sanitized, { safe: "visible", nested: { reason: "ok" } });

const merged = mergeProblemCards([
  wordpressCard,
  projectOperationalAlertToProblemCard({
    ...wordpressAlert,
    alert_key: "alert.wp_media",
    source_ref: "execution-log://2",
    severity: "high",
    title: "wordpress_create_media execution is failed",
    occurrence_count: 5,
    last_seen_at: "2026-07-09T12:00:00Z",
  }),
]);
assert.equal(merged.length, 1);
assert.equal(merged[0].alert_count, 2);
assert.equal(merged[0].occurrence_count, 8);
assert.deepEqual(merged[0].source_alert_keys.sort(), ["alert.wp_media", "alert.wpml"].sort());
assert.equal(merged[0].sample_alert.alert_key, "alert.wp_media");

const projected = await readTenantResolutionProblemCards({
  explicitSubject: { is_admin: false, tenant_id: "tenant_1", user_id: "user_1" },
  rootFamily: "wordpress_site_health",
  readAlerts: async () => ({
    ok: true,
    subject: { is_admin: false, tenant_id: "tenant_1", user_id: "user_1" },
    final_result: [wordpressAlert],
    source_health: [],
  }),
});
assert.equal(projected.activation_layer, "tenant_resolution_problem_cards");
assert.equal(projected.source_authority, "tenant_scoped_operational_alerts_projection");
assert.equal(projected.items.length, 1);
assert.equal(projected.policy.diagnostic_only, true);
assert.equal(projected.policy.apply_enabled, false);
assert.equal(projected.policy.provider_call_allowed, false);
assert.equal(projected.policy.case_creation_deferred_to_next_child_pr, true);
assert.equal(projected.secrets_included, false);

console.log("tenant resolution problem card projection tests passed");
