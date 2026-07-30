import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GENERAL_MODE_CHOICE_POLICY_KEY,
  buildModeChoicePlan,
  persistModeChoiceSelection,
} from "./modeChoiceGovernanceService.js";

const guide = readFileSync(new URL("../AI_Agent_Knowledge_Guide.md", import.meta.url), "utf8");
const doc = readFileSync(new URL("../docs/mode-choice-governance.md", import.meta.url), "utf8");
const service = readFileSync(new URL("./modeChoiceGovernanceService.js", import.meta.url), "utf8");
const migrationName = "233_sprint68_general_mode_choice_governance.sql";
const migration = readFileSync(new URL(`./migrations/${migrationName}`, import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");
const readiness = readFileSync(new URL("./releaseReadiness.js", import.meta.url), "utf8");

for (const source of [guide, doc, migration]) {
  assert.ok(source.includes("runner_mode"), "runner_mode must be covered");
  assert.ok(source.includes("activation_mode"), "activation_mode must be covered");
  assert.ok(source.includes("integration_modes"), "integration_modes must be covered");
  assert.ok(source.includes("credential_scope"), "credential_scope must be covered");
  assert.ok(source.includes("reconciliation_mode"), "reconciliation_mode must be covered");
}

assert.ok(guide.includes("General mode-choice governance"));
assert.ok(guide.includes("multiple valid modes or scope selectors"));
assert.ok(guide.includes("fresh user-visible choice"));

assert.ok(doc.includes("When a governed execution can proceed through more than one valid mode"));
assert.ok(doc.includes("silently default to the first mode"));
assert.ok(doc.includes("mode_fallback_requires_user_choice"));
assert.ok(doc.includes("secrets_included=false"));

assert.ok(migration.includes("general_mode_choice_before_execution"));
assert.ok(migration.includes("agents_must_offer_user_choice_for_multiple_valid_modes_before_execution"));
assert.ok(migration.includes("future_registry_or_openapi_scope_mode_fields"));
assert.ok(migration.includes("silent_mode_switch_after_failure"));
assert.ok(migration.includes("platform_engine_policy_registry"));
assert.ok(migration.includes("platform_engine_policy_rules"));
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);

assert.ok(runner.includes(migrationName), "governed migration runner must allow the mode-choice governance migration");
assert.ok(readiness.includes(migrationName), "release readiness must track the mode-choice governance migration");
assert.match(service, /buildModeChoicePlan/);
assert.match(service, /persistModeChoiceSelection/);
assert.match(service, /writeExecutionEvidence/);
assert.match(service, /mode_choice_selection/);
assert.match(service, /mode_choice_evidence_write_failed/);

const modes = [
  {
    mode_key: "managed",
    label: "Platform managed",
    description: "Platform-owned runtime and governed credentials.",
    risk_class: "low",
    side_effect_class: "platform_managed_execution",
    expected_evidence: ["execution_log", "runtime_readback"],
    scope: { scope_type: "tenant", scope_ref: "tenant-alpha" },
    recommended: true,
  },
  {
    mode_key: "dedicated",
    label: "Tenant dedicated",
    description: "Tenant-owned runtime and credential references.",
    risk_class: "high",
    side_effect_class: "tenant_owned_external_execution",
    expected_evidence: ["credential_reference_readiness", "execution_log"],
    scope: { scope_type: "tenant_connection", scope_ref: "connection-alpha" },
  },
];

const requiredPlan = buildModeChoicePlan({
  choiceId: "choice-required",
  surfaceKey: "connector_activation",
  targetScope: { scope_type: "tenant", scope_ref: "tenant-alpha" },
  modes,
});
assert.equal(requiredPlan.mode_choice_required, true);
assert.equal(requiredPlan.execution_allowed, false);
assert.equal(requiredPlan.selected_mode, null);
assert.equal(requiredPlan.mode_choices_presented.length, 2);
assert.equal(requiredPlan.recommended_mode, "managed");
assert.match(requiredPlan.prompt_text, /managed/);
assert.match(requiredPlan.prompt_text, /dedicated/);
assert.match(requiredPlan.prompt_text, /risk=high/);
assert.match(requiredPlan.prompt_text, /scope=tenant_connection:connection-alpha/);
assert.equal(requiredPlan.secrets_included, false);

const explicitPlan = buildModeChoicePlan({
  choiceId: "choice-explicit",
  surfaceKey: "connector_activation",
  targetScope: { scope_type: "tenant", scope_ref: "tenant-alpha" },
  modes,
  selectedMode: "dedicated",
});
assert.equal(explicitPlan.mode_choice_required, false);
assert.equal(explicitPlan.execution_allowed, true);
assert.equal(explicitPlan.selected_mode, "dedicated");
assert.equal(explicitPlan.selection_source, "user_explicit");
assert.equal(explicitPlan.mode_default_used, false);
assert.equal(explicitPlan.prompt_text, null);

const singleModePlan = buildModeChoicePlan({
  choiceId: "choice-single",
  surfaceKey: "read_only_reconciliation",
  targetScope: { scope_type: "repository", scope_ref: "main" },
  modes: [modes[0]],
});
assert.equal(singleModePlan.mode_choice_required, false);
assert.equal(singleModePlan.selected_mode, "managed");
assert.equal(singleModePlan.selection_source, "single_valid_mode");

const mandatedPlan = buildModeChoicePlan({
  choiceId: "choice-mandated",
  surfaceKey: "production_deploy",
  targetScope: { scope_type: "environment", scope_ref: "production" },
  modes,
  mandatedMode: "managed",
});
assert.equal(mandatedPlan.mode_choice_required, false);
assert.equal(mandatedPlan.selected_mode, "managed");
assert.equal(mandatedPlan.selection_source, "policy_mandated");

const fallbackPlan = buildModeChoicePlan({
  choiceId: "choice-fallback",
  surfaceKey: "connector_activation",
  targetScope: { scope_type: "tenant", scope_ref: "tenant-alpha" },
  modes,
  fallbackFromMode: "managed",
});
assert.equal(fallbackPlan.mode_choice_required, true);
assert.equal(fallbackPlan.mode_fallback_requires_user_choice, true);
assert.match(fallbackPlan.prompt_text, /fresh choice is required/);

const fallbackSelectedPlan = buildModeChoicePlan({
  choiceId: "choice-fallback-selected",
  surfaceKey: "connector_activation",
  targetScope: { scope_type: "tenant", scope_ref: "tenant-alpha" },
  modes,
  fallbackFromMode: "managed",
  selectedMode: "dedicated",
});
assert.equal(fallbackSelectedPlan.mode_choice_required, false);
assert.equal(fallbackSelectedPlan.selected_mode, "dedicated");
assert.equal(fallbackSelectedPlan.selection_source, "user_explicit");
assert.equal(fallbackSelectedPlan.mode_fallback_requires_user_choice, true);

assert.throws(
  () => buildModeChoicePlan({
    surfaceKey: "connector_activation",
    targetScope: { scope_type: "tenant", scope_ref: "tenant-alpha" },
    modes,
    selectedMode: "unknown",
  }),
  (error) => error.code === "mode_choice_selected_mode_invalid"
);
assert.throws(
  () => buildModeChoicePlan({
    surfaceKey: "connector_activation",
    targetScope: { scope_type: "tenant", scope_ref: "tenant-alpha" },
    modes,
    selectedMode: "dedicated",
    mandatedMode: "managed",
  }),
  (error) => error.code === "mode_choice_policy_conflict"
);

let capturedEvidenceInput = null;
const persisted = await persistModeChoiceSelection({
  plan: explicitPlan,
  traceId: "mode-choice-trace-1",
  tenantId: "tenant-alpha",
  requestId: "request-alpha",
  skipSurfaceAuthority: true,
  writeEvidence: async (input) => {
    capturedEvidenceInput = input;
    return {
      ok: true,
      row: { id: 901, execution_status: "selection_recorded" },
      trace_id: input.traceId,
      secrets_included: false,
    };
  },
});
assert.equal(persisted.ok, true);
assert.equal(persisted.execution_log_id, 901);
assert.equal(persisted.selected_mode, "dedicated");
assert.equal(persisted.selection_source, "user_explicit");
assert.equal(persisted.evidence_recorded, true);
assert.equal(persisted.secrets_included, false);
assert.equal(capturedEvidenceInput.entryType, "mode_choice_selection");
assert.equal(capturedEvidenceInput.executionClass, "governed_mode_choice");
assert.equal(capturedEvidenceInput.executionMode, "dedicated");
assert.equal(capturedEvidenceInput.policyKeys, GENERAL_MODE_CHOICE_POLICY_KEY);
assert.equal(capturedEvidenceInput.policyEvidence.selected_mode, "dedicated");
assert.equal(capturedEvidenceInput.policyEvidence.selection_source, "user_explicit");
assert.equal(capturedEvidenceInput.policyEvidence.mode_default_used, false);
assert.equal(capturedEvidenceInput.policyEvidence.secrets_included, false);
assert.equal(capturedEvidenceInput.executionEvidenceStatus, "complete");

await assert.rejects(
  () => persistModeChoiceSelection({
    plan: requiredPlan,
    writeEvidence: async () => ({ ok: true, row: { id: 1 } }),
  }),
  (error) => error.code === "mode_choice_selection_required"
);
await assert.rejects(
  () => persistModeChoiceSelection({
    plan: explicitPlan,
    writeEvidence: async () => ({ ok: false, row: null }),
  }),
  (error) => error.code === "mode_choice_evidence_write_failed"
);

console.log("General mode-choice governance tests passed.");
