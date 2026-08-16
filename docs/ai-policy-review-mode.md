# Governed AI Policy Review Mode

## Purpose

`mad4b.production-promotion-review-mode.v2` is the bounded review mode used by the governed Production release-cut controller. It automates only non-mutating verification and does not inherit authority to merge `Production`, deploy, apply SQL or migrations, apply grants, mutate providers, or read credential payloads.

The mode is deterministic and does not require an LLM key, external model call, database access, provider access, or secret payload. A future model-backed reviewer would require a separately reviewed adapter and would not inherit this authority automatically.

## Modes

| Mode | Supporting-gate behavior | Production behavior |
|---|---|---|
| `human` | Execute the registered exact-candidate read-only gates and preserve human-action-required states when the workflow itself requires them. | No merge or deployment is performed by the controller. |
| `ai_policy` | Execute only the declaratively registered exact-candidate read-only gates and reject approval-blocked or non-success terminal results. | No protected merge, deploy, migration, grant, provider mutation, credential read, or protected-ref write is permitted. |

The gateway parameter schema accepts only `human` or `ai_policy`. Unknown values fail closed before dispatch.

## Release identity

The authorized identity is an immutable **release cut**, not the moving `main` tip.

The gateway still runs from trusted `main` and binds the request to an exact SHA. The request PR head must be same-repository, descend from the authorized release cut, and be tree-identical to it. This allows a marker-only governed request without changing release bytes.

During convergence:

- current `main` may advance only while the release cut remains an ancestor;
- `Production` must remain exactly pinned;
- pinned `Production` must already be an ancestor of the release cut;
- candidate first parent must be the release cut;
- candidate tree must be byte-identical to the release cut;
- candidate must contain pinned Production ancestry.

A descendant commit on `main` therefore does not invalidate an already authorized release. A Production move, release-cut ancestry loss, candidate drift, or required-gate failure does.

## Supporting-gate authority

The supporting workflow inventory is not embedded in launcher control flow. It is declared in:

`.github/contracts/production-promotion-supporting-gates.v1.json`

The typed resolver validates that every current gate is required, `read_only`, enabled only for registered review modes, and free of secret-like input names or unsupported templates. The registry SHA-256 identity is recorded in convergence evidence.

The controller dispatches all required supporting gates against the exact candidate before beginning the wait pass. This reduces the validation window while keeping exact candidate SHA and exact run-ID evidence for every gate.

## Certified exact validation

The candidate opens a `test(release): certify immutable Production candidate …` validation surface. The existing `Certified Production Release Cut Validation` workflow performs direct CI against the immutable candidate and requires release-cut/current-main ancestry plus Production stability before and after the CI cycle.

A failed test is never converted into success by `ai_policy`.

## Evidence

Canonical convergence evidence uses `governed_production_promotion_convergence.v2` and records:

- release cut and current `main` separately;
- whether `main` advanced after the cut;
- pinned Production and exact candidate;
- certified validation run ID;
- supporting-gate registry digest and exact gate run IDs;
- release-cut/current-main ancestry;
- Production/release-cut and Production/candidate ancestry;
- exact candidate/release-cut tree identity;
- explicit non-mutation flags.

The evidence does not claim that candidate bytes equal the latest moving `main` when `main` has advanced.

PR comments are observability surfaces after the canonical artifact exists. Comment-transport failure is reported as degraded observability and cannot create execution authority or turn valid canonical evidence into a synthetic promotion failure.

## Runtime reliability

Direct workflow run IDs are preferred. Bounded run discovery is retained only as a fallback and filters by exact candidate SHA, workflow event, and dispatch time. Terminal exact-head success is preferred over a newer queued duplicate.

The main source guard, Production release-source gate, and post-finalization guard all use the same release-cut ancestry contract. The post-finalization guard does not blindly reopen a stale authorization after Production or release ancestry changes; a truly invalid cut requires a new governed authorization.

## Security boundary

This mode is not a Production approval bypass. It is a bounded verifier for repository evidence. Merge, deployment, migration apply, grant apply, provider mutation, credential access, protected-ref mutation, and force push remain outside its authority.
