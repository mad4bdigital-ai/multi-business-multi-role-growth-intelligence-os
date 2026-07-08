import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../specs/001-capability-security-hardening/", import.meta.url);
const tasks = await readFile(new URL("tasks.md", root), "utf8");
const validation = await readFile(new URL("containment-validation.md", root), "utf8");
const traceability = await readFile(new URL("traceability.md", root), "utf8");
const rollout = await readFile(new URL("rollout.md", root), "utf8");
const report = await readFile(new URL("tenant-reverification-unified-report-2026-06-23.md", root), "utf8");
const requirementsChecklist = await readFile(new URL("checklists/requirements.md", root), "utf8");
const securityChecklist = await readFile(new URL("checklists/security.md", root), "utf8");
const releaseChecklist = await readFile(new URL("checklists/release-readiness.md", root), "utf8");
const prChecklist = await readFile(new URL("checklists/pr-1879-phase0-merge.md", root), "utf8");
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const completion = JSON.parse(await readFile(new URL("completion.json", root), "utf8"));

for (let task = 1; task <= 9; task += 1) {
  const key = String(task).padStart(3, "0");
  assert.match(tasks, new RegExp(`^- \\[x\\] \\*\\*T${key}\\*\\*`, "m"), `T${key} must be checked for Phase 0 closure`);
}
const laterUnchecked = [...tasks.matchAll(/^- \[ \] \*\*T(0(1[0-9]|[2-9][0-9])|1[01][0-9])\*\*/gm)];
const laterChecked = [...tasks.matchAll(/^- \[x\] \*\*T(0(1[0-9]|[2-9][0-9])|1[01][0-9])\*\*/gm)];
assert(laterUnchecked.length > 0, "later Spec Kit work must remain explicitly tracked");
assert(laterChecked.length > 0, "previously completed later-phase evidence must be preserved");
assert.match(tasks, /^- \[x\] \*\*T010\*\*/m, "completed Phase 1 discovery evidence must remain preserved");
assert.match(tasks, /^- \[x\] \*\*T046\*\*/m, "previously completed credential-policy work must remain preserved");
assert.match(tasks, /^- \[ \] \*\*T114\*\*/m, "legacy retirement must remain open");

for (const required of [
  "Phase 0 — Safety containment (T001–T009)",
  "Unchecked T010–T114 remain open by design",
  "Growth Intelligence Platform Admin (`nagyxs@gmail.com`)",
  "Essam Nagy / Nagy (`mad4b.digital@gmail.com`)",
  "Growth Intelligence Platform Admin Assistant (`platform-admin@mad4b.com`)",
  "d98394a37310124f6d05069667a42664ee0e8e50",
  "7dd1e6f850c7eb2969d3790199ac56a674981c01",
  "203224b81b8cd7dc81d1f37d213d99722c36615f",
  "CAPABILITY_KILL_SWITCH_LOCAL_SHELL",
  "CI must pass again on the final reconciled PR head before merge",
  "same-cycle PR gate and GitHub merge audit",
  "Unrelated advancement of `main` does not invalidate this baseline",
  "Secrets included: `false`",
]) {
  assert(validation.includes(required), `containment validation evidence must include: ${required}`);
}

assert(traceability.includes("| T009 |"), "traceability must include T009 evidence");
assert(traceability.includes("containment-validation.md"), "traceability must point to the validation record");
assert(rollout.includes("containment-validation.md"), "rollout must point to the validation record");
assert(rollout.includes("tenant-reverification-unified-report-2026-06-23.md"), "rollout must preserve the tenant residual-risk report");
assert(validation.includes("tenant-reverification-unified-report-2026-06-23.md"), "containment validation must link the tenant report");
assert(validation.includes("5874a56d4dc5c3d11bce18e3166fd509fce74317253bd2e0305ff3c50485eb6f"), "containment validation must pin the report checksum");
assert(traceability.includes("3462323198"), "traceability must record GPT-tool broad-policy review closure");
assert(traceability.includes("3462323203"), "traceability must record app-action broad-policy review closure");

for (const required of [
  "عدد موجات الاختبار المكتملة:** 34",
  "المجموعات المحجوبة بعقد المنصة:** 3",
  "Actual execution: **NO**",
  "Provider calls: **0**",
  "Repository mutations: **0**",
  "3c8d16a0-2923-4065-934b-3e9e75382a4e",
  "28213bb6-be87-4212-8dad-21cc07edd44d",
  "لا يُنصح بإطلاق tenant execution العام",
]) {
  assert(report.includes(required), `tenant reverification report must include: ${required}`);
}

assert(requirementsChecklist.includes("Performance targets are measurable but still require baseline ratification"), "requirements checklist must retain the performance baseline gap");
assert(securityChecklist.includes("broad generic policies already match"), "security checklist must record the generic-policy regression closure");
assert(securityChecklist.includes("General tenant state-changing execution remains release-blocked"), "security checklist must preserve the execution block");
assert(releaseChecklist.includes("Eligible only for Phase 0 containment merge"), "release checklist must bound merge eligibility to containment");
assert(releaseChecklist.includes("Not eligible for unrestricted tenant execution"), "release checklist must deny unrestricted execution readiness");
assert(prChecklist.includes("Review comment `3462323198`"), "PR checklist must map the GPT-tool review comment");
assert(prChecklist.includes("Review comment `3462323203`"), "PR checklist must map the app-action review comment");
assert(prChecklist.includes("Full final-head repository test manifest"), "PR checklist must retain final-head test gating");

assert.equal(completion.schema_version, 1);
assert.equal(completion.feature_key, "001-capability-security-hardening");
assert.equal(completion.status, "in_progress", "full Spec Kit must remain in progress while implementation and release tasks remain open");
assert.equal(completion.delivery_mode, "multi_pr");
assert.equal(completion.current_increment.pull_request, 1969);
assert.equal(completion.current_increment.merge_scope, "canonical_capability_domain_alias_registry_and_integrity");
assert.equal(completion.evidence.phase0.status, "completed_increment");
assert.equal(completion.evidence.phase0.validation_record, "containment-validation.md");
assert.equal(completion.evidence.phase0.tenant_reverification_report, "tenant-reverification-unified-report-2026-06-23.md");
assert.equal(completion.evidence.phase0.report_sha256, "5874a56d4dc5c3d11bce18e3166fd509fce74317253bd2e0305ff3c50485eb6f");
assert.equal(completion.evidence.phase1.validation_record, "phase1-discovery-evidence-2026-06-26.md");
assert.equal(completion.evidence.phase2.pull_request, 1969);
assert.equal(completion.evidence.phase2.registry_migration, "http-generic-api/migrations/1030_sprint69_canonical_capability_domain.sql");
assert.equal(completion.evidence.release_readiness.unrestricted_tenant_execution_authorized, false);
assert.equal(completion.evidence.release_readiness.production_promotion_authorized, false);

for (const requiredFile of [
  "specs/001-capability-security-hardening/completion.json",
  "specs/001-capability-security-hardening/containment-validation.md",
  "specs/001-capability-security-hardening/tenant-reverification-unified-report-2026-06-23.md",
  "specs/001-capability-security-hardening/checklists/pr-1879-phase0-merge.md",
]) {
  assert(manifest.files.includes(requiredFile), `manifest must include: ${requiredFile}`);
}
assert(!validation.includes("is production-promotion approval"), "validation must not grant production promotion");
assert(validation.includes("not production-promotion approval"), "validation must deny implicit production approval");

console.log("Spec Kit Phase 0 containment evidence tests passed");
