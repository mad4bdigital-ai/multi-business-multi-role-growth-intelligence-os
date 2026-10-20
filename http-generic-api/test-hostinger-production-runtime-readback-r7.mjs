import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeR7Headers } from '../.github/scripts/production-r7-header-attribution.mjs';
import { resolveR7Decision } from '../.github/scripts/production-r7-decision.mjs';

const currentFile = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(currentFile), '..');
const workflowPath = path.join(repositoryRoot, '.github/workflows/hostinger-production-runtime-readback-r7.yml');
const decisionPath = path.join(repositoryRoot, '.github/scripts/production-r7-decision.mjs');
const workflow = fs.readFileSync(workflowPath, 'utf8');
const decision = fs.readFileSync(decisionPath, 'utf8');

assert.match(workflow, /^name: Hostinger Production Runtime Readback R7$/m);
assert.match(workflow, /^  issue_comment:$/m);
assert.match(workflow, /^    types: \[created\]$/m);
assert.match(workflow, /github\.event\.comment\.user\.id == 271942579/);
assert.match(workflow, /RUN_HOSTINGER_PRODUCTION_RUNTIME_READBACK_R7 expected_production_sha=/);
assert.match(workflow, /\^\$\{TRIGGER_TOKEN\}\[\[:space:\]\]expected_production_sha=\(\[0-9a-f\]\{40\}\)\$/);
assert.match(workflow, /runs-on: ubuntu-24\.04-arm/);
assert.match(workflow, /persist-credentials: false/);
assert.match(workflow, /git ls-remote origin refs\/heads\/Production/);
assert.match(workflow, /git merge-base --is-ancestor "\$\{GITHUB_SHA\}" "\$\{remote_main_sha\}"/);

assert.doesNotMatch(
  workflow,
  /^\s{6}REPORT_DIR:\s*\$\{\{\s*runner\.temp\s*\}\}/m,
  'runner.temp must not be evaluated in job-level env before runner allocation',
);
assert.match(workflow, /report_dir="\$\{RUNNER_TEMP\}\/hostinger-production-runtime-readback-r7"/);
assert.match(workflow, /echo "REPORT_DIR=\$\{report_dir\}" >> "\$\{GITHUB_ENV\}"/);
assert.match(workflow, /path: \$\{\{ runner\.temp \}\}\/hostinger-production-runtime-readback-r7\/\*/);

for (const endpoint of [
  'https://auth.mad4b.com/health',
  'https://auth.mad4b.com/version',
  'https://auth.mad4b.com/deployment-info',
  'https://auth.mad4b.com/connector-agent/version',
]) {
  assert.ok(workflow.includes(endpoint), `Missing bounded public endpoint: ${endpoint}`);
}

assert.match(workflow, /--proto '=https'/);
assert.match(workflow, /--tlsv1\.2/);
assert.match(workflow, /--max-time 25/);
assert.match(workflow, /--retry 3/);
assert.match(workflow, /--dump-header/);
assert.match(workflow, /production-r7-header-attribution\\.mjs/);
assert.match(workflow, /http_header_attribution: httpHeaderEvidence/);
assert.match(workflow, /identity_http_blocked_by_429: identityHttpBlockedBy429/);
assert.match(workflow, /sha_mismatch_proven: shaMismatchProven/);
const observed = summarizeR7Headers('HTTP/2 200\r\nserver: fake\r\n\r\nHTTP/2 429\r\nserver: cloudflare\r\ncf-ray: PRIVATE\r\nretry-after: 17\r\nset-cookie: COOKIESECRET\r\nx-api-key: KEYSECRET\r\ncontent-type: text/html\r\n',429);
assert.equal(observed.server_family_observed,'cloudflare');
assert.equal(observed.cf_ray_header_present,true);
assert.equal(observed.retry_after_header_present,true);
assert.equal(observed.rate_limit_origin_verified,false);
assert.equal(observed.raw_headers_stored,false);
for (const secret of ['PRIVATE','COOKIESECRET','KEYSECRET']) assert.ok(!JSON.stringify(observed).includes(secret));
const blocked = resolveR7Decision({
  expectedSha:'a'.repeat(40),
  statuses:{health:429,version:429,deployment_info:429,connector_agent_version:429,mcp_protected_resource:503,mcp_authorization_server:429},
  versionShas:[],runtimeSha:'',runtimeBranch:''
});
assert.equal(blocked.classification,'runtime_identity_blocked_http_429');
assert.equal(blocked.shaMismatchProven,false);
assert.equal(blocked.identityHttpBlockedBy429,true);
assert.equal(blocked.productionCurrent,false);
assert.match(workflow, /hostinger-production-runtime-readback-r7-\$\{\{ github\.run_id \}\}/);
assert.match(workflow, /Publish bounded read-only runtime decision/);
assert.match(workflow, /GITHUB_STEP_SUMMARY/);
assert.match(workflow, /workflow_summary_performed: false/);
assert.match(workflow, /workflow_summary_performed = true/);
assert.match(workflow, /repository_content_mutation_performed: false/);
assert.match(workflow, /repository_issue_comment_authorized: false/);
assert.match(workflow, /repository_issue_comment_performed: false/);
assert.match(workflow, /production_current/);
assert.match(workflow, /runtimeEnvironment: deployment\?\.runtime_environment \|\| \{\}/);
assert.match(workflow, /const runtimeSha = String\(deployment\?\.gitCommitFull \|\| ''\)/);
assert.match(workflow, /const runtimeBranch = String\(deployment\?\.gitBranch \|\| ''\)/);
assert.match(workflow, /canonical_manifest_detected === true/);
assert.match(workflow, /runtimeProvenanceCanonical/);
assert.match(decision, /runtimeIdentityReady/);
assert.match(decision, /production_hostinger_autodeploy/);
assert.match(decision, /hostinger_autodeploy/);
assert.match(decision, /runtime_canonical_provenance_missing/);
assert.match(decision, /runtime_environment_identity_not_explicit/);
assert.match(decision, /runtime_activation_pending_or_sha_mismatch/);
assert.match(decision, /runtime_sha_current_branch_provenance_mismatch/);
assert.match(decision, /trusted_ingress_attestation_required/);
assert.match(decision, /oauth_discovery_not_ready/);
assert.match(workflow, /provider_credential_accessed: false/);
assert.match(workflow, /provider_mutation_performed: false/);
assert.match(workflow, /deployment_performed: false/);
assert.match(workflow, /restart_performed: false/);
assert.match(workflow, /secrets_included: false/);

assert.doesNotMatch(workflow, /issues: write/);
assert.doesNotMatch(workflow, /GH_TOKEN/);
assert.doesNotMatch(workflow, /\bgh\s+api\b/);
assert.doesNotMatch(workflow, /repository_mutation_performed/);
assert.doesNotMatch(workflow, /HOSTINGER_API_TOKEN/);
assert.doesNotMatch(workflow, /secrets\./);
assert.doesNotMatch(workflow, /workflow_dispatch/);
assert.doesNotMatch(workflow, /schedule:/);
assert.doesNotMatch(workflow, /\bssh\b/i);
assert.doesNotMatch(workflow, /\b(rsync|scp)\b/i);
assert.doesNotMatch(workflow, /\b(DROP|TRUNCATE|ALTER|INSERT|UPDATE|DELETE)\b/);
assert.doesNotMatch(workflow, /git push/);

console.log(JSON.stringify({
  ok: true,
  contract: 'mad4b.hostinger-production-runtime-readback-r7.workflow-test.v5',
  trigger: 'owner_bound_issue_comment',
  report_directory_initialized_after_runner_allocation: true,
  public_get_only: true,
  repository_content_mutation_performed: false,
  repository_issue_comment_authorized: false,
  repository_issue_comment_performed: false,
  workflow_summary_performed: true,
  provider_credential_accessed: false,
  provider_mutation_performed: false,
  deployment_performed: false,
  restart_performed: false,
  secrets_included: false,
}, null, 2));