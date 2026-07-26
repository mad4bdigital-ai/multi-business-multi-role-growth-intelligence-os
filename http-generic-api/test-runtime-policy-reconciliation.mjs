import { readFileSync } from "node:fs";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed += 1;
  } else {
    console.error(`  [FAIL] ${label}${detail ? ` - ${detail}` : ""}`);
    failed += 1;
  }
}

function read(path) {
  return readFileSync(path, "utf8");
}

console.log("\n== Runtime policy reconciliation");

const migration = read("migrations/194_sprint66_runtime_policy_reconciliation.sql");
const runner = read("scripts/governed-migration-runner.mjs");
const readiness = read("releaseReadiness.js");
const evidenceLogger = read("executionEvidenceLogger.js");
const seedClassification = read("seed-entity-classification.mjs");

const requiredPolicies = [
  "Stale Duplicate Branch Merge Guard",
  "External App Action Preflight Visibility",
  "n8n Workflow Execution Guard",
  "Connector Dispatch Preflight Visibility",
  "Agent Loop Preflight Visibility",
  "Brand Writing Requires Brand Core",
];

assert("migration restores all required runtime execution_policies rows",
  requiredPolicies.every((policy) => migration.includes(policy)),
  requiredPolicies.filter((policy) => !migration.includes(policy)).join(", "));
assert("migration creates policy_logic_bindings bridge",
  migration.includes("CREATE TABLE IF NOT EXISTS `policy_logic_bindings`") &&
  migration.includes("runtime_policy_target_rule") &&
  migration.includes("legacy_policy_logic_mirror"));
assert("migration seeds target platform-engine policies and rules",
  migration.includes("platform_engine_policy_registry") &&
  migration.includes("platform_engine_policy_rules") &&
  migration.includes("runtime_repo_mutation_policy_v1") &&
  migration.includes("runtime_brand_writing_requires_brand_core"));
assert("migration keeps runtime compatibility through execution_policies",
  migration.includes("Runtime still reads execution_policies during transition") &&
  migration.includes("new policies must not be mirrored into logic_definitions"));
assert("governed migration runner allowlists reconciliation migration",
  runner.includes("194_sprint66_runtime_policy_reconciliation.sql"));
assert("release readiness checks live runtime policy seeds",
  readiness.includes("REQUIRED_RUNTIME_POLICY_SEEDS") &&
  readiness.includes("checkRuntimePolicySeedReadiness") &&
  readiness.includes("runtime_policy_seed_readiness") &&
  readiness.includes("policy_value_json_valid"));
assert("execution evidence logger accepts logic and engine association fields",
  evidenceLogger.includes("logicAssociationStatus") &&
  evidenceLogger.includes("engineAssociationStatus") &&
  evidenceLogger.includes("used_engine_registry_refs") &&
  evidenceLogger.includes("logic_association_status"));
assert("entity classification no longer targets execution_policies at logic_definitions",
  seedClassification.includes('"execution_policies",     "transitional"') &&
  seedClassification.includes("target policy model is platform_engine_policy_registry/platform_engine_policy_rules") &&
  seedClassification.includes('"policy_logic_bindings"'));

if (failed) {
  console.error(`\n${failed} runtime policy reconciliation assertion(s) failed.`);
  process.exit(1);
}

console.log(`\n${passed} runtime policy reconciliation assertion(s) passed.`);
