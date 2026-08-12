# Spec: Governed PR Delivery Orchestration

## Problem statement

Manual PR delivery becomes slow and noisy when `main` moves during conflict resolution, when CI runs on a stale head, when mutation calls return transport errors after partially succeeding, when capability envelopes expire mid-flow, and when oversized evidence requires repeated chunk reads. The result is operational scatter: the operator repeatedly re-classifies drift, re-runs checks, revalidates SHAs, and decides whether a mutation succeeded.

The platform needs a single governed delivery pipeline that coordinates existing tools and makes drift, retries, readback, receipts, and closeout explicit.

## Root causes to fix

1. Delivery state is distributed across multiple tools instead of one resumable operation.
2. CI is sometimes evaluated on a head or candidate that is no longer merge-fresh.
3. Drift handling is reactive instead of part of the normal state machine.
4. Mutation success is inferred from transport responses instead of durable receipts plus readback.
5. Capability envelopes are created too early for long multi-step operations.
6. Oversized evidence can distract the operator with low-level chunk handling.
7. Post-merge migration/readiness/cleanup is not attached to the PR delivery object.

## Goals

- Provide one governed orchestrator for sync, conflict resolution, CI, merge, migration, and closeout.
- Use candidate merge commits and atomic expected SHA revalidation.
- Treat `main` movement as expected input, not a failure surprise.
- Use idempotency keys and mutation receipts for every external write.
- Create capability envelopes just-in-time before the mutation that consumes them.
- Summarize oversized evidence while preserving full readback references.
- Record post-merge closeout evidence in a durable delivery ledger.

## Non-goals

- Do not disable docs-agent or auto-sync as the standard path.
- Do not force-push work branches.
- Do not bypass typed confirmations, capability envelopes, or readback policies.
- Do not replace release readiness, migration runner, or GitHub App authority.
- Do not treat docs-only drift as irrelevant without explicit policy classification.

## Personas

- Platform admin delivering repository changes.
- Automation agent maintaining docs and generated work maps.
- Release operator who needs one final readiness answer.
- Governance reviewer who needs durable evidence and no hidden mutations.

## User stories

### US-1 Drift-aware merge delivery

As a platform admin, I want one operation to reconcile a PR with moving `main`, run fresh CI, and merge only when the base and head are current, so that I do not manually repeat sync and gate checks.

Acceptance criteria:

- The operation pins initial `head_sha` and `base_sha`.
- The operation classifies drift as `up_to_date`, `behind_only`, `diverged_no_overlap`, `diverged_same_files`, or `already_merged`.
- The operation resolves `behind_only` and `diverged_no_overlap` using no-force update paths.
- The operation resolves `diverged_same_files` using a reviewed resolution commit.
- The operation stops safely when the PR is already merged or closed.

### US-2 Candidate CI correctness

As a release operator, I want CI to run on the candidate that will actually be merged, so that green checks are not stale.

Acceptance criteria:

- CI gate is attached to the latest candidate head.
- `base_is_fresh=false` returns `sync_required` instead of merge readiness.
- Required checks are evaluated by name and conclusion.
- The orchestrator can dispatch or re-dispatch configured workflows when checks are missing.

### US-3 Idempotent mutation handling

As a platform admin, I want transport errors after mutation calls to be resolved by receipt/readback rather than blind retry, so that duplicate commits, duplicate PRs, or duplicate migration applies do not occur.

Acceptance criteria:

- Every mutation uses an idempotency key or deterministic operation key.
- A durable receipt stores request hash, target resource, expected post-state, provider status, and readback result.
- On 502/503/504/client payload errors, the orchestrator performs readback before retry.
- Retry is bounded and records whether the mutation was `succeeded_after_transport_error`, `not_observed_retryable`, or `ambiguous_manual_review_required`.

### US-4 Just-in-time authority envelopes

As a governance reviewer, I want envelopes created and approved close to the consuming mutation, so that authority does not expire mid-flow.

Acceptance criteria:

- Long-running plan steps do not create apply envelopes early.
- The orchestrator creates envelopes only after final SHA/readiness checks pass.
- Expired envelopes trigger a single JIT renewal path, not a full workflow restart.
- Envelope IDs are stored in the delivery ledger.

### US-5 Migration and post-merge closeout

As a release operator, I want merged PRs with migration or production verification obligations to enter a closeout state, so that runtime configuration, ledger entries, release readiness, and cleanup are not missed.

Acceptance criteria:

- PR body, changed files, and Spec Kit completion metadata identify post-merge obligations.
- The orchestrator runs authorized migration dry-run/apply only after merge evidence exists.
- Release readiness is run after apply or explicitly skipped with rationale.
- Cleanup results and remaining warnings are recorded.

## Functional requirements

- FR-1: Provide `governed_pr_delivery_plan` to read PR state, refs, checks, changed files, and obligations without mutation.
- FR-2: Provide `governed_pr_delivery_apply` to execute a previously generated plan with expected fingerprint, typed confirmation, and capability envelope.
- FR-3: Provide `governed_pr_delivery_status` to read delivery state and receipts.
- FR-4: Support delivery modes: `spec_only`, `code_only`, `migration`, `production_verification`, and `closeout`.
- FR-5: Support retry policies for GitHub ref update, workflow dispatch, PR merge, migration apply, and release readiness.
- FR-6: Preserve existing tool boundaries: GitHub calls through registry endpoints, migrations through governed runner, release checks through release readiness.
- FR-7: Produce compact summaries plus pointers to full evidence.

## Safety requirements

- SR-1: Never force-push protected or default branches.
- SR-2: Never return secrets or credential payloads.
- SR-3: Require typed confirmation for mutations.
- SR-4: Require same-cycle readback for every mutation.
- SR-5: Fail closed on ambiguous post-state.
- SR-6: Distinguish `already_present_in_base` from missing conflict resolution.

## Metrics

- Median tool calls per PR delivery.
- Number of stale-base loops avoided.
- Number of transport-error blind retries avoided.
- Time from CI pass to merge.
- Number of PRs merged with stale checks: target zero.
- Number of post-merge obligations missed: target zero.
- Number of ambiguous mutation outcomes requiring manual review.

## Open questions

- Should docs-only auto-sync commits be allowed to update `main` while a merge candidate is in final gate if they do not overlap candidate files?
- Which workflows are authoritative for each PR type?
- Should candidate merge commits live on the work branch or on disposable `gpt/candidate/*` branches?
