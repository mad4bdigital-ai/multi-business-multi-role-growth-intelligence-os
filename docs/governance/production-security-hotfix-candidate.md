# Governed Production security hotfix — classification only

**Status:** code proposal; no Production authority or merge authorization. Parent: [#8579](https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/issues/8579); first candidate: [#8578](https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/pull/8578).

## Why
`e2e-parallel-pr-gate` previously treated every PR whose base is `Production` as a full-main promotion. Even a lockfile-only security fix triggered `production_promotion_identity_invalid`. Do not weaken full release-cut identity; classify verified limited security candidates separately.

## Candidate classification criteria
- Base ref must be exactly `Production`, from the current immutable base SHA confirmed by independent `git ls-remote origin refs/heads/Production` readback.
- Head and base SHA must be complete 40-character commits; base must be an ancestor; maximum four review-only commits; no merge commits.
- Branch name follows `security/production-hotfix-YYYYMMDD` or `security/production-api-lockfile-YYYYMMDD` with an optional limited suffix. This name is **not** an authorization or an attestation.
- Diff must contain only existing `package-lock.json` and/or `http-generic-api/package-lock.json`. Both file content and parsed npm lockfile constraints are inspected at the exact head SHA, not from working files.
- No additions/deletions of package entries, changes to root package metadata, external tarball hosts, GitHub URL dependencies, or downgrades. Each changed existing package has an upgraded semantic version and npm-registry HTTPS + SHA-512 integrity. Non-version metadata limited to resolution/integrity, package dependencies, engine/funding metadata.
- Negative tests deny moved Production base, unknown head, wrong ref, new dependency, malicious registry URL, non-lockfile edit, downgrade and root metadata edit.

## Hard boundary: classification ≠ authority
**Every successful result intentionally declares:**

- `production_security_hotfix_candidate=true`
- `production_security_hotfix_authority_eligible=false`
- `production_promotion=false` and no inherited release-cut promotion identity.

CI may continue testing a candidate. **This does not publish a trusted GitHub App status, grant owner approval, merge, deploy, release, or authorize database/provider access.** The finalizer and GitHub Production branch/ruleset must independently enforce required checks, trusted attestor binding, no bypass and exact-head/same-cycle owner approval. If policy readback remains uncertified (#8500), Production stays **NO-GO**.

## Validation
```sh
node http-generic-api/scripts/production-security-hotfix-candidate-self-test.mjs
node http-generic-api/scripts/e2e-parallel-pr-flow-self-test.mjs
```
The first test constructs an isolated local Git origin, evaluates 13 positive/negative cases, and changes **only its throwaway fixture**. A separate live, read-only test also validated #8578's known two-lockfile diff at `d334b03dfea4a7feeaa20c9adca1926af8b8628f` against `Production@e0c07f6fba431650b87d7a6f3dde76a364be6223`.

`e2e-production-promotion-bridge-self-test.mjs` failed locally at line 140 **both with this change and at unmodified `main` HEAD**, so that result is an existing Windows/authenticated-test-fixture failure rather than a claimed hotfix regression. Run canonical Linux CI and investigate independently.

## Remaining release gates
- Finish all security scans including the 7 Hostinger advisories absent from the supplied excerpt.
- Obtain complete OAuth, MCP, trusted ingress, stable application/DB readback, verified backup/isolated restore and no-secret host parity.
- Bring #8500 GitHub protected Production ruleset and #8487 trusted attestation into certified status.
- Obtain new exact-head owner approval **only** once every release precondition passes, then use separately governed promotion/deployment with auditable rollback.
## Immutable legacy mirror
The legacy classifier source is preserved byte-for-byte. The new adapter in `e2e-parallel-pr-gate.mjs` runs the legacy gate, then removes **only** its single known identity classification finding when all independently validated exact-SHA, scope, monotonic upgrade, and registry constraints pass. Any other finding or process failure remains blocked. This preserves the existing configuration-discovery immutable-mirror hash test.
