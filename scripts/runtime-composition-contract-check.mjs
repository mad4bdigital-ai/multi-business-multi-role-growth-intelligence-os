#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'specs/integration-governed-execution-runtime-composition';
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const readText = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const required = [
  `${BASE}/manifest.json`, `${BASE}/completion.json`, `${BASE}/e2e-phases.json`,
  `${BASE}/canonical-semantic-ontology.md`, `${BASE}/canonical-artifact-authority-reference-graph.md`,
  `${BASE}/tasks-and-gates.md`, `${BASE}/wordpress-site-control-plane-provider-profile.json`,
  `${BASE}/wordpress-site-control-plane-provider-profile.md`
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
assert.deepEqual(manifest.implementation_phases, ['X0_evidence_baseline','X1_contract_composition_shadow','X2_unified_in_process_read','X3_dag_read_and_preparation','X4_approval_frontier','X5_ledger_and_projection_split','X6_fast_lane_mutation','X7_durable_lane','X8_execution_surface','X9_percent_rollout_and_closeout']);
for (const invariant of ['no_provider_call','no_external_send','no_database_write','no_migration_apply','no_deployment','no_runtime_cutover','no_parallel_semantic_authority','no_automatic_retry_after_unknown_outcome','no_silent_context_or_connection_substitution']) assert.ok(manifest.constraints.includes(invariant));

const wp = readJson(`${BASE}/wordpress-site-control-plane-provider-profile.json`);
assert.equal(wp.schema_version, 1);
assert.equal(wp.profile_key, 'mad4b.wordpress-site-control-plane.provider-profile.v1');
assert.equal(wp.observed_source.repository, 'mad4bdigital-ai/WordPress');
assert.equal(wp.observed_source.pull_request, 6);
assert.equal(wp.observed_source.plugin_version, '0.3.0');
assert.equal(wp.observed_source.runtime_certified, false);
assert.equal(wp.upstream_mcp_adapter.repository, 'WordPress/mcp-adapter');
assert.equal(wp.upstream_mcp_adapter.observed_latest_release, 'v0.6.1');
assert.equal(wp.upstream_mcp_adapter.http_transport_protocol_baseline, '2025-11-25');
assert.equal(wp.upstream_mcp_adapter.mcp_2026_07_28_status, 'not_yet_upstream_supported_at_observation_time');
assert.equal(wp.upstream_mcp_adapter.fork_required_now, false);
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
assert.equal(wp.content_intelligence_fit['CI-0'].status, 'compatible');
assert.equal(wp.content_intelligence_fit['CI-1'].status, 'partial_gap');
assert.equal(wp.content_intelligence_fit['CI-2'].status, 'blocked');
assert.match(wp.content_intelligence_fit.additional_media_gap, /upload/);
assert.equal(wp.runtime_authority, false);
assert.equal(wp.provider_write_performed, false);
assert.equal(wp.production_activated, false);
assert.equal(wp.secrets_included, false);

const completion = readJson(`${BASE}/completion.json`);
assert.equal(completion.status, 'in_progress');
assert.equal(completion.current_phase, 'specification_and_owner_registration');
assert.equal(completion.next_phase, 'X0_evidence_baseline');
for (const key of ['runtime_authority','provider_write','database_write','migration_apply','deployment','protected_branch_write','secrets_included']) assert.equal(completion[key], false, `${key} must remain false`);
assert.equal(completion.evidence?.ci?.status, 'pending');
assert.equal(completion.evidence?.migration?.status, 'not_started');
assert.equal(completion.evidence?.production_verification?.status, 'not_started');

const e2e = readJson(`${BASE}/e2e-phases.json`);
assert.equal(e2e.feature_key, manifest.package_key);
assert.equal(e2e.delivery_mode, 'multi_pr');
assert.equal(e2e.current_phase, 'mvp');
assert.equal(e2e.secrets_included, false);
const phaseMap = new Map(e2e.phases.map((entry) => [entry.id, entry]));
assert.equal(phaseMap.get('mvp')?.status, 'implemented');
for (const id of ['operational','resilient','canary','production']) assert.equal(phaseMap.get(id)?.status, 'blocked');
const journey = phaseMap.get('mvp').e2e_journeys?.[0];
assert.equal(journey?.end_to_end, true);
assert.equal(journey?.level, 'synthetic_runtime');
assert.ok(journey?.tests?.some((test) => test.path === 'scripts/runtime-composition-contract-check.mjs'));
assert.ok(journey?.evidence_paths?.includes(`${BASE}/wordpress-site-control-plane-provider-profile.json`));

const gates = readText(`${BASE}/tasks-and-gates.md`);
assert.match(gates, /Phase X0 — Evidence baseline/);
assert.match(gates, /no runtime behavior change/);
assert.match(gates, /Phase X1 — Contract composition shadow/);
assert.match(gates, /no provider call from the shadow path/);
assert.match(gates, /zero unexplained authority or target mismatch/);
const ontology = readText(`${BASE}/canonical-semantic-ontology.md`);
assert.match(ontology, /Operation/);
assert.match(ontology, /Tool/);
const graph = readText(`${BASE}/canonical-artifact-authority-reference-graph.md`);
assert.match(graph, /authority/i);

console.log(JSON.stringify({schema:'mad4b.runtime-composition.spec-contract-check.v1',ok:true,feature_key:manifest.package_key,owner_specs:Object.values(manifest.owner_specs),wordpress_provider_profile:'candidate_supported_with_governed_platform_binding_gaps',wordpress_pr:6,wordpress_mcp_adapter_baseline:'v0.6.1',wordpress_mcp_protocol:'2025-11-25',mcp_2026_07_28_upstream_gap:true,current_phase:e2e.current_phase,next_runtime_phase:completion.next_phase,runtime_authority:false,provider_write:false,database_write:false,migration_apply:false,deployment:false,secrets_included:false},null,2));
