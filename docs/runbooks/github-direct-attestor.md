# MAD4B GitHub Direct Attestor — optional independent mode

Status: source implementation only, disabled until a trusted default-branch workflow and protected GitHub Environment have been approved.

## Purpose
Keep the existing Hostinger Backend Finalizer unchanged, but offer a separately activated GitHub Actions path. Direct mode obtains a real installed GitHub App token and publishes the required Derived State Closure status on the exact HEAD. It never publishes status using GITHUB_TOKEN or fake statuses, and it never disables GitHub Rulesets.

## Modes
- plan: read-only current PR/head/base/candidate tree, required CI, exact owner review, and authentic Derived State evidence.
- attest: repeats preflight through GitHub App token, verifies candidate has zero statuses and zero check runs, publishes trusted HEAD status, and checks latest status id and creator.
- attest_and_merge: after authentic App attestation, independently verifies Ruleset, live PR identity, newest trusted status and labels, then runs normal SHA-bound GitHub merge using REPO_AUTOSYNC_TOKEN. No --admin or force.

## Required one-time configuration
1. Review and land this feature on a trusted default branch using existing governance, or use a separately reviewed controller repository. A workflow in an unmerged PR cannot be dispatched as a trusted default-branch workflow, so this feature cannot automatically merge itself into main.
2. Create GitHub Environment Governance-Direct, with reviewer protection. Set secrets DIRECT_GITHUB_APP_ID and DIRECT_GITHUB_APP_PRIVATE_KEY for the same authorized GitHub App installed on this repository; provide required GitHub App permissions (commit statuses write, PR/checks/Actions/contents read).
3. Set Environment variable DIRECT_GITHUB_ATTESTOR_ENABLED to enabled only after checking authentic App installation identity and read-only plan acceptance. No pre-existing Hostinger Backend secrets are used.
4. Optionally provide dedicated REPO_AUTOSYNC_TOKEN for the merge step, separately approved. Never fall back to default GITHUB_TOKEN for merging.

## Dispatch
Run existing workflow derived-state-converged-automerge.yml on ref main with source_run_id, pr_number, expected_head_sha, action and confirmation. Direct mode uses separate direct_attest and direct_merge jobs; the unchanged Backend attest/merge jobs remain reserved for FINALIZE_GOVERNANCE_ATTESTATION. Allowed pairs: plan/PLAN_DIRECT, attest/DIRECT_ATTEST_EXACT_HEAD, attest_and_merge/DIRECT_ATTEST_AND_MERGE.

The source_run_id must refer to a successful Derived State Closure with event pull_request or workflow_dispatch; the older pull_request_review event is not sufficient for provenance. Its downloaded artifact must contain detector-identity.json, report.json, environment-impact.json, policy-objections.json, manual-authorization.json and evidence-finalizer.json. All must match the same current PR base/head/candidate/run with no remaining manual/blocking objection.

## Security and release acceptance
- A stale SHA, changed Git tree, missing App private key, wrong dispatcher, untrusted source event, negative owner review, missing check, evidence conflict, candidate status contamination or any GitHub API failure prevents all publication.
- The direct workflow is manual and disabled by default; it must never silently fall back after a policy or signature failure.
- GitHub Ruleset still decides whether a merge is allowed. If its required context source is Any source, independent trusted App verification remains necessary; native branch rules do not validate the author of all matching statuses.
- A newly reviewed bootstrap/controller is still needed to activate Direct mode; simply committing this PR does not evade circular deployment dependencies.
- Hostinger Production/OAuth/Trusted Ingress and Staging operational acceptance are separate and are not claimed repaired by this feature.

Tests: node http-generic-api/test-github-repository-governance-attestation.mjs, in exact-head Node 22 checkout. Re-check all CI, Governance Fixed Point and Work Map acceptances after changes.
