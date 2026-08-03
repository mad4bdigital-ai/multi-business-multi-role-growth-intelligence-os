from __future__ import annotations

import json
from pathlib import Path

WORKFLOW_PATH = Path('.github/workflows/spec-kit-work-map-autofix.yml')
TEST_PATH = Path('http-generic-api/test-work-map-autofix-validation-diagnostics.mjs')
E2E_PATH = Path('.changes/e2e/work-map-autofix-validation-diagnostics.json')
GENERATED_EVIDENCE = [
    'docs/work-maps/README.md',
    'docs/work-maps/repository-automation-map.md',
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


def update_e2e() -> None:
    payload = json.loads(E2E_PATH.read_text(encoding='utf-8'))
    phase = payload['phases'][0]
    journey = phase['e2e_journeys'][0]
    phase['objective'] = (
        'Evaluate all eleven Work Map Autofix validation contracts, persist each outcome and log, '
        'preserve backward-compatible first-failure fields, fail closed once the complete failure set is captured, '
        'accept only a git-valid non-protected branch that resolves to one exact same-repository pull request into main, '
        'and preserve generated Work Map parity for the durable workflow change.'
    )
    branch_step = (
        'Verify the branch input is git-valid, is not a full refs path or protected branch, and is pinned to exactly one '
        'same-repository open pull request into main by branch name and expected head SHA without a hard-coded work-branch namespace.'
    )
    if branch_step not in journey['steps']:
        journey['steps'].insert(1, branch_step)
    parity_step = (
        'Regenerate the governed Work Map index and repository automation map, then prove a second generation is idempotent.'
    )
    if parity_step not in journey['steps']:
        journey['steps'].append(parity_step)
    branch_assertion = (
        'Permanent workflow branch governance is input-driven and PR/commit-pinned; no gpt, cert, fix, feat, chore, docs, '
        'release, or other work-branch namespace is embedded as a durable allowlist.'
    )
    if branch_assertion not in journey['assertions']:
        journey['assertions'].append(branch_assertion)
    parity_assertion = (
        'Generated Work Map source hashes and repository automation documentation match the lifecycle-safe workflow source exactly.'
    )
    if parity_assertion not in journey['assertions']:
        journey['assertions'].append(parity_assertion)
    append_unique(payload['scope']['include'], GENERATED_EVIDENCE)
    append_unique(journey['evidence_paths'], GENERATED_EVIDENCE)
    E2E_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


def main() -> None:
    update_workflow()
    update_test()
    update_e2e()


if __name__ == '__main__':
    main()
