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

## Independent repository auto-merge setting

Pull-request creation and automatic merging are separate GitHub capabilities. Enable both:

1. Open **Settings** → **General** → **Pull Requests**.
2. Enable **Allow auto-merge**.
3. Keep the required review rules, required status checks, and branch protections enabled.

The automation reads `allow_auto_merge` from the repository API before it registers an exact-head merge. If the setting is disabled, the PR remains open with an actionable diagnostic; automation never substitutes a direct, administrative, or protection-bypassing merge.

## Dedicated auto-merge credential

Add this repository secret when generated docs-only PRs may be merged automatically:

```text
REPO_AUTOSYNC_TOKEN
```

The token is required for automated merge. A merge performed with the workflow's default `GITHUB_TOKEN` does not start the normal `push` workflows, which can leave the new `main` head without its full post-merge CI cycle. Without this secret, synchronization may still open a review PR, but the workflow leaves it open for a human or governed external actor to merge.

The same scoped identity is also the governed generated-artifact writer and the recipe-specific exact-head verifier dispatcher. A fine-grained token used as `REPO_AUTOSYNC_TOKEN` therefore needs only these repository permissions:

- **Actions: Read and write** — required to dispatch the registered read-only verification workflows after a governed generated-artifact refresh.
- **Contents: Read and write** — required for bounded branch/ref operations and authorized generated-artifact commits.
- **Pull requests: Read and write** — required for governed follow-up pull-request lifecycle operations.

A token without **Actions: Read and write** can still authenticate repository checkout/contents operations but GitHub rejects the verifier `workflow_dispatch` endpoint with `403 Resource not accessible by personal access token`. The writer remains fail-closed and records the bounded GitHub HTTP status/request ID in its canonical verification-dispatch evidence; do not work around this by falling back to `github.token` or `GITHUB_TOKEN`.

Prefer a fine-grained GitHub token or GitHub App installation token over a broad personal access token.

Store `REPO_AUTOSYNC_TOKEN` as a **repository Actions secret**, not a Production environment secret. Repository-maintenance workflows operate on `main` without entering the Production deployment environment. Prefer a dedicated fine-grained service identity restricted to this repository; grant no administrator, ruleset-bypass, environment-management, secret-management, Production, provider, SSH, or database permissions.

The trusted identity must create both the follow-up branch and pull request. Reusing the default `GITHUB_TOKEN` can otherwise create a `github-actions[bot]` PR whose validation runs end as `action_required` with zero jobs. That status is an authorization/approval problem, not a failed test, and it prevents required checks from ever becoming green. Do not weaken repository-wide approval rules to work around it.

The governed Spec Kit Work Map sole writer also checks out its exact authorized target with `REPO_AUTOSYNC_TOKEN`. Its Recovery-issued one-time delegation, bot-authored grant, protected-branch rejection, bounded generated-file scope, exact-head checks, and post-push readback remain unchanged. Only the credential used to publish the authorized branch commit changes, so the resulting pull-request CI event is attributable to the trusted repository identity rather than being stopped as `action_required`. Missing credentials fail before checkout or repository mutation.

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
- generated actionable remediation evidence such as `docs/surface-contract-gap-queue.md`
- generated machine-readable remediation queue evidence such as `docs/surface-contract-gap-queue.json`

The surface discovery report scans migrations for routes, tools, views, policies, plugins, and safety markers. The deep coverage contract also scores documentation completion, high/medium/low documentation gaps, SQL route/OpenAPI coverage, per-target documentation gaps, route classification coverage, and safety marker coverage across all discovered migration surfaces. The actionable queue ranks gaps by severity, surface type, OpenAPI route coverage, missing docs, missing safety markers, and recency, then emits owner hints and remediation actions. Route classification distinguishes OpenAPI-required `http_route` literals from registry-governed `admin_tool_registry_route`, `tenant_tool_registry_route`, `system_tool_dispatch_route`, and `registry_only_surface` exemptions. The Surface Governance Loop adds triage, baseline, a new-gaps-only gate, dashboard, compact dashboard, and trends. Current backlog is baselined so legacy gaps remain visible but non-blocking; only future high/critical gaps absent from the baseline are blocking. It is documentation evidence only: it does not execute providers, read credentials, mutate runtime, write database rows, send externally, deploy, or include secrets.

Auto-merge eligibility classifies the complete tracked and untracked Git mutation set. It allows Markdown plus only these generated documentation-evidence JSON files:

- `docs/surface-contract-discovery-status.json`
- `docs/surface-contract-gap-queue.json`
- `docs/surface-contract-gap-trends.json`
- `docs/surface-contract-gap-triage.json`
- `docs/surface-contract-governance-compact.json`
- `docs/surface-contract-governance-dashboard.json`

OpenAPI schemas, runtime code, authentication changes, migrations, Work Maps, arbitrary JSON, unknown paths, unresolved manual-review items, and blocking new gaps are never auto-merge eligible. Every eligible registration remains bound to the exact PR head; if `main` advances, the stale generated PR is closed and the next exact-head writer regenerates it.

Default automation does **not** commit split OpenAPI schemas. Split schema artifact writes require an explicit reviewed run:

```text
node scripts/repo-maintenance-sync.mjs --write --write-split-schemas
```

## Verification

After enabling PR creation permissions and provisioning `REPO_AUTOSYNC_TOKEN` with the scoped permissions above, run **OpenAPI Auto Sync** or the governed generated-artifact refresh path on an exact feature-branch head.

A healthy no-diff run should complete successfully. A generated-artifact refresh must also produce accepted exact-head verification-dispatch evidence. A run with generated changes should create a PR titled:

```text
Auto-sync repository contracts
```

## Safety expectations

Do not merge generated route stubs as-is for externally consumed routes. Review and replace generated summaries, schemas, security, examples, and `x-openai-isConsequential` values before merge.
