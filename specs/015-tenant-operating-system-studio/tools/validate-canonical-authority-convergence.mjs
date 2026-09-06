#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SPEC_ROOT = path.join(ROOT, 'specs/015-tenant-operating-system-studio');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

const conceptMapPath = 'specs/015-tenant-operating-system-studio/canonical-concept-authority-map.json';
const reuseMatrixPath = 'docs/spec-portfolio/spec015-current-main-authority-reuse-matrix-20260906.json';
const tasksPath = 'specs/015-tenant-operating-system-studio/tasks.md';
const completionPath = 'specs/015-tenant-operating-system-studio/completion.json';

for (const file of [conceptMapPath, reuseMatrixPath, tasksPath, completionPath]) {
  assert.ok(exists(file), `required convergence artifact missing: ${file}`);
}

const concepts = readJson(conceptMapPath);
assert.equal(concepts.schema_version, 1);
assert.equal(concepts.spec_owner, '015-tenant-operating-system-studio');
assert.equal(concepts.runtime_authority, false);
assert.equal(concepts.functional_authority, false);
assert.equal(concepts.secrets_included, false);
assert.ok(Array.isArray(concepts.concepts) && concepts.concepts.length === 30);

const conceptKeys = concepts.concepts.map((entry) => entry.concept_key);
assert.equal(new Set(conceptKeys).size, conceptKeys.length, 'canonical concept keys must be unique');
const byConcept = new Map(concepts.concepts.map((entry) => [entry.concept_key, entry]));

for (const key of [
  'tool',
  'skill',
  'agent',
  'workflow',
  'solution_package',
  'component',
  'installation_revision',
  'execution_capsule',
  'effective_runtime_manifest',
  'projection'
]) {
  assert.equal(byConcept.get(key)?.runtime_authority, false, `${key} must not independently grant runtime authority`);
}

assert.equal(byConcept.get('operation')?.authority_owner, '011-durable-governed-execution-and-agent-delegation');
assert.equal(byConcept.get('execution_capsule')?.authority_owner, '012-unified-admin-tenant-context-kernel');
assert.equal(byConcept.get('tool')?.authority_owner, '013-system-tool-catalog-v2');
assert.equal(byConcept.get('solution_package')?.authority_owner, '015-tenant-operating-system-studio');
assert.match(byConcept.get('action')?.semantic_role ?? '', /business_level/);
assert.match(byConcept.get('operation')?.semantic_role ?? '', /bounded_callable/);
assert.ok(concepts.cross_cutting_invariants.includes('packages_declare_requirements_not_permissions'));
assert.ok(concepts.cross_cutting_invariants.includes('unknown_outcome_reconciles_before_retry'));

const matrix = readJson(reuseMatrixPath);
assert.equal(matrix.schema_version, '2.0.0');
assert.equal(matrix.spec_key, '015-tenant-operating-system-studio');
assert.match(matrix.current_main_sha, /^[0-9a-f]{40}$/);
assert.equal(matrix.current_main_sha, '0faee775cd0572b737fed8bc74e2580d9fca2878');
assert.equal(matrix.status, 'convergence_inventory_complete_owner_decisions_pending');
assert.equal(matrix.global_decisions?.new_persistence_approved, false);
assert.equal(matrix.global_decisions?.new_execution_authority_approved, false);
assert.equal(matrix.global_decisions?.new_permission_authority_approved, false);
assert.equal(matrix.global_decisions?.solution_package_tables_wholesale_creation_approved, false);
assert.equal(matrix.global_decisions?.runtime_mutation_executed, false);
assert.equal(matrix.global_decisions?.migration_applied, false);
assert.equal(matrix.global_decisions?.provider_call_made, false);
assert.equal(matrix.global_decisions?.production_activated, false);
assert.equal(matrix.secrets_included, false);
assert.ok(Array.isArray(matrix.logical_entities) && matrix.logical_entities.length >= 10);

const allowedDispositions = new Set([
  'reuse_exact',
  'reuse_with_extension',
  'compatibility_only',
  'projection_only',
  'gap_requires_owner_decision',
  'retire_after_cutover'
]);

for (const entity of matrix.logical_entities) {
  assert.ok(entity.logical_entity);
  assert.ok(Array.isArray(entity.spec_tasks) && entity.spec_tasks.length > 0);
  assert.ok(Array.isArray(entity.current_main_authorities));
  assert.ok(Array.isArray(entity.evidence_paths) && entity.evidence_paths.length > 0);
  assert.ok(entity.evidence_paths.every(exists), `missing current-main evidence for ${entity.logical_entity}`);
  assert.ok(Array.isArray(entity.field_mappings) && entity.field_mappings.length > 0);
  assert.ok(entity.canonical_disposition?.length > 20);
  for (const field of entity.field_mappings) {
    assert.ok(field.target_field);
    assert.ok(allowedDispositions.has(field.disposition), `invalid disposition ${field.disposition} for ${entity.logical_entity}.${field.target_field}`);
  }
}

const byEntity = new Map(matrix.logical_entities.map((entry) => [entry.logical_entity, entry]));

const packageEntity = byEntity.get('solution_package_definition');
for (const table of ['platform_private_packages', 'platform_package_versions']) {
  assert.ok(packageEntity?.current_main_authorities.includes(table), `package reuse must include ${table}`);
}
assert.ok(packageEntity.field_mappings.some((field) => field.target_field === 'owner_container_id_and_ownership_class' && field.disposition === 'gap_requires_owner_decision'));

const installationEntity = byEntity.get('package_installation');
assert.ok(installationEntity?.current_main_authorities.includes('tenant_package_installs'));
for (const field of ['agent_grants', 'policy_overrides', 'workspace_brand_client_target']) {
  assert.ok(installationEntity.field_mappings.some((entry) => entry.target_field === field && entry.disposition === 'compatibility_only'), `${field} must remain compatibility-only`);
}
assert.ok(installationEntity.field_mappings.some((entry) => entry.target_field === 'active_immutable_installation_revision' && entry.disposition === 'gap_requires_owner_decision'));

const capabilityEntity = byEntity.get('capability_and_operation');
assert.ok(capabilityEntity?.current_main_authorities.includes('canonical_capabilities'));
assert.ok(capabilityEntity?.current_main_authorities.includes('capability_aliases'));
assert.ok(capabilityEntity.field_mappings.some((entry) => entry.target_field === 'legacy_platform_semantic_capability_conflict' && entry.disposition === 'retire_after_cutover'));

const toolEntity = byEntity.get('tool_catalog_projection');
assert.ok(toolEntity?.current_main_authorities.includes('SystemToolCatalogV2'));
assert.ok(toolEntity.field_mappings.some((entry) => entry.target_field === 'operation_version_effect_idempotency_readback_metadata' && entry.disposition === 'gap_requires_owner_decision'));

const activityEntity = byEntity.get('activity_pack');
assert.ok(activityEntity?.current_main_authorities.includes('growth_control_activity_pack_definitions'));
assert.ok(activityEntity?.current_main_authorities.includes('growth_control_activity_pack_versions'));

const mcpEntity = byEntity.get('external_mcp_surface');
assert.ok(mcpEntity.field_mappings.filter((entry) => entry.target_field.startsWith('legacy_')).every((entry) => entry.disposition === 'compatibility_only'));

const actionCollision = byEntity.get('legacy_action_semantic_collision');
assert.ok(actionCollision.field_mappings.some((entry) => entry.target_field === 'legacy_actions_table' && entry.disposition === 'compatibility_only'));

assert.equal(matrix.phase0_completion?.T002_inventory_evidence, 'complete_for_current_main_sha');
assert.equal(matrix.phase0_completion?.T003_field_level_reuse_evidence, 'complete_for_current_main_sha');
assert.equal(matrix.phase0_completion?.T006_identity_and_cutover_approval, 'open');
assert.equal(matrix.phase0_completion?.T008_owner_architecture_security_product_approval, 'open');

const tasks = readText(tasksPath);
assert.match(tasks, /- \[x\] T002 /, 'T002 inventory evidence must be marked complete');
assert.match(tasks, /- \[x\] T003 /, 'T003 reuse matrix evidence must be marked complete');
assert.match(tasks, /- \[ \] T006 /, 'T006 cutover/identity approval must remain open');
assert.match(tasks, /- \[ \] T008 /, 'T008 owner approval must remain open');

const completion = readJson(completionPath);
assert.equal(completion.status, 'in_progress');
assert.equal(completion.implementation?.started, false);
assert.equal(completion.implementation?.migrations_applied, false);
assert.equal(completion.implementation?.runtime_deployed, false);
assert.equal(completion.implementation?.provider_write_performed, false);
assert.equal(completion.implementation?.production_activated, false);
assert.equal(completion.convergence?.duplicate_spec_identity_resolved, false);
assert.ok(completion.specification?.completed_phase0_tasks?.includes('T002'));
assert.ok(completion.specification?.completed_phase0_tasks?.includes('T003'));
assert.equal(completion.convergence?.current_main_authority_inventory_sha, matrix.current_main_sha);

console.log(JSON.stringify({
  schema: 'mad4b.spec015.canonical-authority-convergence.v1',
  ok: true,
  current_main_sha: matrix.current_main_sha,
  canonical_concepts: concepts.concepts.length,
  logical_entities: matrix.logical_entities.length,
  phase0_evidence_complete: ['T002', 'T003'],
  owner_decisions_open: ['T006', 'T008'],
  new_persistence_approved: false,
  runtime_mutation_executed: false,
  secrets_included: false
}, null, 2));
