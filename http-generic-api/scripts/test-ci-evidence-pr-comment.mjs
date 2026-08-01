#!/usr/bin/env node
import assert from "node:assert/strict";
import { COMMENT_MARKER, normalizeEvidence, renderEvidenceSection, upsertEvidenceComment } from "./ci-evidence-pr-comment.mjs";

const HEAD = "a".repeat(40);
const MERGE = "b".repeat(40);

const e2e = normalizeEvidence({
  workflow: "E2E Phase Governance",
  prNumber: 42,
  workflowRunId: 100,
  sourceHeadSha: HEAD,
  report: {
    contract: "mad4b.ci-evidence-summary.v1",
    identity: { candidate_kind: "head", candidate_sha: HEAD },
    outcome: "passed",
    first_failure: null,
    integrity_findings: [],
    secrets_included: false
  }
});
assert.equal(e2e.candidateKind, "head");
assert.match(renderEvidenceSection(e2e), /canonical artifact/u);

const first = upsertEvidenceComment("", e2e);
assert.equal(first.changed, true);
assert.match(first.body, new RegExp(COMMENT_MARKER, "u"));
assert.match(first.body, /run_id=100/u);

const newer = upsertEvidenceComment(first.body, { ...e2e, runId: 101, outcome: "failed", detail: "new failure" });
assert.equal(newer.changed, true);
assert.doesNotMatch(newer.body, /run_id=100/u);
assert.match(newer.body, /run_id=101/u);
assert.match(newer.body, /new failure/u);

const stale = upsertEvidenceComment(newer.body, { ...e2e, runId: 99 });
assert.equal(stale.changed, false);
assert.equal(stale.reason, "newer_section_already_present");
assert.match(stale.body, /run_id=101/u);

const branch = normalizeEvidence({
  workflow: "Branch Test Diagnostic Shards",
  prNumber: 42,
  workflowRunId: 102,
  sourceHeadSha: HEAD,
  report: {
    contract: "mad4b.test-diagnostic-summary.v2",
    ref: "refs/pull/42/merge",
    commitSha: MERGE,
    selectedCount: 773,
    passedCount: 773,
    failedCount: 0,
    secretsIncluded: false
  }
});
assert.equal(branch.candidateKind, "merge_candidate");
assert.equal(branch.candidateSha, MERGE);
const combined = upsertEvidenceComment(newer.body, branch);
assert.match(combined.body, /e2e-phase-governance/u);
assert.match(combined.body, /branch-test-diagnostic/u);
assert.match(combined.body, /merge_candidate/u);

assert.throws(() => normalizeEvidence({
  workflow: "E2E Phase Governance",
  prNumber: 42,
  workflowRunId: 103,
  sourceHeadSha: HEAD,
  report: {
    contract: "mad4b.ci-evidence-summary.v1",
    identity: { candidate_kind: "head", candidate_sha: MERGE },
    outcome: "passed",
    secrets_included: false
  }
}), /does not match workflow_run head_sha/u);

console.log(JSON.stringify({ ok: true, tests: 6, gate: "ci_evidence_pr_comment_supersession", secrets_included: false }));
