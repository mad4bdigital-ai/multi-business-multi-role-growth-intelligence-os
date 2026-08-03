import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(currentFile), '..');
const workflowPath = path.join(repositoryRoot, '.github/workflows/hostinger-production-runtime-readback-r7.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');

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
assert.match(workflow, /hostinger-production-runtime-readback-r7-\$\{\{ github\.run_id \}\}/);
assert.match(workflow, /HOSTINGER_PRODUCTION_RUNTIME_READBACK_R7 status=completed/);
assert.match(workflow, /production_current/);
assert.match(workflow, /runtime_activation_pending_or_sha_mismatch/);
assert.match(workflow, /runtime_sha_current_branch_provenance_mismatch/);
assert.match(workflow, /repository_mutation_performed: false/);
assert.match(workflow, /provider_credential_accessed: false/);
assert.match(workflow, /provider_mutation_performed: false/);
assert.match(workflow, /deployment_performed: false/);
assert.match(workflow, /restart_performed: false/);
assert.match(workflow, /secrets_included: false/);

assert.doesNotMatch(workflow, /HOSTINGER_API_TOKEN/);
assert.doesNotMatch(workflow, /secrets\./);
assert.doesNotMatch(workflow, /workflow_dispatch/);
assert.doesNotMatch(workflow, /schedule:/);
assert.doesNotMatch(workflow, /\bssh\b/i);
assert.doesNotMatch(workflow, /\b(rsync|scp)\b/i);
assert.doesNotMatch(workflow, /\b(DROP|TRUNCATE|ALTER|INSERT|UPDATE|DELETE)\b/);
assert.doesNotMatch(workflow, /git push/);
assert.doesNotMatch(workflow, /gh api --method (PUT|PATCH|DELETE)/);

console.log(JSON.stringify({
  ok: true,
  contract: 'mad4b.hostinger-production-runtime-readback-r7.workflow-test.v1',
  trigger: 'owner_bound_issue_comment',
  public_get_only: true,
  provider_credential_accessed: false,
  provider_mutation_performed: false,
  deployment_performed: false,
  restart_performed: false,
  repository_content_mutation_performed: false,
  secrets_included: false,
}, null, 2));
