import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(
  "../.github/workflows/production-promotion-generated-artifact-evidence.yml",
  "utf8",
);

assert.match(workflow, /^name: Protected Promotion Generated Artifact Refresh$/mu);
assert.match(workflow, /pull_request:[\s\S]*branches:[\s\S]*- Production/u);
assert.doesNotMatch(
  workflow,
  /runner\.temp/u,
  "jobs-level runner.temp prevents GitHub from planning the protected-promotion workflow",
);
assert.match(
  workflow,
  /REPORT_PATH: \.ci-evidence\/production-promotion-generated-artifact-evidence\/pr-generated-artifact-refresh-summary\.json/u,
);
assert.match(
  workflow,
  /REPORT_MARKDOWN_PATH: \.ci-evidence\/production-promotion-generated-artifact-evidence\/pr-generated-artifact-refresh-summary\.md/u,
);
assert.match(
  workflow,
  /run: node http-generic-api\/scripts\/generated-artifact-refresh-runner\.mjs/u,
  "the evaluator must run from repository root so report creation and artifact upload resolve the same paths",
);
assert.match(workflow, /persist-credentials: false/u);
assert.match(workflow, /permissions:\s*\n\s*contents: read/u);
assert.doesNotMatch(workflow, /contents: write/u);
assert.doesNotMatch(workflow, /git push/u);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.protected-promotion-generated-artifact-context.v1",
  cases: 10,
  jobs_level_runner_context: false,
  report_paths_repository_relative: true,
  evaluation_runs_from_repository_root: true,
  repository_mutation: false,
  secrets_included: false,
}));
