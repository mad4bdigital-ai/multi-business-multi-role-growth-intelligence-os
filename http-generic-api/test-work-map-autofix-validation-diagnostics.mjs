#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(repoRoot, ".github", "workflows", "spec-kit-work-map-autofix.yml");
const workflow = fs.readFileSync(workflowPath, "utf8");

const initializationStart = workflow.indexOf("      - name: Initialize diagnostics and validate inputs");
const checkoutStart = workflow.indexOf("      - name: Checkout exact authorized head");
const validationStart = workflow.indexOf("      - name: Validate generator and governance contracts");
const generationStart = workflow.indexOf("      - name: Regenerate and prove idempotency");
assert.notEqual(initializationStart, -1, "diagnostic initialization step is missing");
assert.notEqual(checkoutStart, -1, "checkout step is missing");
assert.notEqual(validationStart, -1, "validation step is missing");
assert.notEqual(generationStart, -1, "generation step is missing");
assert.ok(checkoutStart > initializationStart, "checkout must follow input and diagnostic initialization");
assert.ok(validationStart > checkoutStart, "validation must follow checkout");
assert.ok(generationStart > validationStart, "validation step must precede generation");

const initializationBlock = workflow.slice(initializationStart, checkoutStart);
const validationBlock = workflow.slice(validationStart, generationStart);
const contractNames = [
  "syntax-platform-work-map-generator",
  "syntax-platform-work-map-schema-intelligence",
  "syntax-work-map-schema-classification",
  "syntax-work-map-schema-classification-contract",
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
assert.match(
  workflow,
  /path: \$\{\{ runner\.temp \}\}\/work-map-autofix-diagnostics-\$\{\{ github\.run_id \}\}/,
  "artifact upload must read the checkout-safe diagnostic directory",
);
assert.match(workflow, /if-no-files-found: error/);

assert.match(validationBlock, /run_contract\(\) \{/);
assert.match(validationBlock, /failed-validation-contract\.txt/);
assert.match(validationBlock, /failed-validation-exit-code\.txt/);
assert.match(validationBlock, /validation-results\.tsv/);

for (const contractName of contractNames) {
  const escaped = contractName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(
    validationBlock,
    new RegExp(`run_contract "${escaped}"`),
    `missing named validation contract: ${contractName}`,
  );
}

const invocations = validationBlock.match(/^\s*run_contract "/gm) ?? [];
assert.equal(invocations.length, contractNames.length, "unexpected number of named validation contracts");

assert.match(workflow, /\| Failed validation contract \| \\`\$\{failed_validation_contract\}\\` \|/);
assert.match(workflow, /\| Failed validation exit code \| \\`\$\{failed_validation_exit_code\}\\` \|/);
assert.match(workflow, /--arg failed_validation_contract "\$\{failed_validation_contract\}"/);
assert.match(workflow, /--arg failed_validation_exit_code "\$\{failed_validation_exit_code\}"/);
assert.match(workflow, /failed_validation_contract:\$failed_validation_contract/);
assert.match(workflow, /failed_validation_exit_code:\$failed_validation_exit_code/);
assert.match(workflow, /failed_validation_contract=\$\{failed_validation_contract\}/);
assert.match(workflow, /failed_validation_exit_code=\$\{failed_validation_exit_code\}/);
assert.match(workflow, /if: always\(\)[\s\S]*actions\/upload-artifact@v4/);

assert.doesNotMatch(validationBlock, /git push/);
assert.doesNotMatch(validationBlock, /--force/);
assert.doesNotMatch(validationBlock, /platform-work-map-generator\.mjs --write/);

console.log("Work Map Autofix validation diagnostics regression passed.");
