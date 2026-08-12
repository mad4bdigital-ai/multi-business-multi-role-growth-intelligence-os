# Repository Inventory Guide

## Purpose

The repository inventory is a generated, machine-readable census of every Git-tracked project file. It is designed to grow with the repository rather than relying on manually maintained lists.

The authoritative complete machine-readable artifact is `docs/repository-inventory.json`. The compact `docs/repository-inventory-summary.json` is intended for low-noise Pull Request review and dashboards, while `docs/repository-inventory.md` is the concise human-readable report generated from the same snapshot.

## What is included

Each inventoried file includes its repository-relative path, normalized category, extension, byte size, counted text lines, SHA-256 content fingerprint, normalized Unix mode, executable marker, and whether it is a generated artifact. The inventory also contains deterministic provenance, totals, extension and category counts, package manifests, and grouped lists for workflows, migrations, API contracts, and tests/specifications. The generated artifacts intentionally do not embed the current commit SHA, branch, or commit date, because those values would make a freshly committed artifact stale immediately after every commit.

Generated inventory and repository-evaluation artifacts are deliberately excluded from the inventory inputs. This prevents self-reference and keeps regeneration deterministic.

## Local commands

```bash
npm run inventory:write
npm run inventory:check
npm run inventory:test
```

Use `inventory:write` after adding, removing, or modifying tracked repository files. Use `inventory:check` in validation steps; it returns a non-zero exit code when a committed inventory artifact is missing or stale. Use `inventory:test` to validate the artifact schema, deterministic sorting, file count, byte totals, SHA-256 fields, self-exclusion of generated files, and independent classification fixtures.

## Read-only verification

The `Repository Inventory` workflow remains read-only:

```text
permissions:
  contents: read
```

It runs on relevant pull-request and `main` changes and can also be dispatched with an exact governed work-branch identity:

```text
target_ref=<governed work branch>
expected_head_sha=<exact 40-character SHA>
```

An exact-head dispatch verifies both the local checkout and the remote branch head before running the official inventory lifecycle:

```text
npm ci --ignore-scripts
npm run inventory:write
npm run inventory:check
npm run inventory:test
git diff --exit-code -- <three inventory outputs>
```

The verifier never commits, pushes, or receives `contents: write`.

The normal workflow intentionally ignores commits that change only the three generated Inventory artifacts. This prevents a trigger loop. A governed writer therefore performs an explicit exact-head `Repository Inventory` dispatch after a repair instead of relying on an implicit push-triggered run.

## Governed regeneration authority

Repository Inventory does not have a separate writer. It is the `repository_inventory_refresh` recipe of the existing `Governed Generated Artifact Refresh` authority.

The writer accepts:

```text
--recipe auto
--recipe frontend_openapi_refresh
--recipe work_map_self_hosting_bootstrap
--recipe repository_inventory_refresh
```

`auto` preserves the pre-existing generated-artifact classification behavior. Repository Inventory is selected explicitly because it is cross-cutting and can become stale after changes to almost any tracked file.

For `repository_inventory_refresh`, the writer:

1. pins the exact target branch head;
2. rejects `main` and `Production` as mutation targets;
3. installs root dependencies with `npm ci --ignore-scripts`;
4. runs `inventory:write` twice;
5. compares SHA-256 hashes of all three generated outputs between passes;
6. runs `inventory:check` and `inventory:test`;
7. proves the dirty set is a subset of exactly the three Inventory outputs;
8. re-reads the exact branch head before commit/push;
9. creates `docs(inventory): regenerate repository inventory` only when drift exists;
10. pushes without force;
11. reads the remote result SHA back;
12. explicitly dispatches the read-only `Repository Inventory` verifier on that exact SHA.

The bounded outputs are only:

```text
docs/repository-inventory.json
docs/repository-inventory-summary.json
docs/repository-inventory.md
```

A clean replay is a no-op: no commit, no push, and no ref movement.

## Automatic stale-only recovery

`Repository Inventory Autofix Dispatch` observes completed `Repository Inventory` runs. It is a dispatcher, not a repository writer.

Its top-level authority is read-only. The classification job has only:

```text
actions: read
contents: read
pull-requests: read
```

The final dispatch job receives `actions: write` only so it can call the existing registered writer. It still has `contents: read` and never pushes repository content directly.

Automatic repair is eligible only when all of the following are true:

- the source `Repository Inventory` run failed;
- the source event is `pull_request`;
- exactly one open PR is identified;
- the PR base is `main`;
- the PR head belongs to the same repository;
- the source run SHA still equals the PR head SHA;
- the branch matches a governed work-branch pattern;
- the target is neither `main` nor `Production`;
- the current PR head is `behind_by == 0` relative to `main`;
- the Inventory generator/test/package control surface is unchanged from trusted `main`;
- the generated-artifact writer, verifier, dispatcher, and maintenance governance surface are unchanged from trusted `main`;
- read-only reproduction is deterministic;
- the official Inventory check and self-test pass after regeneration;
- the only dirty paths are Inventory outputs.

If a PR modifies the Inventory automation or its writer/governance control surface, automatic repair is intentionally blocked with `governance_surface_changed_requires_manual_regeneration`. That prevents a privileged `workflow_run` path from executing modified mutation authority. Such PRs must use a separately reviewed/manual governed regeneration path.

A plain workflow failure is never treated as proof of stale Inventory. Installation errors, generator/test failures, malformed outputs, runner failures, control-plane changes, forks, stale PR heads, or additional dirty files all fail closed without writer dispatch.

## Loop and race prevention

The normal lifecycle is:

```text
PR change
  -> Repository Inventory fails
  -> Autofix dispatcher proves stale-only
  -> existing governed writer receives exact SHA
  -> at most one Inventory-only repair commit
  -> normal Inventory trigger ignores Inventory-only commit
  -> writer explicitly dispatches Repository Inventory on the new exact SHA
  -> verifier succeeds
  -> dispatcher sees source event=workflow_dispatch and takes no action
```

Concurrency is grouped by PR, and the writer's exact-head CAS remains the final race guard. If the branch moves during regeneration, the writer blocks rather than rebasing, retrying blindly, force-pushing, or mutating a newer head.

## Governance boundaries

The `generated-artifact-refresh` registration in `.github/repository-maintenance-tool-governance.json` owns the three Inventory output patterns. No second mutation tool is introduced.

The following remain forbidden:

- direct mutation of `main`;
- any mutation of `Production` through this lifecycle;
- force push;
- arbitrary changed paths;
- pull-request workflow write authority;
- bypass of `inventory:check` or `inventory:test`;
- repair when exact-head identity is stale;
- automatic repair of a PR that changes the trusted regeneration control surface.

## Extension policy

The generator discovers files through `git ls-files`, not through a hard-coded directory allowlist. A new directory, language, workflow, migration, contract, or documentation family is therefore included automatically. Categories are assigned by path heuristics for reporting only; they do not control inclusion.

If a new project surface deserves a dedicated summary section, extend the category or surface heuristics in `scripts/repository-inventory.mjs` while preserving the complete file list in JSON. Changes to the generator or its trusted control surface require manual governed Inventory regeneration for that PR; automatic stale-only recovery resumes for later PRs once the trusted implementation is merged to `main`.
