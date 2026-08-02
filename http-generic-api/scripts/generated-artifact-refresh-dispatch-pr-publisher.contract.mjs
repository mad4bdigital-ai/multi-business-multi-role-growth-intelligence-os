import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertGeneratedArtifactDispatchPrIdentity,
  normalizeGeneratedArtifactDispatchEvidence,
} from "./generated-artifact-refresh-dispatch-pr-publisher.mjs";

const headSha = "a".repeat(40);

function report({
  outcome = "passed",
  targetRef = "gpt/example",
  expectedHeadSha = headSha,
  prNumber = 4531,
  dispatchRequested = outcome === "passed",
  firstFailure = outcome === "blocked" ? { code: "workflow_dispatch_rejected" } : null,
  reason = outcome === "skipped" ? "refresh_label_missing" : null,
  secretsIncluded = false,
  sourceOfTruth = "structured_report",
  consultJobLogs = false,
} = {}) {
  return {
    contract: "mad4b.governed-generated-artifact-refresh-dispatch.v1",
    outcome,
    reason,
    target_ref: targetRef,
    expected_head_sha: expectedHeadSha,
    pr_number: prNumber,
    dispatch_requested: dispatchRequested,
    delegated_workflow: dispatchRequested ? "governed-generated-artifact-refresh.yml" : null,
    first_failure: firstFailure,
    source_of_truth: sourceOfTruth,
    job_logs_role: "diagnostic_only",
    consult_job_logs: consultJobLogs,
    protected_branch_mutation: false,
    force_push: false,
    secrets_included: secretsIncluded,
  };
}

const passed = normalizeGeneratedArtifactDispatchEvidence({
  report: report(),
  workflowConclusion: "success",
  workflowRunId: 101,
});
assert.equal(passed.candidateSha, headSha);
assert.equal(passed.sourceHeadSha, headSha);
assert.equal(passed.targetRef, "gpt/example");
assert.equal(passed.prNumber, 4531);
assert.equal(passed.outcome, "passed");
assert.equal(passed.detail, "governed writer dispatch requested");
assert.equal(
  assertGeneratedArtifactDispatchPrIdentity({
    state: "open",
    head: { repo: { full_name: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os" }, ref: "gpt/example", sha: headSha },
  }, passed, "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os"),
  true,
);

const blocked = normalizeGeneratedArtifactDispatchEvidence({
  report: report({ outcome: "blocked", dispatchRequested: false }),
  workflowConclusion: "failure",
  workflowRunId: 102,
});
assert.equal(blocked.outcome, "failed");
assert.equal(blocked.detail, "workflow_dispatch_rejected");

const skipped = normalizeGeneratedArtifactDispatchEvidence({
  report: report({ outcome: "skipped", dispatchRequested: false }),
  workflowConclusion: "success",
  workflowRunId: 103,
});
assert.equal(skipped.outcome, "passed");
assert.equal(skipped.detail, "refresh_label_missing");

assert.throws(() => normalizeGeneratedArtifactDispatchEvidence({ report: report({ targetRef: "main" }), workflowConclusion: "success", workflowRunId: 104 }), /permitted work branch/u);
assert.throws(() => normalizeGeneratedArtifactDispatchEvidence({ report: report({ expectedHeadSha: "short" }), workflowConclusion: "success", workflowRunId: 105 }), /expected_head_sha/u);
assert.throws(() => normalizeGeneratedArtifactDispatchEvidence({ report: report({ prNumber: null }), workflowConclusion: "success", workflowRunId: 106 }), /PR number/u);
assert.throws(() => normalizeGeneratedArtifactDispatchEvidence({ report: report({ secretsIncluded: true }), workflowConclusion: "success", workflowRunId: 107 }), /secrets_included=false/u);
assert.throws(() => normalizeGeneratedArtifactDispatchEvidence({ report: report({ consultJobLogs: true }), workflowConclusion: "success", workflowRunId: 108 }), /Job-log independent/u);
assert.throws(() => normalizeGeneratedArtifactDispatchEvidence({ report: report({ sourceOfTruth: "job_log" }), workflowConclusion: "success", workflowRunId: 109 }), /structured/u);
assert.throws(() => normalizeGeneratedArtifactDispatchEvidence({ report: report({ outcome: "blocked", dispatchRequested: false }), workflowConclusion: "success", workflowRunId: 110 }), /blocked dispatcher/u);
assert.throws(() => normalizeGeneratedArtifactDispatchEvidence({ report: report(), workflowConclusion: "failure", workflowRunId: 111 }), /non-blocked/u);
assert.throws(() => normalizeGeneratedArtifactDispatchEvidence({ report: report({ dispatchRequested: false }), workflowConclusion: "success", workflowRunId: 112 }), /dispatch_requested=true/u);
assert.throws(() => assertGeneratedArtifactDispatchPrIdentity({ state: "closed", head: { repo: { full_name: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os" }, ref: "gpt/example", sha: headSha } }, passed, "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os"), /open PR/u);
assert.throws(() => assertGeneratedArtifactDispatchPrIdentity({ state: "open", head: { repo: { full_name: "other/repo" }, ref: "gpt/example", sha: headSha } }, passed, "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os"), /same-repository/u);
assert.throws(() => assertGeneratedArtifactDispatchPrIdentity({ state: "open", head: { repo: { full_name: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os" }, ref: "gpt/other", sha: headSha } }, passed, "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os"), /branch mismatch/u);
assert.throws(() => assertGeneratedArtifactDispatchPrIdentity({ state: "open", head: { repo: { full_name: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os" }, ref: "gpt/example", sha: "b".repeat(40) } }, passed, "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os"), /expected_head_sha/u);

const fallbackPublisherWorkflow = readFileSync("../.github/workflows/ci-evidence-pr-publisher.yml", "utf8");
assert.match(fallbackPublisherWorkflow, /- Governed Generated Artifact Refresh Dispatch/u);
assert.match(fallbackPublisherWorkflow, /governed-generated-artifact-refresh-dispatch-\$\{\{ github\.event\.workflow_run\.id \}\}/u);
assert.match(fallbackPublisherWorkflow, /canonical\/dispatch\.json/u);
assert.match(fallbackPublisherWorkflow, /generated-artifact-refresh-dispatch-pr-publisher\.mjs/u);

const dispatcherWorkflow = readFileSync("../.github/workflows/governed-generated-artifact-refresh-dispatch-v2.yml", "utf8");
assert.match(dispatcherWorkflow, /^name: Governed Generated Artifact Refresh Dispatch$/mu);
assert.match(dispatcherWorkflow, /^\s*issue_comment:\s*$/mu);
assert.match(dispatcherWorkflow, /^\s*workflow_dispatch:\s*$/mu);
assert.doesNotMatch(dispatcherWorkflow, /^\s*push:\s*$/mu);
assert.match(dispatcherWorkflow, /actions:\s*write/u);
assert.match(dispatcherWorkflow, /contents:\s*read/u);
assert.match(dispatcherWorkflow, /issues:\s*write/u);
assert.match(dispatcherWorkflow, /pull-requests:\s*read/u);
assert.doesNotMatch(dispatcherWorkflow, /contents:\s*write/u);
assert.match(dispatcherWorkflow, /Checkout trusted default branch publisher/u);
assert.match(dispatcherWorkflow, /ref:\s*main/u);
assert.match(dispatcherWorkflow, /persist-credentials:\s*false/u);
assert.match(dispatcherWorkflow, /governed-generated-artifact-refresh-dispatch-\$\{\{ github\.run_id \}\}/u);
assert.match(dispatcherWorkflow, /Publish canonical dispatch evidence directly/u);
assert.match(dispatcherWorkflow, /generated-artifact-refresh-dispatch-pr-publisher\.mjs/u);
assert.match(dispatcherWorkflow, /--source-head-sha "\$\{expected_head_sha\}"/u);
assert.match(dispatcherWorkflow, /workflow_conclusion="failure"/u);
assert.match(dispatcherWorkflow, /workflow_conclusion="success"/u);
assert.doesNotMatch(dispatcherWorkflow, /github\.ref_name/u);
assert.doesNotMatch(dispatcherWorkflow, /\bgit\s+push\b/u);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.generated-artifact-refresh-dispatch-pr-publisher-contract.v1",
  cases: 36,
  exact_head_bound: true,
  trusted_direct_publication: true,
  push_trigger_removed: true,
  job_logs_authoritative: false,
  protected_branch_mutation: false,
  secrets_included: false,
}));