# Governed AI Policy Review Mode

## Purpose

`mad4b.production-promotion-review-mode.v1` adds a bounded review mode to the governed Production promotion launcher. It prevents a promotion run from waiting indefinitely on GitHub `pull_request` workflow approvals when the required checks are read-only supporting gates, while preserving the protected `Production` review surface.

The mode is implemented as a deterministic **AI policy agent contract** inside the governed launcher. It is intentionally reproducible and does not require an LLM key, credential payload, external model call, database access, or provider mutation. Any future model-backed reviewer must be introduced as a separately reviewed adapter and must not inherit this mode's authority automatically.

## Modes

| Mode | Supporting workflow behavior | Protected Production behavior |
|---|---|---|
| `human` | Preserve the existing behavior and wait for the normal maintainer-controlled workflow result. | No merge or deployment is performed by the launcher. |
| `ai_policy` | Ignore stale or approval-blocked `pull_request` runs for the supporting gates, dispatch each exact-head read-only workflow through `workflow_dispatch`, and wait for its result. | The mode may not merge `Production`, deploy, apply migrations or grants, mutate databases or providers, read credential payloads, or authorize protected-ref mutation. |

The value is validated by the gateway parameter schema and is limited to `human` or `ai_policy`. Unknown values fail closed before the launcher is dispatched.

## Exact-head and review contract

The gateway still requires trusted `main`, an exact lowercase SHA pin, an open same-repository request PR targeting `main`, and the fixed typed authorization `AUTHORIZE_GOVERNED_PRODUCTION_PROMOTION_REQUEST`. The launcher independently validates the request PR, current `main`, `Production`, candidate branches, validation branches, tree equality, exact candidate validation, and protected-ref readback.

In `ai_policy` mode, the agent reviews only the following bounded condition: the candidate is source-pinned, exact validation succeeds, the supporting workflow is one of the registered read-only workflows, and the run is dispatched against the exact candidate head. The mode does not convert a failed test into success and does not approve a deployment environment or a protected release PR.

## Evidence

Successful convergence evidence records `review_mode`, `review_authority`, `ai_policy_scope`, exact supporting run IDs, exact candidate validation, protected-ref stability, and the invariant fields `merge_executed=false`, `deployment_executed=false`, `migration_executed=false`, `provider_call_executed=false`, `credential_payload_read=false`, and `secrets_included=false`.

The resulting release PR remains a review surface. It states the exact pinned `main` and `Production` SHAs and remains subject to the repository's protected-release policy. The launcher creates review surfaces and evidence only; it does not merge them.

## Failure behavior

The mode fails closed when the trusted SHA moves, the request PR changes identity, the candidate tree differs from `main`, exact validation is missing or unsuccessful, a supporting workflow is outside the registered allowlist, an exact-head dispatch run cannot be observed, or any protected reference changes during validation. The source-pin guard also marks stale release surfaces and cancels stale governed runs when its write permission is available.

## Security boundary

This feature is not an approval bypass for production execution. It is an automation mode for non-mutating verification. A deployment, migration, grant, provider mutation, credential read, or protected `Production` merge still requires its own explicit governed path and authorization. Spec 015 remains outside the scope of this change.
