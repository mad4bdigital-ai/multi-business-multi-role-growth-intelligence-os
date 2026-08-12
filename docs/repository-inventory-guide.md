# Repository Inventory Guide

## Purpose

The repository inventory is a generated, machine-readable census of every Git-tracked project file. It is designed to grow with the repository rather than relying on manually maintained lists.

The authoritative machine-readable artifact is `docs/repository-inventory.json`. The companion `docs/repository-inventory.md` is a concise human-readable report generated from the same snapshot.

## What is included

Each inventoried file includes its repository-relative path, normalized category, extension, byte size, counted text lines, and whether it is a generated artifact. The inventory also contains commit metadata, totals, extension and category counts, package manifests, and grouped lists for workflows, migrations, API contracts, and tests/specifications.

Generated inventory artifacts are deliberately excluded from their own file list. This prevents self-referential output and guarantees deterministic regeneration.

## Local commands

```bash
npm run inventory:write
npm run inventory:check
```

Use `inventory:write` after adding or removing repository files. Use `inventory:check` in validation steps; it returns a non-zero exit code when either committed artifact is missing or stale.

## Continuous integration

The `Repository Inventory` workflow runs on pull requests and pushes to `main` when repository content changes, and can also be started manually. It uses the Node version declared by `.nvmrc`, regenerates both artifacts, verifies determinism, and uploads the artifacts for inspection. It has read-only repository permissions.

The workflow intentionally ignores changes to the two generated inventory files as triggers. This avoids a second run caused solely by the report update while still requiring the generated files to be committed in the same pull request.

## Extension policy

The generator discovers files through `git ls-files`, not through a hard-coded directory allowlist. A new directory, language, workflow, migration, contract, or documentation family is therefore included automatically. Categories are assigned by path heuristics for reporting only; they do not control inclusion.

If a new project surface deserves a dedicated summary section, extend the category or surface heuristics in `scripts/repository-inventory.mjs`, while preserving the complete file list in JSON.
