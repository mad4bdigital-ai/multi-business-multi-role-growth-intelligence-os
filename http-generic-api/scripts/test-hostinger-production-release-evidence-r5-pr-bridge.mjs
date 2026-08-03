#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const requestPath = "../.github/workflows/hostinger-production-release-evidence-r5-pr-target-request.yml";
const dispatcherPath = "../.github/workflows/hostinger-production-release-evidence-r5-pr-request-dispatcher.yml";
const request = fs.readFileSync(requestPath, "utf8");
const dispatcher = fs.readFileSync(dispatcherPath, "utf8");

assert.match(request, /^name:\s*Hostinger Production R5 PR Target Request$/mu);
assert.match(request, /^\s*pull_request_target:\s*$/mu);
assert.match(request, /types:\s*\[synchronize\]/u);
assert.match(request, /^\s*workflow_dispatch:\s*$/mu);
assert.doesNotMatch(request, /^\s*push:\s*$/mu);
assert.doesNotMatch(request, /^\s*issue_comment:\s*$/mu);
assert.match(request, /contents:\s*read/u);
assert.match(request, /pull-requests:\s*read/u);
assert.doesNotMatch(request, /actions:\s*write/u);
assert.doesNotMatch(request, /issues:\s*write/u);
assert.doesNotMatch(request, /contents:\s*write/u);
assert.doesNotMatch(request, /uses:\s*actions\/checkout/u);
assert.doesNotMatch(request, /secrets\./u);
assert.doesNotMatch(request, /(?:--method|-X)\s*(?:POST|PUT|PATCH|DELETE)/u);
assert.match(request, /github\.actor != 'github-actions\[bot\]'/u);
assert.match(request, /cross_repository_pull_request_forbidden/u);
assert.match(request, /protected_branch_mutation_forbidden/u);
assert.match(request, /pull_request_head_mismatch/u);
assert.match(request, /current_main_head_mismatch/u);
assert.match(request, /protected_production_mismatch/u);
assert.match(request, /target_workflow_blob_mismatch/u);
assert.match(request, /marker_file_scope_mismatch/u);
assert.match(request, /mad4b\.hostinger-production-release-evidence-r5-pr-request\.v1/u);
assert.match(request, /candidate_code_checkout:false/u);
assert.match(request, /repository_mutation_performed:false/u);
assert.match(request, /provider_access_performed:false/u);
assert.match(request, /credential_access_performed:false/u);
assert.match(request, /protected_branch_mutation:false/u);
assert.match(request, /force_push:false/u);
assert.match(request, /consult_job_logs:false/u);
assert.match(request, /secrets_included:false/u);
assert.match(request, /Upload exact-head R5 request/u);

assert.match(dispatcher, /^name:\s*Hostinger Production R5 PR Request Dispatcher$/mu);
assert.match(dispatcher, /^\s*workflow_run:\s*$/mu);
assert.match(dispatcher, /Hostinger Production R5 PR Target Request/u);
assert.match(dispatcher, /^\s*workflow_dispatch:\s*$/mu);
assert.doesNotMatch(dispatcher, /^\s*pull_request(?:_target)?:\s*$/mu);
assert.doesNotMatch(dispatcher, /^\s*push:\s*$/mu);
assert.doesNotMatch(dispatcher, /^\s*issue_comment:\s*$/mu);
assert.match(dispatcher, /actions:\s*write/u);
assert.match(dispatcher, /issues:\s*write/u);
assert.match(dispatcher, /contents:\s*read/u);
assert.match(dispatcher, /pull-requests:\s*read/u);
assert.doesNotMatch(dispatcher, /contents:\s*write/u);
assert.doesNotMatch(dispatcher, /secrets\./u);
assert.doesNotMatch(dispatcher, /\bgit\s+push\b/u);
assert.match(dispatcher, /Resolve and revalidate exact-head R5 request before dispatch/u);
assert.match(dispatcher, /gh run download/u);
assert.match(dispatcher, /report_source_run_id.*SOURCE_RUN_ID/su);
assert.match(dispatcher, /current_main_sha.*expected_main_sha/su);
assert.match(dispatcher, /current_production_sha.*EXPECTED_PRODUCTION_SHA/su);
assert.match(dispatcher, /EXPECTED_HEAD_REF.*main.*Production/su);
assert.match(dispatcher, /protected_branch_mutation_forbidden/u);
assert.match(dispatcher, /marker_file_scope_mismatch|MARKER_PATH/u);
assert.match(dispatcher, /target_workflow_blob/u);
assert.match(dispatcher, /HOSTINGER_PRODUCTION_RELEASE_EVIDENCE_R5 status=claiming/u);
assert.match(dispatcher, /hostinger-production-release-evidence-r5\.yml\/dispatches/u);
assert.match(dispatcher, /expected_head_sha/u);
assert.match(dispatcher, /for attempt in \$\(seq 1 60\)/u);
assert.match(dispatcher, /for attempt in \$\(seq 1 240\)/u);
assert.match(dispatcher, /actions_dispatch_only=true/u);
assert.match(dispatcher, /provider_access=false/u);
assert.match(dispatcher, /credential_access=false/u);
assert.match(dispatcher, /provider_mutation=false/u);
assert.match(dispatcher, /build_creation=false/u);
assert.match(dispatcher, /deployment=false/u);
assert.match(dispatcher, /release_activation=false/u);
assert.match(dispatcher, /restart=false/u);
assert.match(dispatcher, /sql=false/u);
assert.match(dispatcher, /migration_apply=false/u);
assert.match(dispatcher, /database_mutation=false/u);
assert.match(dispatcher, /protected_ref_mutation=false/u);
assert.match(dispatcher, /external_send=false/u);
assert.match(dispatcher, /secrets_included=false/u);

const validateIndex = dispatcher.indexOf("Resolve and revalidate exact-head R5 request before dispatch");
const claimIndex = dispatcher.indexOf("Record one-time PR bridge claim");
const dispatchIndex = dispatcher.indexOf("Dispatch exact trusted R5 workflow");
assert.ok(validateIndex >= 0 && validateIndex < claimIndex);
assert.ok(claimIndex >= 0 && claimIndex < dispatchIndex);

console.log(JSON.stringify({
  ok: true,
  tests: 78,
  gate: "hostinger_production_release_evidence_r5_pr_bridge",
  request_contract: "mad4b.hostinger-production-release-evidence-r5-pr-request.v1",
  pull_request_stage_read_only: true,
  trusted_workflow_run_dispatcher: true,
  exact_head_bound: true,
  production_bound: true,
  target_workflow_blob_bound: true,
  provider_access: false,
  credential_access: false,
  provider_mutation: false,
  build_creation: false,
  deployment: false,
  release_activation: false,
  restart: false,
  sql: false,
  migration_apply: false,
  database_mutation: false,
  protected_ref_mutation: false,
  force_push: false,
  external_send: false,
  secrets_included: false
}));
