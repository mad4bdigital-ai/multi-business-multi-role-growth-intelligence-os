import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('./migrations/130_sprint64_summary_development_automation.sql', import.meta.url), 'utf8');
const toolsMigration = fs.readFileSync(new URL('./migrations/131_sprint64_summary_development_automation_tools.sql', import.meta.url), 'utf8');
const dryRunToolMigration = fs.readFileSync(new URL('./migrations/132_sprint64_summary_development_agent_dry_run_tool.sql', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('./routes/devAgentRoutes.js', import.meta.url), 'utf8');

assert(migration.includes('CREATE TABLE IF NOT EXISTS dev_agent_runtime_registry'));
assert(migration.includes('CREATE TABLE IF NOT EXISTS summary_development_signals'));
assert(migration.includes('CREATE TABLE IF NOT EXISTS summary_development_automation_runs'));
assert(migration.includes('openclaude_essam_local_v1'));
assert(migration.includes('platform_gemini_dev_agent_v1'));
assert(migration.includes('platform_openrouter_dev_agent_v1'));
assert(migration.includes('"can_mutate_repo":false'));
assert(migration.includes('"default_mode":"dry_run"'));

assert(toolsMigration.includes('dev_agent_summary_development_runtimes'));
assert(toolsMigration.includes('dev_agent_summary_development_signals'));
assert(toolsMigration.includes('dev_agent_summary_development_extract'));
assert(toolsMigration.includes('This does not execute code or mutate repositories'));

assert(routes.includes('/dev-agent/summary-development/runtimes'));
assert(routes.includes('/dev-agent/summary-development/signals'));
assert(routes.includes('/dev-agent/summary-development/extract'));
assert(routes.includes('auto_execute_code: false'));
assert(routes.includes('auto_mutate_repo: false'));
assert(routes.includes('create_pending_tasks'));
assert(routes.includes('safeParseJsonArray'));
assert(!routes.includes('safeParseArr(summary.'), 'route must use its local JSON array parser');
assert(routes.includes('openclaude_essam_local_v1'));
assert(!routes.includes('openclaude --write'), 'summary development automation must not invoke OpenClaude writes directly');
assert(!routes.includes('git push'), 'summary development automation must not push code directly');

console.log('summary development automation contract tests passed');
