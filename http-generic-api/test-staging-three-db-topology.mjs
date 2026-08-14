import fs from 'node:fs';
import assert from 'node:assert/strict';
import { parse } from 'yaml';

const compose = parse(fs.readFileSync(new URL('./docker-compose.staging.yml', import.meta.url), 'utf8'));
const env = fs.readFileSync(new URL('./.env.staging.example', import.meta.url), 'utf8');
const required = [
  'DB_HOST=runtime-db', 'DB_NAME=growth_runtime', 'DB_USER=runtime_app',
  'GOVERNANCE_DB_HOST=governance-db', 'GOVERNANCE_DB_NAME=governance_platform', 'GOVERNANCE_DB_USER=governance_writer',
  'RUNTIME_PERSISTENCE_DB_HOST=persistence-db', 'RUNTIME_PERSISTENCE_DB_NAME=growth_persistence', 'RUNTIME_PERSISTENCE_DB_USER=runtime_persistence_writer',
];
for (const entry of required) assert.ok(env.includes(entry), `missing env example entry: ${entry}`);
const services = compose.services;
for (const name of ['runtime-db', 'governance-db', 'persistence-db', 'app']) assert.ok(services[name], `missing service: ${name}`);
assert.equal(services['runtime-db'].image, 'mariadb:11.4');
assert.equal(services['governance-db'].image, 'mariadb:11.4');
assert.equal(services['persistence-db'].image, 'mariadb:11.4');
assert.deepEqual(services.app.depends_on, {
  'runtime-db': { condition: 'service_healthy' },
  'governance-db': { condition: 'service_healthy' },
  'persistence-db': { condition: 'service_healthy' },
});
for (const service of ['redis', 'app', 'runtime-db', 'governance-db', 'persistence-db']) {
  const mounts = services[service].volumes || [];
  assert.ok(mounts.some((mount) => String(mount).includes('${STAGING_DATA_ROOT:-./.staging-data}')), `missing SSD bind mount for ${service}`);
}
assert.match(env, /STAGING_DATA_ROOT=\.\/\.staging-data/);
assert.match(env, /MIGRATION_APPLIED=false/);
assert.match(env, /DATABASE_MUTATED=false/);
assert.match(env, /RULESET_MUTATION_AUTHORIZED=false/);
for (const disabled of [
  'OUTBOX_DELIVERY_ENABLED=false',
  'AUTH_EMAIL_OUTBOX_DELIVERY_ENABLED=false',
  'CONNECTOR_POWERSHELL_ENABLED=false',
  'CONNECTOR_WIN_ENABLED=false',
  'DEV_MIGRATION_APPLY_ENABLED=false',
  'DELEGATION_MARIADB_PRODUCTION_APPLY_MODE=disabled',
  'AGENT_DELEGATION_LEGACY_DIRECT_MUTATION_ENABLED=false',
  'REPO_PATCH_ALLOW_PROTECTED_BRANCH=false',
]) assert.match(env, new RegExp(disabled.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
console.log('staging_three_db_topology=PASS');
