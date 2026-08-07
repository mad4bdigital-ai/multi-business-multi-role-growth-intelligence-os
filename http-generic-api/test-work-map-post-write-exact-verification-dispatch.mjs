import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ciWorkflow = readFileSync("../.github/workflows/ci.yml", "utf8");
const integrationWorkflow = readFileSync("../.github/workflows/spec-kit-work-map-integration.yml", "utf8");
const writerWorkflow = readFileSync("../.github/workflows/spec-kit-work-map-autofix.yml", "utf8");

for (const snippet of [
  "actions/workflows/ci.yml/dispatches",
  "actions/workflows/spec-kit-work-map-integration.yml/dispatches",
  "actions/workflows/${workflow}/enable",
  "dispatch-ci.stderr",
  "dispatch-work-map-integration.stderr",
  ".head_sha ==",
  "${RESULT_HEAD_SHA}",
  "ci_run_id=${ci_run_id}",
  "integration_run_id=${integration_run_id}",
  "WORK_MAP_AUTOFIX_V3",
]) {
  assert.ok(writerWorkflow.includes(snippet), `Writer dispatch contract missing: ${snippet}`);
}

assert.doesNotMatch(
  writerWorkflow,
  /gh workflow run (?:ci\.yml|spec-kit-work-map-integration\.yml)/u,
  "The writer must use observable REST dispatches instead of opaque gh workflow run calls.",
);
assert.match(
  writerWorkflow,
  /test "\$\{remote_head_sha\}" = "\$\{RESULT_HEAD_SHA\}"/u,
  "The writer must read back the committed branch head before verification dispatch.",
);
assert.match(writerWorkflow, /ci_payload[^\n]*\{ref:\$ref\}/u);
assert.match(writerWorkflow, /integration_payload[^\n]*\{ref:\$ref\}/u);
assert.match(writerWorkflow, /new Date\(Date\.now\(\) - 5000\)/u);
assert.match(writerWorkflow, /\[\[ "\$\{ci_run_id\}" =~ \^\[1-9\]\[0-9\]\*\$ \]\]/u);
assert.match(writerWorkflow, /\[\[ "\$\{integration_run_id\}" =~ \^\[1-9\]\[0-9\]\*\$ \]\]/u);

const exactCiCheckout = "ref: ${{ github.event.pull_request.head.sha || github.sha }}";
assert.equal(
  ciWorkflow.split(exactCiCheckout).length - 1,
  4,
  "Every load-bearing CI job must check out the exact PR head or workflow-dispatch event SHA.",
);
assert.ok(
  ciWorkflow.includes('DEPLOYMENT_COMMIT_SHA: "${{ github.event.pull_request.head.sha || github.sha }}"'),
  "Deployment evidence must bind to the same exact CI identity.",
);

assert.ok(
  integrationWorkflow.includes("EXPECTED_CHECKED_OUT_SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}"),
  "Work Map Integration must bind workflow_dispatch verification to the event head SHA.",
);
assert.ok(integrationWorkflow.includes("ref: ${{ env.EXPECTED_CHECKED_OUT_SHA }}"));
assert.ok(integrationWorkflow.includes("Resolve exact workflow-dispatch pull request identity"));
assert.ok(integrationWorkflow.includes('test "$(jq -r \' .[0].head.sha\' "${pr_file}")" = "${EXPECTED_CHECKED_OUT_SHA}"'.replace("' .", "'.")));
assert.ok(integrationWorkflow.includes('test "$(jq -r \' .[0].head.repo.full_name\' "${pr_file}")" = "${GITHUB_REPOSITORY}"'.replace("' .", "'.")));
assert.doesNotMatch(
  integrationWorkflow,
  /WORK_MAP_REPAIR_ROOT:\s*\$\{\{\s*runner\.temp/u,
  "Work Map Integration must not use runner.temp in job-level env.",
);
assert.ok(integrationWorkflow.includes('repair_root="${RUNNER_TEMP}/work-map-repair-candidate"'));
assert.ok(integrationWorkflow.includes('path: ${{ runner.temp }}/work-map-repair-candidate'));

console.log("Work Map post-write exact verification dispatch contract tests passed");
