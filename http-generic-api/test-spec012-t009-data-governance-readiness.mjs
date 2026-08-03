import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

const record = JSON.parse(read(
  "specs/012-tenant-activation-lifecycle/implementation/pr-2i-t009-data-governance-readiness.json",
));
const narrative = read(
  "specs/012-tenant-activation-lifecycle/implementation/pr-2i-t009-data-governance-readiness.md",
);
const tasks = read("specs/012-tenant-activation-lifecycle/tasks.md");
const concerns = read("specs/012-tenant-activation-lifecycle/concerns.md");
const dataModel = read("specs/012-tenant-activation-lifecycle/data-model.md");
const securityChecklist = read("specs/012-tenant-activation-lifecycle/checklists/security.md");

assert.equal(record.task_id, "T009");
assert.equal(record.status, "technical_review_complete_approval_required");
assert.equal(record.approval_gate.security_approval_registered, false);
assert.equal(record.approval_gate.legal_approval_registered, false);
assert.equal(record.approval_gate.retention_schedule_approved, false);
assert.equal(record.approval_gate.task_complete, false);
assert.equal(record.non_effects.database_mutation_performed, false);
assert.equal(record.non_effects.migration_applied, false);
assert.equal(record.non_effects.production_deployment_performed, false);
assert.equal(record.non_effects.secrets_included, false);

assert.match(tasks, /^- \[ \] \*\*T009\*\*/mu, "T009 must remain open until approvals are registered");
assert.match(concerns, /\| C-017 \| Credential safety \|/u);
assert.match(concerns, /\| C-018 \| Privacy \|/u);
assert.match(dataModel, /Final durations require security\/legal approval/u);
assert.match(securityChecklist, /Retention durations are approved\. Blocked by T009/u);
assert.match(narrative, /does \*\*not\*\* close T009/u);

const requiredClasses = new Set([
  "forbidden_secret_material",
  "restricted_identity_and_authority",
  "confidential_tenant_configuration",
  "internal_operational_evidence",
  "opaque_public_diagnostic",
]);
assert.deepEqual(
  new Set(record.classification_catalog.map(entry => entry.class_key)),
  requiredClasses,
);

const requiredEntities = new Set([
  "oauth_authorization_code_record",
  "access_token_verification_evidence",
  "session_context_summary",
  "activation_operation",
  "activation_stage_attempt",
  "activation_evidence_item",
  "activation_delivery_and_acknowledgement",
  "activation_reconciliation_attempt",
  "deployment_observation",
  "activation_attention_item",
  "questionnaire_answer_session",
  "governed_policy_proposal_and_activation",
]);
assert.deepEqual(
  new Set(record.entity_classification.map(entry => entry.entity)),
  requiredEntities,
);

for (const profile of record.retention_profiles) {
  assert.equal(profile.approval_required, true, `${profile.profile_key} must remain approval gated`);
  if (profile.profile_key === "raw_diagnostic_capture") {
    assert.equal(profile.default_enabled, false);
    assert.equal(profile.approved_duration_days, 0);
  } else {
    assert.equal(profile.approved_duration_days, null);
  }
}

const forbiddenFields = new Set(record.redaction_contract.forbidden_fields);
for (const field of [
  "access_token",
  "authorization_code",
  "authorization",
  "client_secret",
  "provider_credential",
  "private_key",
  "refresh_token",
  "raw_request_body",
  "raw_response_body",
  "full_conversation_content",
]) {
  assert.equal(forbiddenFields.has(field), true, `${field} must remain forbidden`);
}

assert.equal(
  record.redaction_contract.required_controls.includes(
    "sensitive_values_included_false_for_gpt_visible_evidence",
  ),
  true,
);
assert.equal(record.approval_gate.required_evidence.length >= 6, true);

console.log("Spec 012 T009 data governance readiness tests passed");
