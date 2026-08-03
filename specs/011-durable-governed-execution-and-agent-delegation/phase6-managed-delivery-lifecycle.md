# Phase 6 — Managed PR and Release Lifecycle

## Purpose

Phase 6 composes the existing durable operation kernel, repository automation control plane, GitHub lifecycle adapters, CI gate, branch reconciliation, and deployment parity readers into one managed delivery contract.

It does not create a second repository automation system, a second persistence model, or a direct GitHub bypass path.

## Reused authorities

- `operationOrchestrator.js`
  - `repo.change.preview`
  - `repo.change.execute`
  - `repo.branch.reconcile`
- `repositoryAutomationControlPlane.js`
  - durable `pr_delivery` automation
  - branch reconciliation
  - required CI gate
  - bounded CI recovery
  - PR finalization
  - deployment parity
- `githubRepositoryLifecycle.js`
  - protected-branch safeguards
  - branch deletion with expected-head verification
  - bounded absence readback
- Phase 4 reconciliation/readback kernel.
- Phase 5 structured CI diagnosis and semantic validation.

## Managed delivery stages

1. Semantic patch intent.
2. Base synchronization.
3. Required CI gate.
4. Bounded delegated repair where allowlisted.
5. Approval bound to final head and base SHA.
6. Merge through the governed PR finalizer.
7. Branch deletion with exact-head and absence readback.
8. Deployment receipt collection.
9. Production parity readback.
10. Terminal completion only after the receipt chain is complete.

## T200 — Managed delivery operation

`spec011ManagedDeliveryLifecycle.js` exposes:

- `previewManagedDeliveryOperation()`
- `executeManagedDeliveryOperation()`

Preview delegates to `repo.change.preview` with `automation_key=pr_delivery` and executes no mutation.

Execution delegates to the durable `repo.change.execute` and `repo.branch.reconcile` operations. Existing repository automation run and receipt persistence remains authoritative.

## T201 — Semantic patch intent and stable anchors

Every changed file carries:

- repository-relative path;
- semantic action;
- SHA-256 of the intended content;
- a unique semantic anchor for non-create operations;
- SHA-256 of the expected anchor context.

Supported anchors are:

- exact text;
- JSON Pointer;
- YAML path;
- symbol.

Line-number anchors are rejected because line movement is not semantic stability.

## T202 — Base synchronization and stale-run cancellation

The lifecycle compares the expected and current head/base SHAs before finalization.

When drift exists:

- nonterminal runs bound to old SHAs are identified as stale;
- stale runs must be cancelled before a replacement execution;
- synchronization delegates to `repo.branch.reconcile`;
- the synchronized branch is read back before CI or approval continues;
- force push is always forbidden.

## T203 — Bounded delegated repair

Automated repair is available only when all conditions are true:

- delegation mode is `delegated_low_risk` or `delegated_plan_bound`;
- the structured diagnosis declares low risk;
- the failure code is explicitly allowlisted;
- every candidate file is inside the code-specific path allowlist;
- current head/base still match the repair envelope;
- no repair attempt was already consumed.

The attempt budget is one. Runtime semantic failures, security failures, migration failures, production failures, and non-allowlisted paths remain human-controlled.

## T204 — Final SHA approval binding

Merge approval contains:

- PR number;
- final head SHA;
- final base SHA;
- approver;
- approval and expiry timestamps;
- deterministic SHA-256 binding fingerprint.

Any head movement, base movement, expiry, or fingerprint mismatch invalidates the approval. Approval is revalidated immediately before durable PR finalization.

## T205 — Receipt chain

Completion requires all of the following:

- confirmed merge receipt bound to the approved head/base;
- merge SHA;
- verified branch absence bound to the merged head;
- deployment receipt whose deployed SHA equals the merge SHA;
- Production readback with verified parity on the same merge SHA.

Missing or conflicting evidence results in `production_readback_pending`, not success.

## T206 — Prohibited bypasses

The kernel rejects:

- `force_push=true`;
- generic `force=true`;
- branch-protection bypass;
- admin override;
- direct protected-branch writes;
- a protected branch as the delivery head;
- secret-like fields or values.

The certification suite proves these failures and confirms that the normal operation delegates through the governed durable surfaces.

## Certification

Workflow:

`.github/workflows/spec-011-managed-delivery-lifecycle.yml`

The workflow runs syntax checks and the focused lifecycle test, then uploads a bounded JSON artifact. It does not merge a PR, delete a real branch, deploy, mutate Production, call a provider, or expose secrets.
