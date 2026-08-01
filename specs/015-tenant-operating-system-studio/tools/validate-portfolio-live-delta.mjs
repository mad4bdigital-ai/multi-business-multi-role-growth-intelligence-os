#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function readJson(relativePath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
  } catch (error) {
    fail('JSON_PARSE_FAILED', `${relativePath}: ${error.message}`);
  }
}

function assert(condition, code, message, details = {}) {
  if (!condition) fail(code, message, details);
}

function fail(code, message, details = {}) {
  console.error(JSON.stringify({
    schema: 'mad4b.spec015.portfolio-live-delta-report.v1',
    ok: false,
    code,
    message,
    details,
    secrets_included: false
  }, null, 2));
  process.exit(1);
}

const base = readJson('draft-spec-portfolio.json');
const delta = readJson('draft-spec-portfolio-live-delta.json');
const schema = readJson('contracts/draft-spec-portfolio-live-delta.schema.json');

assert(delta.$schema === 'contracts/draft-spec-portfolio-live-delta.schema.json', 'DELTA_SCHEMA_REF', 'Unexpected delta schema reference');
assert(delta.schema_version === 1, 'DELTA_SCHEMA_VERSION', 'Unexpected delta schema version');
assert(schema.$schema === 'https://json-schema.org/draft/2020-12/schema', 'DELTA_SCHEMA_DIALECT', 'Delta schema must use JSON Schema 2020-12');
assert(schema.additionalProperties === false, 'DELTA_SCHEMA_CLOSED', 'Delta schema root must fail closed');
assert(delta.base_registry === 'draft-spec-portfolio.json', 'DELTA_BASE_REGISTRY', 'Unexpected base registry');
assert(delta.base_observed_at === base.observed_at, 'DELTA_BASE_TIME', 'Delta base timestamp must match base registry');
assert(Date.parse(delta.delta_observed_at) > Date.parse(delta.base_observed_at), 'DELTA_TIME_ORDER', 'Delta timestamp must follow the base snapshot');
assert(delta.secrets_included === false, 'DELTA_SECRET_FLAG', 'Delta must declare secrets_included=false');

const basePrimary = new Set(base.draft_specs.map((entry) => entry.pull_request));
const baseRelated = new Set(base.related_open_drafts.map((entry) => entry.pull_request));
const deltaRelated = new Set(delta.new_related_open_drafts.map((entry) => entry.pull_request));

assert(delta.new_related_open_drafts.length === 1, 'DELTA_ENTRY_COUNT', 'Current live delta must contain exactly PR #4464');
assert(deltaRelated.size === delta.new_related_open_drafts.length, 'DELTA_DUPLICATE_PR', 'Delta PR entries must be unique');
assert(deltaRelated.has(4464), 'DELTA_PR_4464', 'PR #4464 is missing from the live delta');

for (const number of deltaRelated) {
  assert(!basePrimary.has(number), 'DELTA_PRIMARY_COLLISION', `PR #${number} already exists as a primary Spec`);
  assert(!baseRelated.has(number), 'DELTA_RELATED_COLLISION', `PR #${number} already exists in the base related registry`);
}

const entry = delta.new_related_open_drafts[0];
assert(entry.parent_feature_key === '014-governed-hostinger-storage-orchestration', 'DELTA_PARENT_FEATURE', 'PR #4464 must belong to Hostinger storage orchestration');
assert(entry.parent_pull_request === 4386, 'DELTA_PARENT_PR', 'PR #4464 must target PR #4386');
assert(entry.base_branch === 'gpt/hostinger-safe-storage-cleanup-ssh-20260801', 'DELTA_BASE_BRANCH', 'Unexpected PR #4464 base branch');
assert(entry.branch === 'gpt/014-hostinger/repository-provenance-brand-20260801', 'DELTA_BRANCH', 'Unexpected PR #4464 branch');
assert(entry.observed_head_sha === '78c127f25a647a87e89c65f0b8e3cbf5d30d4653', 'DELTA_HEAD', 'Unexpected PR #4464 head');
assert(entry.state === 'open' && entry.draft === true, 'DELTA_STATE', 'PR #4464 must be open Draft');
assert(entry.classification === 'workstream_correction', 'DELTA_CLASSIFICATION', 'PR #4464 must be a workstream correction');
assert(entry.changed_paths.length === 5, 'DELTA_PATH_COUNT', 'PR #4464 must record five changed paths');
assert(entry.changed_paths.includes('http-generic-api/hostingerStorageControlPlaneRepositoryBase.js'), 'DELTA_BASE_MODULE', 'PR #4464 Base module path is missing');
assert(entry.changed_paths.includes('http-generic-api/test-hostinger-storage-control-plane-repository-brand.mjs'), 'DELTA_TEST', 'PR #4464 provenance test path is missing');

for (const [key, value] of Object.entries(entry.safety_boundary)) {
  assert(value === false, 'DELTA_SAFETY_BOUNDARY', `Safety boundary ${key} must remain false`);
}

const train = delta.updated_delivery_trains.find((candidate) => candidate.train_key === 'hostinger-storage-workstreams');
assert(train, 'DELTA_HOSTINGER_TRAIN', 'Hostinger train update is missing');
assert(train.parent_pr === 4386, 'DELTA_HOSTINGER_PARENT', 'Hostinger train must target PR #4386');
assert(train.added_pull_requests.length === 1 && train.added_pull_requests[0] === 4464, 'DELTA_HOSTINGER_ADDITION', 'Hostinger train must add only PR #4464 in this delta');

const counts = delta.current_counts;
assert(counts.primary_draft_specs === base.draft_specs.length, 'DELTA_PRIMARY_COUNT', 'Primary count must match base registry');
assert(counts.base_related_open_drafts === base.related_open_drafts.length, 'DELTA_BASE_RELATED_COUNT', 'Base related count must match base registry');
assert(counts.live_delta_related_open_drafts === delta.new_related_open_drafts.length, 'DELTA_LIVE_COUNT', 'Live delta count mismatch');
assert(counts.total_related_open_drafts === counts.base_related_open_drafts + counts.live_delta_related_open_drafts, 'DELTA_RELATED_TOTAL', 'Related total mismatch');
assert(counts.total_open_drafts_classified === counts.primary_draft_specs + counts.total_related_open_drafts, 'DELTA_PORTFOLIO_TOTAL', 'Portfolio total mismatch');
assert(counts.total_open_drafts_classified === 35, 'DELTA_EXPECTED_TOTAL', 'Current classified Draft total must be 35');

console.log(JSON.stringify({
  schema: 'mad4b.spec015.portfolio-live-delta-report.v1',
  ok: true,
  base_primary_draft_specs: base.draft_specs.length,
  base_related_open_drafts: base.related_open_drafts.length,
  live_delta_related_open_drafts: delta.new_related_open_drafts.length,
  current_total_open_drafts_classified: counts.total_open_drafts_classified,
  added_pull_requests: [...deltaRelated],
  mutation_authority_granted: false,
  secrets_included: false
}, null, 2));
