from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
READINESS = ROOT / "http-generic-api" / "releaseReadiness.js"
TEST = ROOT / "http-generic-api" / "test-release-readiness-migration-drift.mjs"
WORKFLOW = ROOT / ".github" / "workflows" / "spec011-ephemeral-checkout-preflight-current-main-bootstrap.yml"
TRIGGER = ROOT / ".github" / "spec011-ephemeral-checkout-preflight-current-main-trigger.json"
SELF = Path(__file__).resolve()

readiness_source = READINESS.read_text(encoding="utf-8")
readiness_needle = '''      } else if (
        filename === "20260721_repository_authority_capability_bindings_v2.sql"
        && /^ALTER\\s+TABLE\\s+`?workspace_resource_grants`?\\s+MODIFY\\s+COLUMN\\s+`?resource_type`?\\s+ENUM\\('workspace','brand','site','app','asset','workflow','agent','vault','repository'\\)\\s+NOT\\s+NULL$/i.test(normalized)
      ) {
        counts.alter_table_idempotent += 1;
      } else {
'''
readiness_replacement = '''      } else if (
        filename === "20260721_repository_authority_capability_bindings_v2.sql"
        && /^ALTER\\s+TABLE\\s+`?workspace_resource_grants`?\\s+MODIFY\\s+COLUMN\\s+`?resource_type`?\\s+ENUM\\('workspace','brand','site','app','asset','workflow','agent','vault','repository'\\)\\s+NOT\\s+NULL$/i.test(normalized)
      ) {
        counts.alter_table_idempotent += 1;
      } else if (
        filename === "20260728_operation_managed_git_ephemeral_checkout.sql"
        && /^ALTER\\s+TABLE\\s+`?operation_managed_git_worker_leases`?\\s+MODIFY\\s+COLUMN\\s+`?checkout_strategy`?\\s+ENUM\\('virtual_git_tree',\\s*'ephemeral_checkout'\\)\\s+NOT\\s+NULL$/i.test(normalized)
      ) {
        counts.alter_table_idempotent += 1;
      } else {
'''
readiness_matches = readiness_source.count(readiness_needle)
if readiness_matches != 1:
    raise SystemExit(f"releaseReadiness insertion contract matched {readiness_matches} times")
READINESS.write_text(readiness_source.replace(readiness_needle, readiness_replacement), encoding="utf-8")

test_source = TEST.read_text(encoding="utf-8")
test_needle = 'assert.equal(tagsWideningPreflight.counts.alter_table_idempotent, 1, "must count approved tags widening as idempotent/safe ALTER");\n'
test_replacement = '''assert.equal(tagsWideningPreflight.counts.alter_table_idempotent, 1, "must count approved tags widening as idempotent/safe ALTER");

const ephemeralCheckoutMigrationName = "20260728_operation_managed_git_ephemeral_checkout.sql";
const ephemeralCheckoutMigration = readFileSync(
  new URL(`migrations/${ephemeralCheckoutMigrationName}`, import.meta.url),
  "utf8"
);
const ephemeralCheckoutPreflight = assessMigrationSqlPreflight(
  ephemeralCheckoutMigrationName,
  ephemeralCheckoutMigration
);
assert.equal(ephemeralCheckoutPreflight.status, "pass", "reviewed Spec 011 enum widening must pass governed migration preflight");
assert.equal(ephemeralCheckoutPreflight.risk_count, 0, "reviewed Spec 011 enum widening must have zero preflight risks");
assert.equal(ephemeralCheckoutPreflight.counts.statements, 1, "Spec 011 enum widening must remain one bounded statement");
assert.equal(ephemeralCheckoutPreflight.counts.alter_table, 1, "Spec 011 enum widening must remain an ALTER TABLE");
assert.equal(ephemeralCheckoutPreflight.counts.alter_table_idempotent, 1, "the exact reviewed Spec 011 ALTER must be counted as approved/idempotent");

const unboundEphemeralCheckoutPreflight = assessMigrationSqlPreflight(
  "unreviewed-ephemeral-checkout.sql",
  ephemeralCheckoutMigration
);
assert.equal(unboundEphemeralCheckoutPreflight.status, "warn", "the same ALTER under another migration identity must remain review-gated");
assert(
  unboundEphemeralCheckoutPreflight.risks.some((risk) => risk.code === "alter_table_requires_manual_idempotency_review"),
  "unbound enum ALTER must retain the manual idempotency review warning"
);
'''
test_matches = test_source.count(test_needle)
if test_matches != 1:
    raise SystemExit(f"test insertion contract matched {test_matches} times")
TEST.write_text(test_source.replace(test_needle, test_replacement), encoding="utf-8")

for args in (
    ["node", "--check", "releaseReadiness.js"],
    ["node", "--check", "test-release-readiness-migration-drift.mjs"],
    ["node", "test-release-readiness-migration-drift.mjs"],
):
    subprocess.run(args, cwd=ROOT / "http-generic-api", check=True)

for path in (WORKFLOW, TRIGGER, SELF):
    path.unlink()

print("Spec 011 exact migration preflight contract patched on current main and validated")
