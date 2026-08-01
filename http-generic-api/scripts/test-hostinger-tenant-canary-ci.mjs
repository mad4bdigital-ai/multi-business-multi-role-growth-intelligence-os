#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CONTRACT,
  GUARD_KEY,
  WORKFLOW,
  buildTenantCanaryReport,
  redactBounded,
  validateTenantCanaryReport
} from "./hostinger-tenant-canary-ci.mjs";

const HEAD = "a".repeat(40);
const passingResults = Array.from({ length: 8 }, (_, index) => ({
  check_id: `check-${index + 1}`,
  exit_code: 0,
  duration_ms: index + 1,
  stdout_tail: "",
  stderr_tail: ""
}));

const passed = buildTenantCanaryReport({
  candidateSha: HEAD,
  rawResults: passingResults,
  generatedAt: "2026-08-02T00:00:00.000Z"
});
assert.equal(passed.contract, CONTRACT);
assert.equal(passed.workflow, WORKFLOW);
assert.equal(passed.guard_key, GUARD_KEY);
assert.equal(passed.identity.candidate_kind, "head");
assert.equal(passed.identity.candidate_sha, HEAD);
assert.equal(passed.outcome, "passed");
assert.equal(passed.checks.selected_count, 8);
assert.equal(passed.checks.passed_count, 8);
assert.equal(passed.checks.failed_count, 0);
assert.equal(passed.first_failure, null);
assert.deepEqual(passed.integrity_findings, []);
assert.equal(passed.repository_mutation_performed, false);
assert.equal(passed.provider_dispatch_performed, false);
assert.equal(passed.credential_access_performed, false);
assert.equal(passed.job_logs_consulted, false);
assert.equal(passed.secrets_included, false);
assert.equal(validateTenantCanaryReport(passed), true);

const failed = buildTenantCanaryReport({
  candidateSha: HEAD,
  rawResults: passingResults.map((item, index) => index === 3 ? {
    ...item,
    check_id: "runtime-provenance",
    exit_code: 1,
    stdout_tail: "bounded output",
    stderr_tail: "token=super-secret-value"
  } : item),
  generatedAt: "2026-08-02T00:00:00.000Z"
});
assert.equal(failed.outcome, "failed");
assert.equal(failed.checks.passed_count, 7);
assert.equal(failed.checks.failed_count, 1);
assert.equal(failed.first_failure.check_id, "runtime-provenance");
assert.doesNotMatch(failed.first_failure.stderr_tail, /super-secret-value/u);
assert.match(failed.first_failure.stderr_tail, /token=\[REDACTED\]/u);
assert.equal(validateTenantCanaryReport(failed), true);

const invalidIdentity = buildTenantCanaryReport({
  candidateSha: "invalid",
  rawResults: passingResults,
  generatedAt: "2026-08-02T00:00:00.000Z"
});
assert.equal(invalidIdentity.outcome, "failed");
assert.equal(invalidIdentity.integrity_findings[0].code, "INVALID_CANDIDATE_SHA");
assert.throws(() => validateTenantCanaryReport(invalidIdentity), /candidate identity is invalid/u);

const incomplete = buildTenantCanaryReport({
  candidateSha: HEAD,
  rawResults: passingResults.slice(0, 7),
  generatedAt: "2026-08-02T00:00:00.000Z"
});
assert.equal(incomplete.outcome, "failed");
assert.equal(incomplete.integrity_findings[0].code, "INCOMPLETE_CHECK_SET");
assert.throws(() => validateTenantCanaryReport(incomplete), /counts are inconsistent/u);

const redactedAuthorization = redactBounded("Authorization: Bearer abcdef");
assert.doesNotMatch(redactedAuthorization, /abcdef/u);
assert.match(redactedAuthorization, /REDACTED/u);
assert.equal(redactBounded("password=hunter2"), "password=[REDACTED]");
assert.doesNotMatch(redactBounded(`ghp_${"x".repeat(32)}`), /ghp_/u);
assert.equal(redactBounded("x".repeat(2500)).length, 2000);

assert.throws(() => validateTenantCanaryReport({ ...passed, contract: "wrong" }), /contract mismatch/u);
assert.throws(() => validateTenantCanaryReport({ ...passed, workflow: "wrong" }), /identity mismatch/u);
assert.throws(() => validateTenantCanaryReport({ ...passed, secrets_included: true }), /secret-free/u);
assert.throws(() => validateTenantCanaryReport({ ...passed, job_logs_consulted: true }), /log-independent/u);
assert.throws(() => validateTenantCanaryReport({ ...passed, checks: { ...passed.checks, selected_count: 7 } }), /counts are inconsistent/u);
assert.throws(() => validateTenantCanaryReport({ ...passed, outcome: "unknown" }), /outcome is invalid/u);

const workflow = fs.readFileSync(
  new URL("../../.github/workflows/hostinger-storage-tenant-canary-guard.yml", import.meta.url),
  "utf8"
);
assert.match(workflow, /^name: Hostinger Storage Tenant Canary Guard$/mu);
assert.match(workflow, /^\s*contents:\s*read\s*$/mu);
assert.doesNotMatch(workflow, /^\s*contents:\s*write\s*$/mu);
assert.doesNotMatch(workflow, /^\s*issues:\s*write\s*$/mu);
assert.doesNotMatch(workflow, /^\s*pull-requests:\s*write\s*$/mu);
assert.match(workflow, /^\s*ref:\s*\$\{\{ env\.CI_SOURCE_HEAD_SHA \}\}\s*$/mu);
assert.match(workflow, /^\s*persist-credentials:\s*false\s*$/mu);
assert.match(workflow, /hostinger-storage-tenant-canary-\$\{\{ github\.run_id \}\}-summary/u);
assert.match(workflow, /^\s*if:\s*always\(\)\s*$/mu);
assert.match(workflow, /job_logs_consulted !== false/u);
assert.match(workflow, /repository_mutation_performed !== false/u);
assert.doesNotMatch(workflow, /git\s+push/iu);
assert.doesNotMatch(workflow, /workflow_dispatch/u);

console.log(JSON.stringify({
  ok: true,
  tests: 49,
  gate: "hostinger_tenant_canary_canonical_report_producer",
  secrets_included: false
}));
