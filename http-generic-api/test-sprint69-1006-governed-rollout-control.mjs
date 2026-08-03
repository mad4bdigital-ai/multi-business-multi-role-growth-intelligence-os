import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('../.github/workflows/sprint69-1006-governed-rollout.yml', 'utf8');
const program = readFileSync('../.github/ops/sprint69-1006-governed-rollout.mjs', 'utf8');
const validator = readFileSync('../.github/ops/validate-sprint69-1006-readiness-trigger.mjs', 'utf8');
const trigger = JSON.parse(readFileSync('../.github/ops/triggers/sprint69-1006-readiness-trigger.json', 'utf8'));
const applyJob = workflow.split('\n  apply:')[1] || '';

assert.match(workflow, /issue_comment:/);
assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /confirmation_comment_id:/);
assert.match(workflow, /Exact readiness authorization comment ID 5170518874/);
assert.match(workflow, /expected_main_sha:/);
assert.match(workflow, /push:/);
assert.match(workflow, /branches: \[main\]/);
assert.match(workflow, /sprint69-1006-readiness-trigger\.json/);
assert.doesNotMatch(workflow, /pull_request:/);
assert.match(workflow, /github\.event_name == 'issue_comment'/);
assert.match(workflow, /github\.event_name == 'workflow_dispatch'/);
assert.match(workflow, /github\.event_name == 'push'/);
assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
assert.match(workflow, /DISPATCH_CONFIRMATION_COMMENT_ID: \$\{\{ inputs\.confirmation_comment_id \}\}/);
assert.match(workflow, /DISPATCH_EXPECTED_MAIN_SHA: \$\{\{ inputs\.expected_main_sha \}\}/);
assert.match(workflow, /Validate manual dispatch operator authorization/);
assert.match(workflow, /github\.event\.issue\.number == 4122/);
assert.match(workflow, /AUTHORIZE_GOVERNED_MIGRATION_1006_SPRINT69_AGENT_CAPABILITY_EVIDENCE_COVERAGE/);
assert.match(workflow, /APPLY_1006_SPRINT69_AGENT_CAPABILITY_EVIDENCE_COVERAGE/);
assert.match(workflow, /contains\(fromJSON\('\["OWNER","MEMBER","COLLABORATOR"\]'\)/);
assert.match(workflow, /Validate push fallback operator authorization/);
assert.match(workflow, /validate-sprint69-1006-readiness-trigger\.mjs/);
assert.match(workflow, /ref: main/);
assert.match(workflow, /cancel-in-progress: false/);
assert.match(workflow, /Upload no-secret readiness evidence/);
assert.match(workflow, /Upload no-secret apply evidence/);
assert.match(workflow, /GITHUB_STEP_SUMMARY/);
assert.doesNotMatch(workflow, /issues:\s*write/);
assert.doesNotMatch(workflow, /\bgh\s+api\b/);
assert.doesNotMatch(workflow, /EVIDENCE_DIR:\s*\$\{\{\s*runner\.temp\s*\}\}/);
assert.match(workflow, /EVIDENCE_DIR: \.artifacts\/sprint69-1006-readiness/);
assert.match(workflow, /EVIDENCE_DIR: \.artifacts\/sprint69-1006-apply/);
assert.doesNotMatch(applyJob, /workflow_dispatch/, 'manual dispatch must never authorize the Apply job');

assert.equal(trigger.schema_version, 1);
assert.equal(trigger.phase, 'readiness');
assert.equal(trigger.issue_number, 4122);
assert.equal(trigger.confirmation_comment_id, 5143273227);
assert.equal(trigger.confirmation_body, 'AUTHORIZE_GOVERNED_MIGRATION_1006_SPRINT69_AGENT_CAPABILITY_EVIDENCE_COVERAGE');
assert.equal(trigger.migration_id, '1006_sprint69_agent_capability_evidence_coverage');
assert.equal(trigger.checksum, '995c657922413f9917fd4d93ac1213e76bc66b077c68646e4f5572c62c744374');
assert.equal(trigger.statement_count, 5);
assert.equal(trigger.requested_by, 'mad4bdigital-ai');
assert.equal(trigger.database_mutation_authorized, false);
assert.equal(trigger.apply_authorized, false);

assert.match(validator, /EXPECTED_ISSUE = 4122/);
assert.match(validator, /EXPECTED_CONFIRMATION = 'AUTHORIZE_GOVERNED_MIGRATION_1006_SPRINT69_AGENT_CAPABILITY_EVIDENCE_COVERAGE'/);
assert.match(validator, /EXPECTED_CHECKSUM = '995c657922413f9917fd4d93ac1213e76bc66b077c68646e4f5572c62c744374'/);
assert.match(validator, /EXPECTED_DISPATCH_CONFIRMATION_COMMENT_ID = 5170518874/);
assert.match(validator, /ALLOWED_ASSOCIATIONS = new Set\(\['OWNER', 'MEMBER', 'COLLABORATOR'\]\)/);
assert.match(validator, /eventName === 'workflow_dispatch'/);
assert.match(validator, /DISPATCH_CONFIRMATION_COMMENT_ID/);
assert.match(validator, /DISPATCH_EXPECTED_MAIN_SHA/);
assert.match(validator, /confirmationCommentId,\s*EXPECTED_DISPATCH_CONFIRMATION_COMMENT_ID/);
assert.match(validator, /unexpected dispatch confirmation comment id/);
assert.match(validator, /assert\.equal\(currentSha, expectedMainSha, 'workflow_dispatch main SHA mismatch'\)/);
assert.match(validator, /requested_by: actor/);
assert.match(validator, /issues\/comments\/\$\{marker\.confirmation_comment_id\}/);
assert.match(validator, /comment\.body, EXPECTED_CONFIRMATION/);
assert.match(validator, /comment\.user\?\.login, marker\.requested_by/);
assert.match(validator, /marker\.database_mutation_authorized, false/);
assert.match(validator, /marker\.apply_authorized, false/);
assert.match(validator, /database_mutation_executed: false/);
assert.match(validator, /external_write_executed: false/);
assert.match(validator, /secrets_included: false/);

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

const dispatchEnvKeys = [
  'GITHUB_REPOSITORY',
  'GH_TOKEN',
  'GITHUB_EVENT_NAME',
  'GITHUB_ACTOR',
  'GITHUB_SHA',
  'DISPATCH_EXPECTED_MAIN_SHA',
  'DISPATCH_CONFIRMATION_COMMENT_ID',
];
const originalDispatchEnv = Object.fromEntries(dispatchEnvKeys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const dispatchSha = 'a'.repeat(40);

try {
  Object.assign(process.env, {
    GITHUB_REPOSITORY: 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os',
    GH_TOKEN: 'test-token',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_ACTOR: 'mad4bdigital-ai',
    GITHUB_SHA: dispatchSha,
    DISPATCH_EXPECTED_MAIN_SHA: dispatchSha,
    DISPATCH_CONFIRMATION_COMMENT_ID: '5143273227',
  });
  globalThis.fetch = async () => {
    throw new Error('historical comment replay must fail before GitHub read');
  };

  await assert.rejects(
    import('../.github/ops/validate-sprint69-1006-readiness-trigger.mjs?replay-rejected'),
    /unexpected dispatch confirmation comment id/,
  );

  process.env.DISPATCH_CONFIRMATION_COMMENT_ID = '5170518874';
  globalThis.fetch = async (url) => {
    assert.match(String(url), /issues\/comments\/5170518874$/);
    return {
      ok: true,
      async json() {
        return {
          body: 'AUTHORIZE_GOVERNED_MIGRATION_1006_SPRINT69_AGENT_CAPABILITY_EVIDENCE_COVERAGE',
          user: { login: 'mad4bdigital-ai' },
          author_association: 'OWNER',
          issue_url: 'https://api.github.com/repos/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/issues/4122',
        };
      },
    };
  };

  await import('../.github/ops/validate-sprint69-1006-readiness-trigger.mjs?fresh-authorized');
} finally {
  globalThis.fetch = originalFetch;
  for (const key of dispatchEnvKeys) {
    const value = originalDispatchEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log('Sprint 69 Migration 1006 governed rollout control checks passed');
