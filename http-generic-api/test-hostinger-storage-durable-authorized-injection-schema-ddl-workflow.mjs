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
requireFragment('Validate rollup-aware workflow contract', 'workflow regression step');
requireFragment('WORKFLOW_CONTRACT_OUTCOME: ${{ steps.workflow_contract.outcome }}', 'workflow contract outcome binding');
requireFragment('MERGE_CANDIDATE_SHA: ${{ github.sha }}', 'merge candidate identity binding');
requireFragment("'source_sha': os.environ['CANDIDATE_SHA']", 'source SHA bound to exact head');
requireFragment("'merge_candidate_sha': os.environ['MERGE_CANDIDATE_SHA']", 'separate merge candidate SHA');
requireFragment("'candidate_mode': candidate_mode", 'candidate mode evidence');
requireFragment("'feature_scope_allowlist_enforced': candidate_mode == 'feature'", 'feature allowlist evidence');
requireFragment("'rollup_scope_allowlist_skipped': candidate_mode == 'integration'", 'rollup scope evidence');
requireFragment("'ddl_matches_registry_sql': ddl_matches_registry_sql", 'focused DDL parity evidence');
requireFragment("focused.get('ddl_matches_registry_sql') is True", 'focused test result consumption');
requireFragment("focused.get('contract_local_only') is True", 'contract-local result consumption');
requireFragment('if [[ "${BASE_REF}" == "main" && "${HEAD_REF}" == "gpt/hostinger-safe-storage-cleanup-ssh-20260801" ]]', 'bounded Integration detection');
requireFragment('if [[ "${integration_mode}" != "true" ]]', 'feature-only diff allowlist enforcement');
requireFragment("grep -q 'CONTRACT-LOCAL DDL ONLY'", 'DDL authority marker check');
requireFragment("grep -q '\"governed_runtime_migration_promoted\": false'", 'non-promotion contract check');
requireFragment("grep -q '\"migration_apply_authorized\": false'", 'no-apply contract check');
requireFragment("! grep -E '\\\\b(DROP|TRUNCATE)", 'destructive DDL rejection');

assert.equal(source.includes("'ddl_matches_registry_sql': not failed"), false, 'DDL parity must not be inferred from unrelated stages');
assert.equal(source.includes("'source_sha': os.environ['SOURCE_SHA']"), false, 'merge candidate SHA must not masquerade as source head');
assert.equal(source.includes('contents: write'), false, 'workflow must remain read-only');
assert.equal(source.includes('git push'), false, 'workflow must not mutate repository state');

const integrationDetection = source.indexOf('integration_mode=true');
const featureScopeGate = source.indexOf('if [[ "${integration_mode}" != "true" ]]');
const contentBoundary = source.indexOf("grep -q 'CONTRACT-LOCAL DDL ONLY'");
assert(integrationDetection >= 0 && featureScopeGate > integrationDetection, 'Integration detection must precede scope enforcement');
assert(contentBoundary > featureScopeGate, 'DDL content boundary must run in both feature and Integration modes');

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_durable_authorized_injection_schema_ddl_workflow',
  feature_scope_allowlist_preserved: true,
  integration_rollup_scope_supported: true,
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
