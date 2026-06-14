# AI Agent Knowledge Guide
**Repository:** Multi-Business-Multi-Role-Growth-Intelligence-OS

## Purpose
This document is an agent-facing knowledge summary for working inside this repository.
It translates the canonical architecture into an operational guide for AI agents, orchestrators, and governed automation layers.

## Top-level expanded reference

`Top Level Instructions.md` is intentionally compact and must stay under 8,000 characters. Detailed rules formerly embedded there are maintained here.

For the personal Custom GPT Admin Assistant action setup, scoped OpenAPI files, subdomains, and admin operating boundaries, use `GPT_Admin_Assistant_Knowledge_Guide.md`.

### Live repo knowledge loading

Do not treat GPT Builder file uploads as the canonical source for repo knowledge. They can drift. When repo tools are available, read live files from the repository through governed auth-host tools.

Admin/service agents may use `repo_inspect` through `callAdminTool` to read `AI_Agent_Knowledge_Guide.md`, `GPT_Admin_Assistant_Knowledge_Guide.md`, canonical root files, `http-generic-api/openapi.yaml`, and relevant `docs/*.md` files for the current task.

Tenant GPTs must not use admin repo tools. Tenant knowledge must come from OAuth-scoped `auth.mad4b.com` tenant tools discovered by `listTools`, and only from tenant-safe bounded docs or guidance surfaces. Admin-only guides, raw migrations, DB dumps, secrets, and cross-tenant diagnostics must not be exposed to Tenant GPTs.

### Authority sources

| Registry | Purpose |
|---|---|
| `actions` | Action keys, auth mode, schema binding |
| `endpoints` | Endpoint keys, method, path, domain |
| `execution_policies` | Current transitional runtime preflight authority for governed execution paths |
| `platform_engine_policy_registry` | Target platform-engine policy authority |
| `platform_engine_policy_rules` | Target enforceable policy/rule representation |
| `policy_logic_bindings` | Traceability bridge between runtime policies, target rules, and legacy logic mirrors; not enforcement |
| `workflows` | Workflow authority, `execution_class`, `review_required` |
| `logic_definitions` | Execution logic, engine prompts, Drive links; not policy authority |
| `business_activity_types` | Activity resolution |
| `task_routes` | Routing authority |
| `brands` | Brand context, auth target binding |
| `hosting_accounts` | Per-target credentials |
| `connected_systems` | MCP/external connectors |
| `business_type_profiles` | Business-type knowledge and engine compatibility |
| `output_artifacts` | Canonical store for agent-generated outputs |
| `sink_dispatch_log` | Audit trail for output routing decisions |
| `agent_chain_events` | Event bus for inter-agent communication and chaining |
| `local_connector_user_configs` | Per-user device tunnel URL, connector_secret, cf_tunnel_id |
| `local_connector_shell_allowlists` | Per-device shell alias allowlists (alias, command_template) |
| `local_connector_file_access_rules` | Per-device file path access rules |
| `agent_skills` | Skill capability definitions: skill_key, scope, capability_json |
| `agent_skill_grants` | Per-agent active skill bindings; validated at dispatch time |
| `agent_workflow_bindings` | Agent ↔ workflow binding with trigger_condition |
| `agent_supervision_policy` | Auto-approve class thresholds per agent+tenant |
| `brand_paths` | Brand to business-type path, Drive folder IDs, Brand Core map |
| `brand_core` | Brand asset rows and Drive subfolder IDs |

### Runtime and model chain

Deployment claims require runtime evidence. The API `prestart` lifecycle generates
`http-generic-api/deployment-manifest.json`; CI must spawn the real server and read
`/version` commit evidence; Hostinger environments must provide explicit `DEPLOYMENT_BRANCH`.
Treat missing manifests, detached `HEAD`, and hostname-derived branch labels as
incomplete provenance, not proof of a successful deployment. Incident evidence is
recorded in `docs/execution-log-hostinger-503-recovery-2026-06-14.md`.

All meaningful execution should conceptually follow:
- `prompt_router`
- `module_loader`
- `system_bootstrap`
- `governanceValidationEngine` (explicitly called by `system_bootstrap` for validation)
- runtime tool / connector execution
- governed logging + writeback
- memory persistence through `memory_schema.json`

AI workflows run through:

```text
connectorExecutor -> runAgentLoop -> runLogicWithModel -> engineExecutorRegistry.dispatch -> [MCP | HTTP action | logic-as-engine]
```

`workflows.execution_class` selects tier: `standard`, `complex`, or `authority`. `modelAdapterRouter` maps tiers to models across `openrouter`, `openai`, `anthropic`, and `gemini`. `platform_runtime_config.agent_model_runtime` is the governed model-routing setting for provider order, free-first behavior, env-var references, and class-to-model mappings. `AGENT_MODEL` and `AGENT_MODEL_PROVIDER` remain emergency/runtime overrides.

When `workflow.review_required = 1`, run post-execution review on `standard`. Major failures trigger an automatic fix pass. Write the result to `step_runs.verify_pass`.

### Drive knowledge layer

`logic_definitions` rows carry `source_doc_id` and `knowledge_folder_id`. `body_json.system_prompt` is the canonical prompt from the Drive spec. Run:

```powershell
node http-generic-api/sync-drive-to-db.mjs --apply
```

to sync Drive to DB when explicitly performing that maintenance task.

### Activation detail

Activation order:
1. Read knowledge-layer canonicals.
2. Read Session Context: `GET /activation/session-context`.
3. Read Platform Access if not embedded or if a fresh count is needed: `GET /activation/platform-access`.
4. Admin GPT path: call `/system/tools/call` with `name: "activation_provider_bootstrap_validate"` through `auth.mad4b.com` to run the governed Drive probe, DB-native bootstrap config read, and GitHub validation in one same-cycle tool call. This validates provider/bootstrap only; it does not open or read GPT Session Context and must not replace step 2.
5. Preferred Admin GPT hard activation path: call `POST /activation/hard-run` through the governed tool `activation_hard_run` when available. Treat hard activation as complete only when the response includes `activation_complete=true`, `evidence_matrix.session_context.ok=true`, and `evidence_matrix.provider_bootstrap.ok=true`. The default `response_profile=evidence` must also return complete account/workspace/Brand/permission/capability counts when available, Dynamic Tabs and Dashboard manifests, attention and freshness summaries, a completeness envelope, awareness index, snapshot metadata, and governed detail references. Use `summary`, `dashboard`, `diagnostic`, or `full` only when explicitly selected or required; `full` is compatibility mode, not the default.
6. Direct runtime path, when not using the auth-host system layer: Drive probe with `parent_action_key=google_drive_api`, `endpoint_key=listDriveFiles`.
7. Direct runtime path: read `GET /activation/bootstrap-config` through registry/bootstrap authority; do not read Google Sheets for activation bootstrap.
8. Resolve the authoritative DB-native bootstrap row.
9. GitHub validation only with `parent_action_key` and `endpoint_key` resolved from DB bootstrap/registry authority.
10. Run live validation and classify readiness.

Session Context may include previous session history, related scopes, scoped request transcripts, bounded raw dumps when `include_raw=true`, a `platform_access` summary, `session_management`, and `conversation_memory`. Platform Access reports admin/global scope plus brands, plugins, logics, engines, and runtime-callable actions counts. User JWT sessions inspect only their own user context. Admin/service sessions may inspect explicit `user_id` and may receive execution-log prompt/response summaries.

Do not report “Session Context opened/loaded” unless the current activation cycle includes `getActivationSessionContext` evidence or `/activation/hard-run` evidence with `activation_layer=session_context`, `session_id`, `session_management`, `platform_access`, and `conversation_memory.status`. If provider bootstrap succeeds but Session Context was not attempted, classify the hard activation report as `degraded_missing_session_context_evidence` even if provider bootstrap is `active`.

Session Context is platform-side continuity evidence, not native ChatGPT history access. It opens a new `customer_sessions` row when no reusable run exists and, by default, permits parallel GPT conversations. With `session_policy=reuse_or_create`, the same tenant/user/idempotency key should reuse the existing active session and activation run inside the configured reuse window. It must not close other active sessions unless the caller explicitly passes `close_previous_sessions=true` or `close_previous=true`. New GPT action sessions should use `session_status='active'`.

Activation lifecycle reporting must keep `validation_state`, `evidence_state`, `delivery_state`, and `consumer_ack_state` separate. A prepared response is not delivered until transport completes, and a delivered response is not acknowledged until the consumer explicitly calls the acknowledgement surface. Snapshot id, registry version, data watermark, response profile, response bytes, and deferred-surface projection should remain traceable in SQL without storing secret values.

`conversation_memory` is summary-first. Prefer `session_summaries`, tagged `platform_pending_tasks.conversation_context_ref` references, and graph-memory hints before loading turn previews. Bounded previews from `gpt_session_turns` should be loaded only when `include_turns=true` with a bounded `turns_limit`; full transcript content should be retrieved from Drive only for targeted continuation/debugging. The backend does not have general access to native ChatGPT history unless turns were explicitly archived into platform tables or Drive.

Session turns are stored through `writeSessionTurn` / `recordGptSessionTurn()`. The intended policy is that SQL stores session IDs, role, index, hashes, action keys, bounded `content_preview`, and Drive pointers, while full turn content lives in Drive doc/JSONL archives. Avoid adding new inline turn content to SQL. Summaries are written either by `endSession` when a summary is supplied or by the dev-agent summarizer into `session_summaries`; long or completed sessions should be summarized with tags before relying on raw turn retrieval.

Graph memory is advisory context, not authority. It may add `graph_memory_context`, `activation_graph_context`, and release-readiness diagnostics, but it must stay `summary_only`, `raw_secret_values_included=false`, and `secrets_included=false`. Graph results must not replace registry authority, activation mode policy, integration readiness, credential resolution, or same-cycle provider validation.

See `docs/session-context-graph-memory-archive-notes.md` for the current implementation notes and follow-up backlog.

Do not start GitHub until the DB bootstrap row resolves. If Session Context is unavailable, continue only with a degraded surface note unless auth isolation fails. If Drive or DB bootstrap validation is not attempted when required, classify as `degraded (missing_required_provider_bootstrap_attempt)`.

### Runtime validation

Every execution must validate surface bindings, route/workflow authority, dependency readiness, and credential resolution. Recovered classification is forbidden without same-cycle validation.

### Docs Agent automation

Repository documentation alignment is now automated through the Docs Agent workflow. On pull requests, it generates `docs/auto-docs-agent/pr-<number>.md` on the PR branch when non-doc files change. On pushes to `main`, it opens a docs-only follow-up PR from `docs-agent/<sha>` and requests GitHub auto-merge after CI.

Agents should treat the generated note as reviewable evidence, not as a replacement for targeted high-risk documentation. Runtime/code PRs are not auto-merged by default unless the explicit `docs-agent-automerge` label is present. Docs-only follow-up PRs may auto-merge only through branch-protected GitHub auto-merge. See `docs/ai-docs-agent-governance.md`.

OpenRouter is the priority model-provider candidate for future Docs Agent drafting, but it must run only through the platform-managed OpenAI-compatible bridge and `docs_agent_openrouter_instruction_contract_v1`. Do not call OpenRouter directly from agent code, do not copy provider secrets to prompts/devices, and do not promote the provider from `planned` to `active` until credential binding plus bridge smoke validation pass. See `docs/openrouter-docs-agent-provider-contract.md`.

### Session Insight capability-envelope release-readiness chain

Migrations `277` through `283` implement the Session Insight capability-envelope chain as gated no-execution layers: dispatch dry-run review, actual request preflight, actual envelope request ledger, approval gate, dispatch readback, adapter execution gate, and remaining scope completion. The authoritative release-readiness runbook is `docs/session-insight-capability-envelope-release-readiness.md`.

Agents must not treat migrations `277` through `283` as production target-write authorization. Migration `284_sprint68_session_insight_backlog_target_write_executor.sql` is the first write-enablement layer and is limited to internal SQL backlog target writes after the capability-envelope approval/readback/remaining-scope chain is complete. It may set `target_write_allowed`, `target_write_executed`, and `promotion_allowed` only inside `session_insight_backlog_target_writes`; provider calls, credential payload reads, external writes, raw transcripts, and secrets remain forbidden.

### Runtime policy preflight governance

`execution_policies` is the active transitional runtime preflight authority. Agents must treat it as required runtime policy evidence until a target-rule resolver bridge proves parity with `platform_engine_policy_rules`.

Current required runtime policy seeds cover:

- repository mutation safety and stale/diverged `repo_patch_apply` branches
- repository patch capability envelopes: `repo_patch_apply` must include `capability_envelope_id`; runtime resolves `capability_resolution_envelope_ledger` for GitHub/repo mutation intent and marks the envelope referenced before GitHub App token resolution or content mutation. `repo_inspect` remains read-only and ungated.
- budget and quota authority: spend-changing or platform-cost actions must check `budget_quota_authority_registry` through `budget_quota_authority_dry_run`; missing authority or exceeded limits block execution, and approval-required authorities flow through `capability_resolution_envelope_approve` before dispatch.
- Google Ads budget changes: `google_ads_budget_change_preflight` must pass before any future Google Ads budget mutation adapter can call Google Ads; it requires a ready Google Ads capability envelope and `budget_quota_authority_dry_run=ready_for_dispatch`, and it never reads credentials or changes spend. Every preflight result must be recorded in `google_ads_budget_preflight_ledger`; future execution must require a ready `preflight_id` and verify hash/readback through `preflight_ledger_validate` and `requireValidatedPreflightForExecution` before mutation. The current `google_ads_budget_change_execution_adapter` is a disabled skeleton only; it validates and audits, then blocks provider execution. Future real execution also requires `google_ads_credential_readiness_gate` to pass using connection/binding metadata only; it does not read/decrypt credentials. Every readiness result must be recorded in `google_ads_credential_readiness_ledger`; future execution must require a ready `credential_readiness_id` with hash/readback. Ads provider onboarding is governed by `ads_provider_capability_profile_registry`; future providers must be introduced as profiles with `execution_enabled_default=false` before any provider-specific preflight or execution adapter exists. New provider profiles must be requested through `ads_provider_profile_request`, approved through `ads_provider_profile_approve`, and start as `draft`; approval never creates provider tools, credentials, adapters, or spend surfaces. Before any provider-specific preflight surface is designed, `ads_provider_preflight_contract_validate` must pass for that profile; the validator is read-only and no-execution. After contract validation, `ads_provider_preflight_surface_blueprint` may generate design-only names for future provider-specific surfaces, but it must not create tools, tables, credentials, adapters, or spend surfaces. Final provider execution also requires `execution_enablement_gate`; missing/disabled `execution_enablement_registry` rows block provider execution. Enablement rows must be created through `execution_enablement_request` → `execution_enablement_approve` and can be disabled through `execution_enablement_revoke`; the flow is approval-backed, scoped, expiring, and no-execution.
- external app action preflight visibility
- blocking `n8n execute_workflow` side-effect guard
- connector dispatch preflight visibility
- agent-loop preflight visibility
- Brand Core requirement for writing/content/SEO/publish/strategy flows
- shared reconciliation continuation for resumable governed operations
- chunked tool response continuation: when any governed tool response includes `response_chunked=true`, `page.has_more=true`, or `page.next_cursor`, agents must call `response_chunk_read` with the returned `chunk_id` and cursor until exhausted before switching to local slices, secondary search, connector reads, or external fallback surfaces; chunk cache TTL is size-aware, may be controlled with `response_options.chunk_ttl_ms` or `response_options.chunk_ttl_minutes`, and is extended after each successful chunk read so long continuations do not expire mid-read
- local connector tunnel provisioning continuation: when `connector.mad4b.com` returns HTTP 530/1033, self-repair must first try no-secret DB device alias resolution (for example `Essam` -> `essam-pc`) before declaring a missing tunnel token. If no active alias/config has `cf_token` and `CLOUDFLARE_TUNNEL_TOKEN` is absent, agents must return/use the no-secret `connector_tunnel_provisioning_required` checkpoint and retry self-repair only after tunnel token provisioning; do not classify recovered without same-cycle connector health validation.
- admin branch reconcile continuation: use `admin_branch_reconcile` before stale-branch overrides. Adapter v1 is dry-run/plan-only: it classifies branch drift, returns no-secret continuation evidence, and blocks apply until explicit review/confirmation surfaces exist; diverged/ahead/protected branches must use manual rebase/PR workflow, never force-push.
- repository intelligence V2 tenant scope: `tenant_repo_pr_reconciliation_sweep` is the tenant-facing read-only wrapper over `governed_resource_run` and `repo.pr.reconciliation_sweep`. It requires an active `platform_resource_authority_bindings` row for the tenant/workspace/user scope and GitHub repo URI, must block before provider calls when the binding is missing, and must keep `apply_allowed=false`, `mutations_executed=false`, and `secrets_included=false`. Admin-only lifecycle tools are `platform_resource_authority_binding_create`, `platform_resource_authority_binding_list`, `platform_resource_authority_binding_revoke`, and `tenant_repository_intelligence_v2_readiness_smoke`; V2 grants only `permission_level=read_only` and `allowed_modes=["read_only"]`. V3 adds `tenant_repository_intelligence_report` for read-only decision reports with classification summaries, top risks, manual recommendations, PR evidence, Markdown/JSON output, and bounded evidence. V4 adds `tenant_repository_action_planner_dry_run` plus `tenant_repository_intelligence_v3_v4_readiness_smoke` for non-executed action planning and readiness validation. V5 adds `tenant_repository_advisory_comment_preview`, `tenant_repository_advisory_comment_apply`, `tenant_repository_advisory_comment_readback`, and `tenant_repository_advisory_comment_v5_readiness_smoke` for approval-gated advisory PR comments only; V5 must never label, close, merge, patch files, force-push, or apply migrations. Evidence, when requested, is bounded in `audit_payload_evidence` as `tenant_repository_pr_reconciliation_summary_v2`, `tenant_repository_intelligence_report_v3`, or `tenant_repository_action_planner_v4` with hashed scope metadata. V2/V3/V4 must never comment, label, close, merge, patch, force-push, or apply migrations.
- GitHub fallback repair-before-fallback evidence: when `gh` is unavailable, mapped REST fallbacks and unsupported fallback errors must include no-secret continuation checkpoint evidence plus exactly three governed repair-attempt records before fallback/manual routing

`platform_engine_policy_registry` and `platform_engine_policy_rules` contain additive target representations. They must not be treated as full runtime replacement until `runtimePolicyResolver` emits source evidence and compatibility fallback is validated.

`policy_logic_bindings` is a traceability bridge only. It must not be used as an enforcement source, and new policy rows must not be mirrored into `logic_definitions` by default.

Release readiness must include `runtime_policy_seed_readiness`; missing or invalid runtime seeds block release readiness.

### General mode-choice governance

Before executing any governed operation that has multiple valid modes or scope selectors, the agent must give the user a compact choice prompt and receive an explicit selection unless the user already selected the mode in the current request or policy exposes exactly one safe valid mode.

This rule is general and is not limited to Hostinger `runner_mode`. It applies to any executable selector named `mode`, `*_mode`, `*_modes`, `runner_mode`, `execution_mode`, `activation_mode`, `integration_modes`, `credential_scope`, `auth_mode`, `transport_mode`, `dispatch_mode`, `sync_mode`, `deploy_mode`, `reconciliation_mode`, `approval_mode`, or any future scope/mode field declared by registry, OpenAPI, runtime policy, or tool input contracts.

The user-facing prompt must include the valid modes, recommended/default mode when one exists, risk and side-effect class, expected evidence, and a clear request to choose. Agents must not silently choose the first enum value, switch modes after failure, or treat `auto` as consent for a higher-risk mode. If a selected mode fails and a fallback mode is possible, the fallback requires a fresh user-visible choice. Execution summaries should preserve `selected_mode`, `selection_source`, `mode_choices_presented`, and `secrets_included=false`. See `docs/mode-choice-governance.md`.

### Platform Plugin smoke certification governance

Platform Plugin REST actions must not be treated as dispatch-ready just because `app_integrations`, action bindings, or endpoint rows exist. The public dispatch path must resolve readiness, credential/connection state, action grants, and smoke certification before execution.

Current governed surfaces:

- `platform_plugin_dispatch_rest` — guarded REST dispatch and provider smoke.
- `platform_plugin_smoke_certify` / `platform_plugin_smoke_certification_status` — smoke certification write/read.
- `platform_plugin_smoke_recertification_queue` / `platform_plugin_smoke_recertification_batch` — expiry/drift queue and bounded recertification.
- `platform_plugin_smoke_recertification_policy_*` — policy resolve/list/upsert/history/rollback surfaces.

A valid smoke certification requires a successful `provider_smoke=true` execution log with `GET`, status `200`, `response_ok=true`, expected origin matching resolved origin, and `secrets_included=false`. Dispatch and promotion must reject missing, expired, or drifted certifications. Drift includes origin, path, or method mismatch between certification evidence and the current resolved dispatch target.

Recertification is policy-governed. Batches default to dry-run, honor policy `max_batch_size`, require explicit expected origin evidence, and must not bypass origin/path/method drift. Policy upsert and rollback write execution-log audit evidence with before/after summaries and changed fields.

Detailed operator maps:

- `docs/platform-plugin-smoke-certification-governance.md`
- `docs/platform-plugin-recertification-policy-governance.md`
- `docs/platform-plugin-governance-roadmap-2026-05-28.md`

### Local connector device proxy governance

Local connector device operations go through `auth.mad4b.com` `/connector/{device_id}/...` proxy routes, not direct connector hosts, except for explicit break-glass reachability checks. Use `/connector/{device_id}/diagnostics` before long-running device actions to confirm selected config, candidate routes, hostname alias handling, and route health metadata.

Device alias rows in `local_connector_device_aliases` are authority for friendly names and hostname mismatch exceptions. As of 2026-05-24, Nagy's admin/control device is `DESKTOP-91FDEFP` with aliases `nagyxs`, `nagy pc`, and `nagy`; Essam/`essam-pc` remains the primary n8n runtime. Do not promote `DESKTOP-91FDEFP` to primary n8n runtime without an explicit runtime migration record and same-cycle validation.

Prefer short, allowlisted local connector shell aliases for repo and runtime maintenance (`repo_status`, `repo_branch`, `repo_log_latest`, `repo_compare_origin_main`, `repo_pull_ff_only`) instead of raw PowerShell. Raw PowerShell through auth-host should be reserved for bounded setup/recovery because long scripts and service restarts can surface Cloudflare/Passenger 502 or ChatGPT message-delivery timeouts. `repo_pull_ff_only` must remain `git pull --ff-only origin main` and must not be replaced by an unrestricted pull/merge command.

Do not use oversized `admin_control`, `connector_ps`, or `connector_github` calls for PR update/merge flows when GitHub connector, GitHub REST fallback, or local Git commands can perform the work. For `connector_ps` and `connector_github`, HTTP 200 means the connector route responded; command success is determined by the JSON body `ok`, `command_ok`, `exitCode`, and `exit_code`. `connector_ps` and `connector_github` stdout/stderr may be truncated; inspect `stdout_truncated`, `stderr_truncated`, `stdout_length_chars`, `stderr_length_chars`, and `output_limit_chars` before assuming the full payload was returned.

### Tenant activation mode governance

Managed and dedicated activation modes are governed by `activationModePolicy.js`. Tenant GPTs must call `connect_activate` with `tool_args.mode` set to `managed` or `dedicated`; aliases may be normalized server-side, but stored mode is canonical. Managed uses platform-managed infrastructure and credentials. Dedicated uses tenant-owned credentials/local runtime defaults, including `self_hosted_local` n8n where applicable. Mixed/hybrid behavior is per-app, not a third activation mode: use `integration_modes` or `connect_integration_policy_update` to set apps like Cloudflare/Hostinger to `dedicated` while keeping Google apps `managed`. Dedicated app secrets must be entered only through OAuth or credential intake, never pasted into GPT chat. Device install must not proceed until all integrations configured as dedicated and required for device install are active.

### Development environment governance

`dev.mad4b.com` is the governed development/staging environment for testing repo-branch deployments before production. It is not a brand site and must not be treated as production. Its active evidence should include GitHub branch, commit SHA, deployment mode, Hostinger root, and latest validation result.

Use the separate dev dispatcher OpenAPI schema (`http-generic-api/openapi.gpt-action.dev-dispatcher.yaml`) for passive checks only: `/health`, `/deployment-info`, and protected `/dev/db/status`. Run production control, schema import, release readiness, and provider mutations through `auth.mad4b.com` and the governed dispatcher.

Promotion rule: validate CI, dev deployment, release readiness, and explicit approval before merging/promoting to `main` and `auth.mad4b.com`.

Deployment evidence rule: a current Hostinger checkout is not proof that the running Node.js process loaded the change. Verify `/health`, `/deployment-info` when available, and `SERVICE_VERSION`/runtime profile. If files are current but `/health.version` is old, classify as Hostinger/LiteSpeed process reload lag. Use hPanel restart/redeploy or a governed Hostinger SSH deploy executor only when the target is active, smoke-validated, and approval-gated.

Tenant validation repair rule: when a tenant-safe status route fails with a platform collation/schema/query error, classify it as platform-gated validation rather than tenant credential failure. For runtime join-key collation repairs, prefer narrow, governed fixes to named non-secret join columns plus same-cycle readback of the failing query shape. Do not use permanent `BINARY` joins, broad table conversion, or secret-payload alteration as a shortcut. See `docs/tenant-wordpress-validation-collation-repair-2026-06-06.md`.

### External endpoint credential selection

External endpoint auth is governed at the parent action level. `actions.runtime_binding_profile.auth_strategy` is the default policy for all child endpoints. Endpoints inherit it unless `endpoints.runtime_binding_profile.auth_strategy_override` is explicitly defined for a narrower operation.

When calling exported external endpoint tools, agents may pass:

```json
{
  "credential_scope": "platform | user | tenant | connection | auto",
  "user_id": "optional",
  "tenant_id": "optional",
  "connection_id": "optional",
  "app_key": "optional",
  "scopes": "optional",
  "auth_type": "optional",
  "allow_platform_fallback": false,
  "auth_context": {}
}
```

If `credential_scope` is `user`, `tenant`, or `connection` and `allow_platform_fallback=false`, the runtime must not use platform credentials. Missing scoped credentials should return `external_credential_connection_not_found` or the provider-specific scoped-auth error. Use this for user-owned Drive, tenant API keys, customer Cloudflare/Hostinger, MCP credentials, webhooks, or any per-user external system.

Use platform credentials only when the task is platform-owned or the caller explicitly allows fallback. See `docs/external-endpoint-auth-strategy.md`.

### External endpoint credential selection

External endpoint auth is governed at the parent action level. `actions.runtime_binding_profile.auth_strategy` is the default policy for all child endpoints. Endpoints inherit it unless `endpoints.runtime_binding_profile.auth_strategy_override` is explicitly defined for a narrower operation.

When calling exported external endpoint tools, agents may pass:

```json
{
  "credential_scope": "platform | user | tenant | connection | auto",
  "user_id": "optional",
  "tenant_id": "optional",
  "connection_id": "optional",
  "app_key": "optional",
  "scopes": "optional",
  "auth_type": "optional",
  "allow_platform_fallback": false,
  "auth_context": {}
}
```

If `credential_scope` is `user`, `tenant`, or `connection` and `allow_platform_fallback=false`, the runtime must not use platform credentials. Missing scoped credentials should return `external_credential_connection_not_found` or the provider-specific scoped-auth error. Use this for user-owned Drive, tenant API keys, customer Cloudflare/Hostinger, MCP credentials, webhooks, or any per-user external system.

Use platform credentials only when the task is platform-owned or the caller explicitly allows fallback. See `docs/external-endpoint-auth-strategy.md`.

### Agent-side operating perspectives

Agents should classify themselves by operating side before choosing endpoints. The same backend may expose both admin and customer workflows, but the allowed evidence, risk posture, and mutation authority are different.

#### Admin agent side

Admin agents operate as platform-owner or service-control assistants. They may inspect platform-wide registry state, all-brand access summaries, scoped OpenAPI action health, runtime-callable actions, logics, engines, plugin inventory, release readiness, auth gaps, and schema/client errors.

Use admin-side behavior when the task is about:

- hard activation, platform access, registry readiness, schema generation, scoped GPT Action setup, deployment, DNS, GCloud, GitHub, DB repair, or admin CLI
- all-brand or cross-tenant diagnostics
- platform maintenance, release readiness, generated schemas, canonicals, or runtime policy
- fixing route contracts, auth, security, observability, or privileged execution paths

Admin agents must:

- require backend/service auth or explicit admin authority
- prefer specific governed endpoints before `admin-cli`
- preserve audit evidence for privileged actions
- treat GCloud, GitHub, DB, secrets, admin CLI, auth, and provider transport as high-risk
- avoid destructive operations unless the current conversation contains explicit intent and the backend policy allows it

#### Customer agent side

Customer agents operate inside a tenant/user boundary. They should help with brand, CRM, support, workflow, and customer-facing platform tasks while staying scoped to the authorized tenant, user, brand, and service mode.

Use customer-side behavior when the task is about:

- customers, contacts, tickets, threads, timeline, tenant memberships, subscriptions, entitlements, access decisions, or brand-specific work
- brand writing, SEO, growth analysis, or content planning for a resolved brand
- user-owned Drive/Sheets input, only when refresh-token auth is required and authorized

Customer agents must:

- resolve access with the identity/access scope before execution when membership, role, entitlement, service mode, or risk level matters
- require Brand Core before brand writing or public-facing content
- avoid all-brand, cross-tenant, admin CLI, DB, GCloud, GitHub mutation, secret, or raw execution surfaces
- receive only scoped session history and transcripts; raw dumps must be bounded and same-user or explicitly authorized
- report `authorization_gated`, `blocked`, or `degraded_contract` instead of trying admin recovery paths

### Local Manager connector capability installer governance

Local Manager is now the app-owned surface for connector repair and capability installer application. For repair and capability flows, the app must request a short-lived installer link from `POST /local-connector/install/device-download-link` using its DPAPI-protected device token. App-owned flows must send `app_managed=true` and `suppress_pause=true`, launch the returned BAT through Windows UAC, handle UAC cancellation, wait for the elevated process when possible, then refresh controls.

Do not treat `section=settings` refresh as proof that capabilities were applied. Validate the effective connector behavior after a capability installer runs:

- `connector_ps` should return a PowerShell version when `powershell_admin` was explicitly selected.
- `connector_win process_list` should return process data when `windows_control` was explicitly selected.
- `connector_files list_drives` should show selected allowed paths, such as `D:\\`, in `allowed_paths`.
- `connector_apps list` should include default app aliases plus any dynamic app grant selected locally.

The final `.env` writer is `/connector-agent/installer.ps1`, not just the BAT wrapper. It must render signed capability/grant intent into `CONNECTOR_POWERSHELL_ENABLED`, `CONNECTOR_WIN_ENABLED`, `CONNECTOR_FILE_PATHS`, `CONNECTOR_APP_ALLOWLIST`, and `CONNECTOR_SHELL_ALLOWLIST`. The PR #368 failure mode was: Local Manager and app-managed BAT were correct, but the connector-agent PowerShell installer ignored capability/grant payloads. Future changes must test both `/local-connector/install/download` and `/connector-agent/installer.ps1`.

High-risk capabilities remain opt-in only and require local UAC approval. Never enable `CONNECTOR_POWERSHELL_ENABLED` or `CONNECTOR_WIN_ENABLED` in the base connector env. Prefer bounded verification evidence and keep `secrets_included=false` in all diagnostics. See `docs/local-manager-capability-installer-governance-2026-05-28.md`.

### Local Manager n8n runtime governance

n8n runtime selection is DB-governed. `connected_systems.config_json` and linked `installations` rows are the source of truth for n8n command path, npm prefix, user folder, port, local URL, public URL, editor base URL, webhook URL, lifecycle mode, and exposure scope. Local Manager must load `/local-manager/device/controls?section=n8n` and generate its start script from the returned profile. Do not hard-code tenant n8n routes in the app or in GPT behavior.

`https://n8n.mad4b.com/` is reserved for the platform-managed n8n runtime only. While the platform runtime is temporarily hosted on an admin workstation, it must be represented by a managed `connected_systems` row with `runtime_role: "platform_managed"`, `reserved_platform_domain: true`, `local_url: "http://127.0.0.1:5678/"`, and `public_url: "https://n8n.mad4b.com/"`. Tenant/user n8n profiles must use `runtime_role: "tenant_local"`, a tenant-specific data folder, and a broker-safe non-platform port range. Do not use web port `5679` for tenant n8n because n8n's Task Broker defaults to `5679`; use web port `5682`, broker port `5683`, and launcher health check port `5684` unless a DB profile explicitly reserves another non-conflicting range.

Tenant public n8n exposure must be explicit and DB-backed. Use a tenant/device-specific hostname such as `https://n8n-<stable-opaque-id>.mad4b.com/`, not `n8n.mad4b.com` and not user email or tenant display names. Store `public_url`, `editor_base_url`, `webhook_url`, `public_tunnel_mode`, and `exposure_scope: "tenant_public_tunnel"` on the tenant n8n profile. Raw Cloudflare tokens, connector secrets, or n8n API keys must never be stored in `connected_systems.config_json`.

Do not default n8n to `https://127.0.0.1:<port>`. Cloudflare should provide HTTPS at public hostnames while local origins remain HTTP on `127.0.0.1`, unless a specific certificate/key lifecycle is intentionally implemented and validated.

See `docs/local-manager-n8n-runtime-governance.md` for the runbook.

### Local Windows app connections

Local Windows app access is a device-side connector capability, not a Cloud Run execution capability. `api.mad4b.com` may act as the cloud control plane for registration, status, policy, tenant/user access checks, and request routing, but it must not directly launch apps on a customer device because Cloud Run has no access to the customer's local Windows session.

Admin and customer local app access share these invariants:

- remote callers may request status or create a pending local action request
- remote callers must not remotely enable local device execution
- the local Windows connector must be intentionally running on the user's device
- the local connector must use a fixed allowlist of app aliases; caller-supplied commands, arguments, shells, PowerShell, or arbitrary app paths are forbidden
- local execution is blocked in GCloud runtimes
- launch decisions must be audited with actor, tenant, app alias, authorization state, and runtime classification

Admin-side local app access uses backend/service auth and is limited to platform-owner administration. Customer-side local app access must use `Authorization: Bearer <USER_JWT>`, resolve the user's tenant membership/entitlement, and stay scoped to that customer's device connector and allowlist. A customer GPT may help the customer authorize their own local connector, but it must not use admin credentials or cross-tenant control to access another customer's apps.

For customer flows, prefer this sequence:

1. User signs in through the GPT Action OAuth popup backed by `https://auth.mad4b.com/auth/oauth/authorize` and `https://auth.mad4b.com/auth/oauth/token`; `/auth/login` and `/auth/google` are trusted web-flow or fallback paths.
2. Runtime resolves tenant membership, entitlement, and risk level.
3. Customer starts or configures the local Windows connector on their own device.
4. GPT checks connector status through a scoped runtime/local-connection action.
5. GPT requests launch only by allowlisted `app_alias`; the local connector performs final local authorization and execution.

If the local connector is absent, not enabled, not on Windows, not allowlisted, or running in GCloud, classify the request as `authorization_gated` or `blocked_local_runtime` rather than attempting admin recovery.

### Native browser plugin tier

Browser automation is a native platform plugin family under the local/cloud connector model. Browser libraries must be exposed as governed platform verbs, not raw library APIs.

Initial tier registry:

| Plugin key | Library | Tier | Status | Primary fit |
|---|---|---:|---|---|
| `browser.playwright` | Playwright | 1 | candidate default | controlled cross-browser automation |
| `browser.puppeteer` | Puppeteer | 2 | Chrome specialist | lightweight Chromium-only jobs |
| `browser.stagehand` | Stagehand | 3 | approval-gated candidate | AI-adaptive browser workflows |
| `browser.remote_browser_research` | remote-browser | 4 | research only | legacy/reference evaluation |

Browser plugin capability groups may include managed sessions, navigation, interaction, extraction, artifacts, QA, and AI-adaptive browser workflows. Supported governed verbs include `create_session`, `list_sessions`, `get_session`, `close_session`, `open_url`, `reload_page`, `go_back`, `wait_for_load_state`, `wait_for_selector`, `click_selector`, `form_fill`, `select_option`, `press_key`, `capture_screenshot`, `extract_schema`, `extract_text`, `extract_links`, `get_page_metadata`, `generate_pdf`, `run_assertion`, `inspect_accessibility_snapshot`, `record_trace`, `save_artifact`, `download_allowlisted_file`, and `upload_allowlisted_file`.

Do not expose `eval`, arbitrary JavaScript, raw CDP/WebDriver, shell, filesystem, unrestricted upload/download, or browser-extension background execution as GPT-callable actions.

Every executable browser plugin requires user JWT for customer scope, admin/service auth for admin scope, tenant entitlement, domain allowlists, audit logging, and local consent for customer-owned local connectors. Stagehand and other AI-adaptive browser control must also use approval holds before sensitive actions.

### Functional endpoint question model

When asked "what is this endpoint for?", answer by mapping the endpoint to:

1. scope and action file
2. functional purpose
3. intended agent side: admin, customer, or both
4. when to use it
5. when not to use it
6. auth/risk classification
7. expected evidence in the response

For example, `/activation/session-context` is a runtime/admin-and-customer activation context endpoint. It restores same-user session continuity, related scopes, transcript availability, and platform access summary. It is not a provider validation replacement, not proof of Drive/Sheets/GitHub readiness, and raw dumps are optional, bounded, and auth-scoped.

### Engineering guardrails

API contracts must follow OpenAPI 3.1. Public and Custom GPT schemas should use stable structured error envelopes, normally `ErrorResponse` with nested `ErrorObject` carrying machine-readable `code`, human-readable `message`, optional HTTP `status`, and optional bounded `details`.

When implementing layered application code, preserve folder boundaries:

- `src/api`: transport adapters, request/response mapping, route/controller wiring, OpenAPI-facing contracts
- `src/application`: use cases, orchestration, policy application, transaction boundaries
- `src/domain`: entities, value objects, domain rules, pure business invariants
- `src/infrastructure`: database, external services, provider clients, filesystem, queues, environment access

Keep dependencies flowing inward. Domain code must not depend on API or infrastructure. Application code may depend on domain contracts and infrastructure interfaces, while concrete infrastructure stays outside the domain.

Engineering work should prioritize small, safe, reviewable changes. Prefer explicit errors over silent fallback, bounded validation over broad rewrites, tests for changed behavior, and security review for auth, input handling, provider transport, secrets, admin control, or external integration changes.

PR readiness should include:

- scope and intent
- tests run and evidence
- known risks and rollback notes
- API contract review when routes/schemas/error envelopes change
- database review when migrations, queries, indexes, or persistence semantics change
- security review notes for auth, secrets, input validation, SSRF, command execution, or privileged admin surfaces
- merge readiness checks, including generated schemas/canonicals when relevant

## 1. Authority order
Agents should treat these files as the primary repository guidance sources, in this order:

1. `Top Level Instructions.md`
2. `system_bootstrap.md`
3. `memory_schema.json`
4. `direct_instructions_registry_patch.md`
- `governanceValidationEngine` (explicitly called by `system_bootstrap` for validation)
5. `module_loader.md`
6. `prompt_router.md`

### Supporting but secondary
- `server.js`
- `http-generic-api/*`
- `README.md`

`README.md` is not the authoritative architectural source unless aligned with the canonicals.

### Canonical source workflow

The four root canonical markdown files are lightweight generated indexes:
- `system_bootstrap.md`
- `direct_instructions_registry_patch.md`
- `module_loader.md`
- `prompt_router.md`

Agents should edit the matching source files under `canonicals/`, then run:

```powershell
node build-canonicals.mjs
```

Before completing canonical edits, verify generated roots are current:

```powershell
node build-canonicals.mjs --check
```

Do not edit generated root canonical files directly. The authoritative canonical body lives in the matching `canonicals/` source file.

## 2. Core execution model
The architecture is governed, registry-driven, and validation-first.

### Required execution chain
All meaningful execution should conceptually follow:
- `prompt_router`
- `module_loader`
- `system_bootstrap`
- `governanceValidationEngine` (explicitly called by `system_bootstrap` for validation)
- runtime tool / connector execution
- governed logging + writeback
- memory persistence through `memory_schema.json`

### No-bypass rule
Agents should not bypass the canonical chain with ad hoc reasoning or direct execution assumptions.

## 3. What each canonical does

### `system_bootstrap.md`
Primary execution authority.

Use it for:
- activation behavior
- tool-first execution rules
- runtime validation enforcement (new)
- live validation requirements
- writeback and logging expectations
- degraded vs validating vs active state classification

### `memory_schema.json`
Persistent state contract (root of a decomposed schema set).

Use it for:
- durable execution memory
- state field shape
- `output_artifacts_state`, `sink_dispatch_state`, `agent_chain_state`, `local_connector_governance_state` (new)
- structured persistence expectations

Domain sub-schemas live in `schemas/` and are referenced via `$ref` from the root.
Sub-schemas: `shared`, `business_identity`, `brand`, `execution`, `analytics`,
`governance`, `logic_knowledge`, `repair_audit`, `routing_transport`, `graph_addition`, `operations`, `wordpress_api`.

After memory schema changes, run `node validate-memory-schema.mjs`.

### WordPress blog publish credential recovery

Brand-scoped WordPress blog/article publishing uses the platform-native workflow `wordpress_blog_publish_or_recover_credentials_workflow`.

The expected flow is:

1. resolve brand and WordPress target
2. run publish/preflight readiness
3. resolve `wordpress_rest` credentials
4. if credentials are missing, create a secure credential-intake session and preserve the original publish request without raw secrets
5. after credential storage/readback succeeds, resume the same original publish request
6. create the WordPress post through the dedicated orchestrator
7. return post id, link, status, and readback evidence
8. persist runtime state in `wordpress_blog_publish_recovery_state`

n8n is not authoritative for provider publish execution. It may only run auxiliary governed `workflow_runtime_bindings` side effects, such as notifications or post-publish automation, and must not bypass auth, registry scope, credential resolution, readback, or execution logging.

### `direct_instructions_registry_patch.md`
Hard enforcement patch layer.

Use it for:
- direct overrides
- authority constraints
- non-negotiable runtime behaviors

### `module_loader.md`
Preparation and dependency wiring layer.

Use it for:
- loading target modules
- preparing validation targets
- same-cycle retry context
- execution mode preparation

### `prompt_router.md`
Intent and route selection layer.

Use it for:
- mapping user intent to flows
- activation routing
- preventing invalid routing shortcuts

## 4. Activation model
Activation is not considered complete unless the required governed execution and validation conditions are met.

Agents should assume activation requires the concrete provider bootstrap chain through `http_generic_api`:

1. Load the knowledge-layer canonicals.
2. Run the Session Context probe through `http_generic_api` with `GET /activation/session-context` to recover same-user previous session history, scoped user request transcripts, related platform scopes, and embedded platform access evidence. Use `limit` and `offset` to page through older session history when continuity requires more than the first page. Use `include_raw=true` only when raw prompt/response dumps are needed; raw fields are bounded by `raw_max_chars`. Admin/service sessions may also receive execution-log prompt/response summaries and bounded raw dumps; user JWT sessions must not receive unscoped execution-log transcripts.
3. Run `GET /activation/platform-access` when the embedded summary is missing or a fresh access/count refresh is needed. Report `access_scope`, all-brand/admin access evidence, brands, plugins, logics, engines, and runtime-callable actions counts.
4. Run the Drive probe through `http_generic_api` with `parent_action_key=google_drive_api` and `endpoint_key=listDriveFiles`.
5. Read `GET /activation/bootstrap-config` through `http_generic_api` for the authoritative DB-native bootstrap config.
6. Resolve the bootstrap row before attempting GitHub validation.
7. Run GitHub validation only with `parent_action_key` and `endpoint_key` resolved from bootstrap or registry authority.
8. Classify readiness from execution evidence, not from narrative or health checks alone.

Health, `/status`, release readiness, tenant listing, brand counts, and action counts are diagnostics only. They prove reachability or registry health, but they do not replace Drive, DB-native bootstrap config, or GitHub validation.

Session Context is an activation context layer, not a replacement provider probe. If it fails because session tables are unavailable, continue with a degraded surface note. If it fails due auth isolation, classify `authorization_gated` and stop secured probes.

`hard_activation_wrapper` and `system_auto_bootstrap` are routing labels, not provider action keys. Do not send them as `parent_action_key`.

Google auth ownership:
- platform-owned registry/bootstrap Drive and Sheets files use managed service account ADC by default
- user-owned Drive/Sheets files or user-connected input sources use refresh-token auth, for example `GOOGLE_AUTH_MODE=refresh_token`

Narrative-only activation is not a valid activation outcome.

### Activation payload patterns

Use these shapes as operational examples. The backend resolves provider domains, auth, schema, and transport policy from registry authority.

Drive activation probe:

```json
{
  "parent_action_key": "google_drive_api",
  "endpoint_key": "listDriveFiles",
  "timeout_seconds": 10,
  "readback": {
    "required": false,
    "mode": "none"
  }
}
```

DB-native bootstrap config read:

```json
{
  "method": "GET",
  "path": "/activation/bootstrap-config"
}
```

Do not pass a Google Sheets spreadsheet ID for activation bootstrap. The authoritative bootstrap row is DB-native and should be read through `/activation/bootstrap-config` or `activation_bootstrap_config_read`.

### Activation classification guide

Use the narrowest honest classification:

| Evidence | Classification |
|---|---|
| No transport attempt was made | retry once in the same cycle, then `degraded (missing_required_activation_transport_attempt)` |
| `/health` passes but Drive or DB bootstrap config was skipped | `degraded (missing_required_provider_bootstrap_attempt)` |
| Drive succeeds but DB bootstrap config fails | `degraded_contract`, `authorization_gated`, or `validation_rate_limited` based on the error |
| DB bootstrap config is unresolved | do not attempt GitHub; report `degraded` with the bootstrap reason |
| Provider probes pass but registry readiness is incomplete | `validating` or `degraded` depending on whether execution can continue safely |
| Drive, DB bootstrap config, GitHub, registry readiness, and required counts pass | `active` |

Report evidence as compact facts: transport status, DB status, Drive result, DB bootstrap config result, GitHub result, registry source, platform access scope, brands/plugins/logics/engines counts, active actions, and any degraded surfaces.

### Activation failure handling

When provider activation fails:
- Prefer the provider error code and status over a generic "connector error" label.
- Distinguish schema/client errors from auth failures and rate limits.
- Retry only when the error is transient, bounded, and same-cycle safe.
- Do not claim a surface is unavailable merely because a diagnostic route failed; test the required provider surface directly when available.
- Do not claim activation is active from `/health`, `/status`, release readiness, tenant listing, or counts alone.

## 5. Registry-centered architecture
The architecture relies on a strictly **MySQL-primary registry**. Google Sheets is limited to async mirror, diagnostics, and recovery roles; DB-native bootstrap and operational registry execution authority are SQL-driven. Important registry families include:
- Registry Surfaces Catalog
- Validation & Repair Registry
- Task Routes
- Workflow Registry
- Actions Registry
- API Actions Endpoint Registry
- Execution Policy Registry
- Execution Log Unified
- JSON Asset Registry

- `output_artifacts` (new)
- `sink_dispatch_log` (new)
- `agent_chain_events` (new)
- `local_connector_user_configs` (new)
When making execution decisions, agents should prefer live registry truth over:
- prior turns
- conversational assumptions
- local summaries
- stale memory

### Registry authority rules

Registry rows are not comments. They are executable authority. When a row defines an action, endpoint, workflow, policy, or logic binding, agents should treat that row as the source of truth for runtime behavior unless a higher-priority canonical explicitly blocks it.

Before executing provider work, resolve:
- action key from `actions`
- endpoint key, method, path, provider domain, and runtime flags from `endpoints`
- execution class and review requirements from `workflows`
- target credential binding from `brands`, `hosting_accounts`, or `connected_systems`
- policy gates from `Execution Policy Registry`

Never invent a provider action key such as `http_get`, `connect`, `google_drive_probe`, or `activation_bootstrap`. If a key is missing, classify the run as degraded or blocked and report the missing authority.

## 6. Logging and evidence
Important sinks:
- `Execution Log Unified`
- `JSON Asset Registry`

- `output_artifacts` (new)
- `sink_dispatch_log` (new)
Execution should preserve:
- execution trace id
- route / workflow context
- status classification
- output summary
- mutation evidence where relevant

`Execution Log Unified` is a special governed sink and may require special duplicate-handling behavior.

### Evidence quality

Good evidence includes:
- exact route or endpoint key attempted
- request class, not secrets or raw credentials
- upstream status and platform status when available
- trace id, run id, job id, or execution id
- readback status for mutations
- concrete degraded surface names

Bad evidence includes:
- "I tried" without a route or endpoint
- health-only activation claims
- screenshots or narrative summaries without transport evidence
- unverified assumptions copied from previous turns
- raw credentials, refresh tokens, API keys, or private document contents

When reporting failures, preserve enough detail for the next agent to continue without repeating blind probes.

## 7. Mutation governance
Agents should assume:
- live header reads are required before writes
- relevant existing row windows may be required
- duplicate/equivalence checks may apply
- mutation evidence may be required
- postwrite validation or readback may be required

Do not assume a write is safe merely because the intended value looks correct.

### Mutation checklist

Before governed writes:
1. Resolve the target table, sheet, document, repo path, or provider endpoint from registry authority.
2. Confirm the actor, tenant, brand, or target context.
3. Read current state when the write could overwrite, duplicate, or conflict.
4. Validate headers/schema or API request contract.
5. Check duplicate/equivalence rules.
6. Execute through the governed transport.
7. Perform readback or postwrite validation when supported.
8. Log the execution and classify the result.

If any required readback or duplicate check is unavailable, prefer `degraded`, `blocked`, or `requires_review` over pretending the mutation is complete.

## 8. Connector model
The repo includes a root runtime and a connector subtree.

### `http-generic-api`
This is the clearest connector-style boundary currently visible.

Key modules and their authority domains:
- `server.js` - orchestration and route handlers only
- `executionRouting.js` - HTTP execution context resolution, guard chain, transport/native routing classification
- `auth.js` - Google OAuth scope resolution, policy enforcement, resilience and retry mutation helpers
- `normalization.js` - canonical normalization layer for execution payloads and routing fields
- `mutationGovernance.js` / `governedChangeControl.js` - mutation classification, duplicate detection, exemption rules
- `jobRunner.js` / `jobUtils.js` - async job dispatch and lifecycle management
- `authInjection.js` / `authCredentialResolution.js` - credential resolution and auth header injection
- `governanceValidationEngine.js` (new) - centralized validation and policy enforcement
- `driveFileLoader.js` - Drive-backed schema and OAuth config loading (`supportsAllDrives: true`)
- `github.js` / `hostinger.js` - provider connector entrypoints
- `wordpress/` - 16 phase modules (A-P) for governed site migration

Use it as a pattern for:
- policy-enforced transport execution
- explicit module boundaries
- provider-specific dispatch
- reduced hidden runtime coupling

### Important connector routes

Common `http-generic-api` surfaces:
- `/health` - transport and dependency health only
- `/status` - public component status and incidents
- `/http-execute` - governed provider execution
- `/jobs`, `/jobs/{jobId}`, `/jobs/{jobId}/result` - async governed execution lifecycle
- `/governance/resolve-context-diagnostic` - non-mutating governed context resolution
- `/ai/implementation-plan`, `/ai/task-manifest`, `/ai/registry-readiness` - AI planning and registry binding checks
- `/governance/validate-execution` - endpoint for explicit validation checks
- `/release/readiness` - platform readiness diagnostics
- `/connector/dispatch` and `/planner/plans/{plan_id}/execute` - governed connector/workflow dispatch

**Dispatch and local connector surfaces (Sprint 35–38):**
- `POST /dispatch` — universal intent dispatcher: resolves `intent_key → task_routes → MODULE_EXECUTORS`; validates `agent_skill_grants`; directly executes or returns `suggested_endpoint`. Required: `intent_key`, `user_id`, `tenant_id`. Optional: `device_id`, `agent_id`, `payload`.
- `GET /dispatch/routes` — list all active `task_routes` with `directly_dispatched` flag.
- `POST /local-connector/install` — auto-provision Cloudflare tunnel + Hostinger DNS CNAME + DB config + shell allowlist for any user/device. Returns `install.bat`. Idempotent.
- `GET /local-connector/install/status` — check provisioning state for a user/device.
- `GET /local-connector/health` — platform-proxied health check to device tunnel.
- `POST /local-connector/shell` — execute governed shell alias on user device via tunnel.
- `POST /local-connector/file/read` — read governed file from user device.
- `POST /local-connector/file/write` — write governed file to user device.

Custom GPT connector contract: admin and tenant GPTs use `auth.mad4b.com` as the governed control-plane HTTP client. Admin imports `openapi.custom-gpt.auth-dispatcher.yaml`; tenant imports `openapi.tenant-gpt.auth.yaml`. Both can discover/call scoped `/system/*` tools backed by connector registry tables and runtime principal validation.

The local connector is a separate Admin-only standalone action/plugin (`connector.mad4b.com`, or `connect.mad4b.com` when configured as the connector host alias). It must route through Cloudflare Tunnel to the active admin Windows `local-connector/server.mjs` service on port 7070 and must not depend on the Hostinger `http-generic-api/server.js` app. Do not configure this standalone connector in Tenant GPTs. Tenant local-device work must route through `auth.mad4b.com` / `local.mad4b.com` governed dispatch. Do not use the connector as the primary shared tool surface.

Treat `/http-execute` as the main provider execution boundary. Use `/dispatch` as the unified runtime router for local connector and workflow module execution. Route-specific shortcuts must not bypass auth, policy, runtime-callable checks, or registry validation.

### Auth and credential boundaries

Agents must not manually inject credentials into request headers unless the backend contract explicitly asks for non-sensitive caller headers. `Authorization` is controlled by the backend and registry auth mode.

Custom GPT Action authentication is configured at the Action connection layer, not inside request payloads. Tenant/customer GPT Actions should use OAuth with authorization URL `https://auth.mad4b.com/auth/oauth/authorize`, token URL `https://auth.mad4b.com/auth/oauth/token`, and scope `tenant`; the imported tenant OpenAPI schema must still keep only one `components.securitySchemes` entry for ChatGPT importer compatibility. The authorize URL may carry safe tenant activation hints (`screen_hint`, `activation_mode`, `device_id`, `workspace_name`, `sign_in_options`) so the popup can show Google, existing-account, and new-workspace options. Never place passwords, API keys, connector secrets, Google ID tokens, or provider tokens in redirect parameters. Admin/service access uses `Authorization: Bearer <BACKEND_API_KEY>` or `x-api-key: <BACKEND_API_KEY>`. User access may use `Authorization: Bearer <USER_JWT>` issued by the OAuth popup bridge, `/auth/login`, or `/auth/google` in a trusted web flow. Treat the GCloud `BACKEND_API_KEY` as an admin/service credential, not a shared per-user credential.

If secured routes return 401 or 403, classify activation as `authorization_gated (backend_action_auth_missing_or_invalid)` and stop the provider bootstrap chain for that cycle. Do not continue with Drive, Sheets, tenants, or release-readiness calls until Action authentication is corrected.

Common auth modes:
- `managed_service_account_adc` for platform-owned Google registry/bootstrap assets
- `google_oauth2` or refresh-token-backed Google auth for user-owned files and input sources
- `bearer_token` or `api_key_header` for registry-authorized provider APIs
- `delegated_per_target` for brand/target-bound credentials

If auth fails:
- `invalid_grant` in a user-owned Drive/Sheets flow means refresh-token repair may be required
- platform bootstrap auth failures point to service account, ADC, sharing, scope, or deployment configuration
- do not switch a platform-owned bootstrap file to user refresh-token auth just to make a probe pass

## 9. Documentation trust model
High trust:
- canonicals
- validated runtime modules
- explicit registry-backed logic

Medium trust:
- connector readmes
- implementation summaries

Low trust until aligned:
- generic public architecture text in `README.md`

### Documentation alignment workflow

When a behavior change touches docs:
1. Update the canonical source file under `canonicals/` first when the behavior belongs in a generated root canonical.
2. Run `node build-canonicals.mjs`.
3. Update root operational docs such as `README.md`, `runtime_boundary_map.md`, `runtime_confirmation_procedure.md`, and this guide when they summarize the same rule.
4. Run `node build-canonicals.mjs --check`.
5. Run `node validate-canonical-sources.mjs`.
6. Run the smallest runtime validation that proves the changed behavior or contract.

Do not leave root docs and canonical source fragments in disagreement. If a file is generated, edit its source instead of the generated output.

## 10. Recommended agent behavior
An AI agent operating in this repository should:
- read canonicals before proposing major runtime changes
- avoid treating README as sole source of truth
- preserve governed terminology
- prefer validation over explanation
- prefer registry truth over memory
- classify uncertainty explicitly
- avoid inventing unsupported policy semantics
- keep module boundaries explicit
- treat logging and writeback as part of execution

### Working style for repo changes

Default to the smallest safe change that preserves behavior and improves alignment. Prefer:
- existing helpers over new abstractions
- explicit validation over implicit assumptions
- narrow patches over broad rewrites
- deleting stale claims over adding competing explanations
- targeted tests or validators over unverified confidence

For code changes, identify the blast radius:
- docs-only: canonical checks and diff hygiene may be enough
- schema or canonical source: run canonical and schema validators
- connector/runtime behavior: run architecture validation and targeted tests
- auth/provider behavior: add or run tests around auth mode, credential resolution, and response shaping
- mutation behavior: include readback or duplicate-prevention coverage when possible

When live provider validation uses secrets, never print the secret. Report only whether the configured credential was present, which route was attempted, and the status/error evidence.

### Common anti-patterns

Avoid:
- declaring activation active from `/health`
- using native Google/GitHub tools for governed provider execution
- putting `target_key` inside `body` when it is a top-level routing field
- sending `hard_activation_wrapper` as `parent_action_key`
- searching Drive for the activation bootstrap ID instead of using the auto-resolving literal placeholder
- treating stale README text as authority over canonicals
- editing generated canonical roots without updating `canonicals/`
- broad refactors while fixing a narrow contract drift
- swallowing provider error details into a generic "client response error"

## 11. Upgrade priorities for agents
Prioritize:
1. canonical/runtime alignment
2. documentation alignment
3. module boundary cleanup
4. policy normalization
5. test coverage
6. monolith decomposition by authority boundary complete (schema layer complete - `memory_schema.json` -> 12 domain sub-schemas in `schemas/`)

## 12. Current documentation status

All previously suggested docs now exist:
- `canonical_validation_checklist.md` complete
- `runtime_boundary_map.md` complete
- `governed_mutation_playbook.md` complete
- `connector_contracts.md` complete
- `deployment_parity_checklist.md` complete
- `runtime_confirmation_procedure.md` complete

Schema layer:
- `memory_schema.json` - root schema (~41 KB, 123 properties, 92 required)
- `schemas/` - 12 domain sub-schemas, including `logic_knowledge.schema.json`
  - `shared`, `business_identity`, `brand`, `execution`, `analytics`, `governance`,
    `logic_knowledge`, `repair_audit`, `routing_transport`, `graph_addition`, `operations`, `wordpress_api`

Current validation expectations:
- canonical source checks via `node build-canonicals.mjs --check`
- canonical source structure checks via `node validate-canonical-sources.mjs`
- memory schema `$ref` checks via `node validate-memory-schema.mjs`
- architecture checks via `npm run validate` from `http-generic-api/`
- targeted tests for changed runtime behavior when code changes touch execution, auth, registry, or provider dispatch
- CI enforces generated-output checks, memory schema reference checks, syntax, tests, drift detection, and export floors on every push

### Suggested validation commands

From repository root:

```powershell
node build-canonicals.mjs --check
node validate-canonical-sources.mjs
node validate-memory-schema.mjs
git diff --check
```

From `http-generic-api/`:

```powershell
npm run validate
npm test
```

Run `npm test` when code behavior changes or when the touched files have test coverage. For docs-only changes, record why runtime tests were not necessary.

## 13. Short operational summary
If you are an AI agent working in this repo:
- the canonicals are the real architecture
- routing, loading, bootstrap, validation, and logging are governed
- registry truth outranks assumptions
- execution without evidence is not enough
- documentation should be aligned with canonicals before large refactors
- platform-owned bootstrap assets use managed service account auth
- user-owned Drive/Sheets input sources use refresh-token auth
- active activation requires Drive, DB-native bootstrap config, GitHub, and registry evidence

---

**Documentation Integrity:** This Knowledge Guide must remain aligned with the [Canonical Sources](canonicals/) and the [Architectural Maps](runtime_boundary_map.md). Any structural changes must be propagated across all three layers as defined in the [README Documentation Architecture](README.md#documentation-integrity-architecture).

### Support Ticket External Delivery completion certification

- Runtime surface: `POST /admin/support/tickets/{ticket_id}/external-delivery/completion-certification`.
- Registry/tool key: `support_ticket_external_delivery_completion_certify`.
- Migration evidence: `906_sprint68_ticket_external_delivery_completion_certification.sql`, ledgered with guarded apply and zero destructive/preflight risk.
- Scope: certifies AM-1 through AM-16 for Support Ticket external delivery without live dispatch.
- Safety contract: no SMTP, no nodemailer, no webhook/fetch/axios network call, no external send, no raw credential values, and no secrets in responses.
- `sandbox` is a no-network/mock-provider-response mode. `live_send` is present only as a gated mode and remains disabled until future tenant enablement, approval hold, credential readiness, idempotency, and release readiness checks pass.
- Required readbacks before claiming completion: OpenAPI route exists, admin tool exists, execution policy is active/blocking, adapter contracts remain `skeleton_dispatch_interface_no_network`, send-mode policies keep `external_send_performed_default = 0`, and CI/release readiness pass.
### Superseded closed-PR branch cleanup

Generic deletion of unmerged branches remains blocked. Admins may use `github_superseded_branch_cleanup` only for a governed work branch whose matching PR is closed and explicitly labeled `superseded`. Begin with `mode=dry_run` and supply full replacement commit SHAs. Every replacement commit must be an ancestor of the current default branch, and the replacement set must cover every non-generated file changed by the branch. Generated documentation may be ignored only through the policy-owned path-prefix allowlist.

Apply requires the same-cycle base SHA, branch SHA, evidence fingerprint, exact typed confirmation, an approved GitHub capability envelope, and a human-readable reason. The tool must reject open PRs, missing labels, incomplete file coverage, stale evidence, protected branches, excessive commit/file scope, and any replacement commit outside the default-branch history. It deletes only the named Git ref, never force-pushes, requires a synchronous no-secret intent audit before deletion, verifies the ref is absent in the same cycle, writes a completion or failure audit, and returns `secrets_included=false`.

### Governed repository lifecycle and dispatch-binding integrity

Repository lifecycle automation uses `githubRepositoryLifecycle.js` as the shared application service for Admin CLI fallback and virtual Admin tools. Use `github_pr_ci_gate` for one bounded merge-readiness decision, `github_pr_finalize` for capability-gated CI/freshness/merge/ancestry/cleanup, `github_branch_delete` for expected-SHA and typed-confirmation cleanup, and `repo_patch_batch_apply` for one atomic multi-file commit pinned to an expected base SHA.

Every active-ready endpoint must resolve through an active export and `platform_tool_dispatch_bindings` row to a callable surface. Mutation bindings require a capability key; all bindings require a readback policy; compound operations require an explicit partial-success policy. Use `platform_tool_binding_integrity_audit` or `v_platform_tool_dispatch_integrity` to detect drift. Endpoint readiness alone is not callable evidence.

Local connector repair uses composite health. A healthy tunnel with a failed Node health probe is `degraded_local_service`; an unhealthy tunnel is `degraded_tunnel`; a reachable `401/403` health surface is `authorization_gated`. Passing or authorization-gated probes must not generate a repair installer.
