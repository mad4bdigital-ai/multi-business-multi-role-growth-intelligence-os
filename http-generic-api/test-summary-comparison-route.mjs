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

assert(
  source.includes('router.get("/dev-agent/summary-comparison/report"'),
  'summary comparison report route should be registered',
);
assert(
  source.includes('summary_comparison_runs') && source.includes('n8n_speed_win_rate'),
  'summary comparison report should aggregate persisted comparison runs',
);
assert(
  source.includes('reads_only: true'),
  'summary comparison report should declare read-only behavior',
);
assert(
  source.includes('preferred_output_breakdown') && source.includes('use_case_fit_breakdown'),
  'summary comparison report should include preference and use-case breakdowns',
);
assert(
  source.includes('quality_decision_hint') && source.includes('recommended_default'),
  'summary comparison report should return decision hint metadata',
);
const reportMigration = fs.readFileSync(new URL('./migrations/124_sprint64_summary_comparison_report_tool.sql', import.meta.url), 'utf8');
assert(reportMigration.includes('dev_agent_summary_comparison_report'), 'report migration should register admin report tool');
assert(reportMigration.includes('read_only'), 'report tool should be tagged read_only');

assert(
  source.includes('router.post("/dev-agent/summary-comparison/score"'),
  'summary comparison score route should be registered',
);
assert(
  source.includes('preferred_output') && source.includes('quality_score_model') && source.includes('quality_score_n8n'),
  'summary comparison score route should support manual quality scoring fields',
);
assert(
  source.includes('reviewed_at = NOW()'),
  'summary comparison score route should record review timestamp',
);
const scoringMigration = fs.readFileSync(new URL('./migrations/125_sprint64_summary_comparison_quality_scoring.sql', import.meta.url), 'utf8');
assert(scoringMigration.includes('preferred_output'), 'scoring migration should add preferred_output');
assert(scoringMigration.includes('dev_agent_summary_comparison_score'), 'scoring migration should register scoring tool');
assert(
  !scoringMigration.match(/(ALTER TABLE|INSERT INTO|UPDATE)\s+`session_summaries`/i),
  'scoring migration must not modify session_summaries',
);

console.log('summary comparison route guard tests passed');
