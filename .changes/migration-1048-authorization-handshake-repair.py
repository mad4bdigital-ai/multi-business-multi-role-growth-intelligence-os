from pathlib import Path

runner_path = Path('.github/ops/transport-response-schema-1048-governed-rollout.mjs')
runner = runner_path.read_text()

legacy_constant = "const AUTH_CONFIRM = 'AUTHORIZE_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_SCHEMA_RECOVERY';\n"
if runner.count(legacy_constant) != 1:
    raise SystemExit(
        f'expected exactly one legacy AUTH_CONFIRM constant, found {runner.count(legacy_constant)}'
    )
runner = runner.replace(legacy_constant, '', 1)

start_marker = 'async function bootstrapAuthorization(envelopeId) {'
end_marker = '\nasync function requireReadyComment() {'
start = runner.find(start_marker)
end = runner.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('could not locate bounded bootstrapAuthorization section')

replacement = r'''function migrationAuthorizationConfirmation(migration) {
  return `AUTHORIZE_GOVERNED_MIGRATION_${String(migration || '')
    .replace(/\.sql$/i, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toUpperCase()}`;
}

async function bootstrapAuthorization(envelopeId) {
  const args = {
    migration: MIGRATION,
    expected_checksum_sha256: checksum,
    expected_statement_count: statementCount,
    pull_request: SOURCE_PR,
    merge_sha: SOURCE_MERGE_SHA,
    capability_envelope_id: envelopeId,
    decision_note: 'Authorize checksum-bound Migration 1048 readiness only after exact Production artifact and runtime parity; no SQL executes in readiness.',
  };

  // Fail closed: require the runtime to challenge for its canonical typed confirmation.
  const challenge = await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_authorization_bootstrap',
    tool_args: args,
  }, 300000);
  assert.equal(challenge.transport_ok, true, 'Migration 1048 authorization confirmation challenge transport failed');
  const challengeDetail = keyed(challenge.payload, 'code') || challenge.payload?.error || {};
  assert.equal(String(challengeDetail?.code), 'governed_migration_authorization_confirmation_required');
  const requiredConfirmation = String(challengeDetail?.details?.required_confirmation || '').trim();
  assert.equal(requiredConfirmation, migrationAuthorizationConfirmation(MIGRATION));

  const confirmedArgs = { ...args, confirm: requiredConfirmation };
  const confirmed = await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_authorization_bootstrap',
    tool_args: confirmedArgs,
  }, 300000);
  if (confirmed.transport_ok && confirmed.http_ok && confirmed.payload?.ok !== false) {
    return requireSuccess(confirmed, 'migration_1048_authorization_bootstrap');
  }

  const detail = keyed(confirmed.payload, 'code') || confirmed.payload?.error || {};
  assert.equal(String(detail?.code), 'governed_migration_authorization_previous_checksum_required');
  const previous = String(
    detail?.details?.recorded_checksum_sha256 ||
    detail?.details?.current_checksum_sha256 ||
    '',
  ).toLowerCase();
  assert.match(previous, /^[0-9a-f]{64}$/);
  assert.notEqual(previous, checksum);

  return requireSuccess(await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_authorization_bootstrap',
    tool_args: { ...confirmedArgs, previous_checksum_sha256: previous },
  }, 300000), 'migration_1048_authorization_rotation');
}
'''

runner = runner[:start] + replacement + runner[end:]

if 'const AUTH_CONFIRM =' in runner:
    raise SystemExit('legacy AUTH_CONFIRM still present after repair')
if runner.count("name: 'governed_migration_authorization_bootstrap'") != 3:
    raise SystemExit('expected exactly three bounded authorization bootstrap call sites')
if 'function migrationAuthorizationConfirmation(migration)' not in runner:
    raise SystemExit('runtime-derived confirmation helper missing after repair')

runner_path.write_text(runner)
print('Migration 1048 authorization handshake repair applied')
