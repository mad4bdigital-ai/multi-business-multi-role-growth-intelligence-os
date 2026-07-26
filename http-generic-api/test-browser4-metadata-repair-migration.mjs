import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('migrations/132_sprint65_browser4_adapter_metadata_repair.sql', 'utf8');
assert(migration.includes('browser4_essam_v1'));
assert(migration.includes('/browser-runtime/inspect-site/run'));
assert(migration.includes('/browser4'));
assert(migration.includes('requires_connector_upgrade'));
assert(migration.includes('planned_adapter_available_after_connector_upgrade'));
console.log('browser4 metadata repair migration tests passed');
