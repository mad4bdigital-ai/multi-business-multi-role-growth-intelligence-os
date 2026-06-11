# Repo and SQL Change Documentation Governance

## Purpose

Every meaningful repo or SQL change must leave a durable written trail. Runtime behavior, registry mutations, repair actions, and operational guardrails must not live only in chat history or transient execution logs.

## Applies to

This policy applies to:

- source code changes
- migrations
- SQL replay or repair operations
- registry row mutations
- tool export changes
- OpenAPI/GPT Action schema changes
- connector or credential behavior changes
- session archive repairs
- deployment, DNS, Hostinger, Cloudflare, Drive, GitHub, or local connector operational changes

## Required documentation outputs

For each change, update at least one of the following, depending on scope:

| Change type | Required docs |
|---|---|
| Runtime/code behavior | `README.md`, `runtime_boundary_map.md`, relevant contract docs |
| Platform development constitution or orchestration-governance policy | `Updating Registry Patch Index.md`, `deployment_parity_checklist.md`, targeted tests, and `releaseReadiness.js` runtime policy seed enforcement |
| Orchestration graph/state/recommendation foundation | `Updating Registry Patch Index.md`, `deployment_parity_checklist.md`, targeted orchestration tests, migration safety comments, and release-readiness migration/runtime-policy tracking |
| Orchestration readback/admin diagnostic surface | `openapi.yaml`, `Updating Registry Patch Index.md`, `deployment_parity_checklist.md`, targeted readback tests, tool registry migration, and no-execution/no-secret safety evidence |
| Snapshot/recommendation proposal surface | `openapi.yaml`, `Updating Registry Patch Index.md`, `deployment_parity_checklist.md`, targeted proposal tests, no-write/no-execution evidence, and release-readiness policy tracking |
| Snapshot/recommendation persistence gate | `openapi.yaml`, `Updating Registry Patch Index.md`, `deployment_parity_checklist.md`, targeted gated-write tests, idempotency/envelope/hash verification evidence, and release-readiness policy tracking |
| Registry/taxonomy change | `docs/registry-taxonomy.md`, `Updating Registry Patch Index.md` |
| Auth/credential behavior | `docs/external-endpoint-auth-strategy.md`, `connector_contracts.md` |
| Restore/relink/incident recovery | incident runbook under `docs/`, `Updating Registry Patch Index.md`, `deployment_parity_checklist.md` |
| Live SQL repair / schema hotfix | exact SQL scope, safety class, readback query, affected routes/tools, `Updating Registry Patch Index.md`, and a dedicated `docs/*` runbook |
| Runtime join-key collation repair | migration/test guard, impacted query paths, explicit no-secret/no-payload statement, tenant-facing validation guidance |
| New migration or repair script | migration/script inline comments, runbook or operations doc, patch index |
| GPT action/tool schema change | OpenAPI/schema docs and affected tool registry notes |
| Deployment or CI behavior | `deployment_parity_checklist.md` |
| Shared reconciliation / continuation behavior | `http-generic-api/docs/shared-reconciliation-continuation-runbook.md`, `Updating Registry Patch Index.md`, `deployment_parity_checklist.md` |
| Chunked tool response continuation behavior | `http-generic-api/openapi.yaml`, `AI_Agent_Knowledge_Guide.md`, `Updating Registry Patch Index.md`, and `deployment_parity_checklist.md` when `response_chunk_read` behavior or policy changes |
| Local connector recovery / tunnel provisioning behavior | `http-generic-api/openapi.yaml`, `AI_Agent_Knowledge_Guide.md`, `Updating Registry Patch Index.md`, `deployment_parity_checklist.md`, and relevant admin-control tests when HTTP 530/1033/self-repair behavior changes |
| Repository branch reconciliation behavior | `AI_Agent_Knowledge_Guide.md`, `Updating Registry Patch Index.md`, `deployment_parity_checklist.md`, shared reconciliation runbook, and relevant branch/admin tests when branch drift repair or GitHub ref update behavior changes |
| Repository Intelligence tenant-scoped read-only behavior | `AI_Agent_Knowledge_Guide.md`, `http-generic-api/openapi.yaml`, targeted tests, and this governance note when tenant repository authority bindings, tenant repo reconciliation wrappers, bounded evidence, or PR classification behavior changes. Document that V2 is read-only, requires `platform_resource_authority_bindings`, blocks before provider calls without binding, and never comments, labels, closes, merges, patches, force-pushes, or applies migrations. |
| GitHub fallback / capability repair behavior | `http-generic-api/openapi.yaml`, relevant admin-control tests, and the shared reconciliation runbook when fallback now emits continuation checkpoints or repair-attempt evidence |
| Agent operating rule | `AI_Agent_Knowledge_Guide.md` when safe, or a dedicated `docs/*` runbook linked from checklist docs |

## Patch index rule

`Updating Registry Patch Index.md` is the chronological operational ledger. Add a new patch entry whenever a change affects:

- SQL authority
- registry rows
- runtime routing
- credential selection
- deployment behavior
- archive/session repair
- recovery procedures

Do not duplicate patch numbers. If duplication is found, fix the ledger before adding new entries.

## SQL mutation note rule

For SQL mutations, record:

- target tables and exact columns
- key predicates or join keys affected
- whether the change was dry-run or apply
- exact safety class: `CREATE IF NOT EXISTS`, `INSERT ... ON DUPLICATE`, scoped `UPDATE`, scoped `INSERT ... SELECT`, scoped `ALTER TABLE MODIFY` for named non-secret join columns, etc.
- confirmation that no `DROP`, `TRUNCATE`, broad `DELETE`, broad table conversion, or secret-payload alteration was used
- verification query/results, including rerun of the query shape that previously failed when this was a runtime repair

## Repo mutation note rule

For repo changes, record:

- files changed
- reason
- runtime behavior changed
- tests or checks run
- GitHub Actions run id and final conclusion

## CI schema/docs change guard

CI runs `http-generic-api/scripts/schema-docs-change-guard.mjs` in the syntax job. The guard compares the PR or push diff and fails when guarded runtime authority files change without matching schema, tests, docs, or canonical guidance.

Guarded files include:

```text
http-generic-api/routes/**
http-generic-api/migrations/**
registry/tool/workflow/credential runtime files
src/services/execution/**
src/services/connectors/**
src/store/registries/**
```

Coverage files include:

```text
http-generic-api/openapi*.yaml
http-generic-api/test-*.mjs
tests/**
docs/**
canonicals/**
schemas/**
AI_Agent_Knowledge_Guide.md
GPT_Admin_Assistant_Knowledge_Guide.md
other canonical guide/checklist files
```

This CI gate is the enforcement layer; database rows such as `agent_supervision_policy` are advisory/operational policy unless a runtime gate explicitly reads and enforces them.

## Docs Agent automation

The Docs Agent workflow is the default automation path for keeping documentation aligned after PRs and commits.

- PR mode writes `docs/auto-docs-agent/pr-<number>.md` back to the PR branch when non-doc files change.
- Main follow-up mode opens a docs-only PR from `docs-agent/<sha>` after a merge to `main` when documentation impact evidence is missing.
- Docs-only follow-up PRs request GitHub auto-merge and remain subject to branch protection and CI.
- Runtime/code PRs are not auto-merged by default; they require the explicit `docs-agent-automerge` label.

The generated impact note does not replace targeted documentation for high-risk changes. It makes the required docs visible and keeps the end-to-end process mergeable while deeper docs are added.

## Post-push verification

After every push:

1. Read latest GitHub workflow run through the governed GitHub Actions tools.
2. If in progress, inspect jobs until all complete.
3. If any job fails, read logs, classify the failure, repair, push again, and repeat.
4. Do not mark the change complete until the target run has `status=completed` and `conclusion=success`.
5. If the Docs Agent opened a follow-up PR, verify that it is docs-only and auto-merge is enabled or explicitly explain why auto-merge was unavailable.

## Backup boundary

Do not start any backup or restore operation merely because documentation or repair scripts were updated. Backup operations require a separate plan covering:

- source database
- destination path
- retention policy
- encryption/access control
- restore test
- naming convention
- owner approval

Stop before backup planning if that policy is not yet approved.

## Support Ticket External Delivery certification docs rule

When a change adds or modifies Support Ticket external delivery routes, provider adapter contracts, send-mode policies, or completion certification behavior, the same PR must update:

- `http-generic-api/openapi.yaml` for route contracts, auth, request/response examples, status codes, and error envelopes.
- `AI_Agent_Knowledge_Guide.md` for runtime safety boundaries and readback requirements.
- `Updating Registry Patch Index.md` for migration/tool/policy evidence.
- `deployment_parity_checklist.md` for post-merge runtime and registry parity checks.

A completion certification route is not release-complete unless OpenAPI includes the path and the DB readback confirms no-send/no-secret policy, disabled live dispatch, and active target rules.

## Session Insight capability-envelope chain documentation rule

For migrations `277` through `283`, update `docs/session-insight-capability-envelope-release-readiness.md`, `AI_Agent_Knowledge_Guide.md`, `Updating Registry Patch Index.md`, `deployment_parity_checklist.md`, Docs Agent governance files, and OpenAPI route coverage before promotion. The documentation must explicitly state that the chain is gated no-execution evidence only and does not authorize adapter apply, production runtime execution, `promotion_allowed`, or target writes.

## Session Insight capability binding hardening documentation rule

For migration `910_sprint68_session_insight_capability_binding_hardening.sql` and related actual capability envelope request code, update `Updating Registry Patch Index.md`, `deployment_parity_checklist.md`, Docs Agent governance files, and the targeted Session Insight actual-request test. Required evidence must include: app/action/tool graph rows for `session_insight`, `credential_source='none'`, the internal SQL target-write executor binding, removal of `--explain` passthrough from actual capability envelope creation, governed migration ledger id, readback queries for app/action/tool/policy rows, and release-readiness pass. The documentation must explicitly state that the change does not authorize provider credentials, credential payload reads, external writes, raw transcript access, or secrets.

## Support Ticket External Delivery no-send orchestration graph documentation rule

For migration `287_sprint68_external_delivery_orchestration_graph_plugin.sql`, update `Updating Registry Patch Index.md`, `deployment_parity_checklist.md`, Docs Agent governance files, and the targeted external-delivery orchestration graph test. Required evidence must include: plugin key `support_ticket_external_delivery_orchestrator`, 7 expected stages, 6 expected edges, `v_platform_orchestration_external_delivery_readiness`, policy `support_ticket_external_delivery_orchestration_readback_policy_v1`, governed migration ledger run id, and readback status `ready_no_send_external_delivery_graph`. The documentation must explicitly state that the graph is read-only/no-send and does not authorize provider calls, credential payload reads, raw secrets, external sends, external writes, spend changes, or secrets.

## Automatic surface contract discovery documentation rule

When repository automation changes SQL-backed surface discovery or OpenAPI auto-sync behavior, update `Updating Registry Patch Index.md`, `deployment_parity_checklist.md`, `docs/repo-autosync-permissions.md`, the relevant tests, and this governance note. The automation may generate reviewable PRs for `docs/surface-contract-discovery-status.md`, `docs/surface-contract-discovery-status.json`, and OpenAPI route stubs, but it must not push directly to `main`, auto-merge OpenAPI TODO stubs, execute provider calls, read credential payloads, mutate runtime, write database rows, send externally, change spend, deploy, or include secrets.

For `surface-contract-discovery-v2`, documentation must mention the machine-readable JSON contract, all-migration coverage scope, documentation completion percentage, high/medium/low gap classification, SQL route/OpenAPI coverage scoring, per-doc-target gap counts, and safety marker coverage counts. Tests must assert representative covered migrations and newly discovered migration gaps.
