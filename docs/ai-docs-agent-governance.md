# AI Docs Agent Governance

## Purpose

The Docs Agent keeps repository documentation aligned with runtime, schema, tenant, deployment, and governance changes. It runs in GitHub Actions and produces reviewable Markdown evidence instead of silently changing production behavior.

The agent is designed to keep documentation updates auto-mergeable end-to-end without giving the agent permission to mutate secrets, live databases, or protected branches directly.

## Operating modes

### Pull request mode

On internal pull requests targeting `main`, the workflow:

1. Checks out the PR branch.
2. Runs `http-generic-api/scripts/docs-agent-runner.mjs --write`.
3. Writes or updates `docs/auto-docs-agent/pr-<number>.md`.
4. Commits the generated note back to the PR branch.
5. Enables GitHub auto-merge only when the PR has the explicit `docs-agent-automerge` label.

The PR author remains responsible for high-risk runtime changes. The generated note makes required documentation targets explicit and helps keep CI green.

### Main follow-up mode

On pushes to `main`, the workflow:

1. Compares the merged commit range.
2. Generates an impact note when non-doc files changed.
3. Opens a docs-only follow-up PR from `docs-agent/<sha>`.
4. Requests GitHub auto-merge for that docs-only PR.

This mode handles commits that reached `main` before a complete documentation note existed. The follow-up PR is docs-only and therefore safe for automated merge after CI passes.

## Safety boundaries

The Docs Agent must not:

- write to `main` directly
- modify `.env`, credentials, tokens, or secret payloads
- run live DB mutations
- alter generated canonical roots without canonical source changes
- mark deployment complete without runtime evidence
- merge high-risk runtime PRs without an explicit `docs-agent-automerge` label

The generated files are evidence, not authority. For high-risk changes, maintainers must still update the targeted docs named by the impact note.

For the Session Insight capability-envelope chain, generated impact notes for migrations `277` through `283` are satisfied by the targeted runbook `docs/session-insight-capability-envelope-release-readiness.md`, the patch index, deployment parity checklist, agent guide, and OpenAPI route coverage. The docs evidence confirms gated no-execution behavior only; it does not authorize adapter apply or production target writes.

For Session Insight capability binding hardening, generated impact notes for migration `910_sprint68_session_insight_capability_binding_hardening.sql` are satisfied by the patch index, deployment parity checklist, this governance file, `docs/auto-docs-agent/README.md`, and `docs/change-documentation-governance.md`. The required evidence is the internal `session_insight` app/action/tool graph with `credential_source='none'`, removal of `--explain` from actual capability envelope passthrough, regression test coverage, governed migration ledger evidence, and release-readiness pass. This documentation does not authorize provider credentials, credential payload reads, external writes, raw transcript access, or secrets.

For Support Ticket External Delivery no-send orchestration graph changes, generated impact notes for migration `287_sprint68_external_delivery_orchestration_graph_plugin.sql` are satisfied by the patch index, deployment parity checklist, this governance file, `docs/auto-docs-agent/README.md`, and `docs/change-documentation-governance.md`. Required evidence includes the `support_ticket_external_delivery_orchestrator` plugin, 7/7 stages, 6/6 edges, `v_platform_orchestration_external_delivery_readiness`, blocking policy `support_ticket_external_delivery_orchestration_readback_policy_v1`, governed migration ledger run, and readback status `ready_no_send_external_delivery_graph`. This documentation does not authorize provider calls, credential payload reads, raw secrets, external sends, external writes, spend changes, or secrets.

For automatic surface contract discovery, generated impact notes are satisfied by the patch index, deployment parity checklist, `docs/repo-autosync-permissions.md`, this governance file, `docs/auto-docs-agent/README.md`, and `docs/change-documentation-governance.md`. The automation may generate reviewable PRs for SQL-backed surface evidence, the machine-readable JSON coverage contract, and OpenAPI stubs, but it must not push directly to `main`, auto-merge TODO route contracts, execute provider calls, read credentials, mutate runtime, write database rows, send externally, deploy, or include secrets.

For deep surface coverage changes, require evidence for `surface-contract-discovery-v2`, all-migration metrics, documentation completion scoring, high/medium/low gap classification, SQL route/OpenAPI coverage scoring, per-target documentation gap counts, safety marker counts, and regression tests for representative documented and undocumented migrations.

For actionable gap queue changes, require evidence for `surface-contract-discovery-v3`, generated `docs/surface-contract-gap-queue.md`, generated `docs/surface-contract-gap-queue.json`, queue schema `surface-contract-gap-queue-v1`, score/class counts, remediation action keys, owner hints, and regression tests that prove a recent undocumented migration appears in the queue with actionable remediation. The queue is review guidance only and must not authorize provider calls, credential reads, runtime mutation, database writes, external sends, deployments, or secrets.

For Surface Governance Loop changes, generated impact notes are resolved by documenting the triage, baseline, new-gaps-only gate, dashboard, and trend outputs. Required evidence includes schemas `surface-contract-gap-triage-v1`, `surface-contract-gap-baseline-v1`, `surface-contract-new-gap-gate-v1`, `surface-contract-governance-dashboard-v1`, and `surface-contract-gap-trends-v1`; `repo-maintenance-sync` enforcement; and latest remediation coverage for exact migrations `954_sprint68_compact_operational_views_and_github_resource_coverage.sql`, `955_sprint68_external_delivery_admin_control_surface.sql`, and `956_sprint68_external_delivery_allowlist_readiness_view_updated_at.sql`. The gate must not block legacy backlog and must remain no provider calls, no credential reads, no runtime mutation, no database writes, no external sends, no deployments, and no secrets.

For legacy surface backlog full-closure changes, generated impact notes are resolved when docs explain `surface-contract-legacy-backlog-closure-v1`, the explicit closure ranges `001-291`, `305-306`, `900-910`, `950-961`, `997-999`, and `20260611_*`, and the future-protection rule that migrations outside those ranges/prefixes remain normally scored. Required tests must prove `legacy_closure_route_reviewed` route classification, closed historical docs coverage, no active legacy OpenAPI/safety gaps, and no provider/credential/runtime/database/external-send/deploy/secret behavior.

For route classifier changes, generated impact notes are resolved when docs explain `http_route`, `admin_tool_registry_route`, `tenant_tool_registry_route`, `system_tool_dispatch_route`, `registry_only_surface`, and `false_positive_route_like_string`, plus tests proving registry routes in `955_sprint68_external_delivery_admin_control_surface.sql` do not create OpenAPI false positives. Schema completion route-literal remediations are resolved when docs and tests prove `286_sprint68_platform_schema_contract_completion_registry.sql` endpoint `schema_json` path literals are `registry_only_surface`, OpenAPI-exempt, and registry schema contract evidence rather than new Express routes. For Session Insight remediation batches, docs must include exact filenames `273_sprint68_session_insight_capability_envelope_request_gate.sql`, `275_sprint68_session_insight_capability_envelope_dispatch_dry_run.sql`, `278_sprint68_session_insight_capability_envelope_actual_request_preflight.sql`, `279_sprint68_session_insight_capability_envelope_actual_request_dispatch.sql`, `280_sprint68_session_insight_capability_envelope_approval_gate.sql`, `281_sprint68_session_insight_capability_envelope_dispatch_readback.sql`, `282_sprint68_session_insight_capability_envelope_adapter_execution_gate.sql`, `283_sprint68_session_insight_capability_envelope_remaining_scope_completion.sql`, and `284_sprint68_session_insight_backlog_target_write_executor.sql` with no-hidden-execution/no-provider/no-external-send safety evidence.

For Session Insight target write readback, generated impact notes for migration `285_sprint68_session_insight_target_write_readback.sql` are resolved by the patch index, deployment parity checklist, agent guide/OpenAPI route coverage, this governance file, `docs/auto-docs-agent/README.md`, and `docs/change-documentation-governance.md`. Required evidence includes table `session_insight_target_write_readbacks`, views `v_session_insight_target_write_readback_issues` and `v_session_insight_target_write_readback_readiness`, policy `session_insight_target_write_readback_policy_v1`, tools `session_insight_target_write_readback_create` and `session_insight_target_write_readback_list`, routes `/platform/session-insight-promotions/target-write-readbacks/create` and `/platform/session-insight-promotions/target-write-readbacks/list`, and explicit no_provider_call/no_raw_secrets/no_external_send markers. This documentation does not authorize target write creation, target item mutation, rollback execution, provider calls, credential payload reads, external writes, raw transcripts, or secrets.

## Classifier behavior

The classifier is deterministic and dependency-free. It maps changed files into impact families such as:

- `runtime_routes`
- `database_migration`
- `credential_or_auth`
- `deployment_runtime`
- `tenant_gpt`
- `admin_gpt`
- `canonical_sources`
- `openapi_schema`
- `docs_agent`

Each family maps to required documentation targets and risk level. The generated note records changed files, required docs, docs missing from the diff, and a short recommendation.

## Optional AI layer

The current implementation is deterministic so the workflow remains reliable without external model credentials. OpenRouter is the priority model provider candidate for the first model-backed drafting layer because it can be exposed through an OpenAI-compatible, platform-managed bridge.

The OpenRouter contract is tracked in `docs/openrouter-docs-agent-provider-contract.md` and registry key `docs_agent_openrouter_instruction_contract_v1`. It must keep these guardrails:

- model output must be converted into a normal Git diff
- all model calls must go through the Growth Intelligence Platform governed API/orchestrator
- no direct OpenRouter calls from the agent
- no direct `main` writes
- no secret ingestion or emission
- no live provider calls from untrusted fork PRs
- docs-only follow-up PRs remain the auto-merge unit
- provider status remains `planned` until platform credential binding and bridge smoke validation pass

## Auto-merge contract

A docs PR is auto-mergeable only when:

1. The diff is limited to generated documentation notes or approved docs files.
2. CI passes.
3. GitHub branch protection accepts the checks.
4. The workflow used GitHub auto-merge rather than bypassing review/branch protection.

High-risk code PRs can be made auto-mergeable by label only after the repository owner has approved that behavior for the PR.

## Files

```text
.github/workflows/docs-agent.yml
http-generic-api/scripts/docs-impact-classifier.mjs
http-generic-api/scripts/docs-agent-runner.mjs
http-generic-api/test-docs-impact-classifier.mjs
docs/auto-docs-agent/README.md
docs/ai-docs-agent-governance.md
```
