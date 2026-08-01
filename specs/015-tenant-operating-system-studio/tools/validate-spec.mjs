#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const argv = process.argv.slice(2);
const onlyIndex = argv.indexOf('--only');
const ONLY = onlyIndex >= 0 ? argv[onlyIndex + 1] : 'all';
const ALLOWED_STAGES = new Set(['all', 'manifest', 'contracts', 'convergence', 'work-map', 'completion', 'secrets']);

if (!ALLOWED_STAGES.has(ONLY)) {
  fail('INVALID_STAGE', `Unsupported validation stage: ${ONLY}`);
}

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

function assert(condition, code, message) {
  if (!condition) fail(code, message);
}

function fail(code, message, details = {}) {
  const report = {
    schema: 'mad4b.spec015.contract-integrity-report.v1',
    ok: false,
    stage: ONLY,
    code,
    message,
    details,
    secrets_included: false
  };
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function listFilesRecursive(directory) {
  const results = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(absolute));
    } else {
      results.push(path.relative(ROOT, absolute).split(path.sep).join('/'));
    }
  }
  return results.sort();
}

function validateManifest() {
  const manifest = readJson('manifest.json');
  assert(manifest.spec_key === '015-tenant-operating-system-studio', 'MANIFEST_SPEC_KEY', 'Unexpected manifest spec_key');
  assert(manifest.specification_only === true, 'MANIFEST_SCOPE', 'Manifest must remain specification-only');
  assert(manifest.boundaries?.runtime_changes === false, 'RUNTIME_BOUNDARY', 'Runtime changes must remain false in this PR');
  assert(manifest.boundaries?.database_migrations === false, 'MIGRATION_BOUNDARY', 'Database migrations must remain false in this PR');
  assert(manifest.boundaries?.provider_calls === false, 'PROVIDER_BOUNDARY', 'Provider calls must remain false in this PR');
  assert(manifest.boundaries?.candidate_pr_merge === false, 'CANDIDATE_MERGE_BOUNDARY', 'Candidate PR merge must remain false');
  assert(manifest.boundaries?.secrets_included === false, 'MANIFEST_SECRET_FLAG', 'Manifest must declare secrets_included=false');
  assert(Array.isArray(manifest.files), 'MANIFEST_FILES', 'Manifest files must be an array');
  assert(manifest.file_count === manifest.files.length, 'MANIFEST_COUNT', 'file_count does not match files array length');

  const declared = [...manifest.files].sort();
  const actual = listFilesRecursive(ROOT).filter((file) => file !== 'tools/.DS_Store');
  assert(JSON.stringify(declared) === JSON.stringify(actual), 'MANIFEST_INVENTORY_DRIFT', 'Declared and actual Spec file inventories differ', { declared, actual });

  for (const dependency of manifest.dependencies ?? []) {
    assert(typeof dependency === 'string' && dependency.length > 2, 'MANIFEST_DEPENDENCY', 'Invalid manifest dependency');
  }

  return { manifest, actual };
}

function validateContracts() {
  const schemaFiles = [
    'contracts/solution-package.schema.json',
    'contracts/package-installation.schema.json',
    'contracts/lifecycle-definition.schema.json',
    'contracts/candidate-convergence.schema.json'
  ];

  for (const file of schemaFiles) {
    const schema = readJson(file);
    assert(schema.$schema === 'https://json-schema.org/draft/2020-12/schema', 'SCHEMA_DIALECT', `${file} must use JSON Schema 2020-12`);
    assert(typeof schema.$id === 'string' && schema.$id.includes('/spec-015/'), 'SCHEMA_ID', `${file} has an invalid $id`);
    assert(schema.type === 'object', 'SCHEMA_ROOT_TYPE', `${file} root type must be object`);
    assert(schema.additionalProperties === false, 'SCHEMA_ADDITIONAL_PROPERTIES', `${file} root must fail closed on unknown properties`);
    assert(JSON.stringify(schema).includes('secrets_included'), 'SCHEMA_SECRET_FLAG', `${file} must carry a no-secret contract`);
  }

  const openapi = readText('contracts/tenant-operating-system-studio.openapi.yaml');
  assert(/^openapi:\s*3\.1\.0/m.test(openapi), 'OPENAPI_VERSION', 'OpenAPI contract must use 3.1.0');
  assert(/servers:\s*\[\]/m.test(openapi), 'OPENAPI_DRAFT_SERVER', 'Draft OpenAPI must not declare a live server');
  assert(openapi.includes('Idempotency-Key'), 'OPENAPI_IDEMPOTENCY', 'Mutating API contract must include Idempotency-Key');
  assert(openapi.includes('If-Match'), 'OPENAPI_EXPECTED_VERSION', 'Conflict-sensitive API contract must include If-Match');
  assert(openapi.includes('secrets_included'), 'OPENAPI_SECRET_FLAG', 'OpenAPI responses must declare secrets_included');
}

function validateConvergence() {
  const convergence = readJson('candidate-convergence.json');
  assert(convergence.spec_key === '015-tenant-operating-system-studio', 'CONVERGENCE_SPEC_KEY', 'Unexpected convergence spec key');
  assert(convergence.status === 'draft_review_required', 'CONVERGENCE_STATUS', 'Candidate convergence must remain review-required');
  assert(Array.isArray(convergence.candidates) && convergence.candidates.length === 2, 'CONVERGENCE_CANDIDATES', 'Exactly PR #3922 and #4432 must be classified');

  const byPr = new Map(convergence.candidates.map((candidate) => [candidate.pull_request, candidate]));
  for (const number of [3922, 4432]) {
    const candidate = byPr.get(number);
    assert(candidate, 'CONVERGENCE_PR_MISSING', `PR #${number} is missing`);
    assert(candidate.merge_posture === 'do_not_blind_merge_reconstruct_on_current_main', 'CONVERGENCE_MERGE_POSTURE', `PR #${number} must not be blindly merged`);
    assert(candidate.generic_substrate.length > 0, 'CONVERGENCE_GENERIC_EMPTY', `PR #${number} generic substrate is empty`);
    assert(candidate.child_package?.content_families?.length > 0, 'CONVERGENCE_CHILD_EMPTY', `PR #${number} child package classification is empty`);
    assert(candidate.blocking_actions.length > 0, 'CONVERGENCE_BLOCKERS_EMPTY', `PR #${number} must retain reconstruction blockers`);
  }

  assert(byPr.get(3922).child_package.package_key === 'platform.reference.retail_commerce_operations', 'RETAIL_PACKAGE_KEY', 'Unexpected Retail Commerce package key');
  assert(byPr.get(4432).child_package.package_key === 'platform.reference.evidence_intelligence_operations', 'EVIDENCE_PACKAGE_KEY', 'Unexpected Evidence Intelligence package key');
  assert(convergence.secrets_included === false, 'CONVERGENCE_SECRET_FLAG', 'Convergence must declare secrets_included=false');
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
    assert(allowed.has(decision.decision), 'WORK_MAP_DECISION_INVALID', `${key} has unresolved or invalid decision ${decision.decision}`);
    assert(typeof decision.rationale === 'string' && decision.rationale.length > 10, 'WORK_MAP_RATIONALE', `${key} lacks rationale`);
    if (decision.decision === 'not_applicable') {
      assert(Array.isArray(decision.non_applicability_evidence) && decision.non_applicability_evidence.length > 0, 'WORK_MAP_NA_EVIDENCE', `${key} lacks non-applicability evidence`);
    }
  }

  assert(workMap.implementation_readiness?.ready_for_implementation === false, 'IMPLEMENTATION_READINESS', 'This convergence Spec must remain implementation-blocked');
  assert(workMap.implementation_readiness?.status === 'blocked', 'IMPLEMENTATION_STATUS', 'Implementation status must remain blocked');
  assert(workMap.secrets_included === false, 'WORK_MAP_SECRET_FLAG', 'Work Map contract must declare secrets_included=false');
}

function validateCompletion() {
  const completion = readJson('completion.json');
  const manifest = readJson('manifest.json');
  assert(completion.feature_key === manifest.spec_key, 'COMPLETION_FEATURE', 'Completion feature key must match manifest');
  assert(completion.status === 'in_progress', 'COMPLETION_STATUS', 'Runtime completion must remain in_progress');
  assert(completion.specification?.complete === true, 'SPEC_COMPLETION', 'Specification package should be marked complete');
  assert(completion.specification?.file_count_expected === manifest.file_count, 'COMPLETION_FILE_COUNT', 'Completion expected file count must match manifest');
  assert(completion.specification?.file_count_recorded === manifest.file_count, 'COMPLETION_FILE_RECORDED', 'Completion recorded file count must match manifest');
  assert(completion.implementation?.started === false, 'IMPLEMENTATION_STARTED', 'Runtime implementation must remain not started');
  assert(completion.implementation?.migrations_applied === false, 'COMPLETION_MIGRATION', 'No migration may be claimed');
  assert(completion.implementation?.runtime_deployed === false, 'COMPLETION_DEPLOYMENT', 'No runtime deployment may be claimed');
  assert(completion.convergence?.duplicate_spec_identity_resolved === false, 'DUPLICATE_SPEC_IDENTITY', 'Duplicate Spec 014 identity must remain an explicit blocker');
  assert(completion.secrets_included === false, 'COMPLETION_SECRET_FLAG', 'Completion must declare secrets_included=false');
}

function validateSecrets() {
  const files = listFilesRecursive(ROOT);
  const findings = [];
  const forbiddenPatterns = [
    { label: 'private_key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i },
    { label: 'github_pat', pattern: /github_pat_[A-Za-z0-9_]{20,}/ },
    { label: 'google_api_key', pattern: /AIza[0-9A-Za-z_-]{30,}/ },
    { label: 'aws_access_key', pattern: /AKIA[0-9A-Z]{16}/ },
    { label: 'bearer_token', pattern: /Authorization:\s*Bearer\s+[A-Za-z0-9._~+\/-]{20,}/i },
    { label: 'signed_url', pattern: /[?&](?:X-Goog-Signature|X-Amz-Signature|sig)=[A-Fa-f0-9%]{20,}/i }
  ];

  for (const file of files) {
    const text = readText(file);
    for (const { label, pattern } of forbiddenPatterns) {
      if (pattern.test(text)) findings.push({ file, label });
    }
  }

  assert(findings.length === 0, 'SECRET_SCAN_FAILED', 'Potential secret material detected', { findings });
}

const stages = ONLY === 'all'
  ? ['manifest', 'contracts', 'convergence', 'work-map', 'completion', 'secrets']
  : [ONLY];

const stageFunctions = {
  manifest: validateManifest,
  contracts: validateContracts,
  convergence: validateConvergence,
  'work-map': validateWorkMap,
  completion: validateCompletion,
  secrets: validateSecrets
};

for (const stage of stages) stageFunctions[stage]();

const report = {
  schema: 'mad4b.spec015.contract-integrity-report.v1',
  ok: true,
  stage: ONLY,
  validated_stages: stages,
  spec_key: '015-tenant-operating-system-studio',
  inventory_digest: sha256(listFilesRecursive(ROOT).join('\n')),
  mutation_authority_granted: false,
  runtime_implementation_claimed: false,
  secrets_included: false
};

console.log(JSON.stringify(report, null, 2));
