# Spec Portfolio Convergence — 2026-08-12

Baseline: `main@3b1831fb423bc673c008ccdcb6fab8613e770b22`

## Purpose

Recover architectural and product-planning authority that remained stranded in historical open pull requests without importing stale runtime code, migrations, generated Work Maps, or historical Docs Agent output.

This recovery is additive. The recovered paths did not exist on the pinned baseline.

## Recovered design sources

| Source PR | Source head | Recovered path | Exact source tree |
|---:|---|---|---|
| #1898 | `210840f0ea38d531355d6d4611c729a40d4195bb` | `specs/004-tenant-asset-federation` | `382f71454ec0b727c29b53003017ee4497d973a0` |
| #2284 | `066fe68d3a070ba4af1ccca5423966d8193b680f` | `specs/008-governed-pr-delivery-orchestration` | `11f2db060db5bd6c9c937baa4507e12a2dd1c769` |
| #2385 | `91fd2529ccbb195d652e37c1594e16f19202a67f` | `specs/009-local-connector-reachability-recovery` | `35542add9be3214b7f75c1c5de3b413f5eb8fa21` |
| #2950 | `ac78c42d9db24e6e23a288848f8d809d6ba7f238` | `specs/011-tenant-gpt-effective-capability-envelope` | `33412e08a67eda01bb2a3c199e6f1e978f4df132` |
| #4432 | `521ff64a1fbe69be2d3ebe5ad3ca59baaf5f84e9` | `specs/014-gemini-evidence-intake-automation` | `ef83f63415164c87c19b077b27907f974276ed1f` |
| #4456 | `9217fec66c28ce2fdbfbb773c91488bc6a31ac13` | `specs/015-tenant-operating-system-studio` | `6e89a12abd57240de69ae9857591ddb14a1de300` |
| #2470 | `6d1f3c56540a74d1f1a7c106d22345d1e85791bf` | `docs/spec-kits/release-intelligence` | `6422f7a55c9878c151bb99200402aab49d4c7ccc` |

The source subtrees are attached by their original Git tree identities. No historical runtime/test/migration files from mixed-scope PRs #2950 or #2470 are recovered here.

## Canonical portfolio identity

Use:

`feature_key + canonical_role`

Numeric Spec numbers are display labels only. A duplicated number such as `011` or `014` must never be treated as a unique authority identity.

## Truthfulness boundary

The recovered documents preserve design provenance. Historical state embedded inside them is not automatically current operational truth.

In particular:

- historical `main` SHAs, PR heads, workflow run IDs, CI claims, completion evidence, and rollout observations remain provenance snapshots;
- `draft-spec-portfolio*.json` and `draft-spec-portfolio*.md` inside Spec 015 describe the historical scan performed by PR #4456 and must be regenerated from the live repository before being treated as the current PR portfolio;
- current repository code, current database/runtime evidence, and current exact-head CI remain authoritative for implementation and operational state;
- generated Work Maps must be produced only from the current candidate by the repository's governed generator/writer lifecycle; historical `docs/work-maps/**` output is intentionally not imported;
- historical Docs Agent output is intentionally not imported.

## Existing canonical Specs

PR #1935 and PR #2949 are not whole-imported. Their corresponding architectural areas already exist on current `main` and may have evolved beyond the historical branches. Any still-missing amendment must be recovered through a field/file-level current-main gap review rather than replacing the current canonical subtree.

## Implementation boundary

This convergence does not authorize or perform:

- runtime source restoration;
- database migration or SQL execution;
- provider, credential, deployment, restart, or external-system mutation;
- generated-artifact publication;
- Production promotion;
- direct or force writes to `main` or `Production`.

Implementation PRs that remain useful must be reconstructed against current `main`, validated on their exact final heads, and merged independently.
