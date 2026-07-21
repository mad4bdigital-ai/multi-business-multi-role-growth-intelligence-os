# Acceptance Matrix

## Functional acceptance

| Scenario | Expected result |
|---|---|
| Admin requests a repository change | One operation creates context, plan, binding, capability, worker execution, CI, and readback evidence. |
| Tool projection compiler runs twice on identical inputs | Projection digest and rows are identical. |
| Active operation has no healthy binding | Execution blocks with candidate exclusions and no low-level probing. |
| User preference selects local execution but Tenant policy denies it | Denial wins; another eligible binding is selected or the operation blocks. |
| Operation is interrupted during approval | Resume restores the bound plan after authority and fingerprint revalidation. |
| Capability envelope expires during legitimate active execution | The lifecycle service renews within policy and records replacement evidence. |
| Branch is behind only | Fast-forward binding completes with no force and readback. |
| Branch is diverged with source conflicts | Managed Git worker returns reviewed conflict scope or applies approved resolution. |
| Conflict is generated documentation only | Sources merge, generator runs once, and final digest is verified. |
| CI fails | Diagnosis identifies check, job, step, reason code, affected paths, and recovery operation. |

## Security acceptance

- Tenant cannot override Tenant/user/workspace/brand identity.
- Tenant cannot discover an Admin-only operation.
- Missing or open Tenant input schema hides and blocks the tool.
- Blocked capability manifest hides and blocks the Tenant tool.
- SQL metadata rejects secret-like values and executable source.
- Worker credentials are short-lived, scoped, and never returned.
- Protected branches and force pushes are blocked.
- Preferences never widen capability or policy authority.
- Upstream HTML errors are normalized and redacted.

## Resilience acceptance

- Duplicate operation request returns the original idempotent run.
- Duplicate callback is processed once.
- GitHub 5xx after a possible write triggers remote readback before retry.
- Worker crash releases or expires the lease and supports bounded resume.
- Main moves before push; worker revalidates and blocks or replans.
- Projection apply fails mid-transaction; no partial tool visibility occurs.
- Cache update failure blocks projection completion and preserves prior revision.
- Generated artifact generator fails; no branch success is reported.

## Negative acceptance

- Unregistered operation key.
- Unknown handler or adapter key.
- Binding references disabled operation.
- Stale health accepted as healthy.
- Infinite fallback cycle.
- Capability reused across unrelated operations.
- Operation revision changes silently after plan creation.
- CI generic exit code reported without available step evidence.
- Direct caller SQL required for normal operation execution.
- Local connector outage blocks a managed cloud repository operation.

## Completion gates

- All registry/compiler/runtime/worker/diagnosis tests pass.
- Migration ledger and same-cycle readback complete.
- Admin projection pilot passes.
- Selected Tenant projection pilot passes.
- Rollback drill passes.
- Production SHA parity and smoke evidence complete.
- Post-merge audit has no unresolved critical findings.
