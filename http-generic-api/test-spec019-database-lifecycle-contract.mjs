import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SPEC = path.join(ROOT, "specs", "019-governed-database-lifecycle-pressure-relief");
const read = (relative) => fs.readFileSync(path.join(SPEC, relative), "utf8");
const json = (relative) => JSON.parse(read(relative));

for (const required of ["README.md", "spec.md", "plan.md", "tasks.md", "research.md", "data-model.md", "operation-paths.md", "threat-model.md", "testing-strategy.md", "rollout.md", "quickstart.md", "concerns.md", "traceability.md", "completion.json", "manifest.json", "e2e-phases.json", "work-map-integration.json", "checklists/requirements.md", "checklists/security.md", "checklists/operations.md", "decisions/ADR-001-reuse-resource-recipes-and-durable-execution.md", "decisions/ADR-002-plan-only-unknown-retention.md", "contracts/lifecycle-plan.schema.json", "contracts/authority-binding.schema.json", "contracts/approval-binding.schema.json", "contracts/mutation-receipt.schema.json", "contracts/lifecycle-evidence.schema.json", "contracts/error-catalog.json", "contracts/compatibility.md"]) {
  assert.ok(fs.existsSync(path.join(SPEC, required)), `missing Spec 019 artifact: ${required}`);
}

const spec = read("spec.md");
for (const phrase of ["immutable plan", "same-cycle readback", "exact resource", "logical cleanup", "physical reclaim", "response_chunks", "repo_file_audit_findings", "platform_engine_execution_runs", "arbitrary SQL", "fail closed"]) {
  assert.match(spec.toLowerCase(), new RegExp(phrase.replace(/[.*+?^${}()|[\\]\\]/g, "\\\\$&"), "i"), `missing contract phrase: ${phrase}`);
}

const planSchema = json("contracts/lifecycle-plan.schema.json");
assert.equal(planSchema.additionalProperties, false);
assert.ok(planSchema.required.includes("plan_fingerprint"));
assert.ok(planSchema.required.includes("requires_same_cycle_readback"));
assert.equal(planSchema.properties.authority_requirement.const, "exact_resource_and_recipe");

const authority = json("contracts/authority-binding.schema.json");
assert.equal(authority.properties.resource_type.const, "database_table");
assert.ok(authority.properties.resource_uri.pattern.includes("[^*]"));

const errors = json("contracts/error-catalog.json");
const codes = new Set(errors.errors.map((row) => row.code));
for (const code of ["DATABASE_LIFECYCLE_POLICY_MISSING", "DATABASE_PLAN_STALE", "DATABASE_PRESERVATION_INVARIANT_FAILED", "DATABASE_MUTATION_RECEIPT_REQUIRED"]) assert.ok(codes.has(code), `missing error code: ${code}`);
assert.equal(errors.secrets_included, false);

const e2e = json("e2e-phases.json");
assert.equal(e2e.feature_key, "019-governed-database-lifecycle-pressure-relief");
assert.equal(e2e.secrets_included, false);
assert.equal(e2e.phases[0].status, "implemented");

assert.doesNotMatch(read("contracts/compatibility.md"), /production mutation is authorized/i);
assert.doesNotMatch(read("spec.md"), /raw_sql_delete\s*[:=]\s*true/i);
console.log("Spec 019 governed database lifecycle contract tests passed.");
