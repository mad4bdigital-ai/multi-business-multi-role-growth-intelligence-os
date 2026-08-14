import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildReport,
  evaluateBranch,
  policySha256,
  renderBranchCsv,
  renderBranchMarkdown,
  sortBranchesForTriage,
  summarizeBranches,
} from "../../http-generic-api/scripts/maintenance-tools/branch-hygiene-policy.mjs";

const policy = JSON.parse(fs.readFileSync(new URL("../branch-hygiene-policy.json", import.meta.url), "utf8"));
const NOW = Date.parse("2026-08-14T00:00:00.000Z");
const OLD = "2026-06-01T00:00:00.000Z";
const RECENT = "2026-08-10T00:00:00.000Z";

function branch(name, overrides = {}) {
  return {
    name,
    sha: `${"a".repeat(39)}${String(name.length % 10)}`,
    commitAt: OLD,
    mergedIntoDefault: true,
    ...overrides,
  };
}

const context = (openPrHeads = [], protectedBranches = []) => ({
  nowMs: NOW,
  openPrHeads: new Set(openPrHeads),
  protectedBranches: new Set(protectedBranches),
});

test("merged old branch with no PR is delete eligible", () => {
  const result = evaluateBranch(branch("gpt/old-merged"), policy, context());
  assert.equal(result.category, "delete_eligible");
  assert.equal(result.eligibleForDelete, true);
  assert.equal(result.protected, false);
  assert.equal(result.excluded, false);
});

test("open PR always blocks deletion", () => {
  const result = evaluateBranch(branch("gpt/old-with-pr"), policy, context(["gpt/old-with-pr"]));
  assert.equal(result.category, "open_pull_request");
  assert.equal(result.eligibleForDelete, false);
});

test("main and Production are protected by policy", () => {
  for (const name of ["main", "Production"]) {
    const result = evaluateBranch(branch(name), policy, context());
    assert.equal(result.category, "protected");
    assert.equal(result.eligibleForDelete, false);
  }
});

test("provider-protected branch cannot be deleted", () => {
  const result = evaluateBranch(branch("gpt/provider-protected"), policy, context([], ["gpt/provider-protected"]));
  assert.equal(result.category, "protected");
  assert.equal(result.protectedByProvider, true);
  assert.equal(result.eligibleForDelete, false);
});

test("Spec 015 is excluded even when old and merged", () => {
  const result = evaluateBranch(branch("feat/spec015-tenant-audit-convergence"), policy, context());
  assert.equal(result.category, "excluded_namespace");
  assert.equal(result.excluded, true);
  assert.equal(result.eligibleForDelete, false);
});

test("Promotion, recovery, and evidence namespaces are excluded", () => {
  for (const name of [
    "release/production-candidate-abc",
    "gpt/validate-production-candidate-abc",
    "chore/repository-inventory-main-sync-abc",
    "chore/work-map-main-sync-abc",
    "gpt/production-promotion-recovery",
  ]) {
    const result = evaluateBranch(branch(name), policy, context());
    assert.equal(result.category, "excluded_namespace", name);
    assert.equal(result.eligibleForDelete, false, name);
  }
});

test("old unmerged branch is review-only, never delete eligible", () => {
  const result = evaluateBranch(branch("gpt/old-unmerged", { mergedIntoDefault: false, uniqueCommits: 3 }), policy, context());
  assert.equal(result.category, "review_only_unmerged");
  assert.equal(result.reviewOnly, true);
  assert.equal(result.eligibleForDelete, false);
});

test("recent merged branch remains inside grace period", () => {
  const result = evaluateBranch(branch("gpt/recent-merged", { commitAt: RECENT }), policy, context());
  assert.equal(result.category, "merged_within_grace_period");
  assert.equal(result.eligibleForDelete, false);
});

test("unclassified old namespace remains review-only rather than deleted", () => {
  const result = evaluateBranch(branch("tmp/old-unmerged", { mergedIntoDefault: false }), policy, context());
  assert.equal(result.category, "review_only_unmerged_namespace_unclassified");
  assert.equal(result.eligibleForDelete, false);
});

test("summary counts categories without granting mutation authority", () => {
  const branches = [
    evaluateBranch(branch("gpt/delete"), policy, context()),
    evaluateBranch(branch("gpt/open"), policy, context(["gpt/open"])),
    evaluateBranch(branch("gpt/unmerged", { mergedIntoDefault: false }), policy, context()),
  ];
  const summary = summarizeBranches(branches);
  assert.equal(summary.total, 3);
  assert.equal(summary.delete_eligible, 1);
  assert.equal(summary.open_pull_request, 1);
  assert.equal(summary.review_only_unmerged, 1);
  assert.equal(summary.deleted, 0);
});

test("policy has a stable SHA for audit binding", () => {
  assert.match(policySha256(policy), /^[0-9a-f]{64}$/);
  assert.equal(policy.apply_confirmation, "APPLY_BRANCH_HYGIENE");
  assert.equal(policy.default_mode, "dry_run");
  assert.equal(policy.schedule_mode, "apply");
});

test("v2 triage fields identify owner, reason, age band, and namespace", () => {
  const result = evaluateBranch(branch("gpt/old-merged"), policy, context());
  assert.equal(result.priority, "high");
  assert.equal(result.reasonCode, "merged_old_no_open_pr");
  assert.equal(result.recommendedAction, "delete_on_apply");
  assert.equal(result.actionOwner, "automation");
  assert.equal(result.ageBand, "aging_46_90d");
  assert.equal(result.namespace, "gpt");
  assert.equal(result.priorityRank, 1);
});

test("old unmerged work is actionable for maintainers but never delete eligible", () => {
  const result = evaluateBranch(branch("gpt/old-unmerged-v2", { mergedIntoDefault: false, uniqueCommits: 3 }), policy, context());
  assert.equal(result.priority, "medium");
  assert.equal(result.reasonCode, "old_unmerged_work_requires_decision");
  assert.equal(result.recommendedAction, "review_unmerged_or_archive");
  assert.equal(result.actionOwner, "maintainer");
  assert.equal(result.uniqueCommitCount, 3);
  assert.equal(result.eligibleForDelete, false);
});

test("triage sort is deterministic by priority, age, unique commits, then name", () => {
  const items = [
    evaluateBranch(branch("feat/medium-two", { mergedIntoDefault: false, uniqueCommits: 2 }), policy, context()),
    evaluateBranch(branch("gpt/high-younger", { commitAt: "2026-07-20T00:00:00.000Z" }), policy, context()),
    evaluateBranch(branch("gpt/high-older", { commitAt: "2026-06-01T00:00:00.000Z" }), policy, context()),
    evaluateBranch(branch("feat/medium-one", { mergedIntoDefault: false, uniqueCommits: 4 }), policy, context()),
  ];
  assert.deepEqual(sortBranchesForTriage(items).map((item) => item.name), [
    "gpt/high-older",
    "gpt/high-younger",
    "feat/medium-one",
    "feat/medium-two",
  ]);
});

test("CSV and Markdown render sortable actionable evidence", () => {
  const branches = [
    evaluateBranch(branch("gpt/delete"), policy, context()),
    evaluateBranch(branch("feat/unmerged", { mergedIntoDefault: false, uniqueCommits: 4 }), policy, context()),
  ];
  const report = buildReport({
    policy,
    policyPath: ".github/branch-hygiene-policy.json",
    repo: "example/repo",
    defaultBranch: "main",
    defaultSha: "b".repeat(40),
    mode: "dry_run",
    branches,
    generatedAt: "2026-08-14T00:00:00.000Z",
  });
  const csv = renderBranchCsv(report.branches);
  const markdown = renderBranchMarkdown(report);
  assert.match(csv, /^name,namespace,sha,commitAt,ageDays,ageBand,/);
  assert.ok(csv.indexOf("gpt/delete") < csv.indexOf("feat/unmerged"));
  assert.match(markdown, /# Branch Hygiene Triage Report/);
  assert.match(markdown, /delete_on_apply/);
  assert.match(markdown, /review_unmerged_or_archive/);
  assert.match(markdown, /Default branch SHA/);
});

test("policy v2 declares age bands and the canonical triage sort order", () => {
  assert.equal(policy.report_contract, "mad4b.branch-hygiene-report.v2");
  assert.deepEqual(policy.triage_sort_order, [
    "priority_rank_asc",
    "age_days_desc",
    "unique_commit_count_desc",
    "name_asc",
  ]);
  assert.equal(policy.age_band_days.review, 45);
});
