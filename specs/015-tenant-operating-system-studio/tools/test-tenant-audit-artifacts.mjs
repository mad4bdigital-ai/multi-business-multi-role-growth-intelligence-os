import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const matrixPath = path.join(ROOT, 'docs/spec-portfolio/spec015-tenant-reuse-matrix-20260812.json');
const snapshotPath = path.join(ROOT, 'docs/spec-portfolio/spec015-candidate-pr-readonly-evidence-20260812.jsonl');
const specRoot = path.join(ROOT, 'specs/015-tenant-operating-system-studio');
const convergencePath = path.join(specRoot, 'candidate-convergence.json');
const manifestPath = path.join(specRoot, 'manifest.json');
const completionPath = path.join(specRoot, 'completion.json');
const t006Path = path.join(specRoot, 'canonical-identity-cutover-decisions.json');
const t008Path = path.join(specRoot, 'phase1-owner-decision-matrix.json');

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
assert.equal(rows.filter((row) => row.mergeable === 'CONFLICTING').length, 3);
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

const manifest = readJson(manifestPath);
const completion = readJson(completionPath);
const t006 = readJson(t006Path);
const t008 = readJson(t008Path);
const expectedInventorySnapshot = '0faee775cd0572b737fed8bc74e2580d9fca2878';
const expectedValidatedMain = '589ab1ec780c1833d1b585fbdc1accaf6cbd8172';

assert.equal(manifest.current_main_authority_inventory_sha, expectedInventorySnapshot);
assert.equal(manifest.current_main_authority_inventory_validated_against_sha, expectedValidatedMain);
assert.equal(manifest.authority_inventory_validation?.snapshot_sha, expectedInventorySnapshot);
assert.equal(manifest.authority_inventory_validation?.validated_against_main_sha, expectedValidatedMain);
assert.equal(manifest.authority_inventory_validation?.delta_commit_count, 2);
assert.equal(manifest.authority_inventory_validation?.exact_head_attestation, 'external_required');
assert.equal(manifest.delivery_provenance?.source_specification_pr?.number, 4456);
assert.equal(manifest.delivery_provenance?.convergence_pr?.number, 7930);
assert.equal(manifest.delivery_provenance?.convergence_pr?.base_main_sha, expectedValidatedMain);
assert.equal(manifest.delivery_provenance?.convergence_pr?.exact_head_attestation, 'external_required');

assert.equal(t006.approval_status, 'approved');
assert.equal(t006.owner_approval_complete, true);
assert.equal(t006.cutover_executed, false);
assert.equal(manifest.coverage?.T006_owner_approval_complete, true);
assert.equal(completion.owner_decision_evidence?.T006?.status, 'approved');
assert.equal(completion.convergence?.T006_cutover_executed, false);

assert.equal(t008.approval_status, 'approved');
assert.equal(t008.phase1_authorized, true);
assert.equal(t008.runtime_mutation_authorized, false);
assert.equal(t008.phase1_entry_gate?.T006_owner_approved, true);
assert.equal(t008.phase1_entry_gate?.T008_owner_approved, true);
assert.equal(t008.phase1_entry_gate?.bounded_implementation_pr_design_authorized, true);
assert.equal(t008.phase1_entry_gate?.runtime_mutation_authorized, false);
assert.equal(manifest.coverage?.T008_owner_approval_complete, true);
assert.equal(manifest.boundaries?.T008_phase1_authorized, true);
assert.equal(manifest.boundaries?.T008_runtime_mutation_authorized, false);
assert.equal(completion.owner_decision_evidence?.T008?.status, 'approved');
assert.equal(completion.owner_decision_evidence?.T008?.phase1_design_authorized, true);
assert.equal(completion.owner_decision_evidence?.T008?.runtime_mutation_authorized, false);
assert.equal(completion.convergence?.T008_phase1_authorized, true);

assert.equal(completion.convergence?.current_main_authority_inventory_sha, expectedInventorySnapshot);
assert.equal(completion.convergence?.current_main_authority_inventory_snapshot_sha, expectedInventorySnapshot);
assert.equal(completion.convergence?.current_main_authority_inventory_validated_against_sha, expectedValidatedMain);
assert.equal(completion.convergence?.current_main_authority_inventory_delta_commit_count, 2);
assert.equal(completion.portfolio_scan?.current_main_field_level_reuse_matrix_sha, expectedInventorySnapshot);
assert.equal(completion.portfolio_scan?.current_main_field_level_reuse_matrix_validated_against_sha, expectedValidatedMain);
assert.equal(completion.delivery?.specification_pr?.number, 4456);
assert.equal(completion.delivery?.convergence_pr?.number, 7930);
assert.equal(completion.delivery?.convergence_pr?.base_main_sha, expectedValidatedMain);
assert.equal(completion.delivery?.convergence_pr?.exact_head_attestation, 'external_required');
assert.equal(completion.implementation?.started, false);
assert.equal(completion.implementation?.migrations_applied, false);
assert.equal(completion.implementation?.runtime_deployed, false);
assert.equal(completion.implementation?.production_activated, false);

console.log(JSON.stringify({
  ok: true,
  test: 'spec015-tenant-audit-artifacts',
  matrix_rows: matrix.rows.length,
  candidate_records: rows.length,
  snapshot_base_main_sha: matrix.snapshot_base_main_sha,
  authority_inventory_snapshot_sha: expectedInventorySnapshot,
  authority_inventory_validated_against_main_sha: expectedValidatedMain,
  truthfulness_reconciled: true,
  safe_read_only: true,
  merge_executed: false,
  runtime_mutation_authorized: false,
  secrets_included: false,
}, null, 2));
