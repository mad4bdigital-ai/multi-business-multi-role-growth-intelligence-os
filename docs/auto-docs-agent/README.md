# Automated Docs Agent Notes

This directory is maintained by the Docs Agent workflow. Each generated note records the documentation impact of a PR or commit so runtime, schema, deployment, and tenant-facing changes do not disappear into chat history or transient CI logs.

Generated notes are reviewable evidence. They do not replace targeted human documentation for high-risk changes, but they make the required docs targets explicit and keep the repository auto-mergeable when a follow-up documentation note is enough.

Rules:

- No secrets or credential values.
- No generated canonical root edits without canonical source edits.
- High-risk notes must name required docs and validation evidence.
- Docs-only agent PRs may be auto-merged only after CI passes.
- Session Insight capability-envelope impact notes for migrations `277` through `283` are resolved by `docs/session-insight-capability-envelope-release-readiness.md` plus the patch index, deployment parity checklist, agent guide, and OpenAPI route coverage. This remains no-execution/no-target-write evidence only.
- Session Insight capability binding hardening impact notes for migration `910_sprint68_session_insight_capability_binding_hardening.sql` are resolved by the patch index, deployment parity checklist, Docs Agent governance, and change documentation governance updates. Required evidence: `credential_source='none'` app/action/tool bindings, no `--explain` passthrough, migration ledger readback, release-readiness pass, and no provider credential/external write/raw transcript/secret access.
- Support Ticket External Delivery no-send orchestration graph impact notes for migration `287_sprint68_external_delivery_orchestration_graph_plugin.sql` are resolved by the patch index, deployment parity checklist, Docs Agent governance, and change documentation governance updates. Required evidence: active `support_ticket_external_delivery_orchestrator`, 7/7 stages, 6/6 edges, readback status `ready_no_send_external_delivery_graph`, migration ledger run, and no provider call/credential payload/raw secret/external send/external write/spend/secret access.
- Automatic surface contract discovery impact notes are resolved by the patch index, deployment parity checklist, repo auto-sync permissions runbook, Docs Agent governance, and change documentation governance updates. Required evidence: surface discovery script, repo-maintenance-sync integration, workflow trigger coverage for migrations, test coverage, reviewable PR behavior, no direct `main` writes, no auto-merge for OpenAPI TODO stubs, and no provider/credential/runtime/database/external send/deploy/secret access.
- Deep surface coverage impact notes are resolved when the same docs explain `surface-contract-discovery-v2`, generated Markdown plus JSON outputs, all-migration metrics, docs completion scoring, high/medium/low gap classification, SQL route/OpenAPI coverage scoring, per-doc-target gap counts, safety marker counts, and representative regression tests for migrations 287, 910, and 954.
