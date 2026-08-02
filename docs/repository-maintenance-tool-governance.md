# Repository Maintenance Tool Governance

## Purpose

Repository automation must not accumulate branch-specific patch workflows, trigger files, self-deleting jobs, or versioned one-off runners. When a temporary mechanism reveals a repeatable need, promote the capability into a registered, branch-agnostic tool. Otherwise remove every temporary artifact before the pull request becomes Ready for Review.

The machine policy is `.github/repository-maintenance-tool-governance.json`. The required check is `Repository Tool Lifecycle Governance`.

## Mandatory classification at creation

Every new repository automation artifact must be classified immediately as one of:

1. **Permanent reusable tool** — stored under the governed tool root, registered in the machine policy, tested, branch-agnostic, and documented.
2. **Temporary diagnostic or migration aid** — allowed only on an active work branch and prohibited from merging into `main` or `Production`.
3. **Product/runtime implementation** — belongs in the runtime or product layer and must not be hidden inside a workflow patch step.

Unclassified automation fails closed.

## Promotion rule

Promote temporary automation to a permanent tool when at least one condition is true:

- the same action is expected on more than one branch;
- the operation is likely to recur after rebases, synchronization, or migrations;
- multiple agents or maintainers need the capability;
- the operation benefits from a stable input/output contract and canonical evidence;
- manual repetition would encourage direct Job-log reading, force pushes, or unsafe branch mutations.

A promoted tool must:

- use a generic tool key and contain no PR number, date, SHA, tenant ID, ticket ID, or branch literal;
- declare its entrypoint and mode in `.github/repository-maintenance-tool-governance.json`;
- accept exact candidate identity as input instead of inferring a mutable branch state;
- reject `main` and `Production` for mutation unless a separate release policy explicitly authorizes them;
- require `expected_head_sha` before any write;
- use normal fast-forward pushes only;
- constrain changed paths to a reviewed allowlist;
- publish bounded machine-readable and human-readable reports with `secrets_included: false`;
- treat Job logs as diagnostic-only evidence;
- include regression tests for allowed and rejected behavior.

## Immutable safety baseline

The pull-request candidate may extend repository-tool policy, but it may not weaken the safety baseline in the same change it is asking the guard to evaluate. The guard therefore rejects attempts to:

- set any mandatory lifecycle rule to `false` or omit it;
- remove `main` or `Production` from the protected-branch set;
- move the governed tool root;
- remove or reclassify the canonical lifecycle guard;
- remove baseline detection for trigger files, one-shot workflows, or versioned temporary runners.

Configured policy patterns are additive to the baseline embedded in the guard; they are not a replacement for it.

## Registered tool body inspection

Registration is not sufficient by itself. The guard reads every registered entrypoint and compares its implementation with its declared mode:

- a `read_only` tool must not contain repository mutation behavior;
- a `mutating` tool must declare a non-empty changed-path allowlist;
- all detected mutations require exact expected-head verification and explicit rejection of `main` and `Production`;
- force push and workflow self-deletion are rejected regardless of declared mode.

Mutation detection is based on the operation found in the body, not only the workflow token declaration. A workflow using `permissions: write-all`, a PAT, a GitHub App token, or another external credential cannot bypass dispatch, expected-head, or protected-branch guards.

## One-off automation rule

Temporary automation may help diagnose or construct a change on a work branch, but it must not survive into the merge diff. This includes:

- branch-specific workflows;
- files ending in `.trigger`;
- repeated `v2`, `v3`, or similar patch-runner revisions;
- workflows whose names identify one-shot execution, including `*-once.yml`;
- workflows that write on `pull_request`;
- workflows that delete or rewrite themselves;
- embedded scripts that push to one hard-coded branch;
- patch logic that remains in automation instead of becoming reviewed runtime code.

Before Ready for Review, move the resulting runtime changes into normal source files, retain only reusable registered tooling, and delete all one-off artifacts. A deleted diff entry is the required remediation and is not treated as an artifact surviving into the merge candidate.

## Mutation safety

A permanent mutating tool must be manually dispatched or invoked by another governed control plane. It must verify the exact current head SHA before mutation, reject protected branches, avoid force push, and fail when the target branch moves concurrently. Pull-request-triggered workflows remain read-only and may not request any write scope, including `permissions: write-all`.

## Evidence routing

The lifecycle check publishes `mad4b.repository-tool-lifecycle-report.v1`. Read that canonical report before opening Job logs. A Job log may explain a finding, but it cannot override the report result.

## Review checklist

A pull request that creates or changes repository automation is not ready until:

- each tool is registered or explicitly identified as temporary;
- mandatory rules and protected branches remain immutable;
- registered tool bodies agree with their declared read-only or mutating mode;
- temporary artifacts are absent from the final diff;
- no work-branch literal is embedded in a permanent workflow;
- write workflows are explicitly dispatched and exact-head guarded;
- protected branches and force pushes are rejected;
- canonical evidence and regression tests pass.
