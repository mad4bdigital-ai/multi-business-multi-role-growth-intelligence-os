import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./test-tenant-gpt-audience-compatibility-policy.mjs";
import "./test-tenant-gpt-access-token-verifier.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

const record = JSON.parse(read(
  "specs/012-tenant-activation-lifecycle/implementation/pr-2n-t032-legacy-audience-compatibility.json",
));
const narrative = read(
  "specs/012-tenant-activation-lifecycle/implementation/pr-2n-t032-legacy-audience-compatibility.md",
);
const tasks = read("specs/012-tenant-activation-lifecycle/tasks.md");
const policy = read("http-generic-api/tenantGptAudienceCompatibilityPolicy.js");
const verifier = read("http-generic-api/tenantGptAccessTokenVerifier.js");
const manifest = read("http-generic-api/scripts/manifests/test-manifest-spec012.mjs");

assert.equal(record.task_id, "T032");
assert.equal(record.status, "repository_policy_and_telemetry_hardened_live_metric_readback_required");
assert.deepEqual(record.authority.requirements, ["FR-005", "FR-006"]);
assert.deepEqual(record.authority.concerns, ["C-004", "C-026"]);
assert.equal(record.compatibility_contract.new_token_audience_mode, "single_protected_resource");
assert.equal(record.compatibility_contract.single_audience_required, true);
assert.equal(record.compatibility_contract.multi_audience_rejected, true);
assert.equal(record.compatibility_contract.strict_resource_audience_accepted, true);
assert.equal(record.compatibility_contract.legacy_acceptance_requires_explicit_enablement, true);
assert.equal(record.compatibility_contract.legacy_acceptance_requires_valid_cutoff, true);
assert.equal(record.compatibility_contract.legacy_acceptance_requires_valid_iat, true);
assert.equal(record.compatibility_contract.legacy_iat_must_not_exceed_cutoff, true);
assert.equal(record.compatibility_contract.legacy_iat_future_skew_max_ms, 300000);
assert.equal(record.compatibility_contract.cutoff_boundary_inclusive, true);
assert.equal(record.compatibility_contract.post_cutoff_legacy_rejected, true);
assert.equal(record.compatibility_contract.verifier_secret_required, true);
assert.equal(record.compatibility_contract.verifier_secret_max_length, 4096);
assert.equal(record.compatibility_contract.verifier_secret_failure_http_status, 503);
assert.equal(record.compatibility_contract.known_fallback_secret_allowed, false);
assert.equal(record.compatibility_contract.telemetry_failure_does_not_change_auth_decision, true);
assert.equal(record.telemetry_contract.metric_name, "tenant_gpt_audience_compatibility_total");
assert.deepEqual(record.telemetry_contract.labels, [
  "classification", "outcome", "audience_mode", "cutoff_state",
]);
assert.equal(record.telemetry_contract.strict_acceptance_attached_to_verified_context, true);
assert.equal(record.telemetry_contract.strict_acceptance_available_to_custom_metrics_sink, true);
assert.equal(record.telemetry_contract.default_logging_suppresses_strict_acceptance_volume, true);
assert.equal(record.telemetry_contract.tenant_id_included, false);
assert.equal(record.telemetry_contract.user_id_included, false);
assert.equal(record.telemetry_contract.token_included, false);
assert.equal(record.telemetry_contract.authorization_header_included, false);
assert.equal(record.telemetry_contract.raw_claims_included, false);
assert.equal(record.validation.policy_regression_complete_on_current_head, true);
assert.equal(record.validation.verifier_regression_complete_on_current_head, true);
assert.equal(record.validation.readiness_regression_complete_on_current_head, true);
assert.equal(record.validation.validation_head_sha, "c294e8aaa6b329d9a18edb520c247298bb29b773");
assert.equal(record.validation.validation_run_id, 30861260511);
assert.equal(record.validation.validation_job_id, 91843520162);
assert.equal(record.validation.dependencies_installed_from_lockfile, true);
assert.equal(record.validation.syntax_complete, true);
assert.equal(record.validation.temporary_workflow_change_retired_before_ready, true);
assert.equal(record.validation.post_validation_workflow_restore_commit, "cd1a278f5d91c13a1c86665bde48e90458d55f3b");
assert.equal(record.validation.production_code_changed_by_workflow_restore, false);
assert.equal(record.validation.exact_head_ci_complete, false);
assert.equal(record.validation.production_deployed, false);
assert.equal(record.validation.live_legacy_metric_readback_complete, false);
assert.equal(record.completion_gate.repository_policy_complete, true);
assert.equal(record.completion_gate.verifier_wiring_complete, true);
assert.equal(record.completion_gate.deterministic_regression_complete, true);
assert.equal(record.completion_gate.production_deployed, false);
assert.equal(record.completion_gate.live_legacy_acceptance_metric_readback_complete, false);
assert.equal(record.completion_gate.live_post_cutoff_rejection_metric_readback_complete, false);
assert.equal(record.completion_gate.live_multi_audience_rejection_metric_readback_complete, false);
assert.equal(record.completion_gate.task_completion_allowed, false);
assert.equal(record.completion_gate.required_before_completion.length >= 6, true);
assert.match(tasks, /^- \[ \] \*\*T032\*\*/mu,
  "T032 must remain open until deployment and live legacy metric readback");
assert.match(narrative, /does \*\*not\*\* close T032/u);
assert.match(narrative, /Completion boundary/u);
assert.match(narrative, /does not extend or mutate the configured cutoff/u);
assert.match(narrative, /no longer accepts a known development fallback/u);

assert.match(policy, /TENANT_GPT_AUDIENCE_COMPATIBILITY_METRIC/u);
assert.match(policy, /tenant_gpt_audience_compatibility_total/u);
assert.match(policy, /MAX_CLOCK_SKEW_MS = 5 \* 60 \* 1000/u);
assert.match(policy, /Math\.min\(\s*MAX_CLOCK_SKEW_MS/u);
assert.match(policy, /audiences\.length !== 1/u);
assert.match(policy, /issuedAtMs > normalizedCutoffMs/u);
assert.match(policy, /legacy_audience_rejected_cutoff_elapsed/u);
assert.match(policy, /multi_audience_rejected/u);
assert.match(policy, /token_resource_mismatch_rejected/u);
assert.match(policy, /if \(evidence\.accepted && !evidence\.legacy_audience_present\) return true/u);
assert.match(policy, /secrets_included: false/u);
assert.doesNotMatch(policy, /user_id:\s*evidence/u);
assert.doesNotMatch(policy, /tenant_id:\s*evidence/u);
assert.doesNotMatch(policy, /access_token:\s*evidence/u);
assert.doesNotMatch(policy, /authorization:\s*evidence/u);

assert.match(verifier, /JWT_SECRET_MAX_LENGTH = 4096/u);
assert.match(verifier, /requireTenantGptJwtSecret/u);
assert.match(verifier, /tenant_gpt_verifier_unavailable/u);
assert.match(verifier, /503/u);
assert.doesNotMatch(verifier, /development_fallback_secret_only/u);
assert.match(verifier, /classifyTenantGptAudienceCompatibility/u);
assert.match(verifier, /recordTenantGptAudienceCompatibilityEvidence/u);
assert.match(verifier, /rejectTenantGptAudienceCompatibilityForResourceMismatch/u);
assert.match(verifier, /onCompatibilityEvidence/u);
assert.match(verifier, /audience_compatibility_classification/u);
assert.match(verifier, /legacy_audience_cutoff_state/u);
assert.match(verifier, /compatibility_metric_name/u);
assert.match(verifier, /emitCompatibilityEvidence\(compatibility, onCompatibilityEvidence\)/u);
assert.match(verifier, /try \{\s*callback\(evidence\);/u);
assert.match(verifier, /tenant_gpt_audience_compatibility_evidence_failed/u,
  "verifier must isolate metrics callback failures from the authentication decision");

assert.match(manifest, /node test-spec012-t032-legacy-audience-compatibility\.mjs/u,
  "T032 readiness regression must be registered in the Spec 012 manifest");

for (const [key, value] of Object.entries(record.non_effects)) {
  assert.equal(value, false, `${key} must remain false`);
}

console.log("Spec 012 T032 legacy-audience compatibility readiness tests passed");
