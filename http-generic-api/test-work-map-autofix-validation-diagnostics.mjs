#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(repoRoot, ".github", "workflows", "spec-kit-work-map-autofix.yml");
const workflow = fs.readFileSync(workflowPath, "utf8");

const validationStart = workflow.indexOf("      - name: Validate generator and governance contracts");
const generationStart = workflow.indexOf("      - name: Regenerate and prove idempotency");
assert.notEqual(validationStart, -1, "validation step is missing");
assert.notEqual(generationStart, -1, "generation step is missing");
assert.ok(generationStart > validationStart, "validation step must precede generation");

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

assert.match(validationBlock, /run_contract\(\) \{/);
assert.match(validationBlock, /failed-validation-contract\.txt/);
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
assert.match(workflow, /--arg failed_validation_contract "\$\{failed_validation_contract\}"/);
assert.match(workflow, /failed_validation_contract:\$failed_validation_contract/);
assert.match(workflow, /failed_validation_contract=\$\{failed_validation_contract\}/);
assert.match(workflow, /if: always\(\)[\s\S]*actions\/upload-artifact@v4/);

assert.doesNotMatch(validationBlock, /git push/);
assert.doesNotMatch(validationBlock, /--force/);
assert.doesNotMatch(validationBlock, /platform-work-map-generator\.mjs --write/);

console.log("Work Map Autofix validation diagnostics regression passed.");
