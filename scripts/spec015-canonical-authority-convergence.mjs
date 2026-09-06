#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const readText = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const conceptMapPath = 'specs/015-tenant-operating-system-studio/canonical-concept-authority-map.json';
const cutoverPath = 'specs/015-tenant-operating-system-studio/canonical-identity-cutover-decisions.json';
const ownerDecisionPath = 'specs/015-tenant-operating-system-studio/phase1-owner-decision-matrix.json';
const reuseMatrixPath = 'docs/spec-portfolio/spec015-current-main-authority-reuse-matrix-20260906.json';
const tasksPath = 'specs/015-tenant-operating-system-studio/tasks.md';
const completionPath = 'specs/015-tenant-operating-system-studio/completion.json';
const e2ePath = 'specs/015-tenant-operating-system-studio/e2e-phases.json';

for (const file of [conceptMapPath, cutoverPath, ownerDecisionPath, reuseMatrixPath, tasksPath, completionPath, e2ePath]) {
  assert.ok(exists(file), `required convergence artifact missing: ${file}`);
}

const concepts = readJson(conceptMapPath);
assert.equal(concepts.schema_version, 1);
assert.equal(concepts.spec_owner, '015-tenant-operating-system-studio');
assert.equal(concepts.runtime_authority, false);
assert.equal(concepts.functional_authority, false);
assert.equal(concepts.secrets_included, false);
assert.equal(concepts.concepts?.length, 30);
assert.equal(new Set(concepts.concepts.map((entry) => entry.concept_key)).size, 30);
const byConcept = new Map(concepts.concepts.map((entry) => [entry.concept_key, entry]));
for (const key of ['tool','skill','agent','workflow','solution_package','component','installation_revision','execution_capsule','effective_runtime_manifest','projection']) {
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
assert.equal(matrix.current_main_sha, '0faee775cd0572b737fed8bc74e2580d9fca2878');
assert.equal(matrix.status, 'convergence_inventory_complete_owner_decisions_pending');
for (const key of ['new_persistence_approved','new_execution_authority_approved','new_permission_authority_approved','solution_package_tables_wholesale_creation_approved','runtime_mutation_executed','migration_applied','provider_call_made','production_activated']) {
  assert.equal(matrix.global_decisions?.[key], false, `${key} must remain false`);
}
assert.equal(matrix.secrets_included, false);
assert.ok(matrix.logical_entities?.length >= 10);
const allowed = new Set(['reuse_exact','reuse_with_extension','compatibility_only','projection_only','gap_requires_owner_decision','retire_after_cutover']);
for (const entity of matrix.logical_entities) {
  assert.ok(entity.logical_entity);
  assert.ok(entity.evidence_paths?.length > 0 && entity.evidence_paths.every(exists));
  assert.ok(entity.field_mappings?.length > 0);
  for (const field of entity.field_mappings) assert.ok(allowed.has(field.disposition));
}
const byEntity = new Map(matrix.logical_entities.map((entry) => [entry.logical_entity, entry]));
for (const table of ['platform_private_packages','platform_package_versions']) assert.ok(byEntity.get('solution_package_definition')?.current_main_authorities.includes(table));
const install = byEntity.get('package_installation');
assert.ok(install?.current_main_authorities.includes('tenant_package_installs'));
for (const field of ['agent_grants','policy_overrides','workspace_brand_client_target']) {
  assert.ok(install.field_mappings.some((entry) => entry.target_field === field && entry.disposition === 'compatibility_only'));
}
assert.ok(install.field_mappings.some((entry) => entry.target_field === 'active_immutable_installation_revision' && entry.disposition === 'gap_requires_owner_decision'));
const capability = byEntity.get('capability_and_operation');
assert.ok(capability?.current_main_authorities.includes('canonical_capabilities'));
assert.ok(capability?.current_main_authorities.includes('capability_aliases'));
assert.ok(capability.field_mappings.some((entry) => entry.target_field === 'legacy_platform_semantic_capability_conflict' && entry.disposition === 'retire_after_cutover'));
assert.ok(byEntity.get('tool_catalog_projection')?.current_main_authorities.includes('SystemToolCatalogV2'));
assert.ok(byEntity.get('activity_pack')?.current_main_authorities.includes('growth_control_activity_pack_definitions'));
assert.equal(matrix.phase0_completion?.T002_inventory_evidence, 'complete_for_current_main_sha');
assert.equal(matrix.phase0_completion?.T003_field_level_reuse_evidence, 'complete_for_current_main_sha');
// The reuse matrix is a timestamped pre-approval inventory snapshot; current owner disposition lives in the decision artifacts below.
assert.equal(matrix.phase0_completion?.T006_identity_and_cutover_approval, 'open');
assert.equal(matrix.phase0_completion?.T008_owner_architecture_security_product_approval, 'open');

const cutover = readJson(cutoverPath);
assert.equal(cutover.task, 'T006');
assert.equal(cutover.current_main_sha, matrix.current_main_sha);
assert.equal(cutover.status, 'owner_approved_implementation_pending');
assert.equal(cutover.approval_status, 'approved');
assert.equal(cutover.owner_approval_record?.authority, 'repository_owner');
assert.equal(cutover.owner_approval_record?.recorded_on, '2026-09-06');
assert.equal(cutover.owner_approval_record?.runtime_mutation_authority_granted, false);
assert.equal(cutover.mutation_authority_granted, false);
assert.equal(cutover.cutover_executed, false);
assert.equal(cutover.owner_approval_complete, true);
assert.equal(cutover.secrets_included, false);
assert.equal(cutover.decisions?.length, 7);
assert.ok(cutover.decisions.every((entry) => entry.approval_required === true && entry.owner_approved === true));
const byCutover = new Map(cutover.decisions.map((entry) => [entry.decision_key, entry]));
assert.equal(byCutover.get('legacy_actions_semantic_collision')?.physical_table_rename_authorized, false);
assert.equal(byCutover.get('capability_authority_alias_cutover')?.current_main_target?.semantic_identity_registry, 'canonical_capabilities');
assert.match(byCutover.get('capability_authority_alias_cutover')?.disposition ?? '', /shadow_parity/);
assert.equal(byCutover.get('package_authority_target')?.new_solution_package_tables_default, 'prohibited_without_proven_semantic_gap_and_T008_approval');

const phase1 = readJson(ownerDecisionPath);
assert.equal(phase1.task, 'T008');
assert.equal(phase1.current_main_sha, matrix.current_main_sha);
assert.equal(phase1.status, 'owner_approved_phase1_design_authorized');
assert.equal(phase1.approval_status, 'approved');
assert.equal(phase1.owner_approval_record?.authority, 'repository_owner');
assert.equal(phase1.owner_approval_record?.recorded_on, '2026-09-06');
assert.equal(phase1.owner_approval_record?.runtime_mutation_authority_granted, false);
assert.equal(phase1.phase1_authorized, true);
assert.equal(phase1.runtime_mutation_authorized, false);
assert.equal(phase1.secrets_included, false);
assert.equal(phase1.decisions?.length, 13);
assert.ok(phase1.decisions.every((entry) => entry.owner_approval_required === true && entry.owner_approved === true));
const byOwner = new Map(phase1.decisions.map((entry) => [entry.decision_key, entry]));
assert.equal(byOwner.get('commercial_and_finops')?.recommended_decision, 'estimate_reserve_execute_verify_settle_adjust');
assert.ok(byOwner.get('data_governance_minimum')?.minimum_controls?.includes('data_classification'));
assert.ok(byOwner.get('knowledge_and_provenance')?.derived_surfaces?.includes('vector_index'));
assert.equal(byOwner.get('content_intelligence_reference_activation')?.stages?.['CI-4'], 'performance_feedback_to_improvement_candidate_not_self_modifying_production');
assert.equal(phase1.phase1_entry_gate?.T006_owner_approved, true);
assert.equal(phase1.phase1_entry_gate?.T008_owner_approved, true);
assert.equal(Object.hasOwn(phase1.phase1_entry_gate ?? {}, 'exact_head_ci_passed'), false, 'candidate tree must not self-attest exact-head CI success');
assert.equal(phase1.phase1_entry_gate?.exact_head_ci?.required, true);
assert.equal(phase1.phase1_entry_gate?.exact_head_ci?.attestation_location, 'external');
assert.equal(phase1.phase1_entry_gate?.exact_head_ci?.binding, 'candidate_head_sha');
assert.equal(phase1.phase1_entry_gate?.exact_head_ci?.source_tree_may_self_attest, false);
assert.match(phase1.phase1_entry_gate?.exact_head_ci?.source_authority ?? '', /GitHub Actions.*canonical CI evidence/i);
assert.equal(phase1.phase1_entry_gate?.new_persistence_decisions_reviewed, true);
assert.equal(phase1.phase1_entry_gate?.bounded_implementation_pr_design_authorized, true);
assert.equal(phase1.phase1_entry_gate?.runtime_mutation_authorized, false);

const tasks = readText(tasksPath);
assert.match(tasks, /- \[x\] T002 /);
assert.match(tasks, /- \[x\] T003 /);
assert.match(tasks, /- \[x\] T006 /);
assert.match(tasks, /- \[x\] T008 /);
const completionRaw = readText(completionPath);
const completion = JSON.parse(completionRaw);
assert.equal(completion.status, 'in_progress');
assert.equal(completion.implementation?.started, false);
assert.equal(completion.implementation?.migrations_applied, false);
assert.equal(completion.implementation?.runtime_deployed, false);
assert.equal(completion.implementation?.provider_write_performed, false);
assert.equal(completion.implementation?.production_activated, false);
assert.equal(completion.convergence?.duplicate_spec_identity_resolved, true);
assert.equal(completion.convergence?.canonical_semantic_paths_approved, true);
assert.equal(completion.convergence?.T006_cutover_executed, false);
assert.equal(completion.convergence?.T008_phase1_authorized, true);
assert.equal(completion.convergence?.new_persistence_approved, false);
assert.equal(completion.convergence?.new_execution_authority_approved, false);
assert.ok(completion.specification?.completed_phase0_tasks?.includes('T006'));
assert.ok(completion.specification?.completed_phase0_tasks?.includes('T008'));
assert.equal(completion.owner_decision_evidence?.T006?.status, 'approved');
assert.equal(completion.owner_decision_evidence?.T006?.cutover_executed, false);
assert.equal(completion.owner_decision_evidence?.T008?.status, 'approved');
assert.equal(completion.owner_decision_evidence?.T008?.phase1_design_authorized, true);
assert.equal(completion.owner_decision_evidence?.T008?.runtime_mutation_authorized, false);
assert.equal(completion.external_attestation_requirements?.exact_head_ci?.required, true);
assert.equal(completion.external_attestation_requirements?.exact_head_ci?.attestation_location, 'external');
assert.equal(completion.external_attestation_requirements?.exact_head_ci?.binding, 'candidate_head_sha');
assert.equal(completion.external_attestation_requirements?.exact_head_ci?.source_tree_may_self_attest, false);
assert.equal(completion.blocking_reasons?.includes('exact_head_ci_pending'), false);
for (const stale of ['T006_owner_approval_pending','T008_owner_approval_pending','duplicate_spec_roles_not_approved','legacy_action_operation_semantics_not_approved','data_governance_P0_not_approved','knowledge_provenance_boundary_not_approved','agency_client_ownership_and_portability_not_approved']) {
  assert.equal(completion.blocking_reasons?.includes(stale), false, `stale owner-approval blocker remains: ${stale}`);
}
assert.doesNotMatch(completionRaw, /pending_exact_head_ci|exact_head_ci_pending/, 'completion ledger must express exact-head CI as an external requirement, not candidate-tree pending state');
for (const [key, value] of Object.entries(completion.verification ?? {})) {
  if (key.endsWith('_review')) continue;
  assert.match(value, /external_sha_bound_attestation_required|owner_approved_external_sha_bound_attestation_required|owner_approved_bounded_/, `${key} must use external SHA-bound or approved bounded-review semantics`);
}
const e2eRaw = readText(e2ePath);
assert.doesNotMatch(e2eRaw, /T006 owner approval is pending|T008 owner approval is pending|Exact-head CI is not yet certified|pending_exact_head_ci|exact_head_ci_pending/, 'E2E contract must not retain stale owner or dynamic exact-head state');
assert.match(e2eRaw, /external SHA-bound exact-head CI attestation is required/i);
assert.match(e2eRaw, /T006 and T008 are complete as owner decision tasks only/i);

console.log(JSON.stringify({schema:'mad4b.spec015.canonical-authority-convergence.v1',ok:true,current_main_sha:matrix.current_main_sha,canonical_concepts:concepts.concepts.length,logical_entities:matrix.logical_entities.length,phase0_evidence_complete:['T002','T003'],phase0_owner_decisions_complete:['T006','T008'],T006_decisions_approved:cutover.decisions.length,T008_decisions_approved:phase1.decisions.length,owner_decisions_open:[],exact_head_ci_attestation:'external_sha_bound',completion_exact_head_state:'external_requirement_not_self_state',phase1_authorized:true,bounded_implementation_pr_design_authorized:true,new_persistence_approved:false,cutover_executed:false,runtime_mutation_executed:false,secrets_included:false},null,2));
