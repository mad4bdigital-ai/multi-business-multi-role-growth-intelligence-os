# Platform Remaining Scope Automation

This runbook converts the remaining platform-completion checklist into a recurring static scorecard.

## Workflow

`.github/workflows/platform-remaining-scope-scorecard.yml` runs on pull requests, pushes to `main`, manual dispatch, and a daily schedule. It executes:

```bash
node http-generic-api/scripts/platform-remaining-scope-scorecard.mjs
```

The script writes:

- `docs/auto-platform-scorecard/latest.json`
- `docs/auto-platform-scorecard/latest.md`

The workflow also uploads the generated files as artifacts.

## Covered scope

The scorecard tracks:

1. Execution Evidence Enforcement Gate
2. Tool Bus Kernel readiness and descriptor-resolver gap
3. Platform Completion Scorecard automation
4. Registry lifecycle hygiene tracking for `runtime_unclassified` and `planned_placeholder`
5. CMS authority hardening readiness
6. Agent model/tool-call ledger wiring readiness
7. DR/local connector certification and n8n VPS migration readiness
8. External Delivery orchestration graph readiness
9. MySQL identifier regression guard for previously failing Session Insight views

## Safety

This automation is repository-static only. It performs:

- no DB writes
- no migrations
- no provider calls
- no credential payload reads
- no external writes
- no workflow dispatch
- no ticket mutation
- no approval decision
- no deploy or publish
- no secret output

Release readiness remains the runtime authority. This scorecard exists to keep the remaining scope visible and prevent regressions from re-entering the repository.

## Interpretation

- `pass`: the repository currently satisfies the static invariant.
- `warn`: the item is tracked but still requires a governed implementation, runtime readback, or future PR.
- `fail`: the repository lost a required completion invariant or reintroduced a known unsafe/invalid pattern.

Warnings are allowed so the workflow can operate as an always-on scorecard while remaining gaps are closed by separate PRs.
