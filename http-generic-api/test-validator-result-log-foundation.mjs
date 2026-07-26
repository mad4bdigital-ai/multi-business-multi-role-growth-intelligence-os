import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('./migrations/177_sprint65_validator_result_log_foundation.sql', import.meta.url), 'utf8');
const registry = fs.readFileSync(new URL('./platformEngineRegistry.js', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('./routes/platformEngineRoutes.js', import.meta.url), 'utf8');
const doc = fs.readFileSync(new URL('../docs/validator-result-log.md', import.meta.url), 'utf8');

assert(migration.includes('CREATE TABLE IF NOT EXISTS platform_engine_validator_result_log'), 'validator result log table must be created');
assert(migration.includes('v_platform_engine_validator_result_summary'), 'summary view must be created');
assert(migration.includes('v_platform_engine_validator_latest_failures'), 'latest failures view must be created');
assert(migration.includes('platform_engine_validator_results'), 'read tool must be registered');
assert(migration.includes('platform_engine_validator_result_log'), 'write tool must be registered');
assert(migration.includes('validators_executed_by_route') === false, 'migration should not claim route execution behavior');

assert(registry.includes('writePlatformEngineValidatorResult'), 'registry helper must write validator evidence');
assert(registry.includes('listPlatformEngineValidatorResults'), 'registry helper must list validator evidence');
assert(registry.includes('sanitizeAuditValue'), 'validator evidence must reuse audit redaction');
assert(registry.includes('boundedExcerpt'), 'validator output excerpts must be bounded');
assert(registry.includes('platform_engine_validator_status_invalid'), 'validator status must be validated');

assert(routes.includes('router.get("/platform/engines/validator-results"'), 'read route must exist');
assert(routes.includes('router.post("/platform/engines/validator-results"'), 'write route must exist');
assert(routes.includes('validators_executed_by_route: false'), 'write route must state it does not execute validators');
assert(routes.includes('apply_executed: false'), 'write route must state it does not apply changes');

for (const forbidden of [/\bDROP\s+TABLE\b/i, /\bTRUNCATE\s+TABLE\b/i, /\bDELETE\s+FROM\b/i, /repo\.patch\.apply/i, /github\.pr\.merge/i, /wordpress\.publish/i]) {
  assert(!forbidden.test(migration), `validator result foundation must not include destructive/apply operation: ${forbidden}`);
}

assert(doc.includes('evidence-only'), 'docs must state evidence-only boundary');
assert(doc.includes('does not execute validators'), 'docs must state route does not execute validators');
assert(doc.includes('does not perform apply'), 'docs must state route does not perform apply');
assert(doc.includes('validators_executed_and_passed'), 'docs must explain next readiness target');

console.log('validator result log foundation tests passed');
