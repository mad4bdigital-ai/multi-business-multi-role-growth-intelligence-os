#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'specs/integration-governed-execution-runtime-composition';
const X0 = 'specs/011-durable-governed-execution-and-agent-delegation';
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const readText = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const required = [
  `${BASE}/manifest.json`,
  `${BASE}/completion.json`,
  `${BASE}/e2e-phases.json`,
  `${BASE}/canonical-semantic-ontology.md`,
  `${BASE}/canonical-artifact-authority-reference-graph.md`,
  `${BASE}/tasks-and-gates.md`,
  `${BASE}/wordpress-site-control-plane-provider-profile.json`,
  `${BASE}/wordpress-site-control-plane-provider-profile.md`,
  `${X0}/x0-evidence-baseline.manifest.json`,
  `${X0}/x0-evidence-baseline.md`,
  `${X0}/x0-matched-runtime-fixtures.json`,
  'http-generic-api/governedExecutionBaselineRuntime.js',
  'http-generic-api/test-governed-execution-baseline-telemetry.mjs',
  'http-generic-api/test-governed-execution-baseline-benchmark.mjs',
];
for (const file of required) assert.ok(exists(file), `runtime composition artifact missing: ${file}`);

const manifest = readJson(`${BASE}/manifest.json`);
assert.equal(manifest.package_key, 'integration-governed-execution-runtime-composition');
assert.equal(manifest.package_type, 'cross_spec_integration_kit');
assert.equal(manifest.runtime_authority, false);
assert.equal(manifest.functional_authority, false);
assert.equal(manifest.secrets_included, false);
assert.equal(manifest.owner_specs.durable_execution_and_orchestration, '011-durable-governed-execution-and-agent-delegation');
assert.equal(manifest.owner_specs.execution_context, '012-unified-admin-tenant-context-kernel');
assert.equal(manifest.owner_specs.catalog_and_execution_surface, '013-system-tool-catalog-v2');
for (const artifact of ['e2e-phases.json','wordpress-site-control-plane-provider-profile.json','wordpress-site-control-plane-provider-profile.md']) assert.ok(manifest.artifacts.includes(artifact));
for (const invariant of ['no_provider_call','no_external_send','no_database_write','no_migration_apply','no_deployment','no_runtime_cutover','no_parallel_semantic_authority','no_automatic_retry_after_unknown_outcome','no_silent_context_or_connection_substitution']) assert.ok(manifest.constraints.includes(invariant));

const wp = readJson(`${BASE}/wordpress-site-control-plane-provider-profile.json`);
assert.equal(wp.profile_key, 'mad4b.wordpress-site-control-plane.provider-profile.v1');
assert.equal(wp.status, 'candidate_supported_repository_ci_passed_runtime_certification_pending');
assert.equal(wp.observed_source.repository, 'mad4bdigital-ai/WordPress');
assert.equal(wp.observed_source.pull_request, 6);
assert.equal(wp.observed_source.observed_head_sha, '937aa507b8b2d0ff94050395e3cbb704673d85ed');
assert.equal(wp.observed_source.plugin_version, '0.3.0');
assert.equal(wp.observed_source.repository_ci.status, 'passed');
assert.equal(wp.observed_source.runtime_certified, false);
assert.equal(wp.upstream_mcp_adapter.packaged_version_in_wordpress_pr6, '0.5.0');
assert.ok(wp.upstream_mcp_adapter.packaged_protocol_versions.includes('2025-11-25'));
assert.equal(wp.upstream_mcp_adapter.observed_latest_release, 'v0.6.1');
assert.equal(wp.upstream_mcp_adapter.problematic_release_asset, 'v0.6.0 packaged ZIP');
assert.equal(wp.upstream_mcp_adapter.recommended_upgrade_target, 'v0.6.1');
assert.equal(wp.upstream_mcp_adapter.mcp_2026_07_28_status, 'not_yet_upstream_supported_at_observation_time');
assert.equal(wp.upstream_mcp_adapter.fork_required_now, false);
assert.equal(wp.packaged_provider_certification.source_contract, 'mad4b.site-control-plane.certified-providers.v1');
assert.equal(wp.packaged_provider_certification.providers.elementor.version, '4.1.4');
assert.equal(wp.packaged_provider_certification.providers.jetengine.version, '3.8.11.2');
assert.equal(wp.packaged_provider_certification.providers.jetsmartfilters.version, '3.8.3.1');
assert.equal(wp.packaged_provider_certification.providers.bit_pi.version, '1.24.0');
assert.equal(wp.authority_boundary.direct_chatgpt_to_wordpress_is_governed_platform_path, false);
assert.equal(wp.authority_boundary.tool_or_ability_visibility_grants_permission, false);
assert.equal(wp.integration_modes.governed_platform_provider.required_for_mad4b_platform_and_content_intelligence, true);
assert.equal(wp.integration_modes.governed_platform_provider.wordpress_permissions, 'defense_in_depth_only');
assert.equal(wp.required_governed_binding_contract.implementation_status, 'not_yet_proven_by_wordpress_pr6');
for (const field of ['operation_id','capability_key','tenant_id','workspace_id','environment','effect_class','idempotency_key','execution_envelope_or_capsule_ref','provider_connection_ref','readback_contract_ref','correlation_id']) assert.ok(wp.required_governed_binding_contract.required_request_bindings.includes(field));
assert.ok(wp.outcome_contract.canonical_states.includes('unknown'));
assert.match(wp.outcome_contract.unknown_rule, /never receives an automatic blind retry/);
const raw = wp.surface_mapping.find((entry) => entry.wordpress_ability === 'mad4b/database-raw-query');
assert.equal(raw?.capability, null);
assert.equal(raw?.platform_projection, 'forbidden_from_normal_system_tool_catalog');
assert.equal(wp.breakglass_boundary.canonical_mad4b_raw_sql_and_shell_exception_authority, 'Host Breakglass');
assert.equal(wp.breakglass_boundary.normal_platform_projection, false);
assert.match(wp.filesystem_policy.wordpress_core_plugin_theme_source_code_mutation, /code_mutation/);
assert.equal(wp.content_intelligence_fit['CI-0'].status, 'compatible');
assert.equal(wp.content_intelligence_fit['CI-1'].status, 'partial_gap');
assert.equal(wp.content_intelligence_fit['CI-2'].status, 'blocked');
assert.match(wp.content_intelligence_fit.additional_media_gap, /upload/);
assert.equal(wp.runtime_authority, false);
assert.equal(wp.provider_write_performed, false);
assert.equal(wp.production_activated, false);
assert.equal(wp.secrets_included, false);

const x0 = readJson(`${X0}/x0-evidence-baseline.manifest.json`);
const fixtures = readJson(`${X0}/x0-matched-runtime-fixtures.json`);
assert.equal(x0.phase, 'X0_evidence_baseline');
assert.equal(x0.status, 'candidate_implementation_complete_external_ci_pending');
assert.match(x0.base_main_sha, /^[0-9a-f]{40}$/);
assert.equal(x0.base_main_reconciled_after_merge, true);
assert.equal(x0.external_exact_head_attestation, 'required');
assert.equal(x0.live_staging_certification, 'required');
assert.deepEqual(x0.pending_contracts, ['exact_head_ci_evidence','live_staging_certification']);
for (const contract of ['legacy_gpt_tool_entry_instrumentation','legacy_system_tool_entry_instrumentation','connector_plan_entry_instrumentation','agent_loop_entry_instrumentation','matched_runtime_fixture_artifact','matched_fixture_functional_hash_parity','matched_fixture_safety_vector_parity']) assert.ok(x0.implemented_contracts.includes(contract));
assert.equal(x0.runtime_authority, false);
assert.equal(x0.provider_write, false);
assert.equal(x0.database_write, false);
assert.equal(x0.migration_apply, false);
assert.equal(x0.deployment, false);
assert.equal(x0.secrets_included, false);
assert.equal(fixtures.schema, 'mad4b.governed-execution.x0-matched-runtime-fixtures.v1');
assert.equal(fixtures.base_main_sha, x0.base_main_sha);
assert.deepEqual(fixtures.fixture_catalogue, ['F01','F03','F04','F05','F06']);
assert.ok(fixtures.fixtures.every((fixture) => fixture.functional_outcome_equal === true && fixture.legacy_result_hash === fixture.instrumented_result_hash));
assert.equal(fixtures.gate_assertions.all_functional_outcomes_equal, true);
assert.equal(fixtures.gate_assertions.same_fixture_inputs_and_expected_outcomes_reproducible, true);
assert.equal(fixtures.gate_assertions.live_provider_call_made, false);
assert.equal(fixtures.gate_assertions.database_write_performed, false);
assert.equal(fixtures.gate_assertions.migration_applied, false);
assert.equal(fixtures.gate_assertions.external_send_made, false);
assert.equal(fixtures.gate_assertions.runtime_behavior_changed, false);
assert.equal(fixtures.secrets_included, false);

const completion = readJson(`${BASE}/completion.json`);
assert.equal(completion.status, 'in_progress');
assert.equal(completion.current_phase, 'X0_evidence_baseline_candidate');
assert.equal(completion.next_phase, 'X1_contract_composition_shadow_after_X0_external_certification');
assert.equal(completion.evidence?.specification_package?.status, 'merged_baseline');
assert.equal(completion.evidence?.owner_extension_registration?.status, 'merged_baseline');
assert.equal(completion.evidence?.x0_evidence_baseline?.status, 'candidate_implementation_complete_external_certification_pending');
assert.equal(completion.evidence?.x0_evidence_baseline?.exact_head_ci_required, true);
assert.equal(completion.evidence?.x0_evidence_baseline?.live_staging_certification_required, true);
assert.equal(completion.evidence?.x0_evidence_baseline?.source_tree_may_self_attest, false);
assert.equal(completion.evidence?.x0_evidence_baseline?.runtime_cutover, false);
assert.equal(completion.evidence?.x0_evidence_baseline?.provider_effect_added, false);
assert.equal(completion.evidence?.x0_evidence_baseline?.database_write_added, false);
assert.equal(completion.evidence?.x0_evidence_baseline?.migration_added, false);
assert.equal(completion.evidence?.x0_evidence_baseline?.production_mutation_authorized, false);
assert.equal(completion.evidence?.ci?.status, 'external_exact_head_pending');
for (const key of ['runtime_authority','provider_write','database_write','migration_apply','deployment','protected_branch_write','secrets_included']) assert.equal(completion[key], false);

const e2e = readJson(`${BASE}/e2e-phases.json`);
assert.equal(e2e.feature_key, manifest.package_key);
assert.equal(e2e.current_phase, 'mvp');
assert.deepEqual(e2e.environment_impact?.declared_targets, ['staging','production']);
assert.equal(e2e.environment_impact?.cross_environment_reviewed, true);
assert.equal(e2e.environment_impact?.live_staging_certification_required, true);
assert.equal(e2e.environment_impact?.production_mutation_allowed, false);
const phaseMap = new Map(e2e.phases.map((entry) => [entry.id, entry]));
assert.equal(phaseMap.get('mvp')?.status, 'implemented');
assert.equal(phaseMap.get('operational')?.status, 'blocked');
for (const id of ['resilient','canary','production']) assert.equal(phaseMap.get(id)?.status, 'blocked');
const operationalBlockers = phaseMap.get('operational')?.blockers ?? [];
assert.ok(operationalBlockers.some((value) => /external exact-head/i.test(value)));
assert.ok(operationalBlockers.some((value) => /live Staging certification/i.test(value)));
assert.ok(operationalBlockers.some((value) => /X1 implementation is prohibited/i.test(value)));
for (const stale of ['PR #7930 exact-head convergence CI is not yet certified','T006 canonical identity/cutover owner approval remains pending','T008 Phase1 architecture/security/product owner approval remains pending']) assert.ok(!JSON.stringify(e2e).includes(stale), `stale operational blocker remains: ${stale}`);
const journey = phaseMap.get('mvp').e2e_journeys?.[0];
assert.equal(journey?.end_to_end, true);
assert.equal(journey?.level, 'synthetic_runtime');
assert.ok(journey?.tests?.some((test) => test.path === 'scripts/runtime-composition-contract-check.mjs'));
assert.ok(journey?.tests?.some((test) => test.path === 'test-governed-execution-baseline-telemetry.mjs'));
assert.ok(journey?.tests?.some((test) => test.path === 'test-governed-execution-baseline-benchmark.mjs'));
assert.ok(journey?.evidence_paths?.includes(`${X0}/x0-matched-runtime-fixtures.json`));

const gates = readText(`${BASE}/tasks-and-gates.md`);
for (const task of ['X001','X002','X003','X004','X005']) assert.match(gates, new RegExp(`- \\[x\\] \\*\\*${task}\\*\\*`));
assert.match(gates, /Gate X0 external certification state: `pending`/);
assert.match(gates, /no runtime behavior change/);
assert.match(gates, /Phase X1 — Contract composition shadow/);
assert.match(gates, /- \[ \] \*\*X010\*\*/);
assert.match(gates, /no provider call from the shadow path/);
assert.match(gates, /zero unexplained authority or target mismatch/);

console.log(JSON.stringify({
  schema:'mad4b.runtime-composition.spec-contract-check.v2',
  ok:true,
  feature_key:manifest.package_key,
  current_phase:e2e.current_phase,
  x0_status:x0.status,
  x0_base_main_sha:x0.base_main_sha,
  x0_fixture_count:fixtures.fixtures.length,
  x0_external_exact_head_attestation:x0.external_exact_head_attestation,
  x0_live_staging_certification:x0.live_staging_certification,
  next_runtime_phase:completion.next_phase,
  wordpress_provider_profile:wp.status,
  runtime_authority:false,
  provider_write:false,
  database_write:false,
  migration_apply:false,
  deployment:false,
  production_mutation_authorized:false,
  secrets_included:false
},null,2));
