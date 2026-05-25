import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./routes/devAgentRoutes.js', import.meta.url), 'utf8');

assert(
  source.includes('router.post("/dev-agent/summary-comparison/run"'),
  'summary comparison diagnostic route should be registered',
);
assert(
  source.includes('summarizeTranscriptWithModel'),
  'comparison route should use current session summary model path',
);
assert(
  source.includes('runN8nWorkflowRuntime'),
  'comparison route should invoke n8n experiment through governed workflow runtime',
);
assert(
  source.includes('summary_n8n_experiment_v1'),
  'comparison route should default to explicit experimental binding key',
);
assert(
  source.includes('production_route_unchanged: true'),
  'comparison response should declare production route is unchanged',
);
assert(
  source.includes('writes_session_summaries: false'),
  'comparison route should not write session_summaries',
);
assert(
  !source.match(/summary-comparison[\s\S]{0,4000}writeSessionSummary\(/),
  'summary comparison route must not call writeSessionSummary',
);
assert(
  source.includes('persistSummaryComparisonRun'),
  'summary comparison route should persist diagnostics to summary_comparison_runs',
);
assert(
  source.includes('summary_comparison_runs'),
  'summary comparison diagnostics should use the isolated comparison table',
);
assert(
  !source.match(/INSERT INTO\s+`session_summaries`[\s\S]{0,2000}summary-comparison/),
  'summary comparison route must not insert into session_summaries',
);

const migration = fs.readFileSync(new URL('./migrations/123_sprint64_summary_comparison_runs.sql', import.meta.url), 'utf8');
assert(migration.includes('CREATE TABLE IF NOT EXISTS `summary_comparison_runs`'), 'migration should create summary_comparison_runs');
assert(migration.includes('dev_agent_summary_comparison_run'), 'migration should register admin comparison tool');

console.log('summary comparison route guard tests passed');
