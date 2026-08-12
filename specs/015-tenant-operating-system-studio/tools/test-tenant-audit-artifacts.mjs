import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = process.cwd();
const matrixPath = path.join(ROOT, 'docs/spec-portfolio/spec015-tenant-reuse-matrix-20260812.json');
const snapshotPath = path.join(ROOT, 'docs/spec-portfolio/spec015-candidate-pr-readonly-evidence-20260812.jsonl');
const convergencePath = path.join(ROOT, 'specs/015-tenant-operating-system-studio/candidate-convergence.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function relativeExists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

const matrix = readJson(matrixPath);
assert.equal(matrix.schema_version, '1.0.0');
assert.equal(matrix.spec_key, '015-tenant-operating-system-studio');
assert.equal(matrix.status, 'audit_only_review_required');
assert.equal(matrix.secrets_included, false);
assert.equal(matrix.runtime_mutation_executed, false);
assert.match(matrix.snapshot_base_main_sha, /^[0-9a-f]{40}$/);
assert.ok(Array.isArray(matrix.rows) && matrix.rows.length >= 10);

const statuses = new Set([
  'spec_contract_only',
  'contract_and_preview_boundary_only',
  'policy_and_contract_audit_only',
  'existing_runtime_surface_plus_candidate_audit',
  'not_implemented',
  'partial_existing_surfaces_and_spec_contracts',
  'spec_and_governance_boundary_only',
  'transition_requirements_only',
  'ownership_contract_boundary_only',
  'read_only_evidence_refreshable',
]);
for (const row of matrix.rows) {
  assert.ok(row.logical_entity);
  assert.ok(Array.isArray(row.spec_tasks) && row.spec_tasks.length > 0);
  assert.ok(statuses.has(row.current_status), `unexpected status for ${row.logical_entity}`);
  assert.ok(row.authority_status);
  assert.ok(Array.isArray(row.evidence_paths) && row.evidence_paths.length > 0);
  assert.ok(row.evidence_paths.every(relativeExists), `missing evidence for ${row.logical_entity}`);
  assert.ok(Array.isArray(row.not_claimed) && row.not_claimed.length > 0);
}

const rows = fs.readFileSync(snapshotPath, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => JSON.parse(line));
assert.equal(rows.length, 9);
assert.deepEqual([...new Set(rows.map((row) => row.number))].sort((a, b) => a - b), [2284, 2385, 2949, 3139, 3145, 3159, 3922, 4386, 4432]);
assert.ok(rows.every((row) => row.baseRefName === 'main'));
assert.equal(rows.filter((row) => row.state === 'OPEN').length, 4);
assert.equal(rows.filter((row) => row.state === 'CLOSED' || row.state === 'MERGED').length, 5);
assert.equal(rows.filter((row) => row.isDraft === true).length, 8);
assert.equal(rows.filter((row) => row.mergeable === 'CONFLICTING').length, 4);
assert.ok(rows.every((row) => row.snapshotBaseMainSha === matrix.snapshot_base_main_sha));
assert.ok(rows.every((row) => row.safe_read_only === true));
assert.ok(rows.every((row) => row.merge_executed === false));
assert.ok(rows.every((row) => row.secrets_included === false));
assert.ok(rows.every((row) => /^[0-9a-f]{40}$/.test(row.headRefOid)));
assert.ok(rows.every((row) => Array.isArray(row.paths) && row.file_count === row.paths.length));

const convergence = readJson(convergencePath);
assert.equal(convergence.base_main_sha, matrix.snapshot_base_main_sha);
assert.equal(convergence.status, 'draft_review_required');
assert.equal(convergence.secrets_included, false);
assert.ok(convergence.candidates.every((candidate) => candidate.merge_posture === 'do_not_blind_merge_reconstruct_on_current_main'));

console.log(JSON.stringify({
  ok: true,
  test: 'spec015-tenant-audit-artifacts',
  matrix_rows: matrix.rows.length,
  candidate_records: rows.length,
  snapshot_base_main_sha: matrix.snapshot_base_main_sha,
  safe_read_only: true,
  merge_executed: false,
  secrets_included: false,
}, null, 2));
