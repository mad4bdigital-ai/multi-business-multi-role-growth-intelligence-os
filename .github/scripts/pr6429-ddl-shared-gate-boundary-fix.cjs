const fs = require('node:fs');

const diagnostic = [];
const record = (value) => diagnostic.push(String(value));
const diagnosticPath = process.env.PATCH_DIAGNOSTIC_PATH;

function replaceExactlyOnce(source, marker, replacement, label) {
  const count = source.split(marker).length - 1;
  record(`${label}_count=${count}`);
  if (count !== 1) throw new Error(`${label} expected exactly once, found ${count}`);
  return source.replace(marker, replacement);
}

try {
  const workflowPath = '.github/workflows/hostinger-storage-durable-authorized-injection-schema-ddl-guard.yml';
  let workflow = fs.readFileSync(workflowPath, 'utf8');

  const boundaryStart = '          changed_files="$(git diff --name-only "${{ github.event.pull_request.base.sha }}" "${{ github.event.pull_request.head.sha }}")"\n';
  const boundaryEnd = "          grep -q 'CONTRACT-LOCAL DDL ONLY' \"${DDL_FILE}\"";
  const startIndex = workflow.indexOf(boundaryStart);
  const endIndex = workflow.indexOf(boundaryEnd, startIndex + boundaryStart.length);
  record(`boundary_start_index=${startIndex}`);
  record(`boundary_end_index=${endIndex}`);
  if (startIndex < 0 || endIndex < 0) throw new Error('boundary block anchors not found');

  const newBoundary = String.raw`          changed_files="$(git diff --name-only "${{ github.event.pull_request.base.sha }}" "${{ github.event.pull_request.head.sha }}")"
          allowed='^(\.changes/e2e/spec014-durable-authorized-injection-schema-ddl(-rollup-boundary)?\.json|\.github/contracts/spec014/hostinger-storage-durable-authorized-injection-state\.json|\.github/contracts/spec014/sql/hostinger-storage-durable-authorized-injection-state\.sql|\.github/workflows/hostinger-storage-durable-authorized-injection-schema-ddl-guard\.yml|http-generic-api/scripts/e2e-parallel-pr-gate\.mjs|http-generic-api/test-hostinger-storage-durable-authorized-injection-schema-ddl(-workflow)?\.mjs)$'
          contract_local='^(\.changes/e2e/spec014-durable-authorized-injection-schema-ddl(-rollup-boundary)?\.json|\.github/contracts/spec014/hostinger-storage-durable-authorized-injection-state\.json|\.github/contracts/spec014/sql/hostinger-storage-durable-authorized-injection-state\.sql|\.github/workflows/hostinger-storage-durable-authorized-injection-schema-ddl-guard\.yml|http-generic-api/test-hostinger-storage-durable-authorized-injection-schema-ddl(-workflow)?\.mjs)$'
          shared_gate='^http-generic-api/scripts/e2e-parallel-pr-gate\.mjs$'
          candidate_mode="${CANDIDATE_MODE:-feature}"
          boundary_mode='governed_rollup_or_release'
          [[ "${candidate_mode}" == "feature" || "${candidate_mode}" == "integration" || "${candidate_mode}" == "release" ]]
          if [[ "${candidate_mode}" == "feature" ]]; then
            contract_local_changes="$(printf '%s\n' "${changed_files}" | grep -E "${contract_local}" || true)"
            if [[ -n "${contract_local_changes}" ]]; then
              unexpected="$(printf '%s\n' "${changed_files}" | grep -Ev "${allowed}" || true)"
              [[ -z "${unexpected}" ]]
              ! printf '%s\n' "${changed_files}" | grep -E '(^|/)(migrations?|deploy|production|provider)(/|$)'
              ! printf '%s\n' "${changed_files}" | grep -E '^http-generic-api/(server\.js$|routes/)'
              boundary_mode='contract_local'
            else
              printf '%s\n' "${changed_files}" | grep -Eq "${shared_gate}"
              boundary_mode='shared_gate_dependency'
            fi
          fi
          echo "boundary_mode=${boundary_mode}" >> "${GITHUB_OUTPUT}"
`;
  workflow = workflow.slice(0, startIndex) + newBoundary + workflow.slice(endIndex);

  const envAnchor = '          BOUNDARY_OUTCOME: ${{ steps.boundary.outcome }}\n';
  const envReplacement = envAnchor + '          BOUNDARY_MODE: ${{ steps.boundary.outputs.boundary_mode }}\n';
  workflow = replaceExactlyOnce(workflow, envAnchor, envReplacement, 'boundary_mode_env_anchor');

  const candidateAnchor = "          candidate_mode = os.environ.get('CANDIDATE_MODE') or 'unknown'\n";
  const candidateReplacement = candidateAnchor + "          boundary_mode = os.environ.get('BOUNDARY_MODE') or 'unknown'\n";
  workflow = replaceExactlyOnce(workflow, candidateAnchor, candidateReplacement, 'candidate_mode_python_anchor');

  const modeValidation = "          if candidate_mode not in ('feature', 'integration', 'release'):\n            failed.insert(0, 'candidate_mode_invalid')\n";
  const modeReplacement = modeValidation + "          if candidate_mode == 'feature' and boundary_mode not in ('contract_local', 'shared_gate_dependency'):\n            failed.insert(0, 'boundary_mode_invalid')\n";
  workflow = replaceExactlyOnce(workflow, modeValidation, modeReplacement, 'boundary_mode_validation_anchor');

  const reportModeAnchor = "            'candidate_mode': candidate_mode,\n";
  const reportModeReplacement = reportModeAnchor + "            'boundary_mode': boundary_mode,\n";
  workflow = replaceExactlyOnce(workflow, reportModeAnchor, reportModeReplacement, 'boundary_mode_report_anchor');

  const featureScopeAnchor = "            'feature_scope_allowlist_enforced': candidate_mode == 'feature',\n";
  const featureScopeReplacement = "            'feature_scope_allowlist_enforced': candidate_mode == 'feature' and boundary_mode == 'contract_local',\n            'shared_gate_dependency_validated': candidate_mode == 'feature' and boundary_mode == 'shared_gate_dependency',\n";
  workflow = replaceExactlyOnce(workflow, featureScopeAnchor, featureScopeReplacement, 'feature_scope_report_anchor');
  fs.writeFileSync(workflowPath, workflow);
  record('workflow_written=true');

  const testPath = 'http-generic-api/test-hostinger-storage-durable-authorized-injection-schema-ddl-workflow.mjs';
  let test = fs.readFileSync(testPath, 'utf8');
  const testFeatureAnchor = "requireFragment(\"'feature_scope_allowlist_enforced': candidate_mode == 'feature'\", 'feature allowlist evidence');";
  const testFeatureReplacement = "requireFragment(\"'feature_scope_allowlist_enforced': candidate_mode == 'feature' and boundary_mode == 'contract_local'\", 'contract-local feature allowlist evidence');\nrequireFragment(\"'shared_gate_dependency_validated': candidate_mode == 'feature' and boundary_mode == 'shared_gate_dependency'\", 'shared gate dependency evidence');\nrequireFragment('BOUNDARY_MODE: ${{ steps.boundary.outputs.boundary_mode }}', 'boundary mode output binding');\nrequireFragment(\"boundary_mode='shared_gate_dependency'\", 'shared gate dependency classification');\nrequireFragment(\"boundary_mode='contract_local'\", 'contract-local classification');\nrequireFragment(\"grep -Eq \\\"${shared_gate}\\\"\", 'shared gate dependency exact-match check');";
  test = replaceExactlyOnce(test, testFeatureAnchor, testFeatureReplacement, 'workflow_test_feature_anchor');

  const boundaryRequireAnchor = "requireFragment('if [[ \"${candidate_mode}\" == \"feature\" ]]', 'feature-only diff allowlist enforcement');";
  const boundaryRequireReplacement = boundaryRequireAnchor + "\nrequireFragment(\"contract_local_changes=\\\"$(printf '%s\\\\n' \\\"${changed_files}\\\" | grep -E \\\"${contract_local}\\\" || true)\\\"\", 'contract-local change detection');";
  test = replaceExactlyOnce(test, boundaryRequireAnchor, boundaryRequireReplacement, 'workflow_test_boundary_anchor');
  fs.writeFileSync(testPath, test);
  record('workflow_test_written=true');

  const contractPath = '.changes/e2e/spec014-durable-authorized-injection-schema-ddl-rollup-boundary.json';
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  const journey = contract.phases[0].e2e_journeys[0];
  contract.phases[0].objective = 'Preserve strict focused-feature scope enforcement, allow governed Multi-PR Rollups, and validate changes to the shared E2E PR gate without attributing unrelated contract-covered files to the Hostinger DDL feature.';
  journey.terminal_outcome = 'The guard classifies candidate mode from governed evidence, distinguishes contract-local changes from shared-gate dependency validation, publishes exact identity and parity evidence, and rejects unsafe DDL or focused-feature scope expansion.';
  journey.steps = [
    'Read the governed Spec phase contract from the exact candidate tree.',
    'Classify Integration mode only when the PR targets main and the contract declares multi_pr, enabled parallel work, workstream_commits_then_e2e_rollup, and no partial feature merge.',
    'Run the canonical Module-to-DDL parity test and consume its structured result.',
    'Run a workflow regression proving read-only permissions, branch-neutral classification, exact identity routing, and separate Feature, shared-gate dependency, Integration, and Release modes.',
    'Enforce the narrow changed-file allowlist when any contract-local DDL guard file changes in a focused Feature PR.',
    'When the shared e2e-parallel-pr-gate is the only Hostinger DDL trigger, validate the shared dependency and DDL parity without applying the Hostinger-local allowlist to files governed by another E2E contract.',
    'Skip only the unrelated-file allowlist for an explicit shared-gate dependency or contract-governed Rollup while always enforcing contract-local, non-promotion, no-Apply, no-destructive-DDL, and no-provider checks.',
    'Publish exact head and merge-candidate identities, boundary mode, and shared dependency validation as separate structured fields.'
  ];
  journey.assertions = [
    'The permanent Workflow embeds no work-branch name.',
    'Rollup classification is derived from versioned phase-contract properties rather than branch, PR number, title, or changed-file-count heuristics.',
    'DDL parity is derived from the focused parity test rather than the aggregate stage list.',
    'Feature PRs that change a contract-local DDL guard file remain unable to modify unrelated Route, Server, migration, deployment, production, or provider paths.',
    'A Feature PR triggered only by the shared e2e-parallel-pr-gate records shared_gate_dependency and does not claim the unrelated files as Hostinger DDL scope.',
    'Contract-local DDL content, non-promotion, no-Apply, no-destructive-DDL, and no-provider checks always run in every boundary mode.',
    'The Workflow remains contents-read-only with persist-credentials disabled and no git push.',
    'No migration Apply, live database, provider, deployment, main mutation, or Production authority is granted.'
  ];
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
