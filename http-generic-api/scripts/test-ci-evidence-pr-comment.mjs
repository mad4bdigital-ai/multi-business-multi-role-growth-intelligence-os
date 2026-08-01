#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  COMMENT_MARKER,
  assertCurrentPullRequestIdentity,
  normalizeEvidence,
  renderEvidenceSection,
  selectCurrentPullRequest,
  upsertEvidenceComment
} from "./ci-evidence-pr-comment.mjs";

const REPOSITORY = "mad4bdigital-ai/example";
const HEAD_BRANCH = "gpt/example-workstream";
const HEAD = "a".repeat(40);
const MERGE = "b".repeat(40);
const OTHER = "c".repeat(40);

const e2e = normalizeEvidence({
  workflow: "E2E Phase Governance",
  workflowConclusion: "success",
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
assert.equal(e2e.workflowConclusion, "success");
assert.match(renderEvidenceSection(e2e), /canonical artifact/u);
assert.match(renderEvidenceSection(e2e), /Workflow conclusion/u);

const first = upsertEvidenceComment("", e2e);
assert.equal(first.changed, true);
assert.match(first.body, new RegExp(COMMENT_MARKER, "u"));
assert.match(first.body, /run_id=100/u);

const newer = upsertEvidenceComment(first.body, {
  ...e2e,
  workflowConclusion: "failure",
  runId: 101,
  outcome: "failed",
  detail: "new failure"
});
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
  workflowConclusion: "success",
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
  workflowConclusion: "success",
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

assert.throws(() => normalizeEvidence({
  workflow: "E2E Phase Governance",
  workflowConclusion: "failure",
  prNumber: 42,
  workflowRunId: 104,
  sourceHeadSha: HEAD,
  report: {
    contract: "mad4b.ci-evidence-summary.v1",
    identity: { candidate_kind: "head", candidate_sha: HEAD },
    outcome: "passed",
    secrets_included: false
  }
}), /Non-successful workflow_run cannot publish a passed canonical outcome/u);

assert.throws(() => normalizeEvidence({
  workflow: "Branch Test Diagnostic Shards",
  workflowConclusion: "success",
  prNumber: 42,
  workflowRunId: 105,
  sourceHeadSha: HEAD,
  report: {
    contract: "mad4b.test-diagnostic-summary.v2",
    ref: "refs/pull/42/merge",
    commitSha: MERGE,
    selectedCount: 773,
    passedCount: 772,
    failedCount: 1,
    secretsIncluded: false
  }
}), /Successful workflow_run cannot publish a non-passed canonical outcome/u);

const matchingPr = {
  number: 42,
  state: "open",
  head: { repo: { full_name: REPOSITORY }, ref: HEAD_BRANCH, sha: HEAD },
  merge_commit_sha: MERGE
};
assert.equal(selectCurrentPullRequest({
  pullRequests: [matchingPr],
  repository: REPOSITORY,
  headBranch: HEAD_BRANCH,
  sourceHeadSha: HEAD
}).number, 42);
assert.throws(() => selectCurrentPullRequest({
  pullRequests: [{ ...matchingPr, head: { ...matchingPr.head, sha: OTHER } }],
  repository: REPOSITORY,
  headBranch: HEAD_BRANCH,
  sourceHeadSha: HEAD
}), /Unable to resolve an open pull request/u);
assert.throws(() => selectCurrentPullRequest({
  pullRequests: [matchingPr, { ...matchingPr, number: 43 }],
  repository: REPOSITORY,
  headBranch: HEAD_BRANCH,
  sourceHeadSha: HEAD
}), /Ambiguous pull request resolution/u);

assert.equal(assertCurrentPullRequestIdentity(matchingPr, e2e, HEAD_BRANCH), true);
assert.throws(
  () => assertCurrentPullRequestIdentity({ ...matchingPr, head: { ...matchingPr.head, sha: OTHER } }, e2e, HEAD_BRANCH),
  /stale PR head/u
);
assert.throws(
  () => assertCurrentPullRequestIdentity({ ...matchingPr, head: { ...matchingPr.head, ref: "gpt/substituted" } }, e2e, HEAD_BRANCH),
  /substituted PR head branch/u
);
assert.equal(assertCurrentPullRequestIdentity(matchingPr, branch, HEAD_BRANCH), true);
assert.throws(
  () => assertCurrentPullRequestIdentity({ ...matchingPr, merge_commit_sha: OTHER }, branch, HEAD_BRANCH),
  /stale or substituted merge candidate/u
);

const sanitized = renderEvidenceSection({
  ...e2e,
  detail: "@octocat <b>unsafe</b> `inline`"
});
assert.doesNotMatch(sanitized, /@octocat/u);
assert.doesNotMatch(sanitized, /<b>/u);
assert.match(sanitized, /＠octocat/u);
assert.match(sanitized, /&lt;b&gt;unsafe&lt;\/b&gt;/u);

console.log(JSON.stringify({
  ok: true,
  tests: 17,
  gate: "ci_evidence_pr_resolution_identity_conclusion_and_sanitization",
  secrets_included: false
}));
