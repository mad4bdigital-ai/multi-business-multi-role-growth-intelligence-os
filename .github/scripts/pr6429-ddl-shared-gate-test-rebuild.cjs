const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const baseSha = process.env.BASE_SHA;
const testPath = 'http-generic-api/test-hostinger-storage-durable-authorized-injection-schema-ddl-workflow.mjs';
if (!/^[0-9a-f]{40}$/.test(baseSha || '')) {
  throw new Error('BASE_SHA must be an exact 40-character commit SHA.');
}

let source = execFileSync('git', ['show', `${baseSha}:${testPath}`], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});

const anchor = `requireFragment("'feature_scope_allowlist_enforced': candidate_mode == 'feature'", 'feature allowlist evidence');`;
const replacement = [
  `requireFragment("'feature_scope_allowlist_enforced': candidate_mode == 'feature' and boundary_mode == 'contract_local'", 'contract-local feature allowlist evidence');`,
  `requireFragment("'shared_gate_dependency_validated': candidate_mode == 'feature' and boundary_mode == 'shared_gate_dependency'", 'shared gate dependency evidence');`,
  `requireFragment('BOUNDARY_MODE: \${{ steps.boundary.outputs.boundary_mode }}', 'boundary mode output binding');`,
  `requireFragment("boundary_mode='shared_gate_dependency'", 'shared gate dependency classification');`,
  `requireFragment("boundary_mode='contract_local'", 'contract-local classification');`,
  `requireFragment("shared_gate='^http-generic-api/scripts/e2e-parallel-pr-gate\\\\.mjs$'", 'shared gate exact-match pattern');`,
].join('\n');

const count = source.split(anchor).length - 1;
if (count !== 1) {
  throw new Error(`Feature evidence anchor expected once, found ${count}.`);
}
source = source.replace(anchor, replacement);
fs.writeFileSync(testPath, source);

process.stdout.write(`${JSON.stringify({
  ok: true,
  base_sha: baseSha,
  test_path: testPath,
  assertions_added: 6,
  secrets_included: false,
})}\n`);
