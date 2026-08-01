#!/usr/bin/env node

import assert from "node:assert/strict";
import { evaluateRepositoryToolLifecycle } from "./maintenance-tools/repository-tool-lifecycle-guard.mjs";

const policy = {
  tool_root: "http-generic-api/scripts/maintenance-tools",
  forbidden_path_patterns: [
    "(^|/)\\.changes/e2e/.*trigger$",
    "(^|/).*\\.trigger$",
    "^\\.github/workflows/.*(?:temporary|one-off|patch-trigger|runtime-hardening-v[0-9]+).*$",
  ],
  tools: {
    guard: {
      entrypoint: "http-generic-api/scripts/maintenance-tools/repository-tool-lifecycle-guard.mjs",
    },
  },
};

async function evaluate(entries, contents = {}) {
  return evaluateRepositoryToolLifecycle({
    policy,
    entries,
    readText: async (path) => contents[path] || "",
  });
}

const branchSpecificWorkflow = ".github/workflows/apply-runtime-hardening-v3.yml";
const branchSpecificFindings = await evaluate(
  [{ status: "A", path: branchSpecificWorkflow }],
  {
    [branchSpecificWorkflow]: `
on:
  pull_request:
permissions:
  contents: write
jobs:
  apply:
    steps:
      - run: git push origin HEAD:gpt/example-work-branch
`,
  },
);
assert(branchSpecificFindings.some((item) => item.code === "TEMPORARY_AUTOMATION_ARTIFACT"));
assert(branchSpecificFindings.some((item) => item.code === "BRANCH_SPECIFIC_WORKFLOW"));
assert(branchSpecificFindings.some((item) => item.code === "PULL_REQUEST_WRITE_WORKFLOW"));
assert(branchSpecificFindings.some((item) => item.code === "UNGUARDED_AUTOMATION_MUTATION"));
assert(branchSpecificFindings.some((item) => item.code === "MISSING_EXPECTED_HEAD_GUARD"));

const triggerFindings = await evaluate([
  { status: "A", path: ".changes/e2e/.runtime-patch-trigger" },
]);
assert(triggerFindings.some((item) => item.code === "TEMPORARY_AUTOMATION_ARTIFACT"));

const unregisteredToolFindings = await evaluate([
  { status: "A", path: "http-generic-api/scripts/maintenance-tools/unregistered.mjs" },
]);
assert(unregisteredToolFindings.some((item) => item.code === "UNREGISTERED_MAINTENANCE_TOOL"));

const selfDeletingWorkflow = ".github/workflows/governed-maintenance.yml";
const selfDeletingFindings = await evaluate(
  [{ status: "A", path: selfDeletingWorkflow }],
  {
    [selfDeletingWorkflow]: `
on:
  workflow_dispatch:
permissions:
  contents: write
jobs:
  apply:
    steps:
      - run: |
          test "$(git rev-parse HEAD)" = "${{ inputs.expected_head_sha }}"
          case "${{ inputs.target_branch }}" in main|Production) exit 1;; esac
          rm .github/workflows/governed-maintenance.yml
          git push origin HEAD:"${{ inputs.target_branch }}"
`,
  },
);
assert(selfDeletingFindings.some((item) => item.code === "SELF_DELETING_WORKFLOW"));

const compliantWorkflow = ".github/workflows/governed-branch-maintenance.yml";
const compliantFindings = await evaluate(
  [
    { status: "A", path: compliantWorkflow },
    {
      status: "A",
      path: "http-generic-api/scripts/maintenance-tools/repository-tool-lifecycle-guard.mjs",
    },
  ],
  {
    [compliantWorkflow]: `
on:
  workflow_dispatch:
    inputs:
      target_branch:
        required: true
      expected_head_sha:
        required: true
permissions:
  contents: write
jobs:
  apply:
    steps:
      - run: |
          test "$(git rev-parse HEAD)" = "${{ inputs.expected_head_sha }}"
          case "${{ inputs.target_branch }}" in main|Production) echo reject; exit 1;; esac
          git push origin HEAD:"${{ inputs.target_branch }}"
`,
  },
);
assert.deepEqual(compliantFindings, []);

console.log("repository tool lifecycle guard tests passed");
