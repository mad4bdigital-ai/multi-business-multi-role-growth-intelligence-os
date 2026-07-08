# Plan

## Delivery model

Use one father specification PR followed by child PRs. Each child PR must list the alerts it addresses, files touched, tests added or updated, and readback required before alert lifecycle closure.

## Child PR order

1. `gpt/p1-hostinger-ssh-probe-deploy-readback`
2. `gpt/p1-credential-intake-handoff`
3. `gpt/p1-openclaude-bridge-transport`
4. `gpt/p1-deploy-reliability-receipts`
5. `gpt/p1-github-ci-auto-trigger-recovery`
6. `gpt/p1-admin-db-update-serialization`
7. `gpt/p1-deploy-intent-alignment`
8. `gpt/p1-capability-envelope-lifecycle`
9. `gpt/p1-google-ads-execution-readiness`

## Father PR checks

- Documentation only.
- No generated secrets or provider payloads.
- No runtime behavior changes.
- No OpenAPI, migration, route, or deployment changes.
- Clear child PR boundaries.

## Child PR rules

- Keep diffs small and reviewable.
- Preserve structured error envelopes where API contracts change.
- Preserve layer boundaries.
- Include tests for behavior changes.
- Keep secrets out of logs, responses, tests, and docs.
- Do not resolve operational alerts without same-cycle runtime evidence.

## Merge policy

Merge children in dependency order unless a later child is strictly independent. If `main` advances after a branch is pinned, re-run SHA validation and CI before merge.
