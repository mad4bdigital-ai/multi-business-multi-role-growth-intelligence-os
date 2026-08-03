#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  evaluateRepositoryToolLifecycle,
  validateGovernanceInputs,
} from "./maintenance-tools/repository-tool-lifecycle-guard.mjs";

const REPORT_CONTRACT = "mad4b.repository-tool-lifecycle-report.v1";
const GUARD_ENTRYPOINT = "http-generic-api/scripts/maintenance-tools/repository-tool-lifecycle-guard.mjs";

const policy = {
  contract: "mad4b.repository-maintenance-tool-governance.v1",
  canonical_report_contract: REPORT_CONTRACT,
  protected_branches: ["main", "Production"],
  tool_root: "http-generic-api/scripts/maintenance-tools",
  forbidden_path_patterns: [
    "(^|/)\\.changes/e2e/.*trigger$",
    "(^|/).*\\.trigger$",
    "^\\.github/workflows/.*(?:temporary|one-off|(?:^|[/_.-])once(?:[/_.-]|$)|patch-trigger|runtime-hardening-v[0-9]+).*$",
  ],
  rules: {
    one_off_automation_must_not_merge: true,
    reusable_tools_must_be_registered: true,
    branch_specific_workflow_literals_forbidden: true,
    pull_request_workflows_must_not_write_contents: true,
    workflow_self_deletion_forbidden: true,
    force_push_forbidden: true,
    expected_head_sha_required_for_mutation: true,
    protected_branch_mutation_forbidden: true,
    canonical_report_required: true,
    job_logs_are_diagnostic_only: true,
  },
  tools: {
    "repository-tool-lifecycle-guard": {
      entrypoint: GUARD_ENTRYPOINT,
      mode: "read_only",
      allowed_changed_path_patterns: [],
      report_contract: REPORT_CONTRACT,
    },
  },
};

async function evaluate(entries, contents = {}, selectedPolicy = policy) {
  return evaluateRepositoryToolLifecycle({
    policy: selectedPolicy,
    entries,
    readText: async (path) => contents[path] || "",
  });
}

const validIdentity = validateGovernanceInputs({
  policy,
  candidateSha: "a".repeat(40),
  baseSha: "b".repeat(40),
});
assert.deepEqual(validIdentity, []);

const invalidIdentity = validateGovernanceInputs({
  policy: { ...policy, canonical_report_contract: "mad4b.wrong.v1" },
  candidateSha: "short",
  baseSha: null,
});
assert(invalidIdentity.some((item) => item.code === "REPORT_CONTRACT_MISMATCH"));
assert(invalidIdentity.some((item) => item.code === "INVALID_CANDIDATE_SHA"));
assert(invalidIdentity.some((item) => item.code === "INVALID_BASE_SHA"));

const disabledRuleFindings = validateGovernanceInputs({
  policy: {
    ...policy,
    rules: { ...policy.rules, force_push_forbidden: false },
  },
  candidateSha: "a".repeat(40),
  baseSha: "b".repeat(40),
});
assert(disabledRuleFindings.some((item) => item.code === "MANDATORY_RULE_DISABLED"));

const removedGuardFindings = validateGovernanceInputs({
  policy: { ...policy, tools: {} },
  candidateSha: "a".repeat(40),
  baseSha: "b".repeat(40),
});
assert(removedGuardFindings.some((item) => item.code === "INVALID_GUARD_REGISTRATION"));

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

const multilineBranchWorkflow = ".github/workflows/branch-bound.yml";
const multilineBranchFindings = await evaluate(
  [{ status: "A", path: multilineBranchWorkflow }],
  {
    [multilineBranchWorkflow]: `
on:
  push:
    branches:
      - gpt/example-work-branch
permissions:
  contents: read
`,
  },
);
assert(multilineBranchFindings.some((item) => item.code === "BRANCH_SPECIFIC_WORKFLOW"));

const repositoryPathWorkflow = ".github/workflows/repository-path-filter.yml";
const repositoryPathFindings = await evaluate(
  [{ status: "A", path: repositoryPathWorkflow }],
  {
    [repositoryPathWorkflow]: `
on:
  pull_request:
    paths:
      - "docs/work-maps/**"
      - "feat/example/**"
permissions:
  contents: read
`,
  },
);
assert(!repositoryPathFindings.some((item) => item.code === "BRANCH_SPECIFIC_WORKFLOW"));

const repositoryShellPathWorkflow = ".github/workflows/repository-shell-path.yml";
const repositoryShellPathFindings = await evaluate(
  [{ status: "A", path: repositoryShellPathWorkflow }],
  {
    [repositoryShellPathWorkflow]: `
on:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  inspect:
    steps:
      - run: |
          git diff --name-only | grep -v '^docs/work-maps/'
          git add docs/work-maps
`,
  },
);
assert(!repositoryShellPathFindings.some((item) => item.code === "BRANCH_SPECIFIC_WORKFLOW"));

const docsBranchContextWorkflow = ".github/workflows/docs-branch-context.yml";
const docsBranchContextFindings = await evaluate(
  [{ status: "A", path: docsBranchContextWorkflow }],
  {
    [docsBranchContextWorkflow]: `
on:
  workflow_dispatch:
env:
  TARGET_BRANCH: docs/example-work-branch
permissions:
  contents: read
`,
  },
);
assert(docsBranchContextFindings.some((item) => item.code === "BRANCH_SPECIFIC_WORKFLOW"));

const triggerFindings = await evaluate([
  { status: "A", path: ".changes/e2e/.runtime-patch-trigger" },
]);
assert(triggerFindings.some((item) => item.code === "TEMPORARY_AUTOMATION_ARTIFACT"));

const oneShotWorkflow = ".github/workflows/apply-tenant-request-runtime-once.yml";
const oneShotFindings = await evaluate(
  [{ status: "A", path: oneShotWorkflow }],
  {
    [oneShotWorkflow]: `
on:
  workflow_dispatch:
permissions:
  contents: read
`,
  },
);
assert(oneShotFindings.some((item) => item.code === "TEMPORARY_AUTOMATION_ARTIFACT"));

const baselinePatternFindings = await evaluate(
  [{ status: "A", path: oneShotWorkflow }],
  { [oneShotWorkflow]: "on:\n  workflow_dispatch:\n" },
  { ...policy, forbidden_path_patterns: [] },
);
assert(baselinePatternFindings.some((item) => item.code === "TEMPORARY_AUTOMATION_ARTIFACT"));

const deletionFindings = await evaluate([
  { status: "D", path: oneShotWorkflow },
  { status: "D", path: ".changes/e2e/.runtime-patch-trigger" },
]);
assert.deepEqual(deletionFindings, []);

const unregisteredToolFindings = await evaluate([
  { status: "A", path: "http-generic-api/scripts/maintenance-tools/unregistered.mjs" },
]);
assert(unregisteredToolFindings.some((item) => item.code === "UNREGISTERED_MAINTENANCE_TOOL"));

const unsafeReadOnlyTool = "http-generic-api/scripts/maintenance-tools/unsafe-read-only.mjs";
const unsafeReadOnlyPolicy = {
  ...policy,
  tools: {
    ...policy.tools,
    "unsafe-read-only": {
      entrypoint: unsafeReadOnlyTool,
      mode: "read_only",
      allowed_changed_path_patterns: [],
      report_contract: REPORT_CONTRACT,
    },
  },
};
const unsafeReadOnlyFindings = await evaluate(
  [{ status: "A", path: unsafeReadOnlyTool }],
  { [unsafeReadOnlyTool]: "git push --force origin HEAD:unsafe\n" },
  unsafeReadOnlyPolicy,
);
assert(unsafeReadOnlyFindings.some((item) => item.code === "READ_ONLY_TOOL_MUTATION"));
assert(unsafeReadOnlyFindings.some((item) => item.code === "FORCE_PUSH_AUTOMATION"));

const unguardedMutatingTool = "http-generic-api/scripts/maintenance-tools/unguarded-mutator.mjs";
const mutatingPolicy = {
  ...policy,
  tools: {
    ...policy.tools,
    "unguarded-mutator": {
      entrypoint: unguardedMutatingTool,
      mode: "mutating",
      allowed_changed_path_patterns: ["^docs/"],
      report_contract: REPORT_CONTRACT,
    },
  },
};
const mutatingToolFindings = await evaluate(
  [{ status: "A", path: unguardedMutatingTool }],
  { [unguardedMutatingTool]: "git push origin HEAD:work\n" },
  mutatingPolicy,
);
assert(mutatingToolFindings.some((item) => item.code === "MISSING_EXPECTED_HEAD_GUARD"));
assert(mutatingToolFindings.some((item) => item.code === "MISSING_PROTECTED_BRANCH_GUARD"));

const writeAllWorkflow = ".github/workflows/write-all-pr.yml";
const writeAllFindings = await evaluate(
  [{ status: "A", path: writeAllWorkflow }],
  {
    [writeAllWorkflow]: `
on:
  pull_request:
permissions: write-all
jobs:
  inspect:
    runs-on: ubuntu-latest
    steps:
      - run: echo inspect
`,
  },
);
assert(writeAllFindings.some((item) => item.code === "PULL_REQUEST_WRITE_WORKFLOW"));

const externalTokenWorkflow = ".github/workflows/external-token-push.yml";
const externalTokenFindings = await evaluate(
  [{ status: "A", path: externalTokenWorkflow }],
  {
    [externalTokenWorkflow]: `
on:
  push:
permissions:
  contents: read
jobs:
  apply:
    steps:
      - env:
          TOKEN: secret
        run: git push origin HEAD:work
`,
  },
);
assert(externalTokenFindings.some((item) => item.code === "UNGUARDED_AUTOMATION_MUTATION"));
assert(externalTokenFindings.some((item) => item.code === "MISSING_EXPECTED_HEAD_GUARD"));
assert(externalTokenFindings.some((item) => item.code === "MISSING_PROTECTED_BRANCH_GUARD"));

const apiMutationWorkflow = ".github/workflows/api-mutation.yml";
const apiMutationFindings = await evaluate(
  [{ status: "A", path: apiMutationWorkflow }],
  {
    [apiMutationWorkflow]: `
on:
  workflow_dispatch:
permissions:
  contents: write
jobs:
  apply:
    steps:
      - run: gh api repos/example/repo/git/refs/heads/work --method PATCH -f sha=abc
`,
  },
);
assert(apiMutationFindings.some((item) => item.code === "MISSING_EXPECTED_HEAD_GUARD"));
assert(apiMutationFindings.some((item) => item.code === "MISSING_PROTECTED_BRANCH_GUARD"));

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
          test "$(git rev-parse HEAD)" = "\${{ inputs.expected_head_sha }}"
          case "\${{ inputs.target_branch }}" in main|Production) exit 1;; esac
          rm .github/workflows/governed-maintenance.yml
          git push origin HEAD:"\${{ inputs.target_branch }}"
`,
  },
);
assert(selfDeletingFindings.some((item) => item.code === "SELF_DELETING_WORKFLOW"));

const compliantWorkflow = ".github/workflows/governed-branch-maintenance.yml";
const compliantFindings = await evaluate(
  [{ status: "A", path: compliantWorkflow }],
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
          test "$(git rev-parse HEAD)" = "\${{ inputs.expected_head_sha }}"
          case "\${{ inputs.target_branch }}" in main|Production) echo reject; exit 1;; esac
          git push origin HEAD:"\${{ inputs.target_branch }}"
`,
  },
);
assert.deepEqual(compliantFindings, []);

console.log(JSON.stringify({
  ok: true,
  gate: "repository_tool_lifecycle_governance",
  cases: 21,
  secrets_included: false,
}));
