# Architecture: Governed PR Delivery Orchestration

## Design principle

The orchestrator is a control-plane layer above existing tools. It should not duplicate GitHub, migration, CI, or release-readiness implementations. It coordinates them with durable state, idempotency, and readback.

## Components

### Delivery ledger

A SQL-backed ledger records one delivery operation from planning through closeout.

Suggested fields:

- `delivery_id`
- `repo_owner`
- `repo_name`
- `pull_number`
- `branch`
- `delivery_mode`
- `status`
- `current_stage`
- `plan_fingerprint`
- `expected_head_sha`
- `expected_base_sha`
- `candidate_sha`
- `merge_commit_sha`
- `required_checks_json`
- `post_merge_obligations_json`
- `receipt_refs_json`
- `created_at`, `updated_at`, `completed_at`

### Mutation receipt ledger

Every external or state-changing operation writes a deterministic receipt.

Receipt fields:

- `receipt_id`
- `operation_key`
- `idempotency_key`
- `request_sha256`
- `target_resource_uri`
- `expected_pre_state_json`
- `expected_post_state_json`
- `provider_status`
- `transport_status`
- `readback_status`
- `readback_json`
- `classification`

### Planner

The planner reads PR state and produces a no-mutation plan:

- PR open/closed/merged state.
- Head/base refs.
- Compare classification.
- Required checks and current conclusions.
- Changed files and overlaps.
- Migration obligations.
- Production/readiness obligations.
- Candidate plan and expected confirmations.

### Applier

The applier executes a plan only when:

- Plan fingerprint still matches.
- Expected head/base are current.
- Capability envelope is ready for the next mutation.
- Typed confirmation matches the exact planned operation.

### Chunk collector

The chunk collector consumes oversized tool responses and emits:

- `summary_json`
- `source_chunk_refs`
- `completeness_status`
- `secrets_included=false`

Operators should not have to manually inspect large chunks unless debugging.

## State machine

```text
planned
  -> sync_required
  -> resolution_required
  -> candidate_ready
  -> ci_required
  -> ci_running
  -> ci_passed
  -> merge_ready
  -> merged
  -> post_merge_required
  -> closeout_running
  -> complete
```

Failure states:

```text
blocked_auth
blocked_conflict_requires_review
blocked_checks_failed
blocked_transport_ambiguous
blocked_stale_after_retry_budget
blocked_contract_gap
```

## Drift handling

Drift is not exceptional. Each stage begins with atomic revalidation:

```text
read current_pr
read current_head_ref
read current_base_ref
compare
classify
continue only if expected state matches
```

If `main` moves:

- `no_overlap`: rebuild candidate or use update-branch.
- `same_files`: produce resolution plan.
- `docs_only`: apply docs policy, but do not silently skip freshness.
- `already_merged`: stop and record merged evidence.

## Candidate merge strategy

Preferred path:

1. Create disposable candidate branch from latest base.
2. Apply resolved files to candidate.
3. Run CI on candidate or merge-group equivalent.
4. If green and base/head unchanged, merge PR.
5. If base moved, rebuild candidate and re-run only required checks.

Fallback path:

- Create multi-parent merge commit on work branch only when the PR branch must carry the resolution and the operation is no-force, readback verified, and branch is non-protected.

## Post-merge closeout

After merge, the orchestrator inspects obligations:

- migration apply authorization and ledger
- release readiness
- production parity
- branch cleanup
- Spec Kit completion status
- remaining warnings/backlog

A PR with post-merge obligations is not operationally complete until closeout records evidence or an explicit backlog item.
