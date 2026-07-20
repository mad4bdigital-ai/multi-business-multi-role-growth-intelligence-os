import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('./migrations/20260713_local_manager_desktop_command_mutation_policy.sql', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');

for (const marker of [
  "WHERE `tool_key` = 'local_manager_desktop_command_enqueue'",
  'mutation_policy_required',
  'approval_required',
  'readback',
  'same_cycle_readback',
  'local_consent_required',
  'app_managed_installer',
  'no_secrets',
]) {
  assert.ok(migration.includes(marker), `missing mutation contract marker: ${marker}`);
}

assert.ok(migration.includes('same-cycle command-status readback'));
assert.ok(migration.includes('must not open a browser download'));
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /connector_secret|cf_token|api_key\s*=|authorization\s*=/i);

console.log('Local Manager desktop command mutation policy tests passed');
