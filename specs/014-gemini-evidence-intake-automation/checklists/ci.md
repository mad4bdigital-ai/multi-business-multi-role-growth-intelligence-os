# CI Automation Checklist — Spec 014

## Contract integrity

- [ ] `ci-automation.json` validates against `contracts/ci-automation.schema.json`.
- [ ] Every Test Family resolves to existing Requirement and Task IDs.
- [ ] Every Pipeline stage produces a stable bounded evidence key.
- [ ] Every canonical, repair-candidate, or completion artifact shared between Pipelines has a declared Evidence Contract and producer.
- [ ] Required pipeline and canonical evidence keys in the completion policy exist.
- [ ] Pipeline graph has no missing producer, consumer, or writer edge.
- [ ] `secrets_included=false` is required on every canonical artifact.

## Candidate identity

- [ ] PR Head and Merge Candidate are treated as different candidate kinds.
- [ ] Checkout uses the exact declared candidate SHA.
- [ ] Reports carry repository, candidate kind/SHA, source-head SHA, head/base refs, and run ID.
- [ ] Task/Wave/Plan Hash is present for phase-governed work.
- [ ] Stale, ambiguous, superseded, or wrong-repository evidence fails closed.
- [ ] Completion cannot reuse CI produced for an older Head.

## Changed-scope routing

- [ ] Every project path belongs to at least one known Test Family.
- [ ] Unknown changed paths fail rather than silently skipping tests.
- [ ] Required tests are derived from changed files plus selected task requirements.
- [ ] Global governance and no-secret checks always run when relevant.
- [ ] Full ordered tests remain available to detect hidden cross-family interactions.

## Project CI

- [ ] Static/syntax/type checks run before expensive tests.
- [ ] Canonical source/generated parity and architecture-drift guards run.
- [ ] Unit and integration tests use locked dependencies.
- [ ] Security/privacy/cross-scope/adversarial tests run for affected surfaces.
- [ ] Startup and deployment-manifest evidence uses the exact candidate.
- [ ] New project features remain disabled by default during early waves.

## Phase governance

- [ ] The PR resolves to one task/work packet, integration convergence, or closeout mode.
- [ ] Changed paths remain inside the task's `allowed_paths`.
- [ ] No `forbidden_actions` occurred.
- [ ] Dependencies, open decisions, Work Maps, contracts, and entry gates are satisfied.
- [ ] Phase reports include task, wave, plan hash, evaluation, execution, and source identity.

## Diagnostic sharding

- [ ] Test families can be sharded with bounded job count and target size.
- [ ] Shards default to `fail_fast=false` for complete diagnosis.
- [ ] One structured report is emitted for each shard.
- [ ] A sequential ordered run emits last-passed and first-failed progress.
- [ ] Summary provides exact family/shard/test rerun coordinates.
- [ ] Diagnostic evidence is not treated as canonical success authority.

## Canonical evidence

- [ ] Router accepts known report contracts only.
- [ ] Source stamps are verified before routing.
- [ ] Canonical contract result outranks transport status and diagnostic logs.
- [ ] Workflow conclusion and canonical status must agree.
- [ ] Canonical reports expose status, blockers, counts, evidence refs, and no-secret assertion.
- [ ] Missing mandatory report is a failure, not a warning.

## Trusted publisher

- [ ] Publisher code is checked out from trusted default branch.
- [ ] Pull request resolution requires exact repository and source-head SHA.
- [ ] Branch identity is enforced when available.
- [ ] Ambiguous open/merged PR resolution fails closed.
- [ ] Markdown is sanitized before publishing.
- [ ] Publisher updates one sticky evidence comment and does not mutate source code.
- [ ] Permissions are limited to actions/content reads and PR/issue comment writes.

## Generated artifacts

- [ ] Validation workflow is read-only.
- [ ] Stale output creates an exact-head repair candidate artifact.
- [ ] Generator runs twice to prove idempotency.
- [ ] Changes outside the approved generated root fail.
- [ ] Repair report states `remote_write_executed=false`.
- [ ] CI fails closed on stale generated output.

## Governed writer

- [ ] Exactly one writer exists per generated root.
- [ ] Writer requires explicit one-time authorization and exact expected Head SHA.
- [ ] Authorization marker consumption is read back.
- [ ] Direct writes to main are forbidden.
- [ ] Force and force-with-lease are forbidden.
- [ ] Remote head is reread before push.
- [ ] Push is normal fast-forward and the pushed SHA is read back.
- [ ] CI and generated validation are explicitly dispatched after a write.
- [ ] Writer cannot modify files outside its approved root.

## Completion

- [ ] Tasks and all checklists are closed or explicitly deferred/cancelled with ownership.
- [ ] Exact-head CI and canonical summaries are present.
- [ ] Migration ledger is present when persistent schema changed.
- [ ] Production/main parity, health, and smoke are present when runtime changed.
- [ ] Manual fallback and rollback are tested.
- [ ] Remaining work is separated into verified, blocked, deferred, cancelled, and unowned.
- [ ] Any unowned work or evidence contradiction fails completion.
