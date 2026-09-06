import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const matrixPath = path.join(ROOT, 'docs/spec-portfolio/spec015-tenant-reuse-matrix-20260812.json');
const currentMainMatrixPath = path.join(ROOT, 'docs/spec-portfolio/spec015-current-main-authority-reuse-matrix-20260906.json');
const snapshotPath = path.join(ROOT, 'docs/spec-portfolio/spec015-candidate-pr-readonly-evidence-20260812.jsonl');
const convergencePath = path.join(ROOT, 'specs/015-tenant-operating-system-studio/candidate-convergence.json');
const conceptMapPath = path.join(ROOT, 'specs/015-tenant-operating-system-studio/canonical-concept-authority-map.json');
const authorityValidatorPath = path.join(ROOT, 'specs/015-tenant-operating-system-studio/tools/validate-canonical-authority-convergence.mjs');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function relativeExists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

// Preserve the immutable 2026-08-12 portfolio/candidate audit contract.
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

// Additive current-main authority inventory. It intentionally does not rewrite the older
// candidate snapshot SHA: the two artifacts answer different questions.
const currentMainMatrix = readJson(currentMainMatrixPath);
assert.equal(currentMainMatrix.schema_version, '2.0.0');
assert.equal(currentMainMatrix.spec_key, '015-tenant-operating-system-studio');
assert.equal(currentMainMatrix.current_main_sha, '0faee775cd0572b737fed8bc74e2580d9fca2878');
assert.equal(currentMainMatrix.status, 'convergence_inventory_complete_owner_decisions_pending');
assert.equal(currentMainMatrix.global_decisions.new_persistence_approved, false);
assert.equal(currentMainMatrix.global_decisions.new_execution_authority_approved, false);
assert.equal(currentMainMatrix.global_decisions.runtime_mutation_executed, false);
assert.equal(currentMainMatrix.global_decisions.production_activated, false);
assert.ok(Array.isArray(currentMainMatrix.logical_entities) && currentMainMatrix.logical_entities.length >= 10);

const dispositions = new Set([
  'reuse_exact',
  'reuse_with_extension',
  'compatibility_only',
  'projection_only',
  'gap_requires_owner_decision',
  'retire_after_cutover'
]);
for (const entity of currentMainMatrix.logical_entities) {
  assert.ok(entity.evidence_paths.every(relativeExists), `missing current-main evidence for ${entity.logical_entity}`);
  for (const field of entity.field_mappings) assert.ok(dispositions.has(field.disposition));
}

const packageEntity = currentMainMatrix.logical_entities.find((entry) => entry.logical_entity === 'solution_package_definition');
assert.ok(packageEntity.current_main_authorities.includes('platform_private_packages'));
assert.ok(packageEntity.current_main_authorities.includes('platform_package_versions'));
const installEntity = currentMainMatrix.logical_entities.find((entry) => entry.logical_entity === 'package_installation');
assert.ok(installEntity.current_main_authorities.includes('tenant_package_installs'));
assert.ok(installEntity.field_mappings.some((field) => field.target_field === 'agent_grants' && field.disposition === 'compatibility_only'));
assert.ok(installEntity.field_mappings.some((field) => field.target_field === 'active_immutable_installation_revision' && field.disposition === 'gap_requires_owner_decision'));

const conceptMap = readJson(conceptMapPath);
assert.equal(conceptMap.concepts.length, 30);
assert.equal(new Set(conceptMap.concepts.map((entry) => entry.concept_key)).size, 30);
assert.equal(conceptMap.concepts.find((entry) => entry.concept_key === 'tool').runtime_authority, false);
assert.equal(conceptMap.concepts.find((entry) => entry.concept_key === 'solution_package').runtime_authority, false);
assert.match(conceptMap.concepts.find((entry) => entry.concept_key === 'action').semantic_role, /business_level/);
assert.match(conceptMap.concepts.find((entry) => entry.concept_key === 'operation').semantic_role, /bounded_callable/);

const validatorOutput = execFileSync(process.execPath, [authorityValidatorPath], {
  cwd: ROOT,
  encoding: 'utf8'
});
const validatorResult = JSON.parse(validatorOutput);
assert.equal(validatorResult.ok, true);
assert.deepEqual(validatorResult.phase0_evidence_complete, ['T002', 'T003']);
assert.deepEqual(validatorResult.owner_decisions_open, ['T006', 'T008']);
assert.equal(validatorResult.new_persistence_approved, false);

console.log(JSON.stringify({
  ok: true,
  test: 'spec015-tenant-audit-artifacts',
  legacy_matrix_rows: matrix.rows.length,
  current_main_authority_entities: currentMainMatrix.logical_entities.length,
  canonical_concepts: conceptMap.concepts.length,
  candidate_records: rows.length,
  portfolio_snapshot_base_main_sha: matrix.snapshot_base_main_sha,
  current_main_authority_inventory_sha: currentMainMatrix.current_main_sha,
  phase0_evidence_complete: ['T002', 'T003'],
  owner_decisions_open: ['T006', 'T008'],
  safe_read_only: true,
  merge_executed: false,
  secrets_included: false,
}, null, 2));
