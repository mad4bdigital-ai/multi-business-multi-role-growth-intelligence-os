import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const EXPECTED_ISSUE = 4122;
const EXPECTED_CONFIRMATION = 'AUTHORIZE_GOVERNED_MIGRATION_1006_SPRINT69_AGENT_CAPABILITY_EVIDENCE_COVERAGE';
const EXPECTED_CHECKSUM = '995c657922413f9917fd4d93ac1213e76bc66b077c68646e4f5572c62c744374';
const ALLOWED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const triggerPath = process.env.READINESS_TRIGGER_PATH || '.github/ops/triggers/sprint69-1006-readiness-trigger.json';
const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

assert.ok(repository, 'GITHUB_REPOSITORY is required');
assert.ok(token, 'GH_TOKEN or GITHUB_TOKEN is required');

const marker = JSON.parse(readFileSync(triggerPath, 'utf8'));
assert.equal(marker.schema_version, 1, 'unexpected trigger schema version');
assert.equal(marker.phase, 'readiness', 'trigger phase must be readiness');
assert.equal(marker.issue_number, EXPECTED_ISSUE, 'unexpected control issue');
assert.equal(marker.confirmation_body, EXPECTED_CONFIRMATION, 'unexpected confirmation body');
assert.equal(marker.migration_id, '1006_sprint69_agent_capability_evidence_coverage', 'unexpected migration id');
assert.equal(marker.checksum, EXPECTED_CHECKSUM, 'unexpected migration checksum');
assert.equal(marker.statement_count, 5, 'unexpected migration statement count');
assert.ok(Number.isSafeInteger(marker.confirmation_comment_id) && marker.confirmation_comment_id > 0, 'invalid confirmation comment id');
assert.match(marker.requested_by, /^[A-Za-z0-9-]+$/, 'invalid requested_by login');

const response = await fetch(
  `https://api.github.com/repos/${repository}/issues/comments/${marker.confirmation_comment_id}`,
  {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'sprint69-migration-1006-readiness-validator',
    },
  },
);

if (!response.ok) {
  throw new Error(`unable to read confirmation comment: HTTP ${response.status}`);
}

const comment = await response.json();
assert.equal(comment.body, EXPECTED_CONFIRMATION, 'confirmation comment body mismatch');
assert.equal(comment.user?.login, marker.requested_by, 'confirmation author mismatch');
assert.ok(ALLOWED_ASSOCIATIONS.has(comment.author_association), `confirmation author association is not allowed: ${comment.author_association}`);
assert.match(comment.issue_url || '', new RegExp(`/issues/${EXPECTED_ISSUE}$`), 'confirmation belongs to a different issue');

process.stdout.write(`${JSON.stringify({
  ok: true,
  phase: marker.phase,
  issue_number: marker.issue_number,
  confirmation_comment_id: marker.confirmation_comment_id,
  requested_by: marker.requested_by,
  author_association: comment.author_association,
  checksum: marker.checksum,
  statement_count: marker.statement_count,
  database_mutation_executed: false,
  external_write_executed: false,
  secrets_included: false,
})}\n`);
