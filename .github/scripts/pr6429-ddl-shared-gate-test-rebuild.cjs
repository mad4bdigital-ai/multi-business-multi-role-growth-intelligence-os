const fs = require('node:fs');
const { execFileSync, spawnSync } = require('node:child_process');

const baseSha = process.env.BASE_SHA;
const testPath = 'http-generic-api/test-hostinger-storage-durable-authorized-injection-schema-ddl-workflow.mjs';
if (!/^[0-9a-f]{40}$/.test(baseSha || '')) {
  throw new Error('BASE_SHA must be an exact 40-character commit SHA.');
}

let source = execFileSync('git', ['show', `${baseSha}:${testPath}`], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});

const featureEvidenceAnchor = `requireFragment("'feature_scope_allowlist_enforced': candidate_mode == 'feature'", 'feature allowlist evidence');`;
const featureEvidenceReplacement = [
  `requireFragment("'feature_scope_allowlist_enforced': candidate_mode == 'feature' and boundary_mode == 'contract_local'", 'contract-local feature allowlist evidence');`,
  `requireFragment("'shared_gate_dependency_validated': candidate_mode == 'feature' and boundary_mode == 'shared_gate_dependency'", 'shared gate dependency evidence');`,
  `requireFragment('BOUNDARY_MODE: \${{ steps.boundary.outputs.boundary_mode }}', 'boundary mode output binding');`,
  `requireFragment("boundary_mode='shared_gate_dependency'", 'shared gate dependency classification');`,
  `requireFragment("boundary_mode='contract_local'", 'contract-local classification');`,
  `requireFragment("shared_gate='^http-generic-api/scripts/e2e-parallel-pr-gate", 'shared gate exact-match pattern prefix');`,
].join('\n');

const featureEvidenceCount = source.split(featureEvidenceAnchor).length - 1;
if (featureEvidenceCount !== 1) {
  throw new Error(`Feature evidence anchor expected once, found ${featureEvidenceCount}.`);
}
source = source.replace(featureEvidenceAnchor, featureEvidenceReplacement);

const featureBoundaryAnchor = `requireFragment('if [[ "\${candidate_mode}" == "feature" ]]', 'feature-only diff allowlist enforcement');`;
const featureBoundaryReplacement = `requireFragment('contract_local_changes=', 'contract-local feature boundary detection');`;
const featureBoundaryCount = source.split(featureBoundaryAnchor).length - 1;
if (featureBoundaryCount !== 1) {
  throw new Error(`Feature boundary assertion anchor expected once, found ${featureBoundaryCount}.`);
}
source = source.replace(featureBoundaryAnchor, featureBoundaryReplacement);

fs.writeFileSync(testPath, source);

const syntax = spawnSync(process.execPath, ['--check', testPath], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
const runtime = syntax.status === 0
  ? spawnSync(process.execPath, [testPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  : { status: null, stdout: '', stderr: '' };
const report = {
  ok: syntax.status === 0 && runtime.status === 0,
  base_sha: baseSha,
  test_path: testPath,
  assertions_added: 7,
  syntax_status: syntax.status,
  syntax_stdout: String(syntax.stdout || '').slice(-4000),
  syntax_stderr: String(syntax.stderr || '').slice(-4000),
  runtime_status: runtime.status,
  runtime_stdout: String(runtime.stdout || '').slice(-4000),
  runtime_stderr: String(runtime.stderr || '').slice(-4000),
  secrets_included: false,
};
process.stdout.write(`${JSON.stringify(report)}\n`);
if (!report.ok) process.exitCode = 1;
