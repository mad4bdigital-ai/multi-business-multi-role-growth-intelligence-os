#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const argv = process.argv.slice(2);
const onlyIndex = argv.indexOf('--only');
const ONLY = onlyIndex >= 0 ? argv[onlyIndex + 1] : 'all';
const STAGES = new Set(['all', 'manifest', 'contracts', 'convergence', 'portfolio', 'work-map', 'completion', 'secrets']);

if (!STAGES.has(ONLY)) fail('INVALID_STAGE', `Unsupported validation stage: ${ONLY}`);

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readJson(relativePath) {
  try {
    return JSON.parse(readText(relativePath));
  } catch (error) {
    fail('JSON_PARSE_FAILED', `${relativePath}: ${error.message}`);
  }
}

function assert(condition, code, message, details = {}) {
  if (!condition) fail(code, message, details);
}

function fail(code, message, details = {}) {
  console.error(JSON.stringify({
    schema: 'mad4b.spec015.contract-integrity-report.v1',
    ok: false,
    stage: ONLY,
    code,
    message,
    details,
    secrets_included: false
  }, null, 2));
  process.exit(1);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function listFilesRecursive(directory) {
  const results = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...listFilesRecursive(absolute));
    else results.push(path.relative(ROOT, absolute).split(path.sep).join('/'));
  }
  return results.sort();
}

function sortedNumbers(values) {
  return [...values].sort((a, b) => a - b);
}

function sameNumbers(actual, expected) {
  return JSON.stringify(sortedNumbers(actual)) === JSON.stringify(sortedNumbers(expected));
}

function validateManifest() {
  const manifest = readJson('manifest.json');
  assert(manifest.spec_key === '015-tenant-operating-system-studio', 'MANIFEST_SPEC_KEY', 'Unexpected manifest spec_key');
  assert(manifest.specification_only === true, 'MANIFEST_SCOPE', 'Manifest must remain specification-only');
  assert(manifest.boundaries?.runtime_changes === false, 'RUNTIME_BOUNDARY', 'Runtime changes must remain false');
  assert(manifest.boundaries?.database_migrations === false, 'MIGRATION_BOUNDARY', 'Database migrations must remain false');
  assert(manifest.boundaries?.provider_calls === false, 'PROVIDER_BOUNDARY', 'Provider calls must remain false');
  assert(manifest.boundaries?.candidate_pr_merge === false, 'CANDIDATE_MERGE_BOUNDARY', 'Candidate PR merge must remain false');
  assert(manifest.boundaries?.secrets_included === false, 'MANIFEST_SECRET_FLAG', 'Manifest must declare secrets_included=false');
  assert(Array.isArray(manifest.files), 'MANIFEST_FILES', 'Manifest files must be an array');
  assert(manifest.file_count === manifest.files.length, 'MANIFEST_COUNT', 'file_count must match files length');

  const declared = [...manifest.files].sort();
  const actual = listFilesRecursive(ROOT).filter((file) => file !== 'tools/.DS_Store');
  assert(JSON.stringify(declared) === JSON.stringify(actual), 'MANIFEST_INVENTORY_DRIFT', 'Declared and actual file inventories differ', { declared, actual });

  assert(manifest.coverage?.open_draft_specs_reviewed === 12, 'MANIFEST_PRIMARY_COUNT', 'Manifest must record 12 primary Draft Specs');
  assert(manifest.coverage?.related_open_drafts_reviewed === 22, 'MANIFEST_RELATED_COUNT', 'Manifest must record 22 related Draft PRs');
  assert(manifest.coverage?.total_open_drafts_classified === 34, 'MANIFEST_TOTAL_DRAFT_COUNT', 'Manifest must record 34 classified Draft PRs');
  assert(manifest.coverage?.duplicate_numeric_identities === 2, 'MANIFEST_NUMERIC_DUPLICATES', 'Manifest must record duplicate 011 and 014 identities');
  assert(manifest.coverage?.duplicate_feature_clusters === 1, 'MANIFEST_FEATURE_DUPLICATES', 'Manifest must record the Spec 013 duplicate feature cluster');
  assert(manifest.coverage?.implementation_trains_registered === 4, 'MANIFEST_TRAIN_COUNT', 'Manifest must record four delivery trains');
}

function validateContracts() {
  const schemaFiles = [
    'contracts/solution-package.schema.json',
    'contracts/package-installation.schema.json',
    'contracts/lifecycle-definition.schema.json',
    'contracts/candidate-convergence.schema.json',
    'contracts/draft-spec-portfolio.schema.json'
  ];

  for (const file of schemaFiles) {
    const schema = readJson(file);
    assert(schema.$schema === 'https://json-schema.org/draft/2020-12/schema', 'SCHEMA_DIALECT', `${file} must use JSON Schema 2020-12`);
    assert(typeof schema.$id === 'string' && schema.$id.includes('/spec-015/'), 'SCHEMA_ID', `${file} has an invalid $id`);
    assert(schema.type === 'object', 'SCHEMA_ROOT_TYPE', `${file} root type must be object`);
    assert(schema.additionalProperties === false, 'SCHEMA_ADDITIONAL_PROPERTIES', `${file} must fail closed on unknown root properties`);
    assert(JSON.stringify(schema).includes('secrets_included'), 'SCHEMA_SECRET_FLAG', `${file} must carry a no-secret contract`);
  }

  const portfolioSchema = readJson('contracts/draft-spec-portfolio.schema.json');
  assert(portfolioSchema.properties?.schema_version?.const === 2, 'PORTFOLIO_SCHEMA_CONTRACT_VERSION', 'Portfolio schema must be version 2');
  assert(portfolioSchema.properties?.related_open_drafts, 'RELATED_DRAFT_SCHEMA', 'Portfolio schema must govern related open Draft PRs');
  assert(portfolioSchema.properties?.duplicate_feature_clusters, 'DUPLICATE_FEATURE_SCHEMA', 'Portfolio schema must govern duplicate feature clusters');

  const openapi = readText('contracts/tenant-operating-system-studio.openapi.yaml');
  assert(/^openapi:\s*3\.1\.0/m.test(openapi), 'OPENAPI_VERSION', 'OpenAPI contract must use 3.1.0');
  assert(/servers:\s*\[\]/m.test(openapi), 'OPENAPI_DRAFT_SERVER', 'Draft OpenAPI must not declare a live server');
  assert(openapi.includes('Idempotency-Key'), 'OPENAPI_IDEMPOTENCY', 'Mutating contract must include Idempotency-Key');
  assert(openapi.includes('If-Match'), 'OPENAPI_EXPECTED_VERSION', 'Conflict-sensitive contract must include If-Match');
  assert(openapi.includes('secrets_included'), 'OPENAPI_SECRET_FLAG', 'OpenAPI responses must declare secrets_included');
}

function validateConvergence() {
  const convergence = readJson('candidate-convergence.json');
  assert(convergence.spec_key === '015-tenant-operating-system-studio', 'CONVERGENCE_SPEC_KEY', 'Unexpected convergence spec key');
  assert(convergence.status === 'draft_review_required', 'CONVERGENCE_STATUS', 'Detailed candidate convergence must remain review-required');
  assert(Array.isArray(convergence.candidates) && convergence.candidates.length === 2, 'CONVERGENCE_CANDIDATES', 'Detailed extraction contract must retain PRs 3922 and 4432');

  const byPr = new Map(convergence.candidates.map((candidate) => [candidate.pull_request, candidate]));
  for (const number of [3922, 4432]) {
    const candidate = byPr.get(number);
    assert(candidate, 'CONVERGENCE_PR_MISSING', `PR #${number} is missing`);
    assert(candidate.merge_posture === 'do_not_blind_merge_reconstruct_on_current_main', 'CONVERGENCE_MERGE_POSTURE', `PR #${number} must not be blindly merged`);
    assert(candidate.generic_substrate.length > 0, 'CONVERGENCE_GENERIC_EMPTY', `PR #${number} generic substrate is empty`);
    assert(candidate.child_package?.content_families?.length > 0, 'CONVERGENCE_CHILD_EMPTY', `PR #${number} child package is empty`);
    assert(candidate.blocking_actions.length > 0, 'CONVERGENCE_BLOCKERS_EMPTY', `PR #${number} must retain blockers`);
  }

  assert(byPr.get(3922).child_package.package_key === 'platform.reference.retail_commerce_operations', 'RETAIL_PACKAGE_KEY', 'Unexpected Retail Commerce package key');
  assert(byPr.get(4432).child_package.package_key === 'platform.reference.evidence_intelligence_operations', 'EVIDENCE_PACKAGE_KEY', 'Unexpected Evidence Intelligence package key');
  assert(convergence.secrets_included === false, 'CONVERGENCE_SECRET_FLAG', 'Convergence must declare secrets_included=false');
}

function validatePortfolio() {
  const portfolio = readJson('draft-spec-portfolio.json');
  assert(portfolio.schema_version === 2, 'PORTFOLIO_SCHEMA_VERSION', 'Unexpected portfolio schema version');
  assert(portfolio.repository === 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os', 'PORTFOLIO_REPOSITORY', 'Unexpected repository');
  assert(portfolio.portfolio_owner === '015-tenant-operating-system-studio', 'PORTFOLIO_OWNER', 'Unexpected portfolio owner');
  assert(portfolio.identity_policy?.canonical_identity === 'feature_key_plus_canonical_role', 'PORTFOLIO_IDENTITY', 'Unexpected portfolio identity');
  assert(portfolio.identity_policy?.numeric_spec_number_is_unique_authority === false, 'PORTFOLIO_NUMERIC_AUTHORITY', 'Numeric Spec numbers cannot be unique authority');
  assert(portfolio.identity_policy?.open_draft_classification === 'primary_spec_or_related_delivery', 'PORTFOLIO_CLASSIFICATION', 'Every Draft must be primary or related delivery');
  assert(portfolio.identity_policy?.merge_rule === 'reconstruct_against_current_main_and_existing_authorities', 'PORTFOLIO_MERGE_RULE', 'Unexpected merge rule');
  assert(portfolio.secrets_included === false, 'PORTFOLIO_SECRET_FLAG', 'Portfolio must declare secrets_included=false');

  const primaryPrs = [1898, 1935, 2284, 2385, 2949, 2950, 3159, 3922, 4386, 4432, 4456, 4460];
  const relatedPrs = [2030, 3005, 3021, 3026, 3044, 3054, 3070, 3083, 3089, 3097, 3109, 3119, 3130, 3134, 3139, 3143, 3144, 3145, 3160, 3181, 4002, 4462];

  assert(Array.isArray(portfolio.draft_specs) && portfolio.draft_specs.length === primaryPrs.length, 'PORTFOLIO_PRIMARY_COUNT', 'Expected 12 primary Draft Specs');
  assert(Array.isArray(portfolio.related_open_drafts) && portfolio.related_open_drafts.length === relatedPrs.length, 'PORTFOLIO_RELATED_COUNT', 'Expected 22 related Draft PRs');

  const primaryByPr = new Map(portfolio.draft_specs.map((entry) => [entry.pull_request, entry]));
  const relatedByPr = new Map(portfolio.related_open_drafts.map((entry) => [entry.pull_request, entry]));
  assert(primaryByPr.size === primaryPrs.length, 'PORTFOLIO_PRIMARY_DUPLICATE', 'Primary PR entries must be unique');
  assert(relatedByPr.size === relatedPrs.length, 'PORTFOLIO_RELATED_DUPLICATE', 'Related PR entries must be unique');
  assert(sameNumbers(primaryByPr.keys(), primaryPrs), 'PORTFOLIO_PRIMARY_SET', 'Primary PR set is incomplete');
  assert(sameNumbers(relatedByPr.keys(), relatedPrs), 'PORTFOLIO_RELATED_SET', 'Related PR set is incomplete');

  for (const number of primaryPrs) {
    const entry = primaryByPr.get(number);
    assert(entry.state === 'open' && entry.draft === true, 'PORTFOLIO_PRIMARY_STATE', `PR #${number} must be recorded as open Draft`);
    assert(/^specs\//.test(entry.spec_root), 'PORTFOLIO_SPEC_ROOT', `PR #${number} has invalid Spec root`);
    assert(/^[0-9a-f]{40}$/.test(entry.observed_head_sha), 'PORTFOLIO_PRIMARY_HEAD', `PR #${number} has invalid head SHA`);
    assert(Number.isInteger(entry.live_compare?.ahead_by) && entry.live_compare.ahead_by >= 0, 'PORTFOLIO_AHEAD', `PR #${number} has invalid ahead_by`);
    assert(Number.isInteger(entry.live_compare?.behind_by) && entry.live_compare.behind_by >= 0, 'PORTFOLIO_BEHIND', `PR #${number} has invalid behind_by`);
    assert(entry.portfolio_disposition?.length > 20, 'PORTFOLIO_DISPOSITION', `PR #${number} lacks disposition`);
    assert(Array.isArray(entry.truthfulness_findings), 'PORTFOLIO_TRUTHFULNESS', `PR #${number} lacks truthfulness findings`);
  }

  for (const number of relatedPrs) {
    const entry = relatedByPr.get(number);
    assert(entry.state === 'open' && entry.draft === true, 'PORTFOLIO_RELATED_STATE', `PR #${number} must be recorded as open Draft`);
    assert(/^[0-9a-f]{40}$/.test(entry.observed_head_sha), 'PORTFOLIO_RELATED_HEAD', `PR #${number} has invalid head SHA`);
    assert(entry.parent_feature_key?.length > 2, 'PORTFOLIO_RELATED_PARENT', `PR #${number} lacks parent feature`);
    assert(entry.disposition?.length > 20, 'PORTFOLIO_RELATED_DISPOSITION', `PR #${number} lacks disposition`);
  }

  const overlap = primaryPrs.filter((number) => relatedByPr.has(number));
  assert(overlap.length === 0, 'PORTFOLIO_CLASS_OVERLAP', 'A PR cannot be both primary and related', { overlap });
  assert(primaryPrs.length + relatedPrs.length === 34, 'PORTFOLIO_TOTAL_COUNT', 'Expected 34 classified open Draft PRs');

  assert(primaryByPr.get(2950).scope_mode === 'mixed_spec_and_implementation', 'TENANT_GPT_SCOPE_MODE', 'PR 2950 must be mixed Spec/runtime');
  assert(primaryByPr.get(3159).canonical_role === 'system_tool_catalog_subsystem', 'TOOL_CATALOG_ROLE', 'PR 3159 must be the representative System Tool Catalog subsystem');
  assert(primaryByPr.get(4386).scope_mode === 'integration_rollup', 'HOSTINGER_SCOPE_MODE', 'PR 4386 must be integration rollup');
  assert(primaryByPr.get(4456).canonical_role === 'portfolio_convergence_parent', 'PORTFOLIO_PARENT_ROLE', 'PR 4456 must own convergence');
  assert(primaryByPr.get(4460).canonical_role === 'external_integration_surface', 'CHATGPT_SURFACE_ROLE', 'PR 4460 must be external integration surface');
  assert(relatedByPr.get(4462).parent_feature_key === '016-chatgpt-plugin-mcp-integration', 'CHATGPT_CHILD_PARENT', 'PR 4462 must belong to Spec 016');

  const duplicateByNumber = new Map(portfolio.duplicate_numeric_identities.map((entry) => [entry.number, entry]));
  assert(sameNumbers(duplicateByNumber.get(11)?.pull_requests ?? [], [2949, 2950]), 'DUPLICATE_011', 'Numeric Spec 011 classification is incomplete');
  assert(sameNumbers(duplicateByNumber.get(14)?.pull_requests ?? [], [3922, 4386, 4432]), 'DUPLICATE_014', 'Numeric Spec 014 classification is incomplete');

  const featureClusters = new Map(portfolio.duplicate_feature_clusters.map((entry) => [entry.feature_key, entry]));
  const catalogCluster = featureClusters.get('013-system-tool-catalog-v2');
  assert(catalogCluster?.primary_pull_request === 3159, 'CATALOG_CLUSTER_PRIMARY', 'Spec 013 primary representative must be PR 3159');
  assert(sameNumbers(catalogCluster?.related_pull_requests ?? [], [3139, 3145]), 'CATALOG_CLUSTER_RELATED', 'Spec 013 duplicate cluster is incomplete');

  const trainByKey = new Map(portfolio.implementation_trains.map((train) => [train.train_key, train]));
  assert(trainByKey.size === 4, 'PORTFOLIO_TRAIN_COUNT', 'Expected four delivery trains');
  assert(trainByKey.get('operation-fabric-stack')?.delivery_shape === 'strict_stack', 'OPERATION_TRAIN_SHAPE', 'Operation Fabric must be strict stack');
  assert(trainByKey.get('operation-fabric-stack')?.pull_requests?.length === 14, 'OPERATION_TRAIN_COUNT', 'Operation Fabric train must include 13 original PRs plus PR 3160');
  assert(trainByKey.get('hostinger-storage-workstreams')?.pull_requests?.includes(4455), 'HOSTINGER_TENANT_CANARY', 'Hostinger train must include PR 4455');
  assert(sameNumbers(trainByKey.get('system-tool-catalog-v2-reconciliation')?.pull_requests ?? [], [3139, 3145, 3159]), 'CATALOG_TRAIN', 'System Tool Catalog train is incomplete');
  assert(sameNumbers(trainByKey.get('chatgpt-mcp-integration')?.pull_requests ?? [], [4462]), 'CHATGPT_TRAIN', 'ChatGPT implementation train is incomplete');

  const packageKeys = new Set(portfolio.draft_specs.map((entry) => entry.target_package_key).filter(Boolean));
  for (const key of [
    'platform.reference.retail_commerce_operations',
    'platform.reference.evidence_intelligence_operations',
    'platform.reference.hostinger_storage_operations',
    'platform.reference.local_connector_recovery'
  ]) assert(packageKeys.has(key), 'PORTFOLIO_PACKAGE_KEY', `Missing package key ${key}`);

  assert(portfolio.relationship_edges.length >= 15, 'PORTFOLIO_RELATIONSHIPS', 'Portfolio relationship graph is incomplete');
  assert(portfolio.portfolio_decisions.length >= 9, 'PORTFOLIO_DECISIONS', 'Portfolio decisions are incomplete');
}

function validateWorkMap() {
  const workMap = readJson('work-map-integration.json');
  assert(workMap.feature_key === '015-tenant-operating-system-studio', 'WORK_MAP_FEATURE', 'Unexpected Work Map feature key');
  assert(workMap.registry?.map_count === 19, 'WORK_MAP_COUNT', 'Expected all 19 Work Maps');
  assert(workMap.registry?.domain_count === 16, 'DOMAIN_COUNT', 'Expected all 16 schema domains');
  assert(Object.keys(workMap.work_map_decisions ?? {}).length === 19, 'WORK_MAP_DECISIONS', 'Every Work Map requires a decision');
  assert(Object.keys(workMap.domain_decisions ?? {}).length === 16, 'DOMAIN_DECISIONS', 'Every schema domain requires a decision');

  const allowed = new Set(['reuse', 'integrate', 'extend', 'not_applicable']);
  for (const [key, decision] of Object.entries(workMap.work_map_decisions)) {
    assert(allowed.has(decision.decision), 'WORK_MAP_DECISION_INVALID', `${key} has invalid decision ${decision.decision}`);
    assert(decision.rationale?.length > 10, 'WORK_MAP_RATIONALE', `${key} lacks rationale`);
    if (decision.decision === 'not_applicable') assert(decision.non_applicability_evidence?.length > 0, 'WORK_MAP_NA_EVIDENCE', `${key} lacks non-applicability evidence`);
  }

  assert(workMap.implementation_readiness?.ready_for_implementation === false, 'IMPLEMENTATION_READINESS', 'Convergence Spec must remain implementation-blocked');
  assert(workMap.implementation_readiness?.status === 'blocked', 'IMPLEMENTATION_STATUS', 'Implementation status must remain blocked');
  assert(workMap.secrets_included === false, 'WORK_MAP_SECRET_FLAG', 'Work Map must declare secrets_included=false');
}

function validateCompletion() {
  const completion = readJson('completion.json');
  const manifest = readJson('manifest.json');
  assert(completion.feature_key === manifest.spec_key, 'COMPLETION_FEATURE', 'Completion feature must match manifest');
  assert(completion.status === 'in_progress', 'COMPLETION_STATUS', 'Runtime completion must remain in_progress');
  assert(completion.specification?.complete === true, 'SPEC_COMPLETION', 'Specification package must be marked complete');
  assert(completion.specification?.file_count_expected === manifest.file_count, 'COMPLETION_FILE_COUNT', 'Expected file count must match manifest');
  assert(completion.specification?.file_count_recorded === manifest.file_count, 'COMPLETION_FILE_RECORDED', 'Recorded file count must match manifest');
  assert(completion.specification?.completed_phase0_tasks?.includes('T009'), 'COMPLETION_PORTFOLIO_TASK', 'T009 portfolio inventory must be complete');
  assert(completion.portfolio_scan?.open_draft_specs_reviewed === 12, 'COMPLETION_PRIMARY_COUNT', 'Completion must record 12 primary Specs');
  assert(completion.portfolio_scan?.related_open_drafts_reviewed === 22, 'COMPLETION_RELATED_COUNT', 'Completion must record 22 related Drafts');
  assert(completion.portfolio_scan?.total_open_drafts_classified === 34, 'COMPLETION_TOTAL_COUNT', 'Completion must record 34 classified Drafts');
  assert(completion.portfolio_scan?.canonical_paths_finalized === false, 'COMPLETION_CANONICAL_PATHS', 'Canonical paths must remain pending');
  assert(completion.portfolio_scan?.close_or_supersede_actions_executed === false, 'COMPLETION_PORTFOLIO_MUTATION', 'No close or supersede action may be claimed');
  assert(completion.implementation?.started === false, 'IMPLEMENTATION_STARTED', 'Spec 015 runtime implementation must remain not started');
  assert(completion.implementation?.migrations_applied === false, 'COMPLETION_MIGRATION', 'No migration may be claimed');
  assert(completion.implementation?.runtime_deployed === false, 'COMPLETION_DEPLOYMENT', 'No deployment may be claimed');
  assert(completion.convergence?.duplicate_spec_identity_resolved === false, 'DUPLICATE_SPEC_IDENTITY', 'Duplicate numeric identity must remain a blocker');
  assert(completion.secrets_included === false, 'COMPLETION_SECRET_FLAG', 'Completion must declare secrets_included=false');
}

function validateSecrets() {
  const findings = [];
  const patterns = [
    ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i],
    ['github_pat', /github_pat_[A-Za-z0-9_]{20,}/],
    ['google_api_key', /AIza[0-9A-Za-z_-]{30,}/],
    ['aws_access_key', /AKIA[0-9A-Z]{16}/],
    ['bearer_token', /Authorization:\s*Bearer\s+[A-Za-z0-9._~+\/-]{20,}/i],
    ['signed_url', /[?&](?:X-Goog-Signature|X-Amz-Signature|sig)=[A-Fa-f0-9%]{20,}/i]
  ];

  for (const file of listFilesRecursive(ROOT)) {
    const text = readText(file);
    for (const [label, pattern] of patterns) if (pattern.test(text)) findings.push({ file, label });
  }
  assert(findings.length === 0, 'SECRET_SCAN_FAILED', 'Potential secret material detected', { findings });
}

const orderedStages = ONLY === 'all'
  ? ['manifest', 'contracts', 'convergence', 'portfolio', 'work-map', 'completion', 'secrets']
  : [ONLY];

const validators = {
  manifest: validateManifest,
  contracts: validateContracts,
  convergence: validateConvergence,
  portfolio: validatePortfolio,
  'work-map': validateWorkMap,
  completion: validateCompletion,
  secrets: validateSecrets
};

for (const stage of orderedStages) validators[stage]();

console.log(JSON.stringify({
  schema: 'mad4b.spec015.contract-integrity-report.v1',
  ok: true,
  stage: ONLY,
  validated_stages: orderedStages,
  spec_key: '015-tenant-operating-system-studio',
  inventory_digest: sha256(listFilesRecursive(ROOT).join('\n')),
  primary_draft_specs: 12,
  related_open_drafts: 22,
  total_open_drafts_classified: 34,
  mutation_authority_granted: false,
  runtime_implementation_claimed: false,
  secrets_included: false
}, null, 2));
