#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one exact match, found {count}")
    return source.replace(old, new, 1)


def run(*args: str) -> None:
    subprocess.run(args, cwd=ROOT, check=True)


launcher_path = ".github/workflows/governed-production-promotion-request-launcher.yml"
launcher = read(launcher_path)
launcher = replace_once(
    launcher,
    """on:
  pull_request_target:
    branches: [main]
    types: [opened, synchronize, reopened, ready_for_review]
""",
    """on:
  workflow_dispatch:
    inputs:
      request_pr:
        description: Open same-repository request PR targeting main
        required: true
        type: string
      expected_head_sha:
        description: Exact trusted workflow head SHA
        required: true
        type: string
      expected_request_head_sha:
        description: Exact request PR head SHA
        required: true
        type: string
      release_branch_prefix:
        description: Non-protected branch prefix for the Production candidate
        required: true
        type: string
      validation_branch_prefix:
        description: Non-protected branch prefix for exact candidate validation
        required: true
        type: string
      validation_base_branch_prefix:
        description: Governed non-protected validation base prefix
        required: true
        type: string
      confirmation:
        description: Type AUTHORIZE_GOVERNED_PRODUCTION_PROMOTION_REQUEST
        required: true
        type: string
""",
    "launcher trigger",
)
launcher = replace_once(
    launcher,
    """    if: >-
      github.event.pull_request.base.ref == 'main' &&
      github.event.pull_request.head.repo.full_name == github.repository &&
      startsWith(github.event.pull_request.head.ref, 'gpt/request-production-promotion-') &&
      github.event.pull_request.title == 'ops: request governed Production synchronization'
""",
    """    if: github.event_name == 'workflow_dispatch' && inputs.confirmation == 'AUTHORIZE_GOVERNED_PRODUCTION_PROMOTION_REQUEST'
""",
    "launcher job authorization",
)
launcher = replace_once(
    launcher,
    """      REQUEST_PR: ${{ github.event.pull_request.number }}
""",
    """      REQUEST_PR: ${{ inputs.request_pr }}
      EXPECTED_HEAD_SHA: ${{ inputs.expected_head_sha }}
      EXPECTED_REQUEST_HEAD_SHA: ${{ inputs.expected_request_head_sha }}
      CURRENT_HEAD_SHA: ${{ github.sha }}
      RELEASE_BRANCH_PREFIX: ${{ inputs.release_branch_prefix }}
      VALIDATION_BRANCH_PREFIX: ${{ inputs.validation_branch_prefix }}
      VALIDATION_BASE_BRANCH_PREFIX: ${{ inputs.validation_base_branch_prefix }}
""",
    "launcher environment",
)
launcher = replace_once(
    launcher,
    """    steps:
      - name: Initialize bounded convergence evidence path
""",
    """    steps:
      - name: Validate governed dispatch identity and exact heads
        shell: bash
        env:
          CONFIRMATION: ${{ inputs.confirmation }}
        run: |
          set -Eeuo pipefail
          reject() {
            echo "::error::$1"
            exit 1
          }

          [[ "$CONFIRMATION" == "AUTHORIZE_GOVERNED_PRODUCTION_PROMOTION_REQUEST" ]] || reject "typed confirmation mismatch"
          [[ "$REQUEST_PR" =~ ^[1-9][0-9]*$ ]] || reject "request_pr must be a positive integer"
          [[ "$EXPECTED_HEAD_SHA" =~ ^[0-9a-f]{40}$ ]] || reject "expected_head_sha must be an exact lowercase SHA"
          [[ "$EXPECTED_REQUEST_HEAD_SHA" =~ ^[0-9a-f]{40}$ ]] || reject "expected_request_head_sha must be an exact lowercase SHA"
          [[ "$CURRENT_HEAD_SHA" == "$EXPECTED_HEAD_SHA" ]] || reject "expected head mismatch: current workflow head is not authorized"
          [[ "$GITHUB_REF_NAME" == "main" ]] || reject "launcher must be dispatched from trusted main"

          for prefix in "$RELEASE_BRANCH_PREFIX" "$VALIDATION_BRANCH_PREFIX" "$VALIDATION_BASE_BRANCH_PREFIX"; do
            [[ -n "$prefix" ]] || reject "branch prefix must not be empty"
            git check-ref-format --branch "${prefix}-probe" >/dev/null 2>&1 || reject "invalid branch prefix"
            case "$prefix" in
              main|main/*|Production|Production/*)
                reject "branch prefix must reject main and Production"
                ;;
            esac
          done

          request_file="${RUNNER_TEMP}/production-promotion-request-pr.json"
          gh pr view "$REQUEST_PR" --repo "$REPOSITORY" \
            --json state,title,headRefOid,headRepositoryOwner,baseRefName \
            > "$request_file"
          [[ "$(jq -r '.state' "$request_file")" == "OPEN" ]] || reject "request PR is not open"
          [[ "$(jq -r '.baseRefName' "$request_file")" == "main" ]] || reject "request PR must target main"
          [[ "$(jq -r '.headRepositoryOwner.login' "$request_file")" == "$GITHUB_REPOSITORY_OWNER" ]] || reject "request PR must belong to this repository owner"
          [[ "$(jq -r '.headRefOid' "$request_file")" == "$EXPECTED_REQUEST_HEAD_SHA" ]] || reject "request PR expected head SHA mismatch"
          [[ "$(jq -r '.title' "$request_file")" == "ops: request governed Production synchronization" ]] || reject "request PR title contract mismatch"

      - name: Initialize bounded convergence evidence path
""",
    "launcher exact-head guard",
)
launcher = replace_once(
    launcher,
    """            RELEASE_BRANCH="release/production-candidate-${MAIN_SHORT}-${PRODUCTION_SHORT}-${ATTEMPT_SUFFIX}"
            VALIDATION_BRANCH="gpt/validate-production-candidate-${MAIN_SHORT}-${PRODUCTION_SHORT}-${ATTEMPT_SUFFIX}"
            VALIDATION_BASE_BRANCH="gpt/validate-production-base-${MAIN_SHORT}-${PRODUCTION_SHORT}-${ATTEMPT_SUFFIX}"
""",
    """            RELEASE_BRANCH="${RELEASE_BRANCH_PREFIX}-${MAIN_SHORT}-${PRODUCTION_SHORT}-${ATTEMPT_SUFFIX}"
            VALIDATION_BRANCH="${VALIDATION_BRANCH_PREFIX}-${MAIN_SHORT}-${PRODUCTION_SHORT}-${ATTEMPT_SUFFIX}"
            VALIDATION_BASE_BRANCH="${VALIDATION_BASE_BRANCH_PREFIX}-${MAIN_SHORT}-${PRODUCTION_SHORT}-${ATTEMPT_SUFFIX}"
""",
    "launcher generic branch prefixes",
)
write(launcher_path, launcher)

post_guard_path = ".github/workflows/governed-production-promotion-post-finalization-guard.yml"
post_guard = read(post_guard_path)
pattern = re.compile(
    r"      - name: Close superseded Production and validation surfaces\n.*?(?=      - name: Publish post-finalization summary)",
    re.DOTALL,
)
replacement = """      - name: Publish authoritative stable release marker
        if: steps.readback.outputs.stable == 'true'
        shell: bash
        env:
          RELEASE_PR: ${{ steps.evidence.outputs.release_pr }}
          CANDIDATE_SHA: ${{ steps.evidence.outputs.candidate_sha }}
          PINNED_MAIN_SHA: ${{ steps.evidence.outputs.main_sha }}
          PINNED_PRODUCTION_SHA: ${{ steps.evidence.outputs.production_sha }}
        run: |
          set -Eeuo pipefail
          FINAL_MARKER="POST_FINALIZATION_STABLE source_run=${SOURCE_RUN_ID} candidate=${CANDIDATE_SHA} main=${PINNED_MAIN_SHA} Production=${PINNED_PRODUCTION_SHA} merge_executed=false deployment_executed=false"
          gh pr comment "$RELEASE_PR" --repo "$REPOSITORY" --body "$FINAL_MARKER single_release_surface=true final_freshness_readback=true"

"""
post_guard, count = pattern.subn(replacement, post_guard, count=1)
if count != 1:
    raise RuntimeError(f"post-finalization branch-specific convergence block: expected one match, found {count}")
write(post_guard_path, post_guard)

retired_workflows = [
    ".github/workflows/hostinger-nodejs-completed-build-log-evidence-push-r3b.yml",
    ".github/workflows/hostinger-nodejs-completed-build-log-evidence-r3c-windows.yml",
    ".github/workflows/response-chunk-ownership-governed-rollout-push.yml",
    ".github/workflows/ueacp-live-authority-evidence-one-shot.yml",
]
for retired in retired_workflows:
    target = ROOT / retired
    if not target.is_file():
        raise RuntimeError(f"retired workflow is missing before governed deletion: {retired}")
    target.unlink()

test_path = "http-generic-api/test-push-workflow-runner-context-registration.mjs"
test_source = read(test_path)
test_source = replace_once(
    test_source,
    "import { readdirSync, readFileSync } from 'node:fs';",
    "import { existsSync, readdirSync, readFileSync } from 'node:fs';",
    "test fs import",
)
for retired in retired_workflows:
    test_source = test_source.replace(f"  '{retired}',\n", "")
retired_array = "const retiredWorkflowPaths = [\n" + "".join(f"  '{path}',\n" for path in retired_workflows) + "];\n\n"
test_source = replace_once(
    test_source,
    "function preAllocationRunnerContextBindings(source, workflowPath) {",
    retired_array + "function preAllocationRunnerContextBindings(source, workflowPath) {",
    "retired workflow test registration",
)
test_source = replace_once(
    test_source,
    "for (const workflowPath of repairedWorkflowPaths) {\n",
    "for (const workflowPath of retiredWorkflowPaths) {\n  assert.equal(\n    existsSync(resolve(repositoryRoot, workflowPath)),\n    false,\n    `${workflowPath} is an incident-specific mutating bridge and must remain retired`,\n  );\n}\n\nfor (const workflowPath of repairedWorkflowPaths) {\n",
    "retired workflow absence assertions",
)
test_source = replace_once(
    test_source,
    "  repaired_workflow_count: repairedWorkflowPaths.length,\n",
    "  repaired_workflow_count: repairedWorkflowPaths.length,\n  retired_workflow_count: retiredWorkflowPaths.length,\n",
    "test report retired count",
)
write(test_path, test_source)

doc_path = "docs/governance/push-workflow-runner-context-registration.md"
doc_source = read(doc_path)
marker = "## Lifecycle convergence\n"
if marker not in doc_source:
    doc_source = doc_source.rstrip() + """

## Lifecycle convergence

The repository lifecycle guard identified four incident-specific push bridges with hard-coded pull-request or branch identity. They are retired rather than converted into reusable mutation surfaces:

- `hostinger-nodejs-completed-build-log-evidence-push-r3b.yml`
- `hostinger-nodejs-completed-build-log-evidence-r3c-windows.yml`
- `response-chunk-ownership-governed-rollout-push.yml`
- `ueacp-live-authority-evidence-one-shot.yml`

The retained Production promotion launcher is manual-only. It requires typed authorization, an exact trusted workflow SHA, an exact request-PR head SHA, and explicit non-protected branch prefixes. The post-finalization guard no longer searches or closes PRs through hard-coded work-branch namespaces; it acts only on the exact release PR bound in validated convergence evidence.
"""
write(doc_path, doc_source)

contract_path = ".changes/e2e/push-workflow-runner-context-registration.json"
base_scope = [
    contract_path,
    ".github/workflows/governed-migration-dependency-gate.yml",
    post_guard_path,
    launcher_path,
    *retired_workflows,
    ".github/workflows/hostinger-nodejs-completed-build-log-evidence.yml",
    ".github/workflows/hostinger-production-release-evidence-r5.yml",
    ".github/workflows/production-certified-release-cut-validation.yml",
    doc_path,
    test_path,
    "http-generic-api/test-production-certified-release-cut-validation-registration.mjs",
]
existing_evidence = [
    contract_path,
    ".github/workflows/repository-tool-lifecycle.yml",
    ".github/workflows/e2e-contract-reference-integrity.yml",
    ".github/workflows/spec-kit-work-map-integration.yml",
    ".github/workflows/governed-migration-dependency-gate.yml",
    post_guard_path,
    launcher_path,
    ".github/workflows/hostinger-nodejs-completed-build-log-evidence.yml",
    ".github/workflows/hostinger-production-release-evidence-r5.yml",
    ".github/workflows/production-certified-release-cut-validation.yml",
    doc_path,
    test_path,
    "http-generic-api/test-production-certified-release-cut-validation-registration.mjs",
]

def journey(journey_id: str, actor: str, entrypoint: str, terminal: str, assertions: list[str]) -> dict:
    return {
        "id": journey_id,
        "end_to_end": True,
        "level": "synthetic_runtime",
        "actor": actor,
        "entrypoint": entrypoint,
        "terminal_outcome": terminal,
        "steps": [
            "Evaluate every workflow at the exact pull-request head for pre-allocation runner-context use.",
            "Verify retained mutating automation is manual, typed, exact-head bound, and protected-branch rejecting.",
            "Verify incident-specific mutating bridges remain deleted and cannot be re-registered silently.",
            "Verify generated Work Maps and the E2E evidence contract match the exact repository tree.",
        ],
        "assertions": assertions,
        "tests": [
            {
                "id": f"{journey_id}-runner-context-regression",
                "runner": "node",
                "working_directory": ".",
                "path": test_path,
                "args": [],
            },
            {
                "id": f"{journey_id}-release-cut-registration",
                "runner": "node",
                "working_directory": ".",
                "path": "http-generic-api/test-production-certified-release-cut-validation-registration.mjs",
                "args": [],
            },
        ],
        "evidence_paths": list(existing_evidence),
    }

contract = {
    "$schema": "../../.specify/schemas/e2e-phases.schema.json",
    "schema_version": 1,
    "feature_key": "push-workflow-runner-context-registration",
    "title": "Push workflow runner-context registration and lifecycle convergence",
    "delivery_mode": "single_pr",
    "current_phase": "resilient",
    "scope": {"include": base_scope},
    "merge_contract": {"minimum_phase": "mvp"},
    "phases": [
        {
            "id": "mvp",
            "status": "implemented",
            "objective": "Restore valid workflow registration by moving runner-scoped paths after runner allocation and preserving certified release-cut YAML semantics.",
            "e2e_journeys": [journey(
                "restore-push-workflow-registration",
                "repository CI maintainer",
                "Exact pull-request workflow tree and focused registration regressions",
                "Every retained workflow parses and no runner context is evaluated before a runner-backed step begins.",
                [
                    "Repository-wide runner-context findings are empty.",
                    "Certified release-cut conditions remain valid YAML with unchanged semantics.",
                    "No deployment, provider, credential, SQL, migration, database, Production mutation, or force push is executed.",
                ],
            )],
        },
        {
            "id": "operational",
            "status": "implemented",
            "objective": "Bind the retained Production promotion launcher to an explicit manual dispatch, typed confirmation, trusted exact head, and exact request PR head.",
            "e2e_journeys": [journey(
                "govern-production-promotion-dispatch",
                "authorized repository release operator",
                "Governed Production Promotion Request Launcher workflow_dispatch inputs",
                "The launcher rejects stale, untrusted, automatic, or protected-branch-directed requests before any repository mutation.",
                [
                    "The launcher has no pull_request or pull_request_target trigger.",
                    "The launcher compares expected_head_sha to github.sha and expected_request_head_sha to the open request PR head.",
                    "Branch prefixes reject main and Production before downstream dispatch.",
                    "No branch-specific work namespace is hard-coded in the retained automation.",
                ],
            )],
        },
        {
            "id": "resilient",
            "status": "implemented",
            "objective": "Prevent reintroduction of stale one-shot mutation bridges, pre-allocation runner context, branch-specific automation literals, or stale Work Maps.",
            "e2e_journeys": [journey(
                "reject-runner-context-and-automation-lifecycle-regression",
                "repository governance evaluator",
                "Repository Tool Lifecycle, E2E Contract Reference Integrity, and Spec Kit Work Map Integration gates",
                "Any restoration of retired bridges or loss of exact-head lifecycle controls fails on the originating pull request.",
                [
                    "The four incident-specific workflows remain absent.",
                    "Changed mutating workflows pass lifecycle dispatch, expected-head, and protected-branch rules.",
                    "All declared evidence paths resolve to tracked regular files.",
                    "Generated Work Maps match the exact final tree.",
                ],
            )],
        },
        {
            "id": "canary",
            "status": "not_applicable",
            "objective": "This repository registration and governance repair does not execute a live runtime canary.",
        },
        {
            "id": "production",
            "status": "not_applicable",
            "objective": "This pull request grants no Production, deployment, migration, provider, credential, or runtime authority.",
        },
    ],
}
write(contract_path, json.dumps(contract, indent=2) + "\n")

# Remove the bounded renderer before generating final repository maps.
for temporary in [
    ".github/scripts/pr6502-governance-convergence.py",
    ".github/workflows/pr6502-governance-convergence.yml",
]:
    target = ROOT / temporary
    if target.exists():
        target.unlink()

for _ in range(4):
    run("node", "http-generic-api/scripts/platform-work-map-generator.mjs", "--write")
    changed = subprocess.run(
        ["git", "diff", "--name-only", "--", "docs/work-maps"],
        cwd=ROOT,
        check=True,
        text=True,
        capture_output=True,
    ).stdout.splitlines()
    changed = sorted(path.strip() for path in changed if path.strip())
    contract = json.loads(read(contract_path))
    scope = contract["scope"]["include"]
    evidence_lists = [
        phase["e2e_journeys"][0]["evidence_paths"]
        for phase in contract["phases"]
        if phase.get("e2e_journeys")
    ]
    additions = [path for path in changed if path not in scope]
    evidence_additions = [
        path for path in changed
        if any(path not in evidence for evidence in evidence_lists)
    ]
    if not additions and not evidence_additions:
        break
    scope.extend(additions)
    for evidence in evidence_lists:
        for path in changed:
            if path not in evidence:
                evidence.append(path)
    write(contract_path, json.dumps(contract, indent=2) + "\n")
else:
    raise RuntimeError("Work Map scope convergence did not stabilize")

run("node", "http-generic-api/scripts/platform-work-map-generator.mjs", "--write")
run("node", "http-generic-api/scripts/platform-work-map-generator.mjs", "--check")
run("node", test_path)
run("node", "http-generic-api/test-production-certified-release-cut-validation-registration.mjs")
run("git", "diff", "--check")
