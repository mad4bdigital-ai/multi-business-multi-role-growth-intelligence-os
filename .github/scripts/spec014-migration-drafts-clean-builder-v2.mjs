import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const integrationBranch = process.env.INTEGRATION_BRANCH;
const sourceBranch = process.env.SOURCE_BRANCH;
const sourceSha = process.env.SOURCE_SHA;
const finalBranch = process.env.FINAL_BRANCH;
const runId = process.env.GITHUB_RUN_ID ?? null;
const builderHeadSha = process.env.GITHUB_SHA ?? null;
const runnerTemp = process.env.RUNNER_TEMP ?? '/tmp';
const reportJsonPath = path.join(runnerTemp, 'spec014-migration-builder-summary.json');
const reportMarkdownPath = path.join(runnerTemp, 'spec014-migration-builder-summary.md');

for (const [name, value] of Object.entries({ integrationBranch, sourceBranch, sourceSha, finalBranch })) {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
}

const allowedFiles = [
  '.changes/e2e/spec014-migration-drafts-t024-t027.json',
  '.github/contracts/spec014/hostinger-storage-migration-drafts.json',
  '.github/contracts/spec014/migrations/wave-1-foundation.sql',
  '.github/contracts/spec014/validate-hostinger-storage-migration-drafts.mjs',
  '.github/workflows/hostinger-storage-migration-drafts-guard.yml',
  'specs/014-governed-hostinger-storage-orchestration/migrations/preflight.sql',
  'specs/014-governed-hostinger-storage-orchestration/migrations/readback.sql',
  'specs/014-governed-hostinger-storage-orchestration/migrations/rollback-prelive.sql',
  'specs/014-governed-hostinger-storage-orchestration/migrations/wave-1-foundation.sql',
  'specs/014-governed-hostinger-storage-orchestration/migrations/wave-2-control-plane.sql',
  'specs/014-governed-hostinger-storage-orchestration/migrations/wave-3-execution-evidence.sql',
];

let currentStage = 'initialized';
let candidateSha = null;
let changedFileCount = null;
const checks = [];

function truncate(value, limit = 3000) {
  const text = String(value ?? '').trim();
  return text.length <= limit ? text : `${text.slice(0, limit)}\n...[truncated]`;
}

function writeEvidence(outcome, exitCode, error = null) {
  const report = {
    contract: 'spec014.migration-drafts-clean-builder-evidence.v1',
    outcome,
    stage: currentStage,
    exit_code: exitCode,
    error: error ? truncate(error.message ?? error, 2000) : null,
    run_id: runId,
    builder_head_sha: builderHeadSha,
    integration_branch: integrationBranch,
    source_branch: sourceBranch,
    source_sha: sourceSha,
    final_branch: finalBranch,
    candidate_sha: candidateSha,
    changed_file_count: changedFileCount,
    allowed_file_count: allowedFiles.length,
    migration_apply_performed: false,
    live_database_or_provider_access: false,
    secrets_included: false,
    checks,
  };
  fs.writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);

  const lines = [
    '## Spec 014 migration builder evidence',
    '',
    `- Outcome: **${outcome}**`,
    `- Last stage: \`${currentStage}\``,
    `- Exit code: \`${exitCode}\``,
    `- Run ID: \`${runId}\``,
    `- Builder head: \`${builderHeadSha}\``,
    `- Integration branch: \`${integrationBranch}\``,
    `- Source SHA: \`${sourceSha}\``,
    `- Final branch: \`${finalBranch}\``,
    `- Candidate SHA: \`${candidateSha}\``,
    `- Changed file count: \`${changedFileCount}\``,
    `- Allowed file count: \`${allowedFiles.length}\``,
    '- Migration apply performed: `false`',
    '- Live database or provider access: `false`',
    '- Secrets included: `false`',
  ];
  if (error) lines.push(`- Error: \`${truncate(error.message ?? error, 1000).replaceAll('`', "'")}\``);
  lines.push('', '### Stage results', '');
  for (const check of checks) {
    lines.push(`- \`${check.stage}\`: **${check.ok ? 'passed' : 'failed'}** (exit \`${check.status}\`)`);
    if (!check.ok && check.stderr) lines.push(`  - stderr: \`${check.stderr.replaceAll('`', "'")}\``);
  }
  fs.writeFileSync(reportMarkdownPath, `${lines.join('\n')}\n`);
}

function execute(stage, command, args, options = {}) {
  currentStage = stage;
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  const status = result.status ?? 1;
  const check = {
    stage,
    command: [command, ...args].join(' '),
    status,
    ok: status === 0,
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
  };
  checks.push(check);
  writeEvidence('running', null);
  if (result.error) throw result.error;
  if (status !== 0) {
    const detail = check.stderr || check.stdout || `exit ${status}`;
    throw new Error(`${stage}: ${detail}`);
  }
  return String(result.stdout ?? '').trim();
}

function assertEqual(stage, actual, expected) {
  currentStage = stage;
  const ok = actual === expected;
  checks.push({ stage, command: 'assertEqual', status: ok ? 0 : 1, ok, stdout: `actual=${actual}; expected=${expected}`, stderr: '' });
  writeEvidence('running', null);
  if (!ok) throw new Error(`${stage}: expected ${expected}, received ${actual}`);
}

function assertAbsent(stage, targetPath) {
  currentStage = stage;
  const ok = !fs.existsSync(targetPath);
  checks.push({ stage, command: `assertAbsent ${targetPath}`, status: ok ? 0 : 1, ok, stdout: '', stderr: ok ? '' : `${targetPath} exists` });
  writeEvidence('running', null);
  if (!ok) throw new Error(`${stage}: forbidden path exists: ${targetPath}`);
}

writeEvidence('running', null);

try {
  execute('fetch_sources', 'git', ['fetch', 'origin', integrationBranch, sourceBranch]);

  const resolvedSourceSha = execute('resolve_source_sha', 'git', ['rev-parse', `origin/${sourceBranch}`]);
  assertEqual('verify_pinned_source_sha', resolvedSourceSha, sourceSha);

  execute('checkout_current_integration', 'git', ['checkout', '-B', finalBranch, `origin/${integrationBranch}`]);

  for (const file of allowedFiles) {
    currentStage = `copy:${file}`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const content = execute(currentStage, 'git', ['show', `${sourceSha}:${file}`], { encoding: 'buffer' });
    fs.writeFileSync(file, Buffer.isBuffer(content) ? content : Buffer.from(content));
  }

  currentStage = 'align_manifest_validator_contract';
  const manifestPath = '.github/contracts/spec014/hostinger-storage-migration-drafts.json';
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assertEqual('verify_manifest_contract_v3', manifest.contract, 'spec014.hostinger-storage-migration-drafts.v3');

  const validatorPath = '.github/contracts/spec014/validate-hostinger-storage-migration-drafts.mjs';
  const validator = fs.readFileSync(validatorPath, 'utf8');
  const oldContract = "'spec014.hostinger-storage-migration-drafts.v2'";
  const newContract = "'spec014.hostinger-storage-migration-drafts.v3'";
  const occurrenceCount = validator.split(oldContract).length - 1;
  assertEqual('verify_single_v2_validator_contract', String(occurrenceCount), '1');
  fs.writeFileSync(validatorPath, validator.replace(oldContract, newContract));

  execute('validator_syntax_check', 'node', ['--check', validatorPath]);
  execute('schema_classification_validation', 'node', ['.github/contracts/spec014/validate-hostinger-storage-schema-classification.mjs']);
  execute('sql_runtime_contract_validation', 'node', ['.github/contracts/spec014/validate-hostinger-storage-sql-runtime-contract.mjs']);
  execute('migration_drafts_validation', 'node', [validatorPath]);
  execute('git_diff_check', 'git', ['diff', '--check']);

  execute('configure_git_name', 'git', ['config', 'user.name', 'github-actions[bot]']);
  execute('configure_git_email', 'git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  execute('stage_candidate', 'git', ['add', '--all']);
  execute('create_candidate_commit', 'git', ['commit', '-m', 'feat(spec-014): draft governed storage migration waves']);

  candidateSha = execute('resolve_candidate_sha', 'git', ['rev-parse', 'HEAD']);
  execute('e2e_parallel_work_governance', 'node', ['http-generic-api/scripts/e2e-parallel-work-governance.mjs', 'check', '--head', 'HEAD']);

  const aheadCount = execute('count_candidate_commits', 'git', ['rev-list', '--count', `origin/${integrationBranch}..HEAD`]);
  assertEqual('verify_single_commit_ahead', aheadCount, '1');

  const changedFilesRaw = execute('list_changed_files', 'git', ['diff', '--name-only', `origin/${integrationBranch}...HEAD`]);
  const changedFiles = changedFilesRaw.split('\n').filter(Boolean);
  changedFileCount = changedFiles.length;
  assertEqual('verify_exact_11_file_diff', String(changedFileCount), '11');
  assertEqual('verify_exact_allowed_file_set', JSON.stringify([...changedFiles].sort()), JSON.stringify([...allowedFiles].sort()));

  assertAbsent('verify_temporary_builder_workflow_excluded', '.github/workflows/spec014-migration-drafts-clean-builder-v2.yml');
  assertAbsent('verify_temporary_builder_script_excluded', '.github/scripts/spec014-migration-drafts-clean-builder-v2.mjs');
  assertAbsent('verify_live_wave_1_excluded', 'http-generic-api/migrations/wave-1-foundation.sql');
  assertAbsent('verify_live_wave_2_excluded', 'http-generic-api/migrations/wave-2-control-plane.sql');
  assertAbsent('verify_live_wave_3_excluded', 'http-generic-api/migrations/wave-3-execution-evidence.sql');

  currentStage = 'verify_final_branch_absent';
  const remoteCheck = spawnSync('git', ['ls-remote', '--exit-code', '--heads', 'origin', finalBranch], { encoding: 'utf8' });
  const branchAbsent = remoteCheck.status === 2;
  checks.push({
    stage: currentStage,
    command: `git ls-remote --exit-code --heads origin ${finalBranch}`,
    status: remoteCheck.status ?? 1,
    ok: branchAbsent,
    stdout: truncate(remoteCheck.stdout),
    stderr: truncate(remoteCheck.stderr),
  });
  writeEvidence('running', null);
  if (!branchAbsent) throw new Error(`${currentStage}: final branch already exists or remote check failed`);

  execute('push_final_branch', 'git', ['push', 'origin', `HEAD:refs/heads/${finalBranch}`]);

  currentStage = 'completed';
  checks.push({ stage: currentStage, command: 'complete', status: 0, ok: true, stdout: candidateSha, stderr: '' });
  writeEvidence('passed', 0);
} catch (error) {
  try {
    candidateSha = candidateSha ?? execute('capture_failure_head_sha', 'git', ['rev-parse', 'HEAD']);
  } catch {
    // Keep the original failure as authority.
  }
  writeEvidence('failed', 1, error);
  console.error(error);
  process.exitCode = 1;
}
