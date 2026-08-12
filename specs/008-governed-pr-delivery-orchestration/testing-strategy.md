# Testing Strategy

## Unit tests

- Planner classifies PR states and drift types.
- Planner detects post-merge obligations from changed files and Spec Kit metadata.
- Receipt wrapper classifies transport failure outcomes.
- JIT envelope lifecycle renews expired envelopes once and fails closed after budget.
- Chunk collector preserves completeness metadata.

## Integration tests

- Missing checks trigger workflow dispatch and then poll by head SHA.
- `base_is_fresh=false` blocks merge even if all checks are green.
- Candidate branch readback verifies changed paths and tree SHA.
- Migration closeout runs dry-run before apply and records ledger evidence.

## Negative tests

- Attempt to merge with stale base is blocked.
- Attempt to merge a closed but unmerged PR is blocked.
- Attempt to retry mutation after ambiguous transport without readback is blocked.
- Attempt to mark Spec Kit complete with unresolved checkboxes is blocked.
- Attempt to use an expired or mismatched envelope is blocked.

## Smoke tests

- Spec-only PR delivery plan.
- Docs-only no-overlap drift recovery.
- Runtime-code PR with required checks.
- Migration PR with post-merge closeout.
- Already-merged PR readback and stop.

## Observability acceptance

Each smoke produces:

- delivery id
- plan fingerprint
- receipt refs
- check summary
- merge or stop classification
- post-merge obligation state
- no-secret marker
