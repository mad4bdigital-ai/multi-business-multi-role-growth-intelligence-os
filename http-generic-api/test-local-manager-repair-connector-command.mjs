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
assert.ok(program.includes('secrets_included = false'));
assert.ok(program.indexOf('string.Equals(action, "repair_connector"') < program.indexOf('string.Equals(action, "open_url"'));

assert.ok(desktopRoutes.includes('"repair_connector"'));
assert.ok(desktopRoutes.includes('const ALLOWED_ACTIONS = new Set'));

assert.ok(migration.includes("JSON_ARRAY('open_url', 'open_n8n', 'notify', 'focus_local_manager', 'repair_connector'"));
assert.ok(migration.includes('app_managed_installer'));
assert.ok(migration.includes('must not open a browser download'));
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.ok(runner.includes('20260712_local_manager_repair_connector_action.sql'));

console.log('Local Manager app-managed connector repair command tests passed');
