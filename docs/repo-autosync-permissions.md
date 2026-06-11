# Repository Auto-Sync Permissions

This repository uses `.github/workflows/openapi-auto-sync.yml` to keep repository contracts synchronized after pushes to `main`.

The workflow is intentionally review-first: generated changes should open a pull request instead of pushing directly to `main`.

## Required GitHub setting

For the default `GITHUB_TOKEN` to create the auto-sync pull request, enable this repository setting:

1. Open the repository on GitHub.
2. Go to **Settings** → **Actions** → **General**.
3. Under **Workflow permissions**, select **Read and write permissions**.
4. Enable **Allow GitHub Actions to create and approve pull requests**.
5. Save.

Without this setting, the workflow can still run the sync script, but `peter-evans/create-pull-request` may fail with:

```text
GitHub Actions is not permitted to create or approve pull requests.
```

The workflow uses `continue-on-error: true` on the PR creation step so this permission gap does not break `main`, but no automated PR will be opened until the setting is fixed.

## Optional secret fallback

If repository settings cannot allow the default token, add a repository secret:

```text
REPO_AUTOSYNC_TOKEN
```

The token should have the minimum repository permissions needed to create branches and pull requests:

- contents: write
- pull requests: write

Prefer a fine-grained GitHub token or GitHub App installation token over a broad personal access token.

## Workflow behavior

The workflow runs:

```text
node scripts/repo-maintenance-sync.mjs --write --report-file "$RUNNER_TEMP/repo-maintenance-sync-result.json"
```

Default automation may update:

- `http-generic-api/openapi.yaml`
- generated markdown planning docs such as `docs/repo-maintenance-status.md`
- generated SQL-backed surface discovery evidence such as `docs/surface-contract-discovery-status.md`
- generated machine-readable coverage evidence such as `docs/surface-contract-discovery-status.json`

The surface discovery report scans migrations for routes, tools, views, policies, plugins, and safety markers. The deep coverage contract also scores documentation completion, high/medium/low documentation gaps, SQL route/OpenAPI coverage, per-target documentation gaps, and safety marker coverage across all discovered migration surfaces. It is documentation evidence only: it does not execute providers, read credentials, mutate runtime, write database rows, send externally, deploy, or include secrets.

Default automation does **not** commit split OpenAPI schemas. Split schema artifact writes require an explicit reviewed run:

```text
node scripts/repo-maintenance-sync.mjs --write --write-split-schemas
```

## Verification

After enabling permissions or adding `REPO_AUTOSYNC_TOKEN`, run **OpenAPI Auto Sync** manually from GitHub Actions or wait for the next push to `main`.

A healthy no-diff run should complete successfully.
A run with generated changes should create a PR titled:

```text
Auto-sync repository contracts
```

## Safety expectations

Do not merge generated route stubs as-is for externally consumed routes. Review and replace generated summaries, schemas, security, examples, and `x-openai-isConsequential` values before merge.
