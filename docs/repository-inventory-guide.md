# Repository Inventory Guide

## Purpose

Repository Inventory is the generated census of every Git-tracked project file. It grows from the Git index instead of a manually maintained directory list.

The canonical Inventory outputs are:

```text
docs/repository-inventory.json
docs/repository-inventory-summary.json
docs/repository-inventory.md
```

`repository-inventory.json` is the complete machine-readable inventory. The summary JSON is optimized for low-noise review and dashboards. The Markdown file is the concise human report generated from the same deterministic snapshot.

Each inventoried file records its repository-relative path, category, extension, byte size, text-line count, SHA-256 fingerprint, normalized mode, executable marker, and generated-artifact marker. Generated Inventory and Repository Evaluation outputs are excluded from Inventory inputs to prevent self-reference.

Repository Evaluation is a dependent generated state. Its canonical outputs are:

```text
docs/repository-evaluation.json
docs/repository-evaluation-summary.json
docs/repository-evaluation.md
```

Evaluation fingerprints Inventory state, so a valid Inventory refresh can make a previously committed Evaluation stale even when no Evaluation source file changed. The governed lifecycle therefore treats `Inventory -> Evaluation` as one ordered repository-state convergence transaction whenever the trusted Inventory writer performs mutation.

## Local lifecycle

```bash
npm run inventory:write
npm run inventory:check
npm run inventory:test
npm run evaluation:write -- --enforce
npm run evaluation:test
npm run evaluation:check -- --enforce
```

`inventory:write` regenerates the Inventory outputs. `inventory:check` fails when committed Inventory differs from deterministic regeneration. `inventory:test` validates schema, deterministic sorting, file count, byte totals, fingerprints, self-exclusion, and classification fixtures.

The generator discovers tracked files through `git ls-files`. New directories, workflows, migrations, contracts, languages, and documentation families therefore enter the Inventory automatically.

Evaluation must be generated only after Inventory is deterministic and current. The trusted writer runs two Inventory generation passes and verifies them before it starts two enforced Evaluation generation passes.

## Read-only verifiers

The `Repository Inventory` and `Repository Evaluation` workflows remain verifiers, not writers:

```text
permissions:
  contents: read
```

They never commit, push, or persist write credentials.

A manual or trusted exact-head verification can bind the verification to:

```text
target_ref=<governed work branch>
expected_head_sha=<exact 40-character SHA>
```

Repository Evaluation validates that the target is a governed non-protected branch, reads the remote branch SHA, checks out the exact expected SHA with credentials disabled, then verifies both local and remote identity again before evaluation.

Inventory-only and Evaluation-only generated commits are excluded where appropriate from normal trigger paths to prevent loops. The governed writer explicitly dispatches read-only exact-head verification after a repository-state repair.

## Governed regeneration authority

Repository state has no second writer. `repository_inventory_refresh` remains a registered recipe of the sole `Governed Generated Artifact Refresh` mutation authority.

Registered recipes include:

```text
auto
frontend_openapi_refresh
work_map_self_hosting_bootstrap
repository_inventory_refresh
```

For `repository_inventory_refresh`, the trusted writer performs one ordered transaction:

1. pin the exact non-protected target branch head;
2. reject `main` and `Production` as mutation targets;
3. install root dependencies with `npm ci --ignore-scripts`;
4. generate the three Inventory outputs twice;
5. compare Inventory SHA-256 identities between both passes;
6. run `inventory:check` and `inventory:test`;
7. only after Inventory succeeds, generate the three Evaluation outputs twice with enforcement;
8. compare Evaluation SHA-256 identities between both passes;
9. run `evaluation:test` and enforced Evaluation currentness;
10. require the dirty set to remain inside the six registered repository-state outputs;
11. re-read the remote branch immediately before mutation;
12. create one generated-state commit only when needed;
13. push without force;
14. require post-push remote readback to equal the generated commit SHA;
15. dispatch `Repository Inventory` and `Repository Evaluation` as read-only verifiers on the same resulting exact SHA.

The six mutation outputs are bounded to:

```text
docs/repository-inventory.json
docs/repository-inventory-summary.json
docs/repository-inventory.md
docs/repository-evaluation.json
docs/repository-evaluation-summary.json
docs/repository-evaluation.md
```

A clean replay is a no-op: no commit, no push, and no ref movement.

## Stale classification remains Inventory-bounded

The read-only stale classifier remains intentionally narrower than the trusted mutation transaction.

Before delegation, ordinary Inventory drift classification regenerates and inspects only the three Inventory outputs. This keeps the authority decision based on the canonical Inventory symptom and prevents the classifier from becoming another Evaluation writer.

After trusted delegation, `repository_inventory_refresh` owns the dependent convergence and may update both Inventory and Evaluation within the six-file allowlist.

This distinction is deliberate:

```text
read-only classification
  -> prove exact three-file Inventory drift
  -> no repository mutation

trusted repository-state mutation
  -> converge Inventory first
  -> converge dependent Evaluation second
  -> exact six-file maximum write-set
  -> dual exact-head read-only verification
```

## Ordinary stale-only recovery

`Repository Inventory Autofix Dispatch` observes failed `Repository Inventory` runs. It is a dispatcher, not a repository writer.

Its classification phase is read-only. Its final delegation phase gets `actions: write` only to dispatch the already-trusted writer; it still has no `contents: write` permission and never pushes repository content itself.

Ordinary automatic repair requires all of the following:

- the source run is an eligible failed run under the governed recovery contract;
- exactly one same-repository target branch is identified where required;
- the target is a governed non-protected work branch;
- source-run SHA still equals the current exact target head;
- the candidate is not behind current `main` where the PR path requires zero-behind freshness;
- Inventory generator/package contract is unchanged from trusted `main`;
- writer, verifier, dispatcher, and maintenance-governance authority surfaces satisfy the trusted-authority contract;
- read-only Inventory regeneration is deterministic;
- Inventory checks pass after regeneration;
- only the three Inventory outputs are dirty during stale classification.

Forks, stale heads, additional dirty files, runner/setup failures, generator failures, changed mutation authority, or protected targets fail closed without writer dispatch.

## Self-hosting installation boundary

A first installation or change of `repository_inventory_refresh` is different from an ordinary stale-only repair. The PR changes mutation authority that is not yet trusted on `main`. Running that candidate mutation authority before merge would defeat the trust boundary.

The verifier therefore supports a narrow read-only `bootstrap_pending` state instead of a pre-merge write.

`bootstrap_pending` requires the governed repository identity and exact-head conditions defined by the Inventory verification gate, including a non-protected governed target, trusted Inventory generator/package bytes, zero-behind freshness where required, deterministic generation, and an Inventory-only three-output dirty classification.

When those conditions hold, the verifier may publish structured evidence such as:

```text
outcome=bootstrap_pending
inventory_state=self_hosting_bootstrap_pending
current=false
trusted_generator_unchanged=true
behind_by_zero=true
repository_mutation=false
protected_branch_mutation=false
force_push=false
followup_mode=trusted_post_merge_work_branch
```

This is evidence, not mutation. Candidate-modified generated-artifact authority remains non-executable until that authority is trusted on `main`.

The self-hosting rule is intentionally asymmetric:

```text
before source authority is trusted on main
  -> generate + test + prove exact Inventory drift
  -> publish bootstrap_pending
  -> no candidate write authority

after source authority is trusted on main
  -> create a non-protected generated-output work branch from trusted main
  -> invoke repository_inventory_refresh through the trusted writer
  -> converge Inventory then Evaluation
  -> verify both families on the exact resulting head
  -> merge the generated-output PR through normal branch protection
```

This avoids unsafe candidate writes and direct mutation of `main`.

## Post-merge convergence procedure

After the source/control PR containing the repository-state recipe has merged to `main`:

1. read and pin the new `main` SHA;
2. create or validate a governed non-protected convergence branch from that exact SHA;
3. keep the branch authority surface byte-identical to trusted `main`;
4. invoke `repository_inventory_refresh` through the trusted generated-artifact lifecycle;
5. require deterministic Inventory generation and Inventory currentness first;
6. require deterministic Evaluation generation and enforced Evaluation currentness second;
7. require the final write set to stay within the six repository-state outputs;
8. require exact-head CAS, non-force push, and post-push readback;
9. dispatch both Repository Inventory and Repository Evaluation against the same resulting exact SHA;
10. merge only after the generated-output PR is current and required checks are green.

No generated output should be edited by hand to bypass this lifecycle.

## Loop and race prevention

Normal steady-state flow:

```text
source change
  -> Repository Inventory detects stale state
  -> Autofix dispatcher proves bounded drift + trusted authority
  -> governed writer receives exact SHA
  -> writer converges Inventory
  -> writer converges dependent Evaluation
  -> writer creates at most one bounded repository-state commit
  -> writer reads back exact remote head
  -> writer dispatches exact-head Inventory verifier
  -> writer dispatches exact-head Evaluation verifier
  -> both verifiers remain read-only
```

Concurrency is grouped by target branch and exact-head CAS remains the final race guard. If a branch moves during generation, the writer blocks rather than rebasing blindly, replaying mutation, force-pushing, or touching a newer head.

## Verification evidence compatibility

The canonical verification-dispatch evidence keeps the existing contract:

```text
mad4b.generated-artifact-refresh-verification-dispatch.v1
```

Legacy top-level `workflow` and `workflow_file` fields remain present and identify the primary verifier. Repository-state convergence adds a `verifiers` array so Inventory and Evaluation verification requests can be represented together without breaking existing v1 consumers.

Job logs remain diagnostic. Canonical reports and exact-head workflow results are the decision evidence.

## Governance boundaries

The `generated-artifact-refresh` registration in `.github/repository-maintenance-tool-governance.json` remains the sole registered mutating repository maintenance tool. For the repository-state recipe, its bounded output authority covers the three Inventory plus three Evaluation files only.

Forbidden behaviors remain:

- direct mutation of `main`;
- mutation of `Production` through this lifecycle;
- force push;
- arbitrary output paths;
- pull-request workflow write authority;
- execution of candidate-modified generated-artifact mutation authority before it is trusted on `main`;
- bypass of Inventory determinism/currentness/tests;
- generating Evaluation before Inventory is proven current;
- bypass of Evaluation determinism/currentness/tests;
- automatic repair against a stale target head;
- treating setup, dependency, test, or generator failures as ordinary generated-state drift;
- publishing secrets in evidence.

## Extension policy

Categories are reporting heuristics, not inclusion gates. If a new project surface deserves a dedicated summary section, extend `scripts/repository-inventory.mjs` while preserving deterministic complete coverage.

Changes to the canonical Inventory generator or its root package contract are not eligible for a self-hosting exception that would execute candidate mutation authority. Those changes require a separately governed migration of generator trust because the bytes used to prove candidate Inventory would no longer come from trusted `main`.