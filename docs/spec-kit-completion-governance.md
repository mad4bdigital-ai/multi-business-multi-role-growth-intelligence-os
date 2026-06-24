# Spec Kit Completion Governance

Every changed or newly introduced Spec Kit is governed by `.specify/spec-kit-governance.json` and `http-generic-api/scripts/spec-kit-completion-gate.mjs`.

## Delivery modes

- `single_pr`: allowed only when the feature has no migration, production-verification, or post-merge-audit obligation.
- `multi_pr`: required when any post-merge obligation exists. One or more implementation PRs may deliver the feature, followed by a final closeout PR that records the evidence and resolves every task and checklist item.

## Required feature artifacts

A governed feature directory contains `spec.md`, `plan.md`, `tasks.md`, `completion.json`, and at least one Markdown checklist under `checklists/`.

`completion.json` records delivery mode, implementation PRs, the final closeout PR, CI, release readiness, migration ledger, production parity, and post-merge audit evidence as applicable.

## Checkbox semantics

- `[x]`: verified complete.
- `[~]`: explicitly not applicable; the rationale must be on the same line.
- `[ ]`: unresolved. It is allowed only while the feature status is `in_progress`.

A feature marked `complete` fails CI if any unresolved item remains.

## Changed-scope enforcement

The gate is fail-closed for every new Spec Kit and every future change to an existing Spec Kit. Unchanged legacy Spec Kits remain grandfathered until modified. Changes to the policy, templates, or validator revalidate all already-governed feature directories.

## Audit backlog

A post-merge audit may close as `completed_with_backlog` only when `completion.json` includes at least one tracked backlog reference. Detection is not silently treated as remediation.
