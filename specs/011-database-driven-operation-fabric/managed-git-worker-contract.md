# Managed Ephemeral Git Worker Contract

## Problem

The current managed worker lifecycle can reserve a lease and verify branch heads, but repository reconciliation needs a real isolated Git executor that does not depend on the user's local connector.

## Worker lifecycle

```text
allocate
→ acquire repository lease
→ obtain short-lived credential reference
→ create isolated workspace
→ fetch required refs
→ checkout expected head
→ perform requested Git operation
→ reconcile generated artifacts
→ run validation
→ create commit
→ push with no force
→ verify remote ref, ancestry, tree, and changed paths
→ persist evidence
→ destroy workspace
→ release lease
```

## Supported operations

- create work branch from an expected base SHA;
- apply a reviewed change manifest;
- fast-forward a behind-only branch;
- merge current base into a diverged work branch;
- rebase only when operation policy explicitly allows it;
- create resolution commits and multi-parent merge commits;
- regenerate registered generated artifacts;
- run bounded repository validation;
- return diff, commit, ancestry, and readback evidence.

## Safety constraints

- No protected-branch writes.
- No force push.
- Expected base and branch SHA validation before execution.
- Resource, duration, output, and repository-size budgets.
- One active repository/branch lease per conflicting scope.
- Short-lived scoped credentials resolved internally.
- No secret output or persistent credential files.
- Network allowlist limited to required repository and package sources.
- Workspace destroyed after terminal state.
- Readback required before success.

## Conflict policy

Conflicts are classified as:

- source conflict requiring reviewed resolution;
- generated artifact conflict;
- delete/modify conflict;
- rename/path conflict;
- binary conflict;
- submodule or unsupported object conflict.

Generated artifacts follow registry policy. Source conflicts may use an explicit reviewed resolution manifest. Binary and unsupported conflicts block unless a registered adapter handles them.

## Interruption and resume

The worker checkpoints:

- expected and fetched refs;
- workspace and lease identity;
- operation stage;
- resource fingerprint;
- conflict manifest;
- applied resolutions;
- validation status;
- local commit SHA before push;
- remote readback after push.

Resume must detect drift and may continue only when the current fingerprint is compatible with the stored plan.

## Evidence

A successful worker result includes:

- base, original branch, result, and pushed SHAs;
- commit parent list;
- changed path digest;
- generated artifact digest;
- validation command keys and outcomes;
- no-force ref update evidence;
- remote ancestry/tree readback;
- worker cleanup and lease-release evidence.
