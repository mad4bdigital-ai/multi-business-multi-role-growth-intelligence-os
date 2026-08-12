# Repository Inventory Guide

## Purpose

Repository Inventory is the generated census of every Git-tracked project file. It grows from the Git index instead of a manually maintained directory list.

The canonical outputs are:

```text
docs/repository-inventory.json
docs/repository-inventory-summary.json
docs/repository-inventory.md
```

`repository-inventory.json` is the complete machine-readable inventory. The summary JSON is optimized for low-noise review and dashboards. The Markdown file is the concise human report generated from the same deterministic snapshot.

Each inventoried file records its repository-relative path, category, extension, byte size, text-line count, SHA-256 fingerprint, normalized mode, executable marker, and generated-artifact marker. Generated Inventory and repository-evaluation outputs are excluded from Inventory inputs to prevent self-reference.

## Local lifecycle

```bash
npm run inventory:write
npm run inventory:check
npm run inventory:test
```

`inventory:write` regenerates the outputs. `inventory:check` fails when committed Inventory differs from deterministic regeneration. `inventory:test` validates schema, deterministic sorting, file count, byte totals, fingerprints, self-exclusion, and classification fixtures.

The generator discovers tracked files through `git ls-files`. New directories, workflows, migrations, contracts, languages, and documentation families therefore enter the Inventory automatically.

## Read-only verifier

The `Repository Inventory` workflow remains a verifier, not a writer:

```text
permissions:
  contents: read
```

It never commits, pushes, or persists write credentials. A manual exact-head verification accepts:

```text
target_ref=<governed work branch>
expected_head_sha=<exact 40-character SHA>
```

The verifier checks local/remote identity where applicable, installs dependencies, regenerates Inventory, runs `inventory:check` and `inventory:test`, and inspects the three-output diff.

Inventory-only commits are excluded from the normal push/pull-request path filters to prevent trigger loops. The governed writer explicitly dispatches an exact-head read-only verification after a repair.

## Governed regeneration authority

Repository Inventory has no second writer. `repository_inventory_refresh` is a registered recipe of `Governed Generated Artifact Refresh`.

Registered recipes include:

```text
auto
frontend_openapi_refresh
work_map_self_hosting_bootstrap
repository_inventory_refresh
```

For `repository_inventory_refresh`, the writer:

1. pins the exact non-protected target branch head;
2. rejects `main` and `Production`;
3. installs root dependencies with `npm ci --ignore-scripts`;
4. generates all three Inventory outputs twice;
5. compares SHA-256 output identities between passes;
6. runs `inventory:check` and `inventory:test`;
7. requires the dirty set to stay inside the exact three-output allowlist;
8. re-reads the remote branch immediately before mutation;
9. creates `docs(inventory): regenerate repository inventory` only when needed;
10. pushes without force;
11. requires post-push remote readback to equal the generated commit SHA;
12. dispatches `Repository Inventory` on the resulting exact head.

A clean replay is a no-op: no commit, no push, and no ref movement.

## Ordinary stale-only recovery

`Repository Inventory Autofix Dispatch` observes failed `Repository Inventory` runs. It is a dispatcher, not a repository writer.

Its classification phase is read-only. Its final delegation phase gets `actions: write` only to dispatch the already-trusted writer; it still has no `contents: write` permission and never pushes repository content itself.

Ordinary automatic repair requires all of the following:

- the source run is a failed `pull_request` run;
- exactly one open same-repository PR is identified;
- the PR targets `main` from a governed non-protected work branch;
- source-run SHA still equals current PR head SHA;
- `behind_by == 0` relative to current `main`;
- Inventory generator/package contract is unchanged from trusted `main`;
- writer, verifier, dispatcher, and maintenance-governance authority surfaces are unchanged from trusted `main`;
- read-only regeneration is deterministic;
- Inventory checks pass after regeneration;
- only the three Inventory outputs are dirty.

Forks, stale heads, additional dirty files, runner/setup failures, generator failures, changed mutation authority, or protected targets fail closed without writer dispatch.

## Self-hosting installation boundary

A first installation of `repository_inventory_refresh` is different from an ordinary stale-only repair. The PR necessarily changes the writer/verifier/dispatcher authority that does not yet exist on trusted `main`. Running that candidate mutation authority before merge would defeat the trust boundary.

The verifier therefore supports a narrow **read-only `bootstrap_pending` state** instead of a pre-merge write.

`bootstrap_pending` is allowed only when all of these conditions hold:

- event is `pull_request`;
- head repository equals the current repository;
- base is `main`;
- branch is governed and not `main` or `Production`;
- checked-out head equals the exact PR head;
- current `main` is an ancestor of the candidate (`behind_by == 0`);
- `scripts/repository-inventory.mjs`, root `package.json`, and root `package-lock.json` are byte-unchanged from trusted `main`;
- the PR includes the governed writer, Inventory verifier, Inventory autofix dispatcher, generated-artifact maintenance tool, and the `repository-inventory-governed-regeneration` E2E contract;
- deterministic regeneration changes exactly the three Inventory outputs and nothing else in the worktree.

When these conditions hold, the verifier publishes structured evidence with:

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

This is an evidence state, not a generated-artifact mutation. The verifier remains `contents: read` and performs no push.

The self-hosting rule is intentionally asymmetric:

```text
before source authority is trusted on main
  -> generate + test + prove exact output drift
  -> publish bootstrap_pending
  -> no candidate write authority

after source authority is trusted on main
  -> create a non-protected generated-output work branch from trusted main
  -> invoke repository_inventory_refresh through the trusted writer
  -> verify exact resulting head
  -> merge the generated-output PR through normal branch protection
```

This avoids both unsafe candidate writes and direct mutation of `main`.

## Post-merge bootstrap procedure

After the source/control PR containing the Inventory recipe has merged to `main`:

1. read and pin the new `main` SHA;
2. create a governed non-protected branch from that exact SHA;
3. open a bounded generated-output PR (a temporary change to one Inventory output may be used only to establish the PR before the trusted stale-only writer replaces all outputs);
4. require the branch authority surface to remain byte-identical to trusted `main`;
5. invoke `repository_inventory_refresh` through the now-trusted generated-artifact lifecycle;
6. require deterministic generation, exact three-file write set, exact-head CAS, non-force push, and post-push readback;
7. dispatch `Repository Inventory` on the generated commit and require it to pass currentness;
8. remove any temporary bootstrap-only delta before final verification if one was needed to establish the PR;
9. merge only after the generated-output PR is current and all required checks are green.

A temporary PR-establishment change must not survive the final generated-output tree. If removing it changes the Git index, rerun the trusted Inventory writer on the new exact head before merge.

## Loop and race prevention

Normal steady-state flow:

```text
PR source change
  -> Repository Inventory reports stale
  -> Autofix dispatcher proves stale-only + trusted authority
  -> governed writer receives exact SHA
  -> writer creates at most one Inventory-only commit
  -> normal Inventory path filters ignore that Inventory-only push
  -> writer explicitly dispatches exact-head Repository Inventory
  -> verifier succeeds
```

Concurrency is grouped by PR/target branch and exact-head CAS remains the final race guard. If a branch moves during generation, the writer blocks rather than rebasing blindly, replaying mutation, force-pushing, or touching a newer head.

## Governance boundaries

The `generated-artifact-refresh` registration in `.github/repository-maintenance-tool-governance.json` owns the three Inventory outputs. No parallel writer is introduced.

Forbidden behaviors remain:

- direct mutation of `main`;
- mutation of `Production` through this lifecycle;
- force push;
- arbitrary output paths;
- pull-request workflow write authority;
- execution of candidate-modified generated-artifact mutation authority before it is trusted on `main`;
- bypass of `inventory:check` or `inventory:test`;
- automatic repair against a stale PR head;
- treating setup, dependency, test, or generator failures as ordinary Inventory drift;
- publishing secrets in evidence.

## Extension policy

Categories are reporting heuristics, not inclusion gates. If a new project surface deserves a dedicated summary section, extend `scripts/repository-inventory.mjs` while preserving deterministic complete coverage.

Changes to the canonical Inventory generator or its root package contract are **not** eligible for the self-hosting `bootstrap_pending` exception described above. Those changes require a separately governed migration of generator trust because the bytes used to prove candidate Inventory would no longer come from the trusted `main` generator.
