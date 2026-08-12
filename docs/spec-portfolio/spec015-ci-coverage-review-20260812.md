# Spec 015 CI Coverage Review

## Scope

This review compares the Spec 015 contract and readiness surfaces with the repository's GitHub Actions workflows and live GitHub state. It distinguishes local execution evidence from a required check enforced by GitHub branch policy.

## Findings before the change

The repository had a broad CI workflow set, including syntax checks, architecture drift, runtime readiness, migration guards, generated-artifact guards, and production/readback workflows. However, the newly added Spec 015 validators and runtime gate contracts were not invoked by the primary `.github/workflows/ci.yml` workflow. Their local success therefore did not automatically produce a named CI check.

## Change applied

The primary CI workflow now includes a dedicated job:

```text
Spec 015 Contract Governance
```

The job runs on pull requests, pushes, and manual dispatch through the existing workflow triggers. It performs the following checks:

| Check | Purpose |
|---|---|
| `test-spec015-contract-validators.mjs` | identity, dependency, binding, publication, overrides, export, and deterministic hash contracts |
| `test-spec015-readiness-facade.mjs` | ready/blocked readiness preview and blocking-gap aggregation |
| `test-spec015-runtime-gate-contracts.mjs` | canonical identity, migration/readback, rollback, typed confirmation, and provider fail-closed gates |
| Node syntax checks | ensure all Spec 015 contract modules parse in CI |
| final closure preflight | ensure required artifacts exist and no mutation/provider/production flags are asserted |
| `git diff --check` | reject whitespace and patch hygiene failures |

## Live GitHub observations

The live audit observed a CI run for the branch at commit `1c780cce3db1c4be0aa502ea4cdfe53edccbaafd`. At the time of observation, Syntax Check, Architecture Drift Detection, and Execution Resolver Gate were successful, while Unit & Integration Tests was still in progress. The dedicated Spec 015 job was not present in that older run because the workflow change had not yet been pushed.

The default branch currently reports no classic branch protection configuration and no active ruleset in the read-only API response. Required checks therefore exist as workflow jobs but are not enforced by GitHub until a repository policy is applied.

## Live failure triage and fixes

The first CI run after adding the Spec 015 job exposed a pre-existing canonical-binding regression in `test-repo-patch-apply.mjs`: the public lifecycle wrapper was not textually or functionally bound to `githubRepositoryLifecycleCore.js`. The wrapper now delegates `githubBranchDeleteConfirmation` to the canonical core implementation.

The next CI run exposed the deeper repository authority boundary gap. The public wrapper did not expose `createRepositoryAuthorityCheckedFetch`, so live envelope and resource-binding revalidation was absent below the route layer. The wrapper now provides a checked transport that performs read-only preparation without consuming the write boundary, re-reads the capability envelope before the first provider write, revalidates again before ref updates, rejects resolved commit-parent mismatch before binding read, and derives the exact repository URI from the GitHub request path when needed.

The focused authority suite now passes locally:

```text
Repository authority write-boundary regression passed
Repository resolved commit-parent authority boundary regression passed
platform tool dispatch binding integrity tests passed
repo_patch_apply: 12 passed, 0 failed
```

The full canonical manifest originally proceeded beyond these repaired tests but stopped in the sandbox at the .NET local-manager certification command because the `dotnet` executable is not installed. That was an environment capability gap, not a failed JavaScript assertion. CI now provisions .NET 8 explicitly with `actions/setup-dotnet@v4`, and the sidecar certification project enables Windows targeting on the Ubuntu runner. The sandbox cannot execute that final .NET verification because its local toolchain is absent; the next GitHub run is the authoritative check for this change.

## Remaining CI gaps

The following gaps remain intentionally open:

| Gap | Why it remains open |
|---|---|
| Required check enforcement | Needs GitHub ruleset/branch protection mutation and resolved Finalizer App identity |
| Production migration evidence | CI can validate contracts and readiness, but cannot prove a Production readback without the authorized environment |
| Cloudflare/Local Connector | Deferred by operator decision; CI must not restart or rebind the service automatically |
| Pilot evidence | Requires deployed runtime and post-merge execution evidence |
| Candidate PR reconstruction | CI can validate captured SHAs and fail-closed convergence gates, but cannot reconstruct package semantics automatically |

## Local verification

The exact commands used by the new CI job passed locally. Prettier accepted the workflow file, the three Spec 015 test modules passed, the closure preflight passed, and `git diff --check` passed.
