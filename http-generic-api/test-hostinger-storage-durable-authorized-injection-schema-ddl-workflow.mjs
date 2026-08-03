#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const WORKFLOW = '.github/workflows/hostinger-storage-durable-authorized-injection-schema-ddl-guard.yml';
const source = readFileSync(WORKFLOW, 'utf8');

function requireFragment(fragment, label) {
  assert.equal(source.includes(fragment), true, `missing ${label}`);
}

requireFragment('permissions:\n  contents: read', 'read-only permissions');
requireFragment('persist-credentials: false', 'credential-free checkout');
requireFragment('Classify governed candidate mode', 'governed candidate-mode classifier');
requireFragment('PHASE_CONTRACT: specs/014-governed-hostinger-storage-orchestration/e2e-phases.json', 'phase contract input');
requireFragment('HEAD_REF: ${{ github.event.pull_request.head.ref }}', 'head ref classifier input');
requireFragment('HEAD_REPOSITORY: ${{ github.event.pull_request.head.repo.full_name }}', 'head repository classifier input');
requireFragment('REPOSITORY: ${{ github.repository }}', 'repository identity classifier input');
requireFragment('HEAD_SHA: ${{ github.event.pull_request.head.sha }}', 'exact candidate SHA classifier input');
requireFragment('BASE_SHA: ${{ github.event.pull_request.base.sha }}', 'exact Production base SHA classifier input');
requireFragment("import { execFileSync } from 'node:child_process';", 'read-only git topology reader');
requireFragment("git fetch --no-tags origin '+refs/heads/main:refs/remotes/origin/main'", 'current main ancestry fetch');
requireFragment("contract.delivery_mode === 'multi_pr'", 'multi-PR contract requirement');
requireFragment('contract.parallel_work?.enabled === true', 'parallel work requirement');
requireFragment("contract.parallel_work?.merge_policy === 'workstream_commits_then_e2e_rollup'", 'Rollup merge policy requirement');
requireFragment('contract.parallel_work?.no_partial_feature_merge === true', 'no-partial-merge requirement');
requireFragment("process.env.BASE_REF === 'Production'", 'Production release base requirement');
requireFragment("process.env.HEAD_REF === 'main'", 'protected main release head requirement');
requireFragment('process.env.HEAD_REPOSITORY === process.env.REPOSITORY', 'same-repository release requirement');
requireFragment('const releaseBranchPattern = /^release\\/production-candidate-\\d{8}-([0-9a-f]{8})-v[1-9]\\d*$/;', 'exact governed release branch pattern');
requireFragment("parents[1] === process.env.BASE_SHA", 'Production direct-parent requirement');
requireFragment("branchMatch?.[1] === process.env.HEAD_SHA.slice(0, 8)", 'branch-to-candidate SHA binding');
requireFragment('headTree === firstParentTree', 'exact main-tree requirement');
requireFragment("['merge-base', '--is-ancestor', firstParent, 'refs/remotes/origin/main']", 'main ancestry requirement');
requireFragment("messageLines[0] === 'release: build governed Production promotion candidate'", 'builder commit title requirement');
requireFragment('messageLines.includes(`main=${firstParent}`)', 'pinned main message binding');
requireFragment('messageLines.includes(`production=${process.env.BASE_SHA}`)', 'pinned Production message binding');
requireFragment("messageLines.includes('tree_policy=exact_main_tree')", 'tree policy message binding');
requireFragment('const isGovernedRelease = directMainRelease || materializedRelease;', 'direct-or-materialized release classification');
requireFragment("isGovernedRelease ? 'release' : 'feature'", 'governed release classification');
requireFragment('CANDIDATE_MODE: ${{ steps.candidate_mode.outputs.candidate_mode }}', 'candidate mode output binding');
requireFragment('MODE_OUTCOME: ${{ steps.candidate_mode.outcome }}', 'candidate mode outcome binding');
requireFragment("'candidate_mode_source': 'governed_phase_contract'", 'candidate mode evidence source');
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
assert.equal(source.includes('gpt/'), false, 'permanent workflow must not embed a work-branch name');
assert.equal(source.includes('contents: write'), false, 'workflow must remain read-only');
assert.equal(source.includes('git push'), false, 'workflow must not mutate repository state');
assert.equal(source.includes("process.env.HEAD_REF.startsWith('release/')"), false, 'release prefix alone must never grant release mode');

const classification = source.indexOf('Classify governed candidate mode');
const featureScopeGate = source.indexOf('if [[ "${candidate_mode}" == "feature" ]]');
const contentBoundary = source.indexOf("grep -q 'CONTRACT-LOCAL DDL ONLY'");
assert(classification >= 0 && featureScopeGate > classification, 'Contract classification must precede scope enforcement');
assert(contentBoundary > featureScopeGate, 'DDL content boundary must run in feature, Integration, and Release modes');

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_durable_authorized_injection_schema_ddl_workflow',
  feature_scope_allowlist_preserved: true,
  contract_governed_integration_mode: true,
  contract_governed_release_mode: true,
  release_requires_main_to_production: true,
  release_requires_same_repository: true,
  materialized_release_requires_exact_branch_identity: true,
  materialized_release_requires_production_parent: true,
  materialized_release_requires_exact_main_tree: true,
  materialized_release_requires_main_ancestry: true,
  materialized_release_requires_builder_message_binding: true,
  broad_release_prefix_allowed: false,
  branch_specific_workflow_literals: false,
  integration_rollup_scope_supported: true,
  production_release_scope_supported: true,
  exact_head_source_identity: true,
  merge_candidate_identity_separate: true,
  focused_ddl_parity_authoritative: true,
  contract_local_content_checks_always_run: true,
  repository_mutation_performed: false,
  migration_apply_authorized: false,
  provider_dispatch_allowed: false,
  production_ready: false,
  secrets_included: false,
}, null, 2));
