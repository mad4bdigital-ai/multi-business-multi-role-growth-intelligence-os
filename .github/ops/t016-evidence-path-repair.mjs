import fs from 'node:fs';

const runtimePath = '.github/ops/sprint69-1043-runtime-readiness.mjs';
const backfillPath = '.github/ops/sprint69-1043-runtime-readiness-backfill.mjs';
const testPath = 'http-generic-api/test-sprint69-1043-runtime-readiness-contract.mjs';

const safeKeysDeclaration = `const SAFE_EVIDENCE_KEYS = new Set([
  'activation_registry_sync_executed',
  'apply_authorized',
  'apply_sent',
  'authorization_bootstrap',
  'authorization_comment_id',
  'authorization_created',
  'authorization_required',
  'business_data_mutation_executed',
  'credential_payload_accessed',
  'external_business_write_executed',
  'external_write_executed',
  'managed_control_plane_write_executed',
  'migration_apply_executed',
  'provider_call_executed',
  'repository_mutation_performed',
  'secrets_included',
]);`;

function patchSanitizer(source, label) {
  const sensitive = `const sensitiveKey = /(password|secret|token|authorization|cookie|api[_-]?key|credential|private[_-]?key|refresh[_-]?token|access[_-]?token)/i;`;
  if (!source.includes('SAFE_EVIDENCE_KEYS')) {
    if (!source.includes(sensitive)) throw new Error(`${label} sensitive-key anchor missing`);
    source = source.replace(sensitive, `${sensitive}\n${safeKeysDeclaration}`);
  }

  source = source.replace(
    `sensitiveKey.test(key) ? '[redacted]' : sanitize(child)`,
    `sensitiveKey.test(key) && !SAFE_EVIDENCE_KEYS.has(key) ? '[redacted]' : sanitize(child)`,
  );
  source = source.replace(
    `sensitiveKey.test(key) && key !== 'authorization_created' && key !== 'authorization_bootstrap'\n      ? '[redacted]'\n      : sanitize(child)`,
    `sensitiveKey.test(key) && !SAFE_EVIDENCE_KEYS.has(key)\n      ? '[redacted]'\n      : sanitize(child)`,
  );

  if (!source.includes(`sensitiveKey.test(key) && !SAFE_EVIDENCE_KEYS.has(key)`)) {
    throw new Error(`${label} bounded sanitizer missing`);
  }
  return source;
}

let runtime = fs.readFileSync(runtimePath, 'utf8');
runtime = patchSanitizer(runtime, 'runtime');
fs.writeFileSync(runtimePath, runtime);

let backfill = fs.readFileSync(backfillPath, 'utf8');
backfill = patchSanitizer(backfill, 'backfill');

if (!backfill.includes('nonSkippedCandidates')) {
  const startMarker = `  const commentMs = isoMs(comment.created_at);`;
  const endMarker = `\n\n  let run = candidates[0] || null;`;
  const start = backfill.indexOf(startMarker);
  const endStart = backfill.indexOf(endMarker, start);
  if (start < 0 || endStart < 0) throw new Error('backfill discovery section boundaries missing');
  const end = endStart + endMarker.length;
  const replacement = `  const commentMs = isoMs(comment.created_at);
  const allRuns = [];
  let pagesFetched = 0;
  let reachedCommentBoundary = false;
  for (let page = 1; page <= 20; page += 1) {
    const list = await githubJson(
      \`/repos/\${REPOSITORY}/actions/workflows/\${encodeURIComponent(WORKFLOW_FILE)}/runs?event=issue_comment&per_page=100&page=\${page}\`,
    );
    const pageRuns = list?.workflow_runs || [];
    pagesFetched = page;
    allRuns.push(...pageRuns);
    if (!pageRuns.length) break;
    const oldestMs = Math.min(...pageRuns.map((candidate) => isoMs(candidate.created_at)));
    if (oldestMs <= commentMs) {
      reachedCommentBoundary = true;
      break;
    }
  }
  assert.ok(reachedCommentBoundary, 'Runtime Readiness run pagination did not reach the authorization boundary');
  const candidates = allRuns
    .filter((run) => run?.name === WORKFLOW_NAME)
    .filter((run) => run?.event === 'issue_comment')
    .filter((run) => run?.head_branch === 'main')
    .filter((run) => run?.actor?.login === comment.user.login)
    .filter((run) => isoMs(run.created_at) >= commentMs)
    .sort((left, right) => isoMs(left.created_at) - isoMs(right.created_at));
  const nonSkippedCandidates = candidates.filter((run) => run?.conclusion !== 'skipped');

  let run = nonSkippedCandidates[0] || null;`;
  backfill = `${backfill.slice(0, start)}${replacement}${backfill.slice(end)}`;
}

if (!backfill.includes('pages_fetched: pagesFetched')) {
  backfill = backfill.replace(
    `    candidate_count: candidates.length,\n    run_id: run?.id || null,`,
    `    pages_fetched: pagesFetched,\n    reached_comment_boundary: reachedCommentBoundary,\n    scanned_run_count: allRuns.length,\n    candidate_count: candidates.length,\n    non_skipped_candidate_count: nonSkippedCandidates.length,\n    run_id: run?.id || null,`,
  );
}
if (!backfill.includes('pages_fetched: pagesFetched')) throw new Error('backfill report pagination metadata missing');

if (!backfill.includes('function safeBoolean')) {
  backfill = backfill.replace(
    `function boundedRuntimeResult(summary, failure, discovery) {`,
    `function safeBoolean(value) {\n  return value === true || value === false ? value : null;\n}\n\nfunction boundedRuntimeResult(summary, failure, discovery) {`,
  );
}
backfill = backfill.replace(
  `    assert.equal(summary.secrets_included, false);`,
  `    assert.equal(safeBoolean(summary.secrets_included), false);`,
);

const failureStart = backfill.indexOf(`  if (failure) {`);
const fallbackStart = backfill.indexOf(`  return {`, failureStart + 1);
if (failureStart < 0 || fallbackStart < 0) throw new Error('failure result block boundaries missing');
let failureBlock = backfill.slice(failureStart, fallbackStart);
failureBlock = failureBlock.replace(
  `    assert.equal(failure.secrets_included, false);`,
  `    const failureSecretsIncluded = safeBoolean(failure.secrets_included);`,
);
for (const key of [
  'authorization_created',
  'apply_authorized',
  'apply_sent',
  'migration_apply_executed',
  'activation_registry_sync_executed',
]) {
  failureBlock = failureBlock.replace(
    `      ${key}: failure.${key} ?? false,`,
    `      ${key}: safeBoolean(failure.${key}),`,
  );
}
failureBlock = failureBlock.replace(
  `      secrets_included: false,`,
  `      secrets_included: failureSecretsIncluded,`,
);
backfill = `${backfill.slice(0, failureStart)}${failureBlock}${backfill.slice(fallbackStart)}`;
backfill = backfill.replace(
  `    \`- Secrets included: \${runtime.secrets_included}\`,`,
  `    \`- Secrets included: \${runtime.secrets_included ?? 'unverified'}\`,`,
);

for (const required of [
  'nonSkippedCandidates',
  'per_page=100&page=${page}',
  'function safeBoolean',
  'failureSecretsIncluded',
  "runtime.secrets_included ?? 'unverified'",
]) {
  if (!backfill.includes(required)) throw new Error(`backfill repair missing ${required}`);
}
fs.writeFileSync(backfillPath, backfill);

let test = fs.readFileSync(testPath, 'utf8');
test = test.replace(`const AUTH_COMMENT_ID = '5160291051';`, `const AUTH_COMMENT_ID = '5169156192';`);
if (!test.includes('nonSkippedCandidates')) {
  const anchor = `assert.match(backfillRunner, /actions\\/workflows\\/\\$\\{encodeURIComponent\\(WORKFLOW_FILE\\)\\}\\/runs\\?event=issue_comment/);`;
  const addition = `${anchor}
assert.match(backfillRunner, /per_page=100&page=\\$\\{page\\}/);
assert.match(backfillRunner, /reachedCommentBoundary/);
assert.match(backfillRunner, /nonSkippedCandidates/);
assert.match(backfillRunner, /function safeBoolean/);
assert.doesNotMatch(backfillRunner, /per_page=50/);
assert.match(runner, /SAFE_EVIDENCE_KEYS/);
assert.match(backfillRunner, /SAFE_EVIDENCE_KEYS/);
assert.match(runner, /'secrets_included'/);
assert.match(backfillRunner, /unverified/);`;
  if (!test.includes(anchor)) throw new Error('contract test insertion anchor missing');
  test = test.replace(anchor, addition);
}
fs.writeFileSync(testPath, test);

console.log(JSON.stringify({
  ok: true,
  runtime_safe_evidence_fields: true,
  backfill_paginated_discovery: true,
  skipped_run_filtering: true,
  legacy_redacted_booleans_unverified: true,
  secrets_included: false,
}, null, 2));
