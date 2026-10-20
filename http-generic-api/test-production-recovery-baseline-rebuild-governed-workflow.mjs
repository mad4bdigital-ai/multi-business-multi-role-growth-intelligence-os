import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateRuntimeBootstrapRecoveryCompatibility, projectRuntimeBootstrapRecoveryCompatibility } from "../.github/ops/production-recovery-baseline-rebuild-governed.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/governed-production-promotion-dispatch-bridge.yml"), "utf8");
const runner = fs.readFileSync(path.join(ROOT, ".github/ops/production-recovery-baseline-rebuild-governed.mjs"), "utf8");
const constitution = JSON.parse(fs.readFileSync(path.join(ROOT, "http-generic-api/config/repository-governance-constitution.json"), "utf8"));
const derivedGovernance = JSON.parse(fs.readFileSync(path.join(ROOT, ".github/derived-state-governance.json"), "utf8"));
const runtimeBootstrap = fs.readFileSync(path.join(ROOT, "http-generic-api/runtimeBootstrapContract.js"), "utf8");

assert.match(workflow, /issue_comment:[\s\S]*types:\s*\[created\]/u);
assert.match(workflow, /github\.event\.issue\.number == 6813/u);
assert.match(workflow, /startsWith\(github\.event\.comment\.body, 'APPLY_HOSTINGER_RUNTIME_BASELINE_REBUILD:'\)/u);
assert.match(workflow, /startsWith\(github\.event\.comment\.body, 'APPROVE PRODUCTION RECOVERY '\)/u);
assert.match(workflow, /contents:\s*read/u);
assert.match(workflow, /issues:\s*write/u);
assert.match(workflow, /BACKEND_API_KEY:\s*\$\{\{\s*secrets\.BACKEND_API_KEY\s*\}\}/u);

const productionRecoveryJobs = [
  "Prepare exact Production baseline rebuild approval",
  "Execute one approved Production Recovery role step",
  "Read exact Production Recovery Control Store bootstrap plan",
  "Apply exact Production Recovery Control Store schema plan",
];
for (const jobName of productionRecoveryJobs) {
  const start = workflow.indexOf(`name: ${jobName}`);
  assert.ok(start >= 0, `${jobName} must remain registered`);
  const tail = workflow.slice(start);
  const nextJob = tail.match(/\n  [A-Za-z0-9_-]+:\n(?=\s+name:)/u);
  const block = nextJob ? tail.slice(0, nextJob.index) : tail;
  assert.match(block, /environment:\s*\n\s*name:\s*Production\s*\n\s*deployment:\s*false/u, `${jobName} must bind the Production environment without creating a deployment`);
  assert.match(block, /BACKEND_API_KEY:\s*\$\{\{\s*secrets\.BACKEND_API_KEY\s*\}\}/u, `${jobName} must consume the Production-scoped backend key`);
}

assert.match(workflow, /cancel-in-progress:\s*false/u);

for (const criticalPath of [
  ".changes/e2e/production-recovery-baseline-authority-bridge-7999-20260924.json",
  ".github/ops/production-recovery-baseline-rebuild-governed.mjs",
]) {
  assert.ok(constitution.control_plane_paths.includes(criticalPath), criticalPath + " must be Constitution-registered");
  assert.ok(derivedGovernance.convergence.automation_control_paths.includes(criticalPath), criticalPath + " must be convergence-registered");
}

assert.match(runner, /APPLY_HOSTINGER_RUNTIME_BASELINE_REBUILD:\(\[0-9a-f\]\{40\}\):production-runtime:governance,runtime_persistence/u);
assert.match(runner, /APPROVE PRODUCTION RECOVERY/u);
assert.match(runner, /capability_key:\s*"database_full_inspection"/u);
assert.match(runner, /inspection_durable !== true/u);
assert.match(runner, /mutation_grade_durable !== true/u);
assert.match(runner, /capability_key:\s*"remediation_plan_create"/u);
assert.match(runner, /\/admin\/recovery\/kernel\/approval-challenge/u);
assert.match(runner, /\/admin\/recovery\/kernel\/execute-approved/u);
assert.match(runner, /server_issued_execution_ticket !== true/u);
assert.match(runner, /execution_ticket_returned !== false/u);
assert.match(runner, /approval_token_returned !== false/u);
assert.match(runner, /automatic_rerun_allowed:\s*false/u);
assert.match(runner, /\/admin\/recovery\/kernel\/runs\//u);
assert.match(runner, /PRODUCTION_RUNTIME_PARITY_PATHS/u);
assert.match(runner, /CONTROLLER_SOURCE_PATH/u);
assert.match(runner, /mad4b\.production-recovery-source-compatibility\.v2/u);
assert.match(runner, /mad4b\.production-recovery-current-main-controller-authority\.v1/u);
assert.match(runner, /RECOVERY_BRIDGE_CONTROLLER_MAIN_MISMATCH/u);
assert.match(runner, /RECOVERY_BRIDGE_PRODUCTION_ANCESTRY_INVALID/u);
assert.match(runner, /RECOVERY_BRIDGE_OPERATION_COMPATIBILITY_INVALID/u);
assert.match(runner, /operation_scoped_compatibility/u);
assert.match(runner, /RECOVERY_BRIDGE_SOURCE_PARITY_MISMATCH/u);
assert.match(runner, /RECOVERY_BRIDGE_SOURCE_PARITY_CHANGED/u);
assert.match(runner, /source_parity_hash/u);

assert.ok(
  runner.indexOf('capability_key: "database_full_inspection"')
    < runner.indexOf('capability_key: "remediation_plan_create"'),
  "fresh inspection must precede plan creation",
);
assert.ok(
  runner.indexOf("/admin/recovery/kernel/approval-challenge")
    < runner.indexOf("/admin/recovery/kernel/execute-approved"),
  "server-side approval challenge must precede consequential execution",
);

assert.doesNotMatch(runner, /execute_sql_capsule|execute_shell_capsule|raw_sql|ssh_command|GRANT ALL/iu);
assert.doesNotMatch(runner, /execution_ticket_id\s*:/u);
assert.doesNotMatch(runner, /approval_token\s*:/u);

const projection = projectRuntimeBootstrapRecoveryCompatibility(runtimeBootstrap);
assert.equal(projection.verified, true);
assert.equal(projection.replacement_count, 8);
assert.equal(projection.reviewed_transformations.length, 8);
assert.doesNotMatch(projection.projected_source, /staging_recovery_only/u);

const compatible = evaluateRuntimeBootstrapRecoveryCompatibility({
  currentSource: runtimeBootstrap,
  productionSource: projection.projected_source,
});
assert.equal(compatible.verified, true);
assert.equal(compatible.projected_source_matches_exact_production, true);
assert.equal(compatible.canonical_seed_path_preserved, true);
assert.equal(compatible.baseline_rebuild_boundary_present, true);
assert.equal(compatible.additive_staging_recovery_scope_only, true);
assert.equal(compatible.operation, "database.rebuild_empty");
assert.deepEqual(compatible.selected_roles, ["governance", "runtime_persistence"]);

const unexpectedDrift = evaluateRuntimeBootstrapRecoveryCompatibility({
  currentSource: runtimeBootstrap + "\n// unexpected recovery semantic drift\n",
  productionSource: projection.projected_source,
});
assert.equal(unexpectedDrift.verified, false);
assert.equal(unexpectedDrift.projected_source_matches_exact_production, false);

const alteredReviewedExtension = runtimeBootstrap.replace(
  'rootName = "staging-recovery-migrations";',
  'rootName = "staging-recovery-migrations-v2";',
);
const alteredProjection = projectRuntimeBootstrapRecoveryCompatibility(alteredReviewedExtension);
assert.equal(alteredProjection.verified, false);
assert.equal(alteredProjection.failure, "reviewed_transformation_missing_or_ambiguous");

console.log("production_recovery_baseline_rebuild_governed=PASS");