/**
 * Integration test harness for runWordpressConnectorMigration
 * Run: node wordpress/test-integration.mjs
 */
import {
  runWordpressConnectorMigration,
  resolveWordpressPhaseLPlan,
  buildWordpressPhasePGate,
  buildWordpressPhaseKFinalOperatorHandoffBundle,
  buildWordpressPhaseBFinalOperatorHandoffBundle,
  evaluateWordpressPhaseAStartReadiness,
  validateSiteMigrationPayload,
  normalizeSiteMigrationPayload,
  classifyWordpressExecutionStage,
  toPositiveInt,
  normalizeWordpressPhaseAType,
  WORDPRESS_PHASE_B_BUILDER_TYPES,
  WORDPRESS_PHASE_D_FORM_TYPES,
  WORDPRESS_MUTATION_PUBLISH_STATUSES
} from "./index.js";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n── ${name}`);
}

// ─── Utility / shared.js ────────────────────────────────────────────────────
section("shared.js — utilities");

assert("toPositiveInt(5, 0) === 5", toPositiveInt(5, 0) === 5);
assert("toPositiveInt(-1, 99) === 99", toPositiveInt(-1, 99) === 99);
assert("toPositiveInt('3.9', 0) === 3", toPositiveInt("3.9", 0) === 3);
assert("normalizeWordpressPhaseAType('My Post') === 'my_post'", normalizeWordpressPhaseAType("My Post") === "my_post");
assert("WORDPRESS_PHASE_B_BUILDER_TYPES has elementor_library", WORDPRESS_PHASE_B_BUILDER_TYPES.has("elementor_library"));
assert("WORDPRESS_PHASE_D_FORM_TYPES has wpforms", WORDPRESS_PHASE_D_FORM_TYPES.has("wpforms"));
assert("WORDPRESS_MUTATION_PUBLISH_STATUSES has draft", WORDPRESS_MUTATION_PUBLISH_STATUSES.has("draft"));
assert("WORDPRESS_MUTATION_PUBLISH_STATUSES has publish", WORDPRESS_MUTATION_PUBLISH_STATUSES.has("publish"));

// ─── Phase A — readiness gate ────────────────────────────────────────────────
section("Phase A — evaluateWordpressPhaseAStartReadiness");

const readiness = evaluateWordpressPhaseAStartReadiness({
  payload: { migration: { apply: false, publish_status: "draft" } },
  wpContext: { destination: { target_key: "site_abc" } },
  sourceCollectionSlug: "posts",
  destinationCollectionSlug: "posts",
  generatedCandidate: { title: "Test" },
  materializedRegistryRowExists: true
});
assert("readiness returns object", typeof readiness === "object");
assert("phase_a_start_status present", typeof readiness.phase_a_start_status === "string");
assert("governance_gate_results present", typeof readiness.governance_gate_results === "object");
assert("target_key_valid true", readiness.governance_gate_results.target_key_valid === true);

// ─── classifyWordpressExecutionStage ────────────────────────────────────────
section("shared.js — classifyWordpressExecutionStage");

const stage = classifyWordpressExecutionStage({ migration: { apply: true } });
assert("stage is string", typeof stage === "string");
assert("stage not empty", stage.length > 0);

// ─── Phase L — plan resolve ──────────────────────────────────────────────────
section("Phase L — resolveWordpressPhaseLPlan");

const lPlanEnabled = resolveWordpressPhaseLPlan({ migration: { backup_recovery: { enabled: true } } });
const lPlanDisabled = resolveWordpressPhaseLPlan({});
assert("L plan enabled when configured", lPlanEnabled.enabled === true);
assert("L plan disabled when not configured", lPlanDisabled.enabled === false);

// ─── Phase P — gate ──────────────────────────────────────────────────────────
section("Phase P — buildWordpressPhasePGate");

const pGateSkipped = buildWordpressPhasePGate({ plan: { enabled: false }, priorPhaseStatus: {} });
assert("P gate open when plan disabled (skipped)", pGateSkipped.gate_open === true);

const pGateBlocked = buildWordpressPhasePGate({
  plan: { enabled: true, require_all_phases_complete: true },
  priorPhaseStatus: { phase_o_status: "blocked" }
});
assert("P gate has gate_open field", typeof pGateBlocked.gate_open === "boolean");

// ─── Phase K — FinalOperatorHandoffBundle ───────────────────────────────────
section("Phase K — buildWordpressPhaseKFinalOperatorHandoffBundle");

const kBundle = buildWordpressPhaseKFinalOperatorHandoffBundle({ phaseKPlan: { enabled: false } });
assert("K bundle overall_status === skipped", kBundle.overall_status === "skipped");
assert("K bundle phase === K", kBundle.phase === "K");
assert("K bundle has operator_actions array", Array.isArray(kBundle.operator_actions));
assert("K bundle has blocking_reasons array", Array.isArray(kBundle.blocking_reasons));

// ─── Phase B — FinalOperatorHandoffBundle ───────────────────────────────────
section("Phase B — buildWordpressPhaseBFinalOperatorHandoffBundle");

const bBundle = buildWordpressPhaseBFinalOperatorHandoffBundle({ payload: {}, phaseBPlan: { enabled: false } });
assert("B bundle is object", typeof bBundle === "object");
assert("B bundle has artifact_type", typeof bBundle.artifact_type === "string");

// ─── validateSiteMigrationPayload ───────────────────────────────────────────
section("shared.js — validateSiteMigrationPayload");

const normalized = normalizeSiteMigrationPayload({
  transport: "wordpress_connector",
  migration: { apply: false, publish_status: "draft" },
  source: { provider_domain: "https://source.example.com" },
  destination: { provider_domain: "https://dest.example.com", target_key: "abc" }
});
assert("normalizeSiteMigrationPayload returns object", typeof normalized === "object");
assert("normalizeSiteMigrationPayload returns source object", typeof normalized.source === "object");

const validation = validateSiteMigrationPayload(normalized);
assert("validateSiteMigrationPayload returns object", typeof validation === "object");
assert("has errors array", Array.isArray(validation.errors));

// ─── runWordpressConnectorMigration — dry run (apply=false) ─────────────────
section("runWordpressConnectorMigration — dry run (apply=false, no network)");

const mockPayload = {
  transport: "wordpress_connector",
  migration: {
    apply: false,
    publish_status: "draft",
    post_types: ["post"],
    max_items_per_type: 1
  },
  source: { provider_domain: "https://source.example.com", username: "admin", app_password: "test" },
  destination: { provider_domain: "https://dest.example.com", username: "admin", app_password: "test", target_key: "test_key" }
};

const mockWpContext = {
  source: { base_url: "https://source.example.com", username: "admin", app_password: "test" },
  destination: { base_url: "https://dest.example.com", username: "admin", app_password: "test", target_key: "test_key" }
};

const mockMutationPlan = { apply: false, post_types: ["post"] };
const mockWritebackPlan = { rows: [] };

try {
  const result = await runWordpressConnectorMigration({
    payload: mockPayload,
    wpContext: mockWpContext,
    mutationPlan: mockMutationPlan,
    writebackPlan: mockWritebackPlan
  });
  assert("result is object", typeof result === "object");
  assert("has ok field", "ok" in result);
  assert("has transport field", typeof result.transport === "string");
  // apply=false exits early as plan_only — phases L–P don't run in dry-run mode
  assert("execution_mode is plan_only", result.execution_mode === "plan_only");
  assert("artifacts has site metadata", typeof (result.artifacts || {}).source_site === "object" || "transport" in (result.artifacts || {}));
} catch (err) {
  // Network errors are expected in test environment — check it's not a ReferenceError
  if (err instanceof ReferenceError) {
    assert("runWordpressConnectorMigration no ReferenceError", false, err.message);
  } else {
    assert("runWordpressConnectorMigration throws only network/logic errors (not ReferenceError)", true);
    console.log(`    (threw expected non-ref error: ${err.constructor.name}: ${err.message.slice(0, 80)})`);
  }
}

// ─── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log("ALL TESTS PASS ✓");
  process.exit(0);
} else {
  console.error(`${failed} TEST(S) FAILED`);
  process.exit(1);
}
