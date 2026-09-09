# Production Promotion Semantic Continuity Guard

## Purpose

`main` is the development authority and must remain free to accept new features. An open or already-certified Production release cut must not freeze development, but it also must not remain valid merely because its commit is still an ancestor of a newer `main`.

This guard adds a second release-cut invariant:

1. the release cut remains an ancestor of current `main`; and
2. the canonical Production-sensitive semantic surface is unchanged.

If either invariant fails, the old release cut is stale and a fresh governed release cut is required.

## Why ancestry alone is insufficient

A descendant of a certified release cut can change runtime behavior, deployment policy, OpenAPI/runtime surfaces, connector code, repository governance, CI/certification behavior, or the promotion controller itself. Git ancestry proves history containment; it does not prove that the Production-relevant truth used during certification is still current.

The previous `main_tip_may_advance=true` rule therefore remains valid only for semantically non-impacting movement.

## Canonical semantic surface

The evaluator is `.github/scripts/production-promotion-semantic-continuity.mjs`.

It is deliberately pure: it reads precomputed Git tree manifests and deployment-policy snapshots, computes a deterministic report, and performs no GitHub API call, process spawn, branch mutation, or protected-ref write.

The sensitive surface is the union of:

- every path class from both the release-cut and current `http-generic-api/config/deployment-branch-policy.json` whose environments include `production`;
- environment-impact source-of-truth paths from both policy versions; and
- a fixed promotion-control-plane floor covering Production promotion workflows/scripts/contracts, certification and repository-governance gates, policy registries, package/runtime build inputs, and Production deployment helpers.

Using the union of the old and new policy is essential. A feature may expand the deployment policy itself—for example, making a previously repository-only directory part of shared runtime. The new policy must be allowed to classify the old tree so that the change cannot hide behind the older policy definition.

## Fingerprint

For each sensitive path, the evaluator records the Git tree identity:

```text
path + mode + type + object-id
```

The sorted manifest is SHA-256 hashed. File-mode changes, additions, deletions, and content changes therefore affect the digest.

The guard does not hash timestamps, workflow run IDs, PR numbers, or other unstable metadata.

## Pull requests to main

`Production Promotion Semantic Impact Guard` runs read-only for pull requests targeting `main`.

It executes the evaluator from the trusted base SHA, not from the proposed head. A PR therefore cannot weaken its own classifier and then use that weakened code to classify itself.

A Production-impacting PR is not rejected merely for being impactful. The result means:

```text
merge_to_main_allowed_by_impact_guard = true
older_release_cut_reuse_after_merge = false
fresh_governed_release_cut_required = true
```

Other repository governance, environment-impact, CI, review, and certification requirements still apply independently.

## Production release source-pin gate

`Production Promotion Semantic Source-Pin Gate` runs read-only under `pull_request_target` for governed release PRs targeting `Production`.

It resolves and pins exact current `main` and `Production`, checks same-repository release identity and candidate topology, then evaluates the release cut against current `main` using the trusted evaluator from current `main`. A semantically stale cut fails closed and requires a fresh governed release cut. The gate performs no comment, close, merge, deployment, or provider mutation.

This provides a default-branch bootstrap defense even before the new guard files themselves have been promoted into the `Production` branch.

## Pushes to main

`Governed Production Main Source-Pin Guard` runs after every push to `main`.

For every open governed Production candidate and every in-progress Production promotion launcher it requires:

```text
release_cut_is_ancestor_of_current_main
AND
release_cut_promotion_digest == current_main_promotion_digest
```

If the digest changed, the guard:

- marks the old release candidate stale;
- closes the stale release PR and fails if bounded cleanup cannot close it;
- records a bounded preview/count of changed sensitive paths;
- cancels affected in-progress runs;
- requires a fresh governed release cut;
- does not silently repin the old authorization.

Documentation-only movement that is outside the semantic surface can preserve the old release cut.

## Safety boundary

This guard does not authorize or execute:

- merge into `Production`;
- deployment or restart;
- SQL or migration apply;
- grant apply;
- provider, DNS, or Cloudflare mutation;
- credential payload reads;
- direct writes to protected refs;
- force push.

The only mutations in the existing main source-pin reconciliation path are bounded control-plane cleanup actions for stale promotion surfaces (comments, closing stale release PRs, and cancelling stale in-progress workflow runs).
