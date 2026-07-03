import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const phase12 = readFileSync(
  "../specs/001-capability-security-hardening/phase12-verification-release-readiness.md",
  "utf8",
);
const releaseChecklist = readFileSync(
  "../specs/001-capability-security-hardening/checklists/release-readiness.md",
  "utf8",
);
const acceptanceMatrix = readFileSync(
  "../specs/001-capability-security-hardening/acceptance-matrix.md",
  "utf8",
);
const completion = JSON.parse(
  readFileSync("../specs/001-capability-security-hardening/completion.json", "utf8"),
);
const manifest = readFileSync("scripts/test-manifest.mjs", "utf8");
const packageJson = readFileSync("package.json", "utf8");

for (let task = 103; task <= 114; task += 1) {
  assert(phase12.includes(`T${task}`), `phase12 readiness record must include T${task}`);
}

for (const gate of [
  "Full unit, integration, and security suites",
  "Staging preview acceptance matrix",
  "Shadow evaluation mismatch review",
  "Latency and resource budgets",
  "Dependency-outage fail-closed proof",
  "Bounded staging mutations",
  "Security and architecture reviews",
  "Feature-flag rollback",
  "Production promotion approval",
  "Rollout by enforcement group",
  "Legacy branch retirement",
]) {
  assert(phase12.includes(gate), `phase12 readiness record must include gate: ${gate}`);
}

for (const blockedEvidence of [
  "awaiting full CI evidence",
  "Blocked until staging preview run",
  "Blocked until shadow run",
  "Blocked until benchmark run",
  "Blocked until outage drill",
  "Blocked until staging approval",
  "Blocked until reviews",
  "Blocked until rollback drill",
  "Not granted",
  "Not started",
]) {
  assert(phase12.includes(blockedEvidence), `phase12 must preserve blocker: ${blockedEvidence}`);
}

for (const safetyBoundary of [
  "does not authorize provider execution",
  "credential access",
  "external writes",
  "production mutation",
  "branch merge",
  "production promotion",
  "Do not merge any phase branch",
  "Do not use Phase 12 to create new approval infrastructure",
  "Do not expose admin-only decision trace detail to tenant surfaces",
  "Do not downgrade P0 containment during rollback",
  "Do not include secrets",
]) {
  assert(phase12.includes(safetyBoundary), `phase12 must state safety boundary: ${safetyBoundary}`);
}

for (const matrixId of [
  "A01",
  "B03",
  "C07",
  "D09",
  "E07",
  "F11",
  "G08",
  "H09",
  "I07",
  "J08",
]) {
  assert(acceptanceMatrix.includes(matrixId), `acceptance matrix must retain ${matrixId}`);
  assert(phase12.includes(matrixId[0]), `phase12 matrix record must include group ${matrixId[0]}`);
}

assert.equal(completion.status, "in_progress");
assert.equal(completion.current_increment.tasks_completed_count, 56);
assert.equal(completion.current_increment.tasks_remaining_count, 58);
assert.equal(completion.current_increment.tasks_remaining_range, "T027-T045,T073-T081,T085-T114");
for (const alreadyCompleteTask of ["T046", "T072", "T082", "T084"]) {
  assert(
    completion.current_increment.tasks_completed.includes(alreadyCompleteTask),
    `completion tracking must preserve ${alreadyCompleteTask} as complete`,
  );
}
assert.equal(completion.evidence.release_readiness.status, "blocked_for_full_release");
assert.equal(completion.evidence.release_readiness.production_promotion_authorized, false);
assert.equal(completion.secrets_included, false);

assert(phase12.includes("Local Phase Branch Inventory"));
for (const branchCommit of ["9264bfc0", "8b1f8085", "07ea3279", "28760484", "4cb45f8b", "94dc4e64"]) {
  assert(phase12.includes(branchCommit), `phase12 local branch inventory must include ${branchCommit}`);
}
assert.equal(completion.evidence.phase_branch_rollup.status, "local_phase_branches_implemented_pending_reconciliation_ci_and_release_gates");
assert.equal(completion.evidence.phase_branch_rollup.tasks_completed_count, 102);
assert.equal(completion.evidence.phase_branch_rollup.tasks_remaining_count, 12);
assert.equal(completion.evidence.phase_branch_rollup.tasks_remaining_range, "T103-T114");
assert.equal(completion.evidence.phase_branch_rollup.release_merge_allowed, false);
assert.equal(completion.evidence.phase_branch_rollup.ci_required_before_merge, true);
assert.equal(completion.evidence.phase_branch_rollup.production_promotion_authorized, false);
for (const completedRollupTask of ["T027", "T045", "T073", "T081", "T089", "T090", "T096", "T097", "T102"]) {
  assert(
    completion.evidence.phase_branch_rollup.tasks_completed.includes(completedRollupTask),
    `phase branch rollup must include ${completedRollupTask} as locally complete`,
  );
}

for (const reconciliationBoundary of [
  "Pre-Merge Reconciliation Queue",
  "not merge authorization",
  "release owner starts the reconciliation pass",
  "Integration branch must be clean before each queue entry",
  "Do not mark T103-T114 complete from this queue alone",
]) {
  assert(phase12.includes(reconciliationBoundary), `phase12 must preserve reconciliation boundary: ${reconciliationBoundary}`);
}
for (const queuedBranch of [
  "work/phase4-security-decision-engine-20260701",
  "work/phase8-local-consent-shell-files-20260701",
  "work/phase9-mutation-integrations-20260702",
  "work/phase10-status-observability-20260702",
  "work/phase11-contract-docs-migration-20260702",
  "work/phase12-verification-release-20260702",
]) {
  assert(phase12.includes(queuedBranch), `phase12 reconciliation queue must include ${queuedBranch}`);
}

for (const integrationBaseline of [
  "Integration Baseline Preflight",
  "work/capability-security-hardening-integration-20260702",
  "5e0cde4c",
  "node test-approval-hold-identity-release-readiness.mjs",
  "node test-spec-kit-phase0-containment-evidence.mjs",
  "node test-release-readiness-migration-drift.mjs",
  "node test-platform-plugin-strict-request-contract.mjs",
  "node test-local-project-path-repair-security.mjs",
  "node test-n8n-instance-mode-ownership-policy.mjs",
  "node test-cloudflare-mutation-policy-contract.mjs",
  "node test-explicit-mutation-policy-fail-closed.mjs",
  "node test-status-component-readiness-freshness.mjs",
  "node test-security-decision-trace-contract.mjs",
  "node test-audit-payload-evidence.mjs",
  "node test-tenant-platform-plugin-routes.mjs",
  "node test-tenant-platform-plugin-openapi.mjs",
  "node test-platform-plugin-contract-docs.mjs",
  "node test-openapi-route-coverage.mjs",
  "node test-platform-plugin-openapi-db-tag-parity.mjs",
  "node test-openapi-split-regeneration-parity.mjs",
  "node test-platform-degradation-policy.mjs",
  "node test-custom-gpt-schemas.mjs",
  "npm run schemas:check",
  "npm run schemas:guard",
  "tenant_core: 28 operations exceeds warning limit 26",
  "does not prove the phase branches are reconciled",
]) {
  assert(phase12.includes(integrationBaseline), `phase12 must preserve integration baseline: ${integrationBaseline}`);
}


for (const prTriageEvidence of [
  "Remote PR Triage Snapshot",
  "#2064",
  "head `5e0cde4c`",
  "#2059",
  "remote head `e8f27754`",
  "through `b8fb539d`",
  "#2031",
  "Migration 1030 apply/readback",
  "combined-status connector returned no statuses",
  "gh` CLI is not installed",
  "treat CI as unproven",
]) {
  assert(phase12.includes(prTriageEvidence), `phase12 must preserve PR triage evidence: ${prTriageEvidence}`);
}

for (const publishReadinessEvidence of [
  "Phase 12 Remote Publish Readiness",
  "ahead-only",
  "by 11 commits",
  "e8f27754..ad38f18d",
  "zero remote-only commits",
  "publish workflow requires the `gh` CLI",
  "push this branch first",
  "wait for PR `#2059` CI",
  "integration stack PR `#2064`",
]) {
  assert(phase12.includes(publishReadinessEvidence), `phase12 must preserve publish readiness evidence: ${publishReadinessEvidence}`);
}
assert(phase12.includes("node scripts/phase-branch-rollup-check.mjs"));
assert(packageJson.includes("release:phase-rollup-check"));
assert(releaseChecklist.includes("Explicit production-promotion approval has not been granted"));
assert(releaseChecklist.includes("Full release-readiness approval remains blocked"));
assert(manifest.includes("node test-phase12-verification-release-readiness.mjs"));

console.log("phase12 verification release readiness tests passed");
