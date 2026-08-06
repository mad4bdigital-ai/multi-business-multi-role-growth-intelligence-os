const fs = require('node:fs');
const path = require('node:path');

const diagnostic = [];
const record = (message) => diagnostic.push(String(message));
const diagnosticPath = process.env.PATCH_DIAGNOSTIC_PATH;

function replaceExactlyOnce(source, marker, replacement, label) {
  const count = source.split(marker).length - 1;
  record(`${label}_count=${count}`);
  if (count !== 1) throw new Error(`${label} expected exactly once, found ${count}`);
  return source.replace(marker, replacement);
}

try {
  const gatePath = 'http-generic-api/scripts/e2e-parallel-pr-gate.mjs';
  let gate = fs.readFileSync(gatePath, 'utf8');
  const insertionAnchor = '\nfunction classifyProductionPromotion({ root, headRef, baseRef, headSha, baseSha }) {';
  const classifier = String.raw`

const DEFAULT_BRANCH_SYNC_GENERATED_RESOLUTION_PATTERNS = [
  /^docs\/work-maps\/[^/]+\.md$/,
  /^http-generic-api\/frontend-(?:operation-governance|surface-dispatch)\.generated\.json$/,
  /^specs\/[^/]+\/work-map-integration\.json$/
];

function changedFilesForRange(root, range) {
  try {
    return execFileSync("git", ["diff", "--name-only", range], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).split(/\r?\n/).map(normalize).filter(Boolean);
  } catch {
    return [];
  }
}

function resolveBlob(root, ref, file) {
  if (!ref || !file) return null;
  try {
    const value = execFileSync("git", ["rev-parse", "--verify", ref + ":" + file], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return /^[0-9a-f]{40}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

function isGeneratedReconciliationPath(file) {
  const normalized = normalize(file);
  return DEFAULT_BRANCH_SYNC_GENERATED_RESOLUTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

function classifyDefaultBranchSynchronization({ root, headRef, baseRef, headSha, baseSha, changedFiles }) {
  if (headRef === "main" && Boolean(baseRef) && baseRef !== "Production") {
    return { allowed: true, identity: "protected_main" };
  }
  if (
    !/^gpt\/reconcile\/[A-Za-z0-9._/-]+$/.test(headRef || "") ||
    !baseRef ||
    baseRef === "main" ||
    baseRef === "Production" ||
    !/^[0-9a-f]{40}$/.test(headSha || "") ||
    !/^[0-9a-f]{40}$/.test(baseSha || "")
  ) {
    return { allowed: false, identity: null };
  }

  const mainRef = resolveCanonicalMainRef(root);
  const mainSha = resolveCommit(root, mainRef);
  const parents = resolveParents(root, headSha);
  if (
    !mainSha ||
    parents.length !== 2 ||
    parents[1] !== mainSha ||
    !isAncestor(root, baseSha, parents[0]) ||
    !isAncestor(root, baseSha, headSha) ||
    !isAncestor(root, mainSha, headSha)
  ) {
    return { allowed: false, identity: null, main_sha: mainSha };
  }

  const normalizedChangedFiles = [...new Set((changedFiles || []).map(normalize).filter(Boolean))].sort();
  const mainDelta = new Set(changedFilesForRange(root, baseSha + "..." + mainSha));
  const unexpectedFiles = normalizedChangedFiles.filter((file) => !mainDelta.has(file));
  const novelResolutionFiles = normalizedChangedFiles.filter((file) => {
    const headBlob = resolveBlob(root, headSha, file);
    const mainBlob = resolveBlob(root, mainSha, file);
    const firstParentBlob = resolveBlob(root, parents[0], file);
    return headBlob !== mainBlob && headBlob !== firstParentBlob;
  });
  const unsafeResolutionFiles = novelResolutionFiles.filter((file) => !isGeneratedReconciliationPath(file));
  if (!mainDelta.size || unexpectedFiles.length || unsafeResolutionFiles.length) {
    return {
      allowed: false,
      identity: null,
      main_sha: mainSha,
      unexpected_files: unexpectedFiles,
      unsafe_resolution_files: unsafeResolutionFiles
    };
  }
  return {
    allowed: true,
    identity: "history_preserving_feature_branch_main_sync",
    main_sha: mainSha,
    synchronized_file_count: normalizedChangedFiles.length,
    generated_resolution_files: novelResolutionFiles
  };
}
`;
  gate = replaceExactlyOnce(gate, insertionAnchor, classifier + insertionAnchor, 'classifier_insertion_anchor');

  const oldSync = `  const defaultBranchSync = options.headRef === "main"\n    && Boolean(options.baseRef)\n    && options.baseRef !== "Production";\n`;
  const newSync = `  const defaultBranchSynchronization = classifyDefaultBranchSynchronization({\n    root: options.root,\n    headRef: options.headRef,\n    baseRef: options.baseRef,\n    headSha: options.head,\n    baseSha: options.base,\n    changedFiles: report.changed_files\n  });\n  const defaultBranchSync = defaultBranchSynchronization.allowed;\n`;
  gate = replaceExactlyOnce(gate, oldSync, newSync, 'default_sync_anchor');

  const reportAnchor = `  report.phase_evaluation_base = phaseEvaluationBase;\n  writeAtomic(options.reportFile, report);`;
  const reportReplacement = `  report.phase_evaluation_base = phaseEvaluationBase;\n  report.default_branch_sync_identity = defaultBranchSynchronization.identity;\n  report.default_branch_sync_main_sha = defaultBranchSynchronization.main_sha || null;\n  report.default_branch_sync_unexpected_files = defaultBranchSynchronization.unexpected_files || [];\n  report.default_branch_sync_unsafe_resolution_files = defaultBranchSynchronization.unsafe_resolution_files || [];\n  report.default_branch_sync_generated_resolution_files = defaultBranchSynchronization.generated_resolution_files || [];\n  writeAtomic(options.reportFile, report);`;
  gate = replaceExactlyOnce(gate, reportAnchor, reportReplacement, 'report_anchor');
  fs.writeFileSync(gatePath, gate);
  record('gate_written=true');

  const testPath = 'http-generic-api/scripts/e2e-default-branch-sync-classification-self-test.mjs';
  let test = fs.readFileSync(testPath, 'utf8');
  const consoleAnchor = 'console.log(JSON.stringify({ ok: true, tests: 11, default_branch_sync: true, production_promotion_preserved: true, undeclared_feature_fail_closed: true, secrets_included: false }));';
  const scenarios = String.raw`run("git", ["checkout", "-b", "feature-target", baseSha], root);
run("git", ["merge", "--no-ff", "--no-edit", headSha], root);
const reconciliationSha = run("git", ["rev-parse", "HEAD"], root).trim();
const reconciliationReport = JSON.parse(run(process.execPath, [GATE, "--root", root, "--base", baseSha, "--head", reconciliationSha, "--head-ref", "gpt/reconcile/feature-target-main-sync", "--base-ref", "gpt/feature-target"], root));
assert.equal(reconciliationReport.ok, true, JSON.stringify(reconciliationReport.findings));
assert.equal(reconciliationReport.pr_mode, "default_branch_sync");
assert.equal(reconciliationReport.default_branch_sync_identity, "history_preserving_feature_branch_main_sync");
assert.equal(reconciliationReport.default_branch_sync_main_sha, headSha);
assert.deepEqual(reconciliationReport.default_branch_sync_unsafe_resolution_files, []);

run("git", ["checkout", "-b", "feature-target-with-extra", baseSha], root);
run("git", ["merge", "--no-ff", "--no-commit", headSha], root);
fs.writeFileSync(path.join(root, "http-generic-api", "scripts", "unrelated-reconciliation-extra.mjs"), "export const unrelated = true;\n");
run("git", ["add", "."], root);
run("git", ["commit", "-m", "unsafe reconciliation with unrelated file"], root);
const unsafeExtraSha = run("git", ["rev-parse", "HEAD"], root).trim();
const unsafeExtra = spawnSync(process.execPath, [GATE, "--root", root, "--base", baseSha, "--head", unsafeExtraSha, "--head-ref", "gpt/reconcile/feature-target-unsafe-extra", "--base-ref", "gpt/feature-target"], { cwd: root, encoding: "utf8" });
assert.notEqual(unsafeExtra.status, 0, JSON.stringify({ status: unsafeExtra.status, stdout: unsafeExtra.stdout, stderr: unsafeExtra.stderr }));
const unsafeExtraReport = JSON.parse(unsafeExtra.stdout);
assert.equal(unsafeExtraReport.pr_mode, "standard");
assert(unsafeExtraReport.findings.some((finding) => finding.code === "parallel_work_pr_branch_not_declared"));

run("git", ["checkout", "-b", "feature-target-with-tamper", baseSha], root);
run("git", ["merge", "--no-ff", "--no-commit", headSha], root);
fs.writeFileSync(path.join(root, gatePath), "export const version = 3;\n");
run("git", ["add", "."], root);
run("git", ["commit", "-m", "unsafe reconciliation with non-generated conflict resolution"], root);
const unsafeTamperSha = run("git", ["rev-parse", "HEAD"], root).trim();
const unsafeTamper = spawnSync(process.execPath, [GATE, "--root", root, "--base", baseSha, "--head", unsafeTamperSha, "--head-ref", "gpt/reconcile/feature-target-unsafe-tamper", "--base-ref", "gpt/feature-target"], { cwd: root, encoding: "utf8" });
assert.notEqual(unsafeTamper.status, 0, JSON.stringify({ status: unsafeTamper.status, stdout: unsafeTamper.stdout, stderr: unsafeTamper.stderr }));
const unsafeTamperReport = JSON.parse(unsafeTamper.stdout);
assert.equal(unsafeTamperReport.pr_mode, "standard");
assert.deepEqual(unsafeTamperReport.default_branch_sync_unsafe_resolution_files, [gatePath]);
assert(unsafeTamperReport.findings.some((finding) => finding.code === "parallel_work_pr_branch_not_declared"));

console.log(JSON.stringify({ ok: true, tests: 25, default_branch_sync: true, history_preserving_feature_branch_sync: true, unrelated_file_rejected: true, non_generated_conflict_resolution_rejected: true, production_promotion_preserved: true, undeclared_feature_fail_closed: true, secrets_included: false }));`;
  test = replaceExactlyOnce(test, consoleAnchor, scenarios, 'self_test_console_anchor');
  fs.writeFileSync(testPath, test);
  record('self_test_written=true');

  const contract = {
    $schema: '../../.specify/schemas/e2e-phases.schema.json',
    schema_version: 1,
    feature_key: 'e2e-history-preserving-feature-branch-main-sync',
    title: 'History-preserving feature-branch main synchronization classification',
    delivery_mode: 'single_pr',
    current_phase: 'mvp',
    scope: { include: [
      '.changes/e2e/e2e-history-preserving-feature-branch-main-sync.json',
      'http-generic-api/scripts/e2e-parallel-pr-gate.mjs',
      'http-generic-api/scripts/e2e-default-branch-sync-classification-self-test.mjs'
    ]},
    merge_contract: { minimum_phase: 'mvp' },
    phases: [{
      id: 'mvp', status: 'implemented',
      objective: 'Classify a non-protected feature-branch reconciliation as default-branch synchronization only when it is a current-main merge and its complete PR delta contains no unrelated path or ungoverned conflict resolution.',
      e2e_journeys: [{
        id: 'history-preserving-feature-branch-main-sync-classification',
        end_to_end: true,
        level: 'synthetic_runtime',
        actor: 'Repository governance runner',
        entrypoint: 'A gpt/reconcile helper PR targets a governed non-protected feature branch.',
        terminal_outcome: 'The helper is classified as bounded default-branch synchronization only when current-main parent topology, the main-delta file subset, and generated-conflict-resolution constraints all pass.',
        steps: [
          'Resolve the canonical current main commit and candidate merge parents.',
          'Require the candidate second parent to equal current main and the PR base to be an ancestor of the first parent.',
          'Compute the exact base-to-main delta and compare every PR-visible changed path against it.',
          'Compare candidate blobs with main and first-parent blobs to identify novel conflict resolutions.',
          'Allow novel resolutions only on registered generated Work Map, frontend-governance, and Spec binding artifacts.',
          'Reject unrelated paths and non-generated conflict-resolution tampering before phase execution is skipped.'
        ],
        assertions: [
          'Production and main remain forbidden helper targets.',
          'Only gpt/reconcile branches can use the feature-branch synchronization classifier.',
          'The merge has exactly two parents and its second parent is the canonical current main commit.',
          'The PR base is an ancestor of the merge first parent and final head.',
          'Every changed file is present in the exact base-to-main delta.',
          'A candidate blob differing from both main and the feature first parent is accepted only on bounded generated-artifact paths.',
          'An unrelated file or non-generated conflict resolution keeps the candidate in standard mode and fails closed.'
        ],
        tests: [{
          id: 'e2e-history-preserving-main-sync-classifier-regression',
          runner: 'node', working_directory: '.',
          path: 'http-generic-api/scripts/e2e-default-branch-sync-classification-self-test.mjs', args: []
        }],
        evidence_paths: [
          '.changes/e2e/e2e-history-preserving-feature-branch-main-sync.json',
          'http-generic-api/scripts/e2e-parallel-pr-gate.mjs',
          'http-generic-api/scripts/e2e-default-branch-sync-classification-self-test.mjs'
        ]
      }]
    }],
    secrets_included: false
  };
  const contractPath = '.changes/e2e/e2e-history-preserving-feature-branch-main-sync.json';
  fs.mkdirSync(path.dirname(contractPath), { recursive: true });
  fs.writeFileSync(contractPath, JSON.stringify(contract, null, 2) + '\n');
  record('contract_written=true');
  record('patch_ok=true');
} catch (error) {
  record('patch_ok=false');
  record(error?.stack || error?.message || String(error));
  if (diagnosticPath) fs.writeFileSync(diagnosticPath, diagnostic.join('\n') + '\n');
  throw error;
}

if (diagnosticPath) fs.writeFileSync(diagnosticPath, diagnostic.join('\n') + '\n');
