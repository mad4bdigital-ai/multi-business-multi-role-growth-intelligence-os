import assert from 'node:assert/strict';
import fs from 'node:fs';

const template = JSON.parse(fs.readFileSync(new URL('../local-connector/n8n-workflows/platform-summary-experiment-v2.template.json', import.meta.url), 'utf8'));
const restoreScript = fs.readFileSync(new URL('../local-connector/n8n-workflows/restore-platform-summary-experiment-v2.mjs', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('./migrations/129_sprint64_summary_experiment_v2_binding.sql', import.meta.url), 'utf8');

assert.equal(template.binding_key, 'summary_n8n_experiment_v2');
assert.equal(template.workflow_key, 'summary_experiment_v2');
assert.equal(template.security_assertions.contains_secret_values, false);
assert.equal(template.security_assertions.production_replacement, false);
assert.equal(template.security_assertions.canonical_summary_write_allowed, false);
assert.equal(template.runtime_binding.experiment_policy.promotion_status, 'not_promoted');
assert(template.runtime_binding.experiment_policy.blocked_use_cases.includes('canonical_summary_write'));
assert(template.workflow.nodes.some((node) => String(node.parameters?.jsCode || '').includes('decisions')));
assert(template.workflow.nodes.some((node) => String(node.parameters?.jsCode || '').includes('next_actions')));

assert(restoreScript.includes('platform-summary-experiment-v2.template.json'));
assert(restoreScript.includes('platform-summary-experiment-v2'));
assert(restoreScript.includes('secrets_printed: false'));
assert(!restoreScript.match(/console\.log\([^)]*webhookToken/i), 'restore script must not print webhook token');

assert(migration.includes('summary_n8n_experiment_v2'));
assert(migration.includes('not_promoted'));
assert(migration.includes('canonical_summary_write'));
assert(!migration.match(/INSERT INTO\s+`session_summaries`/i), 'v2 migration must not modify session_summaries');

console.log('summary experiment v2 asset guard tests passed');
