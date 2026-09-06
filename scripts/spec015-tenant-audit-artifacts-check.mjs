#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const legacyPath = 'docs/spec-portfolio/spec015-tenant-reuse-matrix-20260812.json';
const currentPath = 'docs/spec-portfolio/spec015-current-main-authority-reuse-matrix-20260906.json';
const snapshotPath = 'docs/spec-portfolio/spec015-candidate-pr-readonly-evidence-20260812.jsonl';
const convergencePath = 'specs/015-tenant-operating-system-studio/candidate-convergence.json';
const conceptMapPath = 'specs/015-tenant-operating-system-studio/canonical-concept-authority-map.json';
const validatorPath = path.join(ROOT, 'scripts/spec015-canonical-authority-convergence.mjs');

const legacy = readJson(legacyPath);
assert.equal(legacy.schema_version, '1.0.0');
assert.equal(legacy.spec_key, '015-tenant-operating-system-studio');
assert.equal(legacy.status, 'audit_only_review_required');
assert.equal(legacy.secrets_included, false);
assert.equal(legacy.runtime_mutation_executed, false);
assert.match(legacy.snapshot_base_main_sha, /^[0-9a-f]{40}$/);
assert.ok(legacy.rows?.length >= 10);
const legacyStatuses = new Set(['spec_contract_only','contract_and_preview_boundary_only','policy_and_contract_audit_only','existing_runtime_surface_plus_candidate_audit','not_implemented','partial_existing_surfaces_and_spec_contracts','spec_and_governance_boundary_only','transition_requirements_only','ownership_contract_boundary_only','read_only_evidence_refreshable']);
for (const row of legacy.rows) {
  assert.ok(row.logical_entity);
  assert.ok(legacyStatuses.has(row.current_status));
  assert.ok(row.evidence_paths?.length > 0 && row.evidence_paths.every(exists));
  assert.ok(row.not_claimed?.length > 0);
}

const rows = fs.readFileSync(path.join(ROOT, snapshotPath), 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map(JSON.parse);
assert.equal(rows.length, 9);
assert.deepEqual([...new Set(rows.map((row) => row.number))].sort((a,b)=>a-b), [2284,2385,2949,3139,3145,3159,3922,4386,4432]);
assert.ok(rows.every((row) => row.baseRefName === 'main'));
assert.ok(rows.every((row) => row.snapshotBaseMainSha === legacy.snapshot_base_main_sha));
assert.ok(rows.every((row) => row.safe_read_only === true && row.merge_executed === false && row.secrets_included === false));

const convergence = readJson(convergencePath);
assert.equal(convergence.base_main_sha, legacy.snapshot_base_main_sha);
assert.equal(convergence.status, 'draft_review_required');
assert.equal(convergence.secrets_included, false);
assert.ok(convergence.candidates.every((candidate) => candidate.merge_posture === 'do_not_blind_merge_reconstruct_on_current_main'));

const current = readJson(currentPath);
assert.equal(current.schema_version, '2.0.0');
assert.equal(current.current_main_sha, '0faee775cd0572b737fed8bc74e2580d9fca2878');
assert.equal(current.status, 'convergence_inventory_complete_owner_decisions_pending');
assert.equal(current.global_decisions.new_persistence_approved, false);
assert.equal(current.global_decisions.new_execution_authority_approved, false);
assert.equal(current.global_decisions.runtime_mutation_executed, false);
assert.equal(current.global_decisions.production_activated, false);
assert.ok(current.logical_entities?.length >= 10);
const dispositions = new Set(['reuse_exact','reuse_with_extension','compatibility_only','projection_only','gap_requires_owner_decision','retire_after_cutover']);
for (const entity of current.logical_entities) {
  assert.ok(entity.evidence_paths.every(exists));
  for (const field of entity.field_mappings) assert.ok(dispositions.has(field.disposition));
}
const pkg = current.logical_entities.find((entry) => entry.logical_entity === 'solution_package_definition');
assert.ok(pkg.current_main_authorities.includes('platform_private_packages'));
assert.ok(pkg.current_main_authorities.includes('platform_package_versions'));
const install = current.logical_entities.find((entry) => entry.logical_entity === 'package_installation');
assert.ok(install.current_main_authorities.includes('tenant_package_installs'));
assert.ok(install.field_mappings.some((field) => field.target_field === 'agent_grants' && field.disposition === 'compatibility_only'));
assert.ok(install.field_mappings.some((field) => field.target_field === 'active_immutable_installation_revision' && field.disposition === 'gap_requires_owner_decision'));

const concepts = readJson(conceptMapPath);
assert.equal(concepts.concepts.length, 30);
assert.equal(new Set(concepts.concepts.map((entry) => entry.concept_key)).size, 30);
assert.equal(concepts.concepts.find((entry) => entry.concept_key === 'tool').runtime_authority, false);
assert.equal(concepts.concepts.find((entry) => entry.concept_key === 'solution_package').runtime_authority, false);
assert.match(concepts.concepts.find((entry) => entry.concept_key === 'action').semantic_role, /business_level/);
assert.match(concepts.concepts.find((entry) => entry.concept_key === 'operation').semantic_role, /bounded_callable/);

const validatorResult = JSON.parse(execFileSync(process.execPath, [validatorPath], {cwd:ROOT,encoding:'utf8'}));
assert.equal(validatorResult.ok, true);
assert.deepEqual(validatorResult.phase0_evidence_complete, ['T002','T003']);
assert.deepEqual(validatorResult.phase0_owner_decisions_complete, ['T006','T008']);
assert.deepEqual(validatorResult.owner_decisions_open, []);
assert.equal(validatorResult.phase1_authorized, true);
assert.equal(validatorResult.bounded_implementation_pr_design_authorized, true);
assert.equal(validatorResult.runtime_mutation_executed, false);
assert.equal(validatorResult.new_persistence_approved, false);

console.log(JSON.stringify({ok:true,test:'spec015-tenant-audit-artifacts',legacy_matrix_rows:legacy.rows.length,current_main_authority_entities:current.logical_entities.length,canonical_concepts:concepts.concepts.length,candidate_records:rows.length,portfolio_snapshot_base_main_sha:legacy.snapshot_base_main_sha,current_main_authority_inventory_sha:current.current_main_sha,phase0_evidence_complete:['T002','T003'],phase0_owner_decisions_complete:['T006','T008'],owner_decisions_open:[],phase1_authorized:true,runtime_mutation_executed:false,safe_read_only:true,merge_executed:false,secrets_included:false},null,2));
