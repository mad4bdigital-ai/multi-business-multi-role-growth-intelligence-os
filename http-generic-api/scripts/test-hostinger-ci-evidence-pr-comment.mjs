#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import { upsertEvidenceComment } from "./ci-evidence-pr-comment.mjs";
import { normalizeHostingerEvidence } from "./hostinger-ci-evidence-pr-comment.mjs";

const HEAD = "a".repeat(40);
const WORKFLOW = "Hostinger Storage Tenant Canary Guard";
const PUBLISHER_WORKFLOW = "CI Evidence PR Publisher";

function passingReport(overrides = {}) {
  return {
    contract: "mad4b.hostinger-guard-summary.v1",
    schema_version: 1,
    workflow: WORKFLOW,
    guard_key: "hostinger-storage-tenant-canary",
    identity: { candidate_kind: "head", candidate_sha: HEAD },
    outcome: "passed",
    checks: { selected_count: 8, passed_count: 8, failed_count: 0 },
    results: Array.from({ length: 8 }, (_, index) => ({
      check_id: `check-${index + 1}`,
      outcome: "passed",
      exit_code: 0,
      stdout_tail: "",
      stderr_tail: "",
      secrets_included: false
    })),
    first_failure: null,
    integrity_findings: [],
    job_logs_consulted: false,
    secrets_included: false,
    ...overrides
  };
}

const passed = normalizeHostingerEvidence({
  workflowConclusion: "success",
  workflowRunId: 200,
  sourceHeadSha: HEAD,
  report: passingReport()
});
assert.equal(passed.slug, "hostinger-storage-tenant-canary");
assert.equal(passed.workflow, WORKFLOW);
assert.equal(passed.candidateKind, "head");
assert.equal(passed.candidateSha, HEAD);
assert.equal(passed.outcome, "passed");
assert.match(passed.detail, /8\/8 guard checks passed/u);

const firstComment = upsertEvidenceComment("", passed);
assert.equal(firstComment.changed, true);
assert.match(firstComment.body, /mad4b-ci-evidence-authority/u);
assert.match(firstComment.body, /ci-evidence-section:hostinger-storage-tenant-canary:start run_id=200/u);
assert.match(firstComment.body, /Hostinger Storage Tenant Canary Guard/u);
assert.match(firstComment.body, /Job logs: diagnostic-only/u);

const failedReport = passingReport({
  outcome: "failed",
  checks: { selected_count: 8, passed_count: 7, failed_count: 1 },
  results: [
    ...Array.from({ length: 7 }, (_, index) => ({
      check_id: `check-${index + 1}`,
      outcome: "passed",
      exit_code: 0,
      stdout_tail: "",
      stderr_tail: "",
      secrets_included: false
    })),
    {
      check_id: "tenant-provenance",
      outcome: "failed",
      exit_code: 1,
      stdout_tail: "bounded output",
      stderr_tail: "bounded failure",
      secrets_included: false
    }
  ],
  first_failure: {
    code: "HOSTINGER_GUARD_CHECK_FAILED",
    check_id: "tenant-provenance",
    exit_code: 1,
    stdout_tail: "bounded output",
    stderr_tail: "bounded failure"
  }
});
const failed = normalizeHostingerEvidence({
  workflowConclusion: "failure",
  workflowRunId: 201,
  sourceHeadSha: HEAD,
  report: failedReport
});
assert.equal(failed.outcome, "failed");
assert.match(failed.detail, /tenant-provenance/u);
const replacement = upsertEvidenceComment(firstComment.body, failed);
assert.equal(replacement.changed, true);
assert.doesNotMatch(replacement.body, /run_id=200/u);
assert.match(replacement.body, /run_id=201/u);

assert.throws(() => normalizeHostingerEvidence({
  workflowConclusion: "success",
  workflowRunId: 202,
  sourceHeadSha: "b".repeat(40),
  report: passingReport()
}), /does not match workflow_run head_sha/u);
assert.throws(() => normalizeHostingerEvidence({
  workflowConclusion: "success",
  workflowRunId: 203,
  sourceHeadSha: HEAD,
  report: passingReport({ contract: "wrong.contract" })
}), /Unexpected Hostinger canonical contract/u);
assert.throws(() => normalizeHostingerEvidence({
  workflowConclusion: "success",
  workflowRunId: 204,
  sourceHeadSha: HEAD,
  report: passingReport({ workflow: "Other Guard" })
}), /guard identity mismatch/u);
assert.throws(() => normalizeHostingerEvidence({
  workflowConclusion: "success",
  workflowRunId: 205,
  sourceHeadSha: HEAD,
  report: passingReport({ guard_key: "other-guard" })
}), /guard identity mismatch/u);
assert.throws(() => normalizeHostingerEvidence({
  workflowConclusion: "success",
  workflowRunId: 206,
  sourceHeadSha: HEAD,
  report: passingReport({ secrets_included: true })
}), /secrets_included=false/u);
assert.throws(() => normalizeHostingerEvidence({
  workflowConclusion: "success",
  workflowRunId: 207,
  sourceHeadSha: HEAD,
  report: passingReport({ job_logs_consulted: true })
}), /must not consult Job logs/u);
assert.throws(() => normalizeHostingerEvidence({
  workflowConclusion: "success",
  workflowRunId: 208,
  sourceHeadSha: HEAD,
  report: passingReport({ checks: { selected_count: 8, passed_count: 7, failed_count: 0 } })
}), /check counts are inconsistent/u);
assert.throws(() => normalizeHostingerEvidence({
  workflowConclusion: "failure",
  workflowRunId: 209,
  sourceHeadSha: HEAD,
  report: passingReport()
}), /Non-successful workflow_run cannot publish a passed Hostinger outcome/u);
assert.throws(() => normalizeHostingerEvidence({
  workflowConclusion: "success",
  workflowRunId: 210,
  sourceHeadSha: HEAD,
  report: failedReport
}), /Successful workflow_run cannot publish a non-passed Hostinger outcome/u);

const publisherWorkflow = fs.readFileSync(
  new URL("../../.github/workflows/ci-evidence-pr-publisher.yml", import.meta.url),
  "utf8"
);
assert.match(publisherWorkflow, /^name: CI Evidence PR Publisher$/mu);
assert.match(publisherWorkflow, /^\s+- Hostinger Storage Tenant Canary Guard\s*$/mu);
assert.match(publisherWorkflow, /^\s*actions:\s*read\s*$/mu);
assert.match(publisherWorkflow, /^\s*issues:\s*write\s*$/mu);
assert.match(publisherWorkflow, /^\s*pull-requests:\s*write\s*$/mu);
assert.match(publisherWorkflow, /^\s*ref:\s*main\s*$/mu);
assert.match(publisherWorkflow, /^\s*persist-credentials:\s*false\s*$/mu);
assert.match(publisherWorkflow, /hostinger-storage-tenant-canary-\$\{\{ github\.event\.workflow_run\.id \}\}-summary/u);
assert.match(publisherWorkflow, /hostinger-ci-evidence-pr-comment\.mjs/u);
assert.match(publisherWorkflow, /generated-artifact-refresh-dispatch-pr-publisher\.mjs/u);
assert.match(publisherWorkflow, /Discover exact-head Hostinger Tenant Canary run/u);
assert.match(publisherWorkflow, /hostinger-storage-tenant-canary-canonical-guard\.yml/u);
assert.match(publisherWorkflow, /url\.searchParams\.set\('head_sha', headSha\)/u);
assert.match(publisherWorkflow, /item\?\.head_sha === headSha/u);
assert.match(publisherWorkflow, /steps\.hostinger_discovery\.outputs\.found == 'true'/u);
assert.match(publisherWorkflow, /hostinger-canonical\/hostinger-storage-tenant-canary-summary\.json/u);
assert.doesNotMatch(publisherWorkflow, /^\s*pull_request:\s*$/mu);

const routing = JSON.parse(fs.readFileSync(
  new URL("../../.github/ci-evidence-routing.json", import.meta.url),
  "utf8"
));
const route = routing.routes.find((item) => item.workflow === WORKFLOW);
assert.ok(route, "Hostinger Tenant Canary evidence route must exist.");
assert.equal(route.candidate_kind, "head");
assert.equal(route.canonical_contract, "mad4b.hostinger-guard-summary.v1");
assert.equal(route.canonical_artifact, "hostinger-storage-tenant-canary-${run_id}-summary");
assert.equal(route.publisher_workflow, PUBLISHER_WORKFLOW);
assert.equal(routing.pr_evidence_publisher.workflow, PUBLISHER_WORKFLOW);
assert.equal(routing.pr_evidence_publisher.hostinger_tenant_canary_workflow, WORKFLOW);
assert.equal(routing.pr_evidence_publisher.governed_generated_artifact_dispatch_workflow, "Governed Generated Artifact Refresh Dispatch");
assert.deepEqual(routing.specialized_publishers, []);
assert.equal(routing.secrets_included, false);

console.log(JSON.stringify({
  ok: true,
  tests: 42,
  gate: "hostinger_tenant_canary_canonical_evidence_publisher",
  publisher_workflow: PUBLISHER_WORKFLOW,
  exact_head_fallback: true,
  secrets_included: false
}));
