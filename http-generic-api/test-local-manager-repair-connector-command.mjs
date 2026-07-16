import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const program = readFileSync(new URL('../apps/local-manager-windows/Program.cs', import.meta.url), 'utf8');
const desktopRoutes = readFileSync(new URL('./routes/localManagerDesktopCommandRoutes.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('./migrations/20260712_local_manager_repair_connector_action.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const runner = readFileSync(new URL('./scripts/governed-migration-runner.mjs', import.meta.url), 'utf8');

assert.ok(program.includes('string.Equals(action, "repair_connector", StringComparison.OrdinalIgnoreCase)'));
assert.ok(program.includes('await RepairConnectorAsync();'));
assert.ok(program.includes('app_managed_installer = true'));
assert.ok(program.includes('browser_download = false'));
assert.ok(program.includes('ClassifyRepairOutcome(repairStatus)'));
assert.ok(program.includes('repair_stage = repairStage'));
assert.ok(program.includes('repair_verified = repairVerified'));
assert.ok(program.includes('connector_repair_not_verified'));
assert.ok(program.includes('installer_completed_runtime_unverified'));
assert.ok(program.includes('completed, but post-install runtime verification did not pass.'));
assert.ok(program.includes('completed. Post-install verification passed.'));
assert.ok(program.includes('verification_completed'));
assert.ok(program.includes('repair_verified = repairVerified'));
assert.ok(program.includes('secrets_included = false'));
const repairCommandStart = program.indexOf('string.Equals(action, "repair_connector"');
const repairCommandEnd = program.indexOf('string.Equals(action, "focus_local_manager"', repairCommandStart);
assert.ok(repairCommandStart >= 0 && repairCommandEnd > repairCommandStart);
const repairCommandBlock = program.slice(repairCommandStart, repairCommandEnd);
assert.doesNotMatch(repairCommandBlock, /OpenUrlAsync|Process\.Start|open_url/i);
assert.doesNotMatch(repairCommandBlock, /CompleteDesktopCommandAsync\(client, token, commandId, true/);
assert.match(repairCommandBlock, /CompleteDesktopCommandAsync\(client, token, commandId, repairVerified/);

assert.ok(desktopRoutes.includes('"repair_connector"'));
assert.ok(desktopRoutes.includes('const ALLOWED_ACTIONS = new Set'));

assert.ok(migration.includes("JSON_ARRAY('open_url', 'open_n8n', 'notify', 'focus_local_manager', 'repair_connector'"));
assert.ok(migration.includes('app_managed_installer'));
assert.ok(migration.includes('must not open a browser download'));
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.ok(runner.includes('20260712_local_manager_repair_connector_action.sql'));

console.log('Local Manager app-managed connector repair command tests passed');
