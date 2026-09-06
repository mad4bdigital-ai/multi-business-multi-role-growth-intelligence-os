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

const required = [`${BASE}/manifest.json`,`${BASE}/completion.json`,`${BASE}/e2e-phases.json`,`${BASE}/canonical-semantic-ontology.md`,`${BASE}/canonical-artifact-authority-reference-graph.md`,`${BASE}/tasks-and-gates.md`];
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
assert.ok(manifest.artifacts.includes('e2e-phases.json'));
assert.deepEqual(manifest.implementation_phases, ['X0_evidence_baseline','X1_contract_composition_shadow','X2_unified_in_process_read','X3_dag_read_and_preparation','X4_approval_frontier','X5_ledger_and_projection_split','X6_fast_lane_mutation','X7_durable_lane','X8_execution_surface','X9_percent_rollout_and_closeout']);
for (const invariant of ['no_provider_call','no_external_send','no_database_write','no_migration_apply','no_deployment','no_runtime_cutover','no_parallel_semantic_authority','no_automatic_retry_after_unknown_outcome','no_silent_context_or_connection_substitution']) assert.ok(manifest.constraints.includes(invariant));

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
assert.ok(journey?.tests?.some((test) => test.path === 'scripts/runtime-composition-contract-check.mjs'));

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

console.log(JSON.stringify({schema:'mad4b.runtime-composition.spec-contract-check.v1',ok:true,feature_key:manifest.package_key,owner_specs:Object.values(manifest.owner_specs),current_phase:e2e.current_phase,next_runtime_phase:completion.next_phase,runtime_authority:false,provider_write:false,database_write:false,migration_apply:false,deployment:false,secrets_included:false},null,2));
