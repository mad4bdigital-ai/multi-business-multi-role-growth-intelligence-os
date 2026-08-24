#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(repoRoot, ".github", "workflows", "spec-kit-work-map-autofix.yml");
const workflow = fs.readFileSync(workflowPath, "utf8");

const initializationStart = workflow.indexOf("      - name: Initialize diagnostics and validate inputs");
const trustedIdentityStart = workflow.indexOf("      - name: Require trusted follow-up writer identity");
const checkoutStart = workflow.indexOf("      - name: Checkout exact authorized head");
const validationStart = workflow.indexOf("      - name: Validate generator and governance contracts");
const generationStart = workflow.indexOf("      - name: Regenerate and prove idempotency");
assert.notEqual(initializationStart, -1, "diagnostic initialization step is missing");
assert.notEqual(trustedIdentityStart, -1, "trusted follow-up writer identity preflight is missing");
assert.notEqual(checkoutStart, -1, "checkout step is missing");
assert.notEqual(validationStart, -1, "validation step is missing");
assert.notEqual(generationStart, -1, "generation step is missing");
assert.ok(trustedIdentityStart > initializationStart, "trusted identity validation must follow input and diagnostic initialization");
assert.ok(checkoutStart > trustedIdentityStart, "checkout must follow the trusted identity preflight");
assert.ok(validationStart > checkoutStart, "validation must follow checkout");
assert.ok(generationStart > validationStart, "validation step must precede generation");

const initializationBlock = workflow.slice(initializationStart, checkoutStart);
const trustedIdentityBlock = workflow.slice(trustedIdentityStart, checkoutStart);
const checkoutBlock = workflow.slice(checkoutStart, workflow.indexOf("      - name: Set up Node.js 22", checkoutStart));
const validationBlock = workflow.slice(validationStart, generationStart);
const contractNames = [
  "syntax-platform-work-map-generator",
  "syntax-platform-work-map-schema-intelligence",
  "syntax-work-map-schema-classification",
  "syntax-work-map-schema-classification-contract",
  "syntax-spec014-final-work-map-binding",
  "spec014-final-work-map-binding-regression",
  "work-map-autofix-spec014-binding-convergence-regression",
  "work-map-autofix-registry-refresh-scope-regression",
  "syntax-pipeline-connectivity-check",
  "pipeline-connectivity-check",
  "pipeline-connectivity-regression",
  "schema-classification-contract",
  "schema-classification",
  "schema-classification-regression",
  "schema-classification-contract-regression",
];

assert.match(
  initializationBlock,
  /diagnostic_root="\$\{RUNNER_TEMP\}\/work-map-autofix-diagnostics-\$\{GITHUB_RUN_ID\}"/,
  "diagnostics must live outside GITHUB_WORKSPACE so checkout cannot remove them",
);
assert.doesNotMatch(initializationBlock, /GITHUB_WORKSPACE.*work-map-autofix-diagnostics/);
assert.match(trustedIdentityBlock, /REPO_AUTOSYNC_TOKEN_PRESENT: \$\{\{ secrets\.REPO_AUTOSYNC_TOKEN != '' \}\}/);
assert.match(trustedIdentityBlock, /instead of action_required/, "missing trusted credentials must explain the blocked-CI failure mode");
assert.match(checkoutBlock, /token: \$\{\{ secrets\.REPO_AUTOSYNC_TOKEN \}\}/, "the bounded Work Map branch push must use the trusted identity");
assert.doesNotMatch(checkoutBlock, /secrets\.GITHUB_TOKEN/, "Work Map branch push must not silently fall back to the recursion-suppressed bot token");
assert.ok(
  initializationBlock.includes('git check-ref-format --branch "${TARGET_BRANCH}"'),
  "target branch must be validated with git check-ref-format",
);
assert.ok(
  initializationBlock.includes('[[ "${TARGET_BRANCH}" != refs/* ]]'),
  "workflow input must be a branch name rather than a full refs path",
);
assert.ok(
  initializationBlock.includes('[[ "${TARGET_BRANCH}" != "main" && "${TARGET_BRANCH}" != "Production" ]]'),
  "protected branches must remain explicitly rejected",
);
assert.ok(
  !initializationBlock.includes('^(gpt|cert|fix|feat|chore|docs|release)'),
  "permanent workflow must not embed a work-branch namespace allowlist",
);
assert.match(
  workflow,
  /path: \$\{\{ runner\.temp \}\}\/work-map-autofix-diagnostics-\$\{\{ github\.run_id \}\}/,
  "artifact upload must read the checkout-safe diagnostic directory",
);
assert.match(workflow, /if-no-files-found: error/);

assert.match(validationBlock, /run_contract\(\) \{/);
assert.match(validationBlock, /validation-\$\{contract_name\}\.log/);
assert.match(validationBlock, /"\$@" >"\$\{log_file\}" 2>&1/);
assert.match(validationBlock, /cat "\$\{log_file\}"/);
assert.match(validationBlock, /failed-validation-contract\.txt/);
assert.match(validationBlock, /failed-validation-exit-code\.txt/);
assert.match(validationBlock, /failed-validation-contracts\.tsv/);
assert.match(validationBlock, /validation-results\.tsv/);
assert.match(validationBlock, /validation-summary\.md/);
assert.match(validationBlock, /if \[\[ ! -s "\$\{failed_contract_file\}" \]\]; then/);
assert.match(validationBlock, /return 0/);
assert.doesNotMatch(validationBlock, /return "\$\{exit_code\}"/);
assert.match(validationBlock, /failed_count=.*awk/);
assert.match(validationBlock, /All validation contracts were evaluated before this fail-closed gate stopped generation/);
assert.match(validationBlock, /exit 1/);

for (const contractName of contractNames) {
  const escaped = contractName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(
    validationBlock,
    new RegExp(`run_contract "${escaped}"`),
    `missing named validation contract: ${contractName}`,
  );
}

const invocationNames = [...validationBlock.matchAll(/^\s*run_contract "([^"]+)"/gm)].map((match) => match[1]);
assert.ok(invocationNames.length >= contractNames.length, "named validation contract baseline must not shrink");
assert.equal(new Set(invocationNames).size, invocationNames.length, "named validation contracts must be unique");
assert.ok(
  invocationNames.every((name) => /^[a-z0-9][a-z0-9-]*$/.test(name)),
  "named validation contracts must use stable machine-safe identifiers",
);

assert.match(workflow, /\| Failed validation contract \| \\`\$\{failed_validation_contract\}\\` \|/);
assert.match(workflow, /\| Failed validation exit code \| \\`\$\{failed_validation_exit_code\}\\` \|/);
assert.match(workflow, /\| Failed validation contracts count \| \\`\$\{failed_validation_contracts_count\}\\` \|/);
assert.match(workflow, /\| Failed validation contracts \| \\`\$\{failed_validation_contracts\}\\` \|/);
assert.match(workflow, /--arg failed_validation_contracts_count "\$\{failed_validation_contracts_count\}"/);
assert.match(workflow, /--arg failed_validation_contracts "\$\{failed_validation_contracts\}"/);
assert.match(workflow, /failed_validation_contracts_count:\(\$failed_validation_contracts_count\|tonumber\)/);
assert.match(workflow, /failed_validation_contracts:\$failed_validation_contracts/);
assert.match(workflow, /failed_validation_contracts_count=\$\{failed_validation_contracts_count\}/);
assert.match(workflow, /failed_validation_contracts=\$\{failed_validation_contracts\}/);
assert.match(workflow, /if: always\(\)[\s\S]*actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4/);

assert.doesNotMatch(validationBlock, /git push/);
assert.doesNotMatch(validationBlock, /--force/);
assert.doesNotMatch(validationBlock, /platform-work-map-generator\.mjs --write/);

console.log("Work Map Autofix complete failure-set diagnostics regression passed.");
