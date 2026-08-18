# Repository Inventory Guide

## Purpose

Repository Inventory is the deterministic generated census of Git-tracked project files. Repository Evaluation is a dependent generated state whose fingerprint depends on Inventory.

Canonical outputs:

```text
docs/repository-inventory.json
docs/repository-inventory-summary.json
docs/repository-inventory.md
docs/repository-evaluation.json
docs/repository-evaluation-summary.json
docs/repository-evaluation.md
```

The lifecycle is governed by `.github/derived-state-governance.json`. Inventory and Evaluation are registered as `artifact_class=observability`, `merge_blocking=false`, and share the `repository_inventory_refresh` recipe.

## v2 policy

Repository State has two deliberately separate phases:

```text
pull request / exact candidate
  -> read-only verification
  -> stale observability is advisory
  -> no feature-branch mutation

post merge / exact main
  -> detect stale Inventory or Evaluation
  -> dispatch the trusted bounded writer
  -> publish through a non-protected convergence branch
  -> exact-head read-only verification
```

The old `bootstrap_pending` feature-branch lifecycle is retired. Candidate-modified writer authority is not executed to converge a pull request, and stale Repository State is not made merge-blocking merely to force generated observability files into the feature branch.

## Local lifecycle

```bash
npm run inventory:write
npm run inventory:check
npm run inventory:test
npm run evaluation:write -- --enforce
npm run evaluation:test
npm run evaluation:check -- --enforce
```

Inventory generation discovers tracked files through `git ls-files`. Generated Inventory and Evaluation outputs are excluded from Inventory inputs to prevent self-reference.

Evaluation is generated only after Inventory is deterministic and current. The governed writer performs two Inventory generation passes, validates Inventory, then performs two enforced Evaluation generation passes and validates Evaluation.

## Exact-candidate read-only verification

`Repository Inventory` and `Repository Evaluation` are verifiers, not writers:

```text
permissions:
  contents: read
```

Checkout uses `persist-credentials: false`. Verification never commits or pushes generated state.

The Inventory v2 gate requires the checked-out `HEAD` to equal the exact expected SHA. It regenerates Inventory twice, verifies deterministic hashes, runs Inventory checks, restores generated outputs, and reports one of these semantic states:

```text
current
  outcome=passed
  current=true
  blocking=false

stale observability
  outcome=advisory
  inventory_state=stale_observability
  current=false
  blocking=false
  artifact_class=observability
  merge_blocking=false
  followup_required=true
  followup_mode=post_merge_observability_publish
```

Repository Evaluation follows the same policy class: exact-head, read-only, advisory on pull-request drift, and no feature-branch convergence write.

A manual exact-head verification may bind to:

```text
target_ref=<governed non-protected work branch>
expected_head_sha=<exact 40-character SHA>
```

Exact-head verification on a governed post-merge output branch fails if the committed generated state is not current; this is verification of the writer result, not permission to repair it in place.

## Post-merge convergence signal

Both observability artifacts share one writer recipe. The `Repository Inventory` workflow therefore acts as the bounded exact-main convergence signal:

1. verify Inventory on the exact `main` SHA;
2. if Inventory is stale, emit a failed post-merge convergence signal;
3. if Inventory is current, check dependent Repository Evaluation currentness;
4. if Evaluation is stale, emit the same shared-recipe signal;
5. perform no repository mutation in the verifier.

This avoids using unrelated Repository Evaluation setup or network-audit failures as writer triggers.

`Repository Inventory Autofix Dispatch` listens to failed `Repository Inventory` runs. For pull-request-originated runs it suppresses mutation. For a failed exact-main push run it verifies the live main SHA and delegates `repository_inventory_refresh` to the existing governed writer.

## Governed regeneration authority

Repository State has one mutating authority: `Governed Generated Artifact Refresh` using the registered `repository_inventory_refresh` recipe.

The dispatcher has no `contents: write` permission. It uses `actions: write` only to invoke the trusted writer.

The writer operates on a non-protected branch named from the exact source main SHA:

```text
chore/repository-inventory-main-sync-<sha12>
```

It rejects `main` and `Production` as mutation targets.

For `repository_inventory_refresh`, the trusted writer performs this ordered transaction:

1. pin exact source main and target identities;
2. reject protected mutation targets;
3. install required dependencies;
4. generate Inventory twice and compare SHA-256 identities;
5. run `inventory:check` and `inventory:test`;
6. generate Evaluation twice with enforcement;
7. compare Evaluation SHA-256 identities;
8. run `evaluation:test` and enforced Evaluation currentness;
9. require the dirty set to remain within the six registered outputs;
10. re-read the remote target immediately before mutation;
11. create at most one generated-state commit;
12. push without force;
13. require post-push remote readback to equal the generated commit SHA;
14. dispatch Repository Inventory and Repository Evaluation exact-head read-only verifiers on that result SHA.

The maximum mutation write set is exactly:

```text
docs/repository-inventory.json
docs/repository-inventory-summary.json
docs/repository-inventory.md
docs/repository-evaluation.json
docs/repository-evaluation-summary.json
docs/repository-evaluation.md
```

A clean replay is a no-op: no commit, no push, and no ref movement.

## Publication

After writer readback, the governed main-convergence publisher validates that the changed paths are a subset of the outputs registered for the recipe and creates or reuses a pull request from the non-protected convergence branch to `main`.

Generated observability outputs are therefore published through normal governed review/closure rather than by direct mutation of `main`.

## Race and trust boundaries

Exact SHA identity is checked before verification and before mutation. The writer re-reads the remote branch immediately before push and verifies the resulting remote SHA after push. It never force-pushes.

The source/control PR may change the writer or governance that controls this lifecycle, but those candidate bytes are not used as a pre-merge Repository State mutation authority. Once merged, the trusted main copy may create the bounded post-merge convergence branch.

## Governance boundaries

Forbidden behaviors include:

- direct generated-artifact mutation of `main`;
- mutation of `Production` through Repository State convergence;
- force push;
- arbitrary output paths;
- pre-merge feature-branch mutation to satisfy observability currentness;
- treating Repository Inventory or Evaluation drift as merge-blocking semantic state;
- executing arbitrary commands from policy data;
- bypassing Inventory or Evaluation determinism/currentness tests;
- generating Evaluation before Inventory is verified;
- using a stale target head;
- interpreting unrelated setup, dependency, network, or test failures as ordinary generated-state drift;
- publishing credentials or secrets in evidence.

Semantic derived-state artifacts remain separate. For example, Work Maps are registered as semantic and merge-blocking; their stale state cannot be downgraded by the Repository State observability policy.
