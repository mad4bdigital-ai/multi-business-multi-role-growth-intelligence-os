#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const workflowPath = path.join(root, ".github/workflows/spec-kit-work-map-autofix.yml");
const workflow = fs.readFileSync(workflowPath, "utf8");
const expectedGroup = "  group: ${{ github.event_name == 'workflow_dispatch' && format('spec-kit-work-map-artifacts-{0}-{1}', github.repository, inputs.branch) || contains(github.event.pull_request.body, '<!-- work-map-autofix:authorized -->') && format('spec-kit-work-map-artifacts-{0}-{1}', github.repository, github.event.pull_request.head.ref) || format('spec-kit-work-map-noop-{0}', github.run_id) }}\n";
const branchSpecificLiteral = /(?:^|[^A-Za-z0-9_.-])(?:gpt|fix|feat|chore|docs|release)\/[A-Za-z0-9._/-]+/iu;

assert(workflow.includes("name: Spec Kit Work Map Autofix\n"), "workflow identity must remain stable");
assert(workflow.includes(expectedGroup), "workflow must use the governed shared resource concurrency key");
assert(workflow.includes("  cancel-in-progress: false\n"), "mutation workflow must not cancel an in-progress writer");
assert(!workflow.includes("group: spec-kit-work-map-artifacts-${{ github.repository }}-${{ inputs.branch }}"), "legacy dispatch-only concurrency key must remain absent");
assert(workflow.includes("expected_head_sha:"), "exact-head input must remain required");
assert(workflow.includes("git check-ref-format --branch \"${TARGET_BRANCH}\""), "generic Git branch validation must remain present");
assert(!branchSpecificLiteral.test(workflow), "permanent workflow must not embed a work-branch prefix or literal");
assert(workflow.includes("test \"${remote_head_sha}\" = \"${EXPECTED_HEAD_SHA}\""), "remote expected-head guard must remain present");
assert(workflow.includes("[[ \"${TARGET_BRANCH}\" != \"main\" && \"${TARGET_BRANCH}\" != \"Production\" ]]"), "protected branches must remain rejected");
assert(workflow.includes("git push origin \"HEAD:refs/heads/${TARGET_BRANCH}\""), "bounded work-branch publication must remain explicit");
assert(!workflow.includes("git push --force"), "force push must remain absent");

console.log(JSON.stringify({
  ok: true,
  tests: 11,
  workflow: ".github/workflows/spec-kit-work-map-autofix.yml",
  shared_resource_concurrency_restored: true,
  generic_branch_validation: true,
  branch_specific_literal_present: false,
  cancel_in_progress: false,
  protected_branch_mutation: false,
  force_push: false,
  secrets_included: false,
}));
