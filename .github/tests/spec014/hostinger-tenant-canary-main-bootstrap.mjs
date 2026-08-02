#!/usr/bin/env node
import fs from 'node:fs';

const workflowPath = '.github/workflows/hostinger-storage-tenant-canary-canonical-guard.yml';
const publisherPath = '.github/workflows/hostinger-ci-evidence-pr-publisher.yml';
const routingPath = '.github/ci-evidence-routing.json';

const workflow = fs.readFileSync(workflowPath, 'utf8');
const publisher = fs.readFileSync(publisherPath, 'utf8');
const routing = JSON.parse(fs.readFileSync(routingPath, 'utf8'));

function requireIncludes(source, needle, label) {
  if (!source.includes(needle)) {
    throw new Error(`${label}: missing required contract: ${needle}`);
  }
}

function requireExcludes(source, needle, label) {
  if (source.includes(needle)) {
    throw new Error(`${label}: forbidden contract present: ${needle}`);
  }
}

requireIncludes(workflow, 'name: Hostinger Storage Tenant Canary Guard', 'Tenant Canary workflow');
requireIncludes(workflow, 'pull_request:', 'Tenant Canary workflow');
for (const eventType of ['opened', 'reopened', 'synchronize', 'ready_for_review']) {
  requireIncludes(workflow, `      - ${eventType}`, 'Tenant Canary workflow event types');
}

for (const governedPath of [
  ".github/workflows/hostinger-storage-tenant-canary-canonical-guard.yml",
  ".changes/e2e/spec014-tenant-canary-canonical-evidence.json",
  "http-generic-api/scripts/hostinger-tenant-canary-ci.mjs",
  "http-generic-api/scripts/test-hostinger-tenant-canary-ci.mjs",
  "http-generic-api/hostingerStorageTenantCanary*.js",
  "http-generic-api/test-hostinger-storage-tenant-canary*.mjs",
  ".github/tests/spec014/tenant-canary-repository-provenance.mjs"
]) {
  requireIncludes(workflow, `      - '${governedPath}'`, 'Tenant Canary workflow path filter');
}

for (const broadGlob of ["'**/*.js'", "'**/*.mjs'", "'**/*.cjs'", "'**/*.ts'", "'**/*.tsx'"]) {
  requireExcludes(workflow, broadGlob, 'Tenant Canary workflow path filter');
}

requireIncludes(workflow, 'permissions:\n  contents: read', 'Tenant Canary workflow permissions');
for (const forbiddenPermission of ['contents: write', 'issues: write', 'pull-requests: write', 'actions: write']) {
  requireExcludes(workflow, forbiddenPermission, 'Tenant Canary workflow permissions');
}
requireIncludes(workflow, 'ref: ${{ env.CI_SOURCE_HEAD_SHA }}', 'Tenant Canary exact-head checkout');
requireIncludes(workflow, 'persist-credentials: false', 'Tenant Canary checkout safety');
requireIncludes(workflow, 'git ls-remote origin "refs/heads/${TARGET_REF}"', 'Tenant Canary remote identity verification');
requireIncludes(
  workflow,
  'node http-generic-api/scripts/hostinger-tenant-canary-ci.mjs --report-dir "${REPORT_DIR}"',
  'Tenant Canary canonical runner',
);
requireIncludes(workflow, 'name: hostinger-storage-tenant-canary-${{ github.run_id }}-summary', 'Tenant Canary artifact identity');
requireIncludes(workflow, 'if-no-files-found: error', 'Tenant Canary artifact enforcement');
requireIncludes(workflow, "report.contract !== 'mad4b.hostinger-guard-summary.v1'", 'Tenant Canary canonical contract enforcement');
requireIncludes(workflow, 'report.identity.candidate_sha !== process.env.CI_SOURCE_HEAD_SHA', 'Tenant Canary stale-head rejection');
requireIncludes(workflow, 'report.job_logs_consulted !== false', 'Tenant Canary no-log authority');
requireIncludes(workflow, 'report.secrets_included !== false', 'Tenant Canary secret-free boundary');

requireIncludes(publisher, 'name: Hostinger CI Evidence PR Publisher', 'Trusted publisher');
requireIncludes(publisher, 'workflow_run:', 'Trusted publisher trigger');
requireIncludes(publisher, '      - Hostinger Storage Tenant Canary Guard', 'Trusted publisher source workflow');
requireIncludes(publisher, 'ref: main', 'Trusted publisher checkout');
requireIncludes(publisher, 'persist-credentials: false', 'Trusted publisher checkout safety');
for (const permission of ['actions: read', 'contents: read', 'issues: write', 'pull-requests: write']) {
  requireIncludes(publisher, permission, 'Trusted publisher bounded permissions');
}
requireIncludes(publisher, 'hostinger-storage-tenant-canary-${{ github.event.workflow_run.id }}-summary', 'Trusted publisher artifact binding');
requireIncludes(publisher, 'SOURCE_HEAD_SHA: ${{ github.event.workflow_run.head_sha }}', 'Trusted publisher source-head binding');

const specializedPublisher = (routing.specialized_publishers || []).find(
  (entry) => entry.workflow === 'Hostinger CI Evidence PR Publisher',
);
if (!specializedPublisher) throw new Error('Routing: specialized Hostinger publisher registration is missing.');
if (specializedPublisher.trigger !== 'workflow_run') throw new Error('Routing: specialized publisher trigger must be workflow_run.');
if (specializedPublisher.trusted_ref !== 'main') throw new Error('Routing: specialized publisher trusted_ref must be main.');
if (specializedPublisher.exact_head_required !== true) throw new Error('Routing: exact-head enforcement is required.');
if (specializedPublisher.pr_head_workflows_may_write_comments !== false) {
  throw new Error('Routing: PR-head workflows must not write comments.');
}
if (!(specializedPublisher.routes || []).includes('Hostinger Storage Tenant Canary Guard')) {
  throw new Error('Routing: Tenant Canary workflow route is missing.');
}

const route = (routing.routes || []).find((entry) => entry.workflow === 'Hostinger Storage Tenant Canary Guard');
if (!route) throw new Error('Routing: Hostinger Tenant Canary route is missing.');
if (route.candidate_kind !== 'head') throw new Error('Routing: candidate_kind must be head.');
if (route.canonical_contract !== 'mad4b.hostinger-guard-summary.v1') {
  throw new Error('Routing: canonical contract mismatch.');
}
if (route.publisher_workflow !== 'Hostinger CI Evidence PR Publisher') {
  throw new Error('Routing: publisher workflow mismatch.');
}
if (route.canonical_artifact !== 'hostinger-storage-tenant-canary-${run_id}-summary') {
  throw new Error('Routing: canonical artifact mismatch.');
}

console.log(JSON.stringify({
  ok: true,
  contract: 'mad4b.hostinger-tenant-canary-main-bootstrap.v1',
  workflow: 'Hostinger Storage Tenant Canary Guard',
  publisher: 'Hostinger CI Evidence PR Publisher',
  candidate_kind: 'head',
  repository_mutation_performed: false,
  provider_dispatch_performed: false,
  credential_access_performed: false,
  job_logs_consulted: false,
  secrets_included: false,
}, null, 2));
