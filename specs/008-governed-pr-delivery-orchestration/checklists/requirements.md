# Requirements Checklist

## Product correctness

- [x] Root causes are stated separately from symptoms.
- [x] Temporary auto-sync lock is not the normal solution.
- [x] Candidate merge and drift-aware delivery are core requirements.
- [x] Green-but-stale CI is explicitly blocked.
- [x] Already-merged PRs stop as success instead of continuing mutation attempts.
- [ ] Planner returns deterministic delivery fingerprints.
- [ ] Apply stage validates the exact fingerprint before mutation.
- [ ] Post-merge obligations are attached to delivery records.

## Governance

- [x] Delivery mode is `multi_pr`.
- [x] Spec Kit includes required files: spec, plan, tasks, completion, and checklists.
- [ ] Final closeout PR records all implementation PRs.
- [ ] Completion status is changed to `complete` only after all unresolved items are closed or marked not applicable.

## Operator experience

- [ ] One command can answer: what is next and why?
- [ ] Oversized evidence is summarized with complete references.
- [ ] Retry outcomes are classified and visible.
- [ ] Manual steps are reserved for review/approval, not state reconstruction.
