#!/usr/bin/env node
import fs from 'node:fs';

const root = new URL('../', import.meta.url).pathname;
const artifactPath = `${root}specs/020-platform-resource-identity-brand-governance/openapi-connected-systems-preflight-batch.json`;
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

if (artifact.contract !== 'spec020-openapi-connected-systems-preflight-batch-v1') throw new Error('unexpected contract');
if (artifact.batch_id !== 'spec020-openapi-connected-systems-preflight-batch-02') throw new Error('unexpected batch id');
if (artifact.coverage.operation_count !== 10) throw new Error(`expected 10 operations, got ${artifact.coverage.operation_count}`);
if (!artifact.coverage.operation_count_matches_expected) throw new Error('coverage count assertion failed');
if (artifact.coverage.route_wiring || artifact.coverage.runtime_authority || artifact.coverage.production_activation) throw new Error('activation boundary violated');
if (artifact.operations.some((item) => item.family_key !== 'connected-systems')) throw new Error('unexpected family');
if (artifact.operations.some((item) => item.openapi_contract_level !== 'operation-index-only')) throw new Error('unexpected contract level');
if (artifact.operations.some((item) => item.prepared_contract.mode !== 'prepared_only')) throw new Error('non prepared-only operation');
if (artifact.operations.some((item) => item.prepared_contract.migration_execution || item.prepared_contract.provider_mutation || item.prepared_contract.secrets_included)) throw new Error('unsafe prepared contract');
if (new Set(artifact.operations.map((item) => item.signature)).size !== artifact.operations.length) throw new Error('duplicate operation signatures');
console.log(JSON.stringify({ ok: true, contract: artifact.contract, batch_id: artifact.batch_id, operation_count: artifact.operations.length, route_wiring: false, runtime_authority: false, production_activation: false }));
