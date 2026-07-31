import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('../.github/workflows/sprint69-1006-governed-rollout.yml', 'utf8');
const program = readFileSync('../.github/ops/sprint69-1006-governed-rollout.mjs', 'utf8');

assert.match(workflow, /issue_comment:/);
assert.doesNotMatch(workflow, /pull_request:/);
assert.doesNotMatch(workflow, /push:/);
assert.match(workflow, /github\.event\.issue\.number == 4122/);
assert.match(workflow, /AUTHORIZE_GOVERNED_MIGRATION_1006_SPRINT69_AGENT_CAPABILITY_EVIDENCE_COVERAGE/);
assert.match(workflow, /APPLY_1006_SPRINT69_AGENT_CAPABILITY_EVIDENCE_COVERAGE/);
assert.match(workflow, /contains\(fromJSON\('\["OWNER","MEMBER","COLLABORATOR"\]'\)/);
assert.match(workflow, /ref: main/);
assert.match(workflow, /cancel-in-progress: false/);
assert.match(workflow, /Upload no-secret readiness evidence/);
assert.match(workflow, /Upload no-secret apply evidence/);

assert.match(program, /const CHECKSUM = '995c657922413f9917fd4d93ac1213e76bc66b077c68646e4f5572c62c744374'/);
assert.match(program, /const STATEMENT_COUNT = 5/);
assert.match(program, /const SOURCE_PR = 3371/);
assert.match(program, /const SOURCE_MERGE_SHA = 'd14234a6ca478aa6c47e4c561c83a24063789d83'/);
assert.match(program, /const PRODUCTION_PROMOTION_SHA = 'abdeed2c5a588c19a2d1f2e35046e7b120d97016'/);
assert.match(program, /expected_tables: \[\.\.\.EXPECTED_OBJECTS\]/);
assert.match(program, /SELECT COUNT\(\*\) AS row_count FROM/);
assert.match(program, /Deliberately no Apply retry/);
assert.equal((program.match(/mode: 'apply'/g) || []).length, 1, 'program must contain one Apply invocation');
assert.match(program, /checkGovernedMigrationDependencies/);
assert.match(program, /1007_sprint69_agent_capability_coverage_admin_tools\.sql/);
assert.match(program, /database_mutation_executed: false/);
assert.match(program, /external_write_executed: false/);
assert.match(program, /secrets_included: false/);
assert.doesNotMatch(program, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);

console.log('Sprint 69 Migration 1006 governed rollout control checks passed');
