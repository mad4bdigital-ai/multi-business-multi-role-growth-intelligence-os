import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const guide = readFileSync(new URL("../AI_Agent_Knowledge_Guide.md", import.meta.url), "utf8");
const doc = readFileSync(new URL("../docs/mode-choice-governance.md", import.meta.url), "utf8");
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

console.log("General mode-choice governance tests passed.");
