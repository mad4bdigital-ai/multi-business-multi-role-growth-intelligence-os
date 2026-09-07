# Governed Production Promotion — Immutable Release-Cut Controller

## Problem

The previous Production promotion flow treated the current `main` tip as both the authorized release identity and the moving development branch. Any descendant commit that reached `main` during candidate validation made the candidate stale even when the candidate tree, Production ancestry, CI evidence, and supporting gates were still valid.

The launcher also embedded the supporting-workflow inventory and per-workflow dispatch behavior directly in YAML. That made the promotion path sensitive to workflow additions, run-discovery races, and YAML/shell serialization defects.

## Release identity

The controller separates two protected-ref identities:

- **release cut** — the exact `main` commit explicitly authorized by the governed request;
- **current main** — the moving development tip observed during build, validation, and final readback.

A release remains valid when current `main` advances only if the release cut is still an ancestor of current `main`.

`Production` is stricter. It must remain exactly equal to the SHA pinned when the request was authorized. The pinned Production SHA must already be an ancestor of the release cut and of the candidate. If Production moves, the old authorization is not reused.

## Promotion session identity

`.github/scripts/production-promotion-identity.mjs` is the shared source for deterministic operation/session identity and Production candidate surface parsing.

The durable session identity is derived from exact repository, release-cut SHA, and pinned Production SHA. GitHub workflow run IDs and run attempts are evidence metadata; they are not promotion-session authority.

The current governed launcher surface remains deterministic and idempotent:

`release/production-candidate-<release-cut-12>-<Production-12>`

The branch prefixes are routing hints only. Acceptance always requires the exact 40-character SHAs and the Git graph checks below. Older run-bound certified surfaces and legacy bridge/push surfaces remain compatibility paths and do not broaden the canonical namespace.

Repeated execution for the same release-cut/Production pair must converge on the same operation identity rather than minting a new promotion merely because GitHub assigned a new workflow run ID.

## Candidate contract

The candidate is a merge commit with exactly two parents:

1. first parent = certified release cut;
2. second parent = pinned Production;
3. tree = exact release-cut tree.

A third parent is invalid even when it happens to preserve both required ancestors. Merely proving that Production is somewhere in candidate ancestry is insufficient; the exact second-parent binding is part of the release identity.

The validation base branch points to the release cut. Candidate, release, validation, and validation-base refs are moved only by fast-forward. No force push is permitted.

## Validation contract

The candidate opens a validation PR titled `test(release): certify immutable Production candidate …`, which activates the existing `Certified Production Release Cut Validation` workflow.

That workflow requires:

- exact same-repository candidate identity;
- exactly two candidate parents;
- candidate first-parent binding to the release cut;
- candidate second-parent binding to the exact pinned Production SHA;
- byte-identical candidate/release-cut trees;
- release cut contained by current `main` before and after direct CI;
- pinned Production contained by the release cut and unchanged during validation;
- successful Syntax, Unit & Integration, Execution Resolver, and Architecture Drift jobs.

The final validation readback repeats the parent-count, first-parent, second-parent, tree, main-ancestry, and Production-stability checks before evidence is emitted.

The certified evidence explicitly records `main_tip_may_advance: true` and the exact two-parent topology assertions.

## Declarative supporting gates

Required promotion support gates live in `.github/contracts/production-promotion-supporting-gates.v1.json`.

The typed resolver rejects unknown fields, duplicate IDs/workflows, protected refs, unsafe effects, unsupported review modes, secret-like input names, unbounded values, and unregistered templates. All currently registered gates are required and read-only.

The controller dispatches all required gates against the exact candidate first, records their exact run IDs, then waits for their results. This shortens the validation window without weakening SHA, branch, ancestry, or effect checks.

Adding or replacing a supporting gate therefore changes the reviewed registry and its SHA-256 identity instead of adding a new workflow-name branch to launcher code.

## Evidence authority

The canonical convergence artifact is `governed_production_promotion_convergence.v2`.

It records the release cut, current main, pinned Production, candidate, certified validation run, gate-registry digest, exact supporting run IDs, ancestry assertions, and explicit non-mutation flags.

PR comments and branch-name prefixes are observability/routing surfaces only after canonical evidence exists. A comment transport failure cannot convert valid canonical evidence into a false promotion failure or authorize a mutation, and a syntactically plausible branch name cannot replace exact graph validation.

## Final guards

`Governed Production Main Source-Pin Guard`, `Governed Production Release Source-Pin Gate`, and `Governed Production Promotion Post-Finalization Guard` use the same rule:

- descendant movement of `main` is allowed;
- release-cut ancestry loss is blocking;
- Production movement is blocking;
- candidate tree or parent drift is blocking;
- loss of Production ancestry is blocking.

A truly invalid release cut requires a new authorization. The post-finalization guard does not blindly reopen and reuse an authorization after Production or ancestry has changed.

## Safety boundary

This controller prepares and verifies Git ancestry only. It does not authorize or execute:

- merge into `Production`;
- deployment or restart;
- migration apply or SQL mutation;
- grant apply;
- provider mutation;
- credential payload reads;
- protected-ref direct writes;
- force push.

Those actions remain separately governed.
