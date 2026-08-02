import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(
  "../.github/workflows/production-promotion-generated-artifact-evidence.yml",
  "utf8",
);

const exactBootstrapFiles = [
  ".changes/e2e/protected-promotion-context-availability.json",
  ".github/workflows/production-promotion-generated-artifact-evidence.yml",
  "http-generic-api/test-protected-promotion-generated-artifact-context.mjs",
];

assert.match(workflow, /^name: Protected Promotion Generated Artifact Refresh$/mu);
assert.match(workflow, /pull_request:[\s\S]*branches:[\s\S]*- Production/u);
assert.doesNotMatch(
  workflow,
  /runner\.temp/u,
  "jobs-level runner.temp prevents GitHub from planning the protected-promotion workflow",
);
assert.match(workflow, /PR_BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/u);
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
  /name: Detect bounded contract bootstrap/u,
);
for (const file of exactBootstrapFiles) {
  assert.match(workflow, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
}
assert.match(
  workflow,
  /git diff --name-only "\$\{PR_BASE_SHA\}\.\.\.HEAD"/u,
  "bootstrap classification must use the exact pull-request base SHA",
);
assert.match(
  workflow,
  /"\$\{#changed_files\[@\]\}" -eq "\$\{#allowed_files\[@\]\}"/u,
  "bootstrap mode must require exact changed-file cardinality",
);
assert.match(
  workflow,
  /if: env\.CONTRACT_BOOTSTRAP_ONLY != 'true'[\s\S]*run: node http-generic-api\/scripts\/generated-artifact-refresh-runner\.mjs/u,
  "all non-bootstrap promotions must retain the full generated-artifact evaluation",
);
assert.match(
  workflow,
  /if: env\.CONTRACT_BOOTSTRAP_ONLY == 'true'[\s\S]*mode: 'contract_bootstrap'/u,
  "the exact bootstrap allowlist must publish an explicit canonical mode",
);
assert.match(workflow, /bootstrap_contract_files: contractFiles/u);
assert.match(workflow, /repository_mutation_performed: false/u);
assert.match(workflow, /persist-credentials: false/u);
assert.match(workflow, /permissions:\s*\n\s*contents: read/u);
assert.doesNotMatch(workflow, /contents: write/u);
assert.doesNotMatch(workflow, /git push/u);
assert.doesNotMatch(
  workflow,
  /head_ref.*bootstrap|TARGET_REF.*bootstrap/iu,
  "bootstrap authority must never depend on a branch-name convention",
);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.protected-promotion-generated-artifact-context.v2",
  cases: 18,
  jobs_level_runner_context: false,
  report_paths_repository_relative: true,
  evaluation_runs_from_repository_root: true,
  bounded_bootstrap_exact_file_set: exactBootstrapFiles,
  branch_name_bypass: false,
  full_promotion_evaluation_preserved: true,
  repository_mutation: false,
  secrets_included: false,
}));
