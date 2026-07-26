import assert from 'node:assert/strict';
import fs from 'node:fs';

const templatePaths = [
  new URL('./n8n-workflows/platform-classification-v1.template.json', import.meta.url),
  new URL('./n8n-workflows/platform-summary-experiment-v1.template.json', import.meta.url),
  new URL('./n8n-workflows/platform-summary-experiment-v2.template.json', import.meta.url),
];

for (const templatePath of templatePaths) {
  const raw = fs.readFileSync(templatePath, 'utf8');
  const template = JSON.parse(raw);
  assert.equal(template.security_assertions?.contains_secret_values, false, `${templatePath.pathname} must not contain secret values`);
  assert.equal(template.security_assertions?.uses_native_header_auth, true, `${templatePath.pathname} should use native n8n Header Auth`);
  assert.equal(template.security_assertions?.code_node_uses_process_env, false, `${templatePath.pathname} code nodes must not read process.env`);
  assert.equal(template.security_assertions?.code_node_contains_bearer_literal, false, `${templatePath.pathname} code nodes must not contain bearer literals`);
  assert(!raw.match(/Bearer\s+[A-Za-z0-9._~+\-/]{12,}/i), `${templatePath.pathname} must not contain bearer token values`);
  assert(!raw.match(/N8N_API_KEY\s*[:=]\s*['\"][^'\"]+/i), `${templatePath.pathname} must not contain n8n API key values`);
}

const summary = JSON.parse(fs.readFileSync(new URL('./n8n-workflows/platform-summary-experiment-v1.template.json', import.meta.url), 'utf8'));
assert.equal(summary.binding_key, 'summary_n8n_experiment_v1');
assert.equal(summary.workflow_key, 'summary_experiment');
assert.equal(summary.security_assertions.production_replacement, false, 'summary experiment must not be marked as production replacement');
assert.equal(summary.security_assertions.canonical_summary_write_allowed, false, 'summary experiment must not allow canonical summary writes');
assert.equal(summary.runtime_binding?.experiment_policy?.promotion_status, 'not_promoted');
assert(summary.runtime_binding.experiment_policy.blocked_use_cases.includes('canonical_summary_write'));
assert(summary.runtime_binding.experiment_policy.allowed_use_cases.includes('quick_preview'));

const summaryV2 = JSON.parse(fs.readFileSync(new URL('./n8n-workflows/platform-summary-experiment-v2.template.json', import.meta.url), 'utf8'));
assert.equal(summaryV2.binding_key, 'summary_n8n_experiment_v2');
assert.equal(summaryV2.workflow_key, 'summary_experiment_v2');
assert.equal(summaryV2.security_assertions.production_replacement, false, 'summary v2 experiment must not be marked as production replacement');
assert.equal(summaryV2.security_assertions.canonical_summary_write_allowed, false, 'summary v2 experiment must not allow canonical summary writes');
assert.equal(summaryV2.runtime_binding?.experiment_policy?.promotion_status, 'not_promoted');
assert(summaryV2.runtime_binding.experiment_policy.blocked_use_cases.includes('canonical_summary_write'));
assert(summaryV2.runtime_binding.experiment_policy.allowed_use_cases.includes('v2_evaluation'));
assert(summaryV2.workflow.nodes.some((node) => String(node.parameters?.jsCode || '').includes('decisions')));
assert(summaryV2.workflow.nodes.some((node) => String(node.parameters?.jsCode || '').includes('next_actions')));

const restoreScript = fs.readFileSync(new URL('./n8n-workflows/restore-platform-summary-experiment-v1.mjs', import.meta.url), 'utf8');
assert(restoreScript.includes('platform-summary-experiment-v1.template.json'));
assert(restoreScript.includes('platform-summary-experiment'));
assert(restoreScript.includes('secrets_printed: false'));

const restoreScriptV2 = fs.readFileSync(new URL('./n8n-workflows/restore-platform-summary-experiment-v2.mjs', import.meta.url), 'utf8');
assert(restoreScriptV2.includes('platform-summary-experiment-v2.template.json'));
assert(restoreScriptV2.includes('platform-summary-experiment-v2'));
assert(restoreScriptV2.includes('secrets_printed: false'));

console.log('n8n workflow template safety tests passed');
