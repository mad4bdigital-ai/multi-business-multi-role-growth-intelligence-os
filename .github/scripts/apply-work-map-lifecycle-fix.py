from __future__ import annotations

import json
from pathlib import Path

WORKFLOW_PATH = Path('.github/workflows/spec-kit-work-map-autofix.yml')
TEST_PATH = Path('http-generic-api/test-work-map-autofix-validation-diagnostics.mjs')
E2E_PATH = Path('.changes/e2e/work-map-autofix-validation-diagnostics.json')
LIFECYCLE_GUARD_PATH = Path('http-generic-api/scripts/maintenance-tools/repository-tool-lifecycle-guard.mjs')
LIFECYCLE_TEST_PATH = Path('http-generic-api/scripts/test-repository-tool-lifecycle-guard.mjs')
GENERATED_EVIDENCE = [
    'docs/work-maps/README.md',
    'docs/work-maps/repository-automation-map.md',
]
LIFECYCLE_EVIDENCE = [
    'http-generic-api/scripts/maintenance-tools/repository-tool-lifecycle-guard.mjs',
    'http-generic-api/scripts/test-repository-tool-lifecycle-guard.mjs',
]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


def append_unique(values: list[str], additions: list[str]) -> None:
    for value in additions:
        if value not in values:
            values.append(value)


def update_workflow() -> None:
    text = WORKFLOW_PATH.read_text(encoding='utf-8')
    text = replace_once(
        text,
        '          [[ "${TARGET_BRANCH}" =~ ^(gpt|cert|fix|feat|chore|docs|release)/[A-Za-z0-9._/-]+$ ]]\n',
        '          [[ "${TARGET_BRANCH}" != refs/* ]]\n',
        'branch namespace allowlist',
    )
    WORKFLOW_PATH.write_text(text, encoding='utf-8')


def update_test() -> None:
    text = TEST_PATH.read_text(encoding='utf-8')
    anchor = 'assert.doesNotMatch(initializationBlock, /GITHUB_WORKSPACE.*work-map-autofix-diagnostics/);\n'
    addition = '''assert.ok(
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
'''
    text = replace_once(text, anchor, anchor + addition, 'generic branch regression anchor')
    TEST_PATH.write_text(text, encoding='utf-8')


def update_lifecycle_guard() -> None:
    text = LIFECYCLE_GUARD_PATH.read_text(encoding='utf-8')
    old_constants = 'const WORK_BRANCH_PATTERN = /(?:^|[^A-Za-z0-9_.-])(?:gpt|fix|feat|chore|docs|release)\\/[A-Za-z0-9._/-]+/iu;\n'
    new_constants = old_constants + (
        'const WORK_BRANCH_CONTEXT_PATTERN = /(?:branches?|refs?\\/heads|ref|head|base|target[_-]?branch|source[_-]?branch|destination[_-]?branch|git\\s+(?:checkout|switch|push)|--ref\\b)/iu;\n'
    )
    text = replace_once(text, old_constants, new_constants, 'branch context constant')

    old_function = '''function containsBranchSpecificLiteral(content) {
  const lines = content.split(/\\r?\\n/u);
  let pathFilterIndent = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const indentation = line.match(/^\\s*/u)?.[0].length || 0;

    if (/^(?:paths|paths-ignore):\\s*$/u.test(trimmed)) {
      pathFilterIndent = indentation;
      continue;
    }
    if (pathFilterIndent !== null) {
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (indentation > pathFilterIndent) continue;
      pathFilterIndent = null;
    }
    if (WORK_BRANCH_PATTERN.test(line)) return true;
  }
  return false;
}
'''
    new_function = '''function containsBranchSpecificLiteral(content) {
  const lines = content.split(/\\r?\\n/u);
  let pathFilterIndent = null;
  let branchFilterIndent = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const indentation = line.match(/^\\s*/u)?.[0].length || 0;

    if (/^(?:paths|paths-ignore):\\s*$/u.test(trimmed)) {
      pathFilterIndent = indentation;
      continue;
    }
    if (pathFilterIndent !== null) {
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (indentation > pathFilterIndent) continue;
      pathFilterIndent = null;
    }

    if (/^(?:branches|branches-ignore):/u.test(trimmed)) {
      if (WORK_BRANCH_PATTERN.test(line)) return true;
      branchFilterIndent = indentation;
      continue;
    }
    if (branchFilterIndent !== null) {
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (indentation > branchFilterIndent) {
        if (WORK_BRANCH_PATTERN.test(line)) return true;
        continue;
      }
      branchFilterIndent = null;
    }

    if (
      WORK_BRANCH_PATTERN.test(line)
      && WORK_BRANCH_CONTEXT_PATTERN.test(line)
    ) return true;
  }
  return false;
}
'''
    text = replace_once(text, old_function, new_function, 'context-aware branch literal detection')
    LIFECYCLE_GUARD_PATH.write_text(text, encoding='utf-8')


def update_lifecycle_test() -> None:
    text = LIFECYCLE_TEST_PATH.read_text(encoding='utf-8')
    anchor = '''assert(!repositoryPathFindings.some((item) => item.code === "BRANCH_SPECIFIC_WORKFLOW"));
'''
    addition = r'''
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
'''
    text = replace_once(text, anchor, anchor + addition, 'repository path and branch context regressions')
    text = replace_once(text, '  cases: 19,\n', '  cases: 21,\n', 'lifecycle regression case count')
    LIFECYCLE_TEST_PATH.write_text(text, encoding='utf-8')


def update_e2e() -> None:
    payload = json.loads(E2E_PATH.read_text(encoding='utf-8'))
    phase = payload['phases'][0]
    journey = phase['e2e_journeys'][0]
    phase['objective'] = (
        'Evaluate all eleven Work Map Autofix validation contracts, persist each outcome and log, '
        'preserve backward-compatible first-failure fields, fail closed once the complete failure set is captured, '
        'accept only a git-valid non-protected branch pinned to one exact same-repository pull request into main, '
        'distinguish branch literals from repository paths, and preserve generated Work Map parity.'
    )
    branch_step = (
        'Verify the branch input is git-valid, is not a full refs path or protected branch, and is pinned to exactly one '
        'same-repository open pull request into main by branch name and expected head SHA without a hard-coded work-branch namespace.'
    )
    if branch_step not in journey['steps']:
        journey['steps'].insert(1, branch_step)
    lifecycle_step = (
        'Verify Repository Tool Lifecycle detects work-branch literals only in branch, ref, or git branch-operation context '
        'and does not classify repository paths such as docs/work-maps as branches.'
    )
    if lifecycle_step not in journey['steps']:
        journey['steps'].append(lifecycle_step)
    parity_step = (
        'Regenerate the governed Work Map index and repository automation map, then prove a second generation is idempotent.'
    )
    if parity_step not in journey['steps']:
        journey['steps'].append(parity_step)
    branch_assertion = (
        'Permanent workflow branch governance is input-driven and PR/commit-pinned; no work-branch namespace is embedded as a durable allowlist.'
    )
    if branch_assertion not in journey['assertions']:
        journey['assertions'].append(branch_assertion)
    lifecycle_assertion = (
        'Lifecycle branch-literal detection remains strict for branch/ref contexts and does not report docs, release, fix, or feat repository paths as branches.'
    )
    if lifecycle_assertion not in journey['assertions']:
        journey['assertions'].append(lifecycle_assertion)
    parity_assertion = (
        'Generated Work Map source hashes and repository automation documentation match the lifecycle-safe workflow and guard sources exactly.'
    )
    if parity_assertion not in journey['assertions']:
        journey['assertions'].append(parity_assertion)
    append_unique(payload['scope']['include'], GENERATED_EVIDENCE + LIFECYCLE_EVIDENCE)
    append_unique(journey['evidence_paths'], GENERATED_EVIDENCE + LIFECYCLE_EVIDENCE)
    E2E_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


def main() -> None:
    update_workflow()
    update_test()
    update_lifecycle_guard()
    update_lifecycle_test()
    update_e2e()


if __name__ == '__main__':
    main()
