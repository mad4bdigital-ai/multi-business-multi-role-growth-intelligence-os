# Operations and Reliability Checklist — Spec 014

## Intake and storage readiness

- [ ] Duplicate submissions return the prior receipt or resume the same operation.
- [ ] Intake acknowledgement does not wait for AI completion.
- [ ] Original files remain recoverable after rename, move, derivative generation, or provider upload.
- [ ] Quarantine, restricted, unsorted, manual-review, and dead-letter queues have owners and SLA targets.
- [ ] Unknown storage outcomes are reconciled before retry.
- [ ] File access and location are read back after every governed mutation.

## Job and queue readiness

- [ ] AI jobs have stable IDs, operation fingerprints, leases, bounded attempts, backoff, and not-before time.
- [ ] Retryable and non-retryable failures are classified explicitly.
- [ ] Outcome-unknown state blocks blind replay.
- [ ] Dead-letter entries preserve source records, attempt history, owner, and repair path.
- [ ] Workers support pause, drain, resume, and per-use-case disable.
- [ ] Queue concurrency and rate limits are scoped and observable.

## Model and provider operations

- [ ] Active model aliases resolve to pinned allowed models.
- [ ] Prompt, schema, policy, safety, and model versions are recorded on every result.
- [ ] Provider file leases expire and cleanup is idempotent.
- [ ] Provider-disabled and manual-review modes are tested.
- [ ] Budget warning, degradation, and hard-stop thresholds are configured.
- [ ] Provider 429, 5xx, timeout, malformed result, safety block, and schema/semantic failures have runbooks.

## Review operations

- [ ] Review queues expose priority, age, sensitivity, owner, and blocker reason.
- [ ] Stale decisions fail with a current-version conflict.
- [ ] Human overrides are attributable and auditable.
- [ ] Clarification requests are minimal, bounded, expiring, and linked to the original record.
- [ ] Duplicate decisions preserve all original records.
- [ ] Promotion and usage links have consumer compatibility tests.

## Observability

- [ ] Trace, request, intake, evidence, AI job, AI result, review decision, and work-packet IDs are correlated.
- [ ] Metrics cover success, latency, queue age, retries, unknown outcomes, schema/semantic failures, safety, cost, budgets, overrides, duplicates, clarification, and evidence utilization.
- [ ] Alerts include actionable owner, scope, threshold, and runbook reference.
- [ ] Logs exclude raw files, credentials, signed URLs, secrets, and unnecessary personal data.
- [ ] Canonical structured reports are retained separately from diagnostic logs.

## CI and release readiness

- [ ] CI tests the exact candidate SHA or merge candidate and stamps evidence with that identity.
- [ ] Changed-scope gates fail closed on missing contracts, classification, tests, or evidence.
- [ ] Diagnostic test sharding produces exact rerun coordinates.
- [ ] Canonical CI summaries are machine-readable and no-secret.
- [ ] A trusted publisher verifies repository, PR, branch when present, and exact head SHA before updating PR evidence.
- [ ] Generated artifact validation is read-only; stale output produces a repair candidate instead of an implicit write.
- [ ] Any governed writer is single-purpose, explicitly authorized, exact-head bound, path-restricted, no-force, and followed by validation dispatch/readback.

## Pilot and production

- [ ] Pilot cohort, data sensitivity, allowed modalities, budgets, and success thresholds are approved.
- [ ] Manual fallback capacity is sufficient for expected intake volume.
- [ ] Golden benchmark and human evaluation pass for Arabic and mixed-language content.
- [ ] Rollback rehearsal disables AI dispatch while preserving intake and evidence.
- [ ] Production/main parity, health, queue/worker state, active model/prompt/policy versions, budgets, and runtime smoke are verified.
- [ ] Completion does not rely on merged code alone; deployment and runtime readback are present when applicable.
