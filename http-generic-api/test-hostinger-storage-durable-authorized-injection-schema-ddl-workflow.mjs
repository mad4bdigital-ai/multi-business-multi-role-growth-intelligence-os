#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WORKFLOW = '.github/workflows/hostinger-storage-durable-authorized-injection-schema-ddl-guard.yml';
const source = readFileSync(WORKFLOW, 'utf8');

function requireFragment(fragment, label) {
  assert.equal(source.includes(fragment), true, `missing ${label}`);
}

requireFragment('permissions:\n  contents: read', 'read-only permissions');
requireFragment('persist-credentials: false', 'credential-free checkout');
requireFragment('fetch-depth: 0', 'full ancestry checkout');
requireFragment('Classify governed candidate mode', 'governed candidate-mode classifier');
requireFragment('PHASE_CONTRACT: specs/014-governed-hostinger-storage-orchestration/e2e-phases.json', 'phase contract input');
requireFragment('PARALLEL_PR_GATE: http-generic-api/scripts/e2e-parallel-pr-gate.mjs', 'canonical Production promotion gate input');
requireFragment("- 'http-generic-api/scripts/e2e-parallel-pr-gate.mjs'", 'canonical gate workflow trigger');
requireFragment('BASE_REF: ${{ github.event.pull_request.base.ref }}', 'base ref classifier input');
requireFragment('BASE_SHA: ${{ github.event.pull_request.base.sha }}', 'exact base SHA classifier input');
requireFragment('HEAD_REF: ${{ github.event.pull_request.head.ref }}', 'head ref classifier input');
requireFragment('HEAD_SHA: ${{ github.event.pull_request.head.sha }}', 'head SHA classifier input');
requireFragment('HEAD_REPOSITORY: ${{ github.event.pull_request.head.repo.full_name }}', 'head repository classifier input');
requireFragment('REPOSITORY: ${{ github.repository }}', 'repository identity classifier input');
requireFragment("import { execFileSync } from 'node:child_process'", 'canonical gate process executor');
requireFragment("contract.delivery_mode === 'multi_pr'", 'multi-PR contract requirement');
requireFragment('contract.parallel_work?.enabled === true', 'parallel work requirement');
requireFragment("contract.parallel_work?.merge_policy === 'workstream_commits_then_e2e_rollup'", 'Rollup merge policy requirement');
requireFragment('contract.parallel_work?.no_partial_feature_merge === true', 'no-partial-merge requirement');
requireFragment("process.env.BASE_REF === 'Production'", 'Production release base requirement');
requireFragment('process.env.HEAD_REPOSITORY === process.env.REPOSITORY', 'same-repository release requirement');
requireFragment('process.env.PARALLEL_PR_GATE', 'canonical gate invocation');
requireFragment("'--base', process.env.BASE_SHA", 'exact Production base SHA delegation');
requireFragment("'--head', process.env.HEAD_SHA", 'exact candidate head SHA delegation');
requireFragment("'--head-ref', process.env.HEAD_REF", 'candidate branch delegation');
requireFragment("'--base-ref', process.env.BASE_REF", 'Production base ref delegation');
requireFragment("'--report-file', promotionReportPath", 'structured canonical gate report');
requireFragment("'protected_main'", 'protected main release identity');
requireFragment("'immutable_main_snapshot'", 'immutable main snapshot identity');
requireFragment("'history_preserving_main_reconciliation'", 'history-preserving reconciliation identity');
requireFragment('promotionReport.production_promotion === true', 'canonical Production promotion requirement');
requireFragment('acceptedReleaseIdentities.has(releaseIdentity)', 'bounded canonical identity allowlist');
requireFragment("? 'canonical_e2e_parallel_pr_gate'", 'canonical gate evidence source');
requireFragment('promotionReport.phase_evaluation_base', 'canonical phase evaluation baseline evidence');
requireFragment('canonical_promotion_validated=${canonicalPromotionValidated}', 'canonical validation output');
requireFragment('promotion_gate_outcome=${promotionGateOutcome}', 'canonical gate outcome output');
requireFragment('promotion_phase_evaluation_base=${phaseEvaluationBase}', 'phase evaluation base output');
requireFragment("isGovernedRelease ? 'release' : 'feature'", 'governed release classification');
requireFragment('CANDIDATE_MODE: ${{ steps.candidate_mode.outputs.candidate_mode }}', 'candidate mode output binding');
requireFragment('CANDIDATE_MODE_SOURCE: ${{ steps.candidate_mode.outputs.candidate_mode_source }}', 'candidate mode source output binding');
requireFragment('RELEASE_IDENTITY: ${{ steps.candidate_mode.outputs.release_identity }}', 'release identity output binding');
requireFragment('CANONICAL_PROMOTION_VALIDATED: ${{ steps.candidate_mode.outputs.canonical_promotion_validated }}', 'canonical promotion validation binding');
requireFragment('PROMOTION_GATE_OUTCOME: ${{ steps.candidate_mode.outputs.promotion_gate_outcome }}', 'promotion gate outcome binding');
requireFragment('PROMOTION_PHASE_EVALUATION_BASE: ${{ steps.candidate_mode.outputs.promotion_phase_evaluation_base }}', 'promotion phase baseline binding');
requireFragment('MODE_OUTCOME: ${{ steps.candidate_mode.outcome }}', 'candidate mode outcome binding');
requireFragment("'candidate_mode_source': os.environ.get('CANDIDATE_MODE_SOURCE') or 'unknown'", 'candidate mode evidence source');
requireFragment("'release_identity': os.environ.get('RELEASE_IDENTITY') or 'none'", 'release identity evidence');
requireFragment("'canonical_promotion_validated'", 'canonical promotion validation evidence');
requireFragment("'promotion_gate_outcome'", 'canonical promotion gate evidence');
requireFragment("'promotion_phase_evaluation_base'", 'canonical phase evaluation baseline evidence');
requireFragment("'governed_phase_contract_digest'", 'phase contract digest evidence');
requireFragment('Validate rollup-aware workflow contract', 'workflow regression step');
requireFragment('WORKFLOW_CONTRACT_OUTCOME: ${{ steps.workflow_contract.outcome }}', 'workflow contract outcome binding');
requireFragment('MERGE_CANDIDATE_SHA: ${{ github.sha }}', 'merge candidate identity binding');
requireFragment("'source_sha': os.environ['CANDIDATE_SHA']", 'source SHA bound to exact head');
requireFragment("'merge_candidate_sha': os.environ['MERGE_CANDIDATE_SHA']", 'separate merge candidate SHA');
requireFragment("'feature_scope_allowlist_enforced': candidate_mode == 'feature'", 'feature allowlist evidence');
requireFragment("'rollup_scope_allowlist_skipped': candidate_mode == 'integration'", 'rollup scope evidence');
requireFragment("'release_scope_allowlist_skipped': candidate_mode == 'release'", 'release scope evidence');
requireFragment("candidate_mode not in ('feature', 'integration', 'release')", 'candidate mode validation');
requireFragment("'ddl_matches_registry_sql': ddl_matches_registry_sql", 'focused DDL parity evidence');
requireFragment("focused.get('ddl_matches_registry_sql') is True", 'focused test result consumption');
requireFragment("focused.get('contract_local_only') is True", 'contract-local result consumption');
requireFragment('if [[ "${candidate_mode}" == "feature" ]]', 'feature-only diff allowlist enforcement');
requireFragment("grep -q 'CONTRACT-LOCAL DDL ONLY'", 'DDL authority marker check');
requireFragment("grep -q '\"governed_runtime_migration_promoted\": false'", 'non-promotion contract check');
requireFragment("grep -q '\"migration_apply_authorized\": false'", 'no-apply contract check');
requireFragment('(DROP|TRUNCATE)[[:space:]]+TABLE', 'destructive DDL rejection');

assert.equal(source.includes("'ddl_matches_registry_sql': not failed"), false, 'DDL parity must not be inferred from unrelated stages');
assert.equal(source.includes("'source_sha': os.environ['SOURCE_SHA']"), false, 'merge candidate SHA must not masquerade as source head');
assert.equal(source.includes('^release\\/production-candidate-'), false, 'workflow must not duplicate canonical release-branch parsing');
assert.equal(source.includes("['merge-base', '--is-ancestor'"), false, 'workflow must not duplicate canonical ancestry classification');
assert.equal(source.includes('directMainRelease'), false, 'workflow must not duplicate protected-main classification');
assert.equal(source.includes('immutableMainSnapshot'), false, 'workflow must not duplicate immutable-snapshot classification');
assert.equal(source.includes('gpt/'), false, 'permanent workflow must not embed a work-branch name');
assert.equal(source.includes('contents: write'), false, 'workflow must remain read-only');
assert.equal(source.includes('git push'), false, 'workflow must not mutate repository state');

const classification = source.indexOf('Classify governed candidate mode');
const canonicalGate = source.indexOf('process.env.PARALLEL_PR_GATE');
const promotionValidation = source.indexOf('const canonicalPromotionValidated');
const releaseIdentityGate = source.indexOf('const isGovernedRelease');
const featureScopeGate = source.indexOf('if [[ "${candidate_mode}" == "feature" ]]');
const contentBoundary = source.indexOf("grep -q 'CONTRACT-LOCAL DDL ONLY'");
assert(classification >= 0 && canonicalGate > classification, 'Canonical promotion gate must run inside candidate classification');
assert(promotionValidation > canonicalGate, 'Canonical promotion report must be validated after gate execution');
assert(releaseIdentityGate > promotionValidation, 'Release mode must derive from bounded canonical promotion evidence');
assert(featureScopeGate > releaseIdentityGate, 'Contract classification must precede scope enforcement');
assert(contentBoundary > featureScopeGate, 'DDL content boundary must run in feature, Integration, and Release modes');

const heredocMarker = "node --input-type=module <<'NODE'\n";
const heredocStart = source.indexOf(heredocMarker);
const heredocEnd = source.indexOf('\n          NODE', heredocStart + heredocMarker.length);
assert(heredocStart >= 0 && heredocEnd > heredocStart, 'candidate classifier heredoc must be extractable');
const classifierSource = source.slice(heredocStart + heredocMarker.length, heredocEnd);
const temporary = mkdtempSync(join(tmpdir(), 'ddl-release-classifier-'));
const classifierFile = join(temporary, 'candidate-classifier.mjs');
const validOutput = join(temporary, 'valid-output.txt');
const invalidOutput = join(temporary, 'invalid-output.txt');
writeFileSync(classifierFile, classifierSource);

const gitEnvironment = {
  ...process.env,
  GIT_AUTHOR_NAME: 'DDL Workflow Contract',
  GIT_AUTHOR_EMAIL: 'ddl-workflow@example.invalid',
  GIT_COMMITTER_NAME: 'DDL Workflow Contract',
  GIT_COMMITTER_EMAIL: 'ddl-workflow@example.invalid',
};
function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', env: gitEnvironment }).trim();
}
function parseOutputs(file) {
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

const mainRef = ['refs/remotes/origin/main', 'refs/heads/main']
  .find((candidate) => spawnSync('git', ['rev-parse', '--verify', `${candidate}^{commit}`], { stdio: 'ignore' }).status === 0);
assert(mainRef, 'canonical main ref must exist in the full-history checkout');
const mainSha = git(['rev-parse', `${mainRef}^{commit}`]);
const mainTree = git(['rev-parse', `${mainSha}^{tree}`]);
const syntheticProduction = git(['commit-tree', mainTree, '-p', mainSha, '-m', 'synthetic Production base']);
const validCandidate = git([
  'commit-tree', mainTree,
  '-p', mainSha,
  '-p', syntheticProduction,
  '-m', 'synthetic history-preserving main reconciliation',
]);
const validRef = `release/production-candidate-20260804-${validCandidate.slice(0, 8)}-v1`;
const repositoryIdentity = 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os';
const classifierEnvironment = {
  ...process.env,
  PHASE_CONTRACT: 'specs/014-governed-hostinger-storage-orchestration/e2e-phases.json',
  PARALLEL_PR_GATE: 'http-generic-api/scripts/e2e-parallel-pr-gate.mjs',
  BASE_REF: 'Production',
  BASE_SHA: syntheticProduction,
  HEAD_REF: validRef,
  HEAD_SHA: validCandidate,
  HEAD_REPOSITORY: repositoryIdentity,
  REPOSITORY: repositoryIdentity,
  RUNNER_TEMP: temporary,
  GITHUB_OUTPUT: validOutput,
};
const validClassification = spawnSync(process.execPath, [classifierFile], {
  cwd: process.cwd(),
  env: classifierEnvironment,
  encoding: 'utf8',
});
assert.equal(validClassification.status, 0, validClassification.stderr || validClassification.stdout);
const valid = parseOutputs(validOutput);
assert.equal(valid.candidate_mode, 'release');
assert.equal(valid.candidate_mode_source, 'canonical_e2e_parallel_pr_gate');
assert.equal(valid.release_identity, 'history_preserving_main_reconciliation');
assert.equal(valid.canonical_promotion_validated, 'true');
assert.equal(valid.promotion_gate_outcome, 'success');
assert.equal(valid.promotion_phase_evaluation_base, mainSha);

const reversedCandidate = git([
  'commit-tree', mainTree,
  '-p', syntheticProduction,
  '-p', mainSha,
  '-m', 'synthetic reversed-parent reconciliation',
]);
const invalidClassification = spawnSync(process.execPath, [classifierFile], {
  cwd: process.cwd(),
  env: {
    ...classifierEnvironment,
    HEAD_REF: `release/production-candidate-20260804-${reversedCandidate.slice(0, 8)}-v1`,
    HEAD_SHA: reversedCandidate,
    GITHUB_OUTPUT: invalidOutput,
  },
  encoding: 'utf8',
});
assert.notEqual(invalidClassification.status, 0, 'reversed reconciliation parents must fail closed');
assert.match(
  `${invalidClassification.stderr}\n${invalidClassification.stdout}`,
  /canonical Production promotion classification failed/u,
);
rmSync(temporary, { recursive: true, force: true });

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_durable_authorized_injection_schema_ddl_workflow',
  feature_scope_allowlist_preserved: true,
  contract_governed_integration_mode: true,
  contract_governed_release_mode: true,
  release_identity_delegated_to_canonical_e2e_parallel_pr_gate: true,
  accepted_release_identities: [
    'protected_main',
    'immutable_main_snapshot',
    'history_preserving_main_reconciliation',
  ],
  history_preserving_reconciliation_executed: true,
  reversed_parent_reconciliation_rejected: true,
  duplicate_release_branch_parser_present: false,
  duplicate_release_ancestry_classifier_present: false,
  malformed_production_identity_fails_closed: true,
  release_requires_same_repository: true,
  branch_specific_workflow_literals: false,
  integration_rollup_scope_supported: true,
  production_release_scope_supported: true,
  exact_head_source_identity: true,
  exact_base_identity: true,
  merge_candidate_identity_separate: true,
  focused_ddl_parity_authoritative: true,
  contract_local_content_checks_always_run: true,
  protected_ref_mutation_performed: false,
  remote_repository_mutation_performed: false,
  migration_apply_authorized: false,
  provider_dispatch_allowed: false,
  production_ready: false,
  secrets_included: false,
}, null, 2));
