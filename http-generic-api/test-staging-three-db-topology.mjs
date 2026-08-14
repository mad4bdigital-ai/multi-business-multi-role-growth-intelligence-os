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
const volumeNames = ['runtime_db_data', 'governance_db_data', 'persistence_db_data'];
assert.equal(new Set(volumeNames).size, 3);
assert.match(env, /MIGRATION_APPLIED=false/);
assert.match(env, /DATABASE_MUTATED=false/);
assert.match(env, /PRODUCTION_MUTATION_AUTHORIZED=false/);
console.log('staging_three_db_topology=PASS');
