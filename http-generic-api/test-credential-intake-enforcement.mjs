import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  __test__ as intakeEnforcement,
  maybeCreateCredentialIntakeRequirement,
} from './credentialIntakeEnforcement.js';

const credentialRoutes = readFileSync('routes/credentialRoutes.js', 'utf8');
const intakeSource = readFileSync('credentialIntakeEnforcement.js', 'utf8');
const toolSchemaMigration = readFileSync('migrations/170_sprint65_credential_intake_enforcement_tool_schema.sql', 'utf8');

assert.equal(
  intakeEnforcement.shouldCreateCredentialIntake({ enforce_intake: true }, { status: 'blocked_missing_secret' }),
  true,
  'enforce_intake should trigger intake for missing secrets',
);
assert.equal(
  intakeEnforcement.shouldCreateCredentialIntake({}, { status: 'blocked_missing_secret' }),
  false,
  'missing-secret responses must not mutate by default',
);
assert.equal(
  intakeEnforcement.shouldCreateCredentialIntake({ enforce_intake: true }, { status: 'resolved' }),
  false,
  'resolved credentials must not create intake sessions',
);

assert.equal(
  intakeEnforcement.inferAuthType({ credential_role: 'wordpress_app_password' }, {}),
  'basic_auth',
  'wordpress app password should infer basic_auth intake',
);
assert.equal(
  intakeEnforcement.inferCredentialField({ credential_role: 'local_connector_api_key' }, { missing_secret_key: 'connector_local_api_key' }, 'api_key'),
  'connector_local_api_key',
  'specific missing_secret_key should be preserved as intake field',
);

const unavailable = await maybeCreateCredentialIntakeRequirement(
  { tenant_id: 'tenant-1', enforce_intake: true },
  { status: 'blocked_missing_secret', missing_secret_key: 'api_key' },
  { pool: { query: async () => [[]] } },
);
assert.equal(unavailable.status, 'credential_intake_unavailable');
assert.equal(unavailable.reason, 'user_id_required');
assert.equal(unavailable.secrets_included, false);

assert(
  credentialRoutes.includes('maybeCreateCredentialIntakeRequirement(input, credential, { req })'),
  'effective status route should attach dynamic intake requirements',
);
assert(
  credentialRoutes.includes('maybeCreateCredentialIntakeRequirement(input, plan.effective || {}, { req })'),
  'effective plan route should attach dynamic intake requirements',
);
assert(
  intakeSource.includes('JSON_UNQUOTE(JSON_EXTRACT(metadata_json') && intakeSource.includes('intake_requirement_key'),
  'intake enforcement should de-duplicate pending sessions by requirement key',
);
assert(
  intakeSource.includes('secrets_included: false') && !intakeSource.includes('secret_value'),
  'intake enforcement responses must stay secret-safe',
);

console.log('credential intake enforcement tests passed');
