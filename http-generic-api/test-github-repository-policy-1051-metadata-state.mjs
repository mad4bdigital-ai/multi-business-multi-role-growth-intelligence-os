import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyMetadataPresence, METADATA_STATE_SQL } from '../.github/ops/github-repository-policy-1051-metadata-state.mjs';

const workflow = fs.readFileSync(new URL('../.github/workflows/github-repository-policy-1051-governed-rollout.yml', import.meta.url), 'utf8');

const absent = classifyMetadataPresence({});
assert.equal(absent.target_metadata_state, 'absent');
assert.equal(absent.authorization_state, 'absent');
assert.equal(absent.metadata_present, false);
assert.equal(absent.replay_safe_without_exact_ledger, true);

const readinessOnly = classifyMetadataPresence({ migration_authorization_count: 1 });
assert.equal(readinessOnly.target_metadata_state, 'absent');
assert.equal(readinessOnly.authorization_state, 'present');
assert.equal(readinessOnly.metadata_present, false);
assert.equal(readinessOnly.replay_safe_without_exact_ledger, true);

const partial = classifyMetadataPresence({
  adapter_count: 1,
  readback_contract_count: 1,
  apply_policy_count: 0,
  capability_binding_count: 0,
  expected_policy_layer_count: 0,
  total_policy_layer_count: 0,
  migration_authorization_count: 1,
});
assert.equal(partial.target_metadata_state, 'partial');
assert.equal(partial.authorization_state, 'present');
assert.equal(partial.metadata_present, false);
assert.equal(partial.replay_safe_without_exact_ledger, false);

const complete = classifyMetadataPresence({
  adapter_count: 1,
  readback_contract_count: 1,
  apply_policy_count: 1,
  capability_binding_count: 1,
  expected_policy_layer_count: 3,
  total_policy_layer_count: 3,
  migration_authorization_count: 1,
});
assert.equal(complete.target_metadata_state, 'complete');
assert.equal(complete.authorization_state, 'present');
assert.equal(complete.metadata_present, true);
assert.equal(complete.replay_safe_without_exact_ledger, false);

const extraLayer = classifyMetadataPresence({
  adapter_count: 1,
  readback_contract_count: 1,
  apply_policy_count: 1,
  capability_binding_count: 1,
  expected_policy_layer_count: 3,
  total_policy_layer_count: 4,
  migration_authorization_count: 1,
});
assert.equal(extraLayer.target_metadata_state, 'partial');
assert.equal(extraLayer.replay_safe_without_exact_ledger, false);

const duplicateAuthorization = classifyMetadataPresence({ migration_authorization_count: 2 });
assert.equal(duplicateAuthorization.authorization_state, 'invalid_multiple');
assert.equal(duplicateAuthorization.metadata_present, false);

assert.match(METADATA_STATE_SQL, /AS adapter_count/);
assert.match(METADATA_STATE_SQL, /AS readback_contract_count/);
assert.match(METADATA_STATE_SQL, /AS apply_policy_count/);
assert.match(METADATA_STATE_SQL, /AS capability_binding_count/);
assert.match(METADATA_STATE_SQL, /AS expected_policy_layer_count/);
assert.match(METADATA_STATE_SQL, /AS total_policy_layer_count/);
assert.match(METADATA_STATE_SQL, /AS migration_authorization_count/);
assert.match(METADATA_STATE_SQL, /scope_type='platform'/);
assert.match(METADATA_STATE_SQL, /scope_type='repository'/);
assert.match(METADATA_STATE_SQL, /scope_type='environment'/);

assert.match(workflow, /Enforce Migration 1051 pre-Apply metadata replay guard/);
assert.match(workflow, /METADATA_DIAGNOSTIC_MODE: pre_apply/);
assert.match(workflow, /github-repository-policy-1051-metadata-state\.mjs/);
assert.match(workflow, /Capture bounded Migration 1051 metadata diagnostic without Apply/);
assert.match(workflow, /METADATA_DIAGNOSTIC_MODE: verify/);
assert.ok(
  workflow.indexOf('Enforce Migration 1051 pre-Apply metadata replay guard')
    < workflow.indexOf('Execute exactly-once metadata Apply and same-cycle certification'),
  'Replay guard must execute before the Migration 1051 Apply runner',
);

console.log(JSON.stringify({
  ok: true,
  test: 'github_repository_policy_1051_metadata_state',
  absent_replay_safe: absent.replay_safe_without_exact_ledger,
  partial_replay_safe: partial.replay_safe_without_exact_ledger,
  complete_requires_exact_ledger: !complete.replay_safe_without_exact_ledger,
  provider_call_executed: false,
  external_write_executed: false,
  secrets_included: false,
}));
