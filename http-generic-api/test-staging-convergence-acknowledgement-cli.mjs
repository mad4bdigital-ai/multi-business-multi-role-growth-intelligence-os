import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const commit = "a".repeat(40);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "staging-convergence-ack-"));
const script = path.join(import.meta.dirname, "scripts/staging-environment-convergence-plan.mjs");
const runtimePath = path.join(dir, "runtime.json");
const preflightPath = path.join(dir, "preflight.json");
const wrapper = fs.readFileSync(path.join(import.meta.dirname, "../autopilot-portable-staging/Invoke-Staging-One-Click.ps1"), "utf8");
assert.match(wrapper, /\[string\]\$AcknowledgedConvergencePlanSha256/u);
assert.match(wrapper, /'--acknowledged-plan-sha256'/u);
assert.match(wrapper, /\$bridge\.convergence_run\.status -ne 'handoff_ready'/u);
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
const run = (ack = null) => spawnSync(process.execPath, [script,
  "--runtime-state", runtimePath, "--preflight", preflightPath,
  "--recovery-trust-exact", "false",
  ...(ack !== null ? ["--acknowledged-plan-sha256", ack] : []),
], { encoding: "utf8" });

try {
  write(runtimePath, { commit, certification_degraded_reasons: ["gateway_exact_commit"] });
  write(preflightPath, {
    status: "passed", expected_commit: commit, observed_commit: commit,
    safety: { production_access: false, provider_access: false, database_mutation: false, migration_apply: false },
  });
  const initial = run();
  assert.equal(initial.status, 0, initial.stderr);
  const plan = JSON.parse(initial.stdout);
  assert.equal(plan.status, "approval_required");
  const ack = plan.plan.plan_sha256;
  for (const invalid of ["b".repeat(64), "short"]) {
    const rejected = run(invalid);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /staging_convergence_acknowledgement_mismatch/u);
    assert.equal(rejected.stdout, "");
  }
  const accepted = run(ack);
  assert.equal(accepted.status, 0, accepted.stderr);
  const handoff = JSON.parse(accepted.stdout);
  assert.equal(handoff.status, "handoff_ready");
  assert.equal(handoff.plan.plan_sha256, ack);
  assert.equal(handoff.convergence_run.operator_acknowledgement.environment, "staging");
  assert.equal(handoff.convergence_run.operator_acknowledgement.commit_sha, commit);
  write(runtimePath, { commit: "b".repeat(40), certification_degraded_reasons: ["gateway_exact_commit"] });
  write(preflightPath, { status: "passed", expected_commit: "b".repeat(40), observed_commit: "b".repeat(40), safety: { production_access: false, provider_access: false, database_mutation: false, migration_apply: false } });
  assert.notEqual(run(ack).status, 0, "acknowledgement must not transfer to a different commit");
  assert.equal(handoff.convergence_run.operator_acknowledgement.operator_acknowledgement_is_execution_authority, false);
  assert.equal(handoff.convergence_run.governed_handoff.execution_performed, false);
  assert.equal(handoff.safety.provider_mutation, false);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
