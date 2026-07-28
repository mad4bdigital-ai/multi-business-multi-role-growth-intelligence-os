# Repo and SQL Change Documentation Governance

> Change-governance contract for `20260727_remote_runtime_hostinger_production_branch_allowlist.sql`: review must confirm that the change updates existing registry contracts and policies so the Hostinger deploy executor accepts only `main` or `Production`, while retaining exact-SHA, approval, path allowlist, bounded-output, and same-cycle readback requirements. Review must preserve `no_provider_call`, `no_credential_payload_read`, `no_external_send`, `no_external_write`, and `secrets_included_false`, and must reject any claim that merge or documentation applies the migration or authorizes deployment.

> Change-governance contract for `20260715_dynamic_container_canary_promotion_tool.sql`: review must confirm that the change is additive registry/tool/policy governance for a single `read_only_canary`, with ledger run `2b2015d2-73d0-40a2-af33-57678af0389a`, checksum `1c0327e8a8c5533683f92a4906d221af052ba633421464605a68488d3e5b665f`, four statements, and zero-risk preflight. Runtime apply must remain separate from merge and documentation, require a fresh plan-bound Capability Envelope, exact typed confirmation, transactional envelope consumption, and same-cycle readback, while leaving global rollout `shadow` and mutation enforcement disabled. Review must reject any implication of automatic enforcement, reused approval/envelope, second concurrent canary, provider call, credential payload read, raw-secret access, external send/write, or secret inclusion; `secrets_included=false`.

> Change-governance contract for `1031_sprint69_github_actions_diagnostics_endpoints_seed.sql`: review must confirm the migration remains endpoint-registry-only and idempotent, adds explicit safety markers, and documents OpenAPI coverage for the GitHub Actions diagnostics paths. The read-only jobs and pending-deployments endpoints may be used for CI/readback diagnosis; the pending-deployment review endpoint remains separately governed by typed approval and must not be described as automatic deployment approval or CI bypass. No provider call, credential payload read, raw-secret output, external send/write, or deployment is introduced by documentation or registry seeding.

> Change-governance contract for `1031_sprint69_github_actions_diagnostics_endpoints_seed.sql`: review must confirm the migration remains endpoint-registry-only and idempotent, adds explicit safety markers, and documents OpenAPI coverage for the GitHub Actions diagnostics paths. The read-only jobs and pending-deployments endpoints may be used for CI/readback diagnosis; the pending-deployment review endpoint remains separately governed by typed approval and must not be described as automatic deployment approval or CI bypass. No provider call, credential payload read, raw-secret output, external send/write, or deployment is introduced by documentation or registry seeding.

> Change-governance contract for `20260709_resource_api_dynamic_db_surfaces.sql`: review must confirm the migration remains additive/idempotent registry seeding for DB-backed Resource API surfaces, exposes only safe readback/filter keys, and excludes secret, token, password, credential, encrypted, webhook, and provider URL fields. Merge requires OpenAPI parity generation/check coverage, docs parity across the surface-contract targets, and governed migration authorization/dry-run/apply readback. Production apply must use the governed runner only; no provider call, credential payload read, raw-secret output, external send/write, deployment, or destructive SQL is introduced.

> `1041_sprint69_hard_disable_temporary_hostinger_executor_gate.sql` documents the final hard-disable for the temporary Hostinger SSH executor gate after parity verification. It performs no deploy, no provider call, no credential payload read, no raw secret, no external send/write, and only closes the temporary runtime config gate with enum-supported disabled status and false execution flags.

> `1040_sprint69_normalize_temporary_hostinger_gate_statuses.sql` documents final status normalization for temporary Hostinger deployment recovery gates. It performs no deploy, no provider call, no credential payload read, no raw secret, no external send/write, and only normalizes enum-backed audit states to `disabled` and `revoked` after parity cleanup.

> `1039_sprint69_disable_temporary_hostinger_deploy_gates.sql` documents closure of temporary Hostinger deployment recovery gates after production parity readback. It performs no deploy, no provider call, no credential payload read, no raw secret, no external send/write, and exists only to mark temporary executor/resource-authority recovery surfaces inactive.

> `1038_sprint69_hostinger_deploy_resource_authority_binding.sql` documents a temporary Hostinger deploy resource-authority repair. It adds no provider call, no credential payload read, no raw secret, no external send/write, and no deploy execution. It exists only to let governed deploy-envelope preflight prove target-bound `deploy` authority before runtime parity recovery.

> Change-governance contract for `1037_sprint69_dona_brand_core_readiness_data_repair.sql`: review must confirm the migration is data-only, scoped to `brand_key='donatours_wp'`, `brand_name='DONA Tours'`, and IDs 76-86, and only backfills known resource IDs plus `active_status='TRUE'` for rows with existing `google_drive_link` evidence. The migration must remain non-destructive and must not create schema, tools, routes, provider bindings, browser execution, external sends, credential payload reads, raw-secret output, or promotion of Google file-read bindings beyond `shadow`. Merge requires the migration diff, generated docs impact note, this governance entry, deployment parity entry, registry patch index entry, and CI/review evidence; production apply remains a separate checksum-bound governed migration with row-level readback and `growth_audit_evidence_prepare` validation.

> Change-governance contract for the in-app Activation Host Gateway: review must confirm that `activation.mad4b.com` remains a distinct GPT Builder server URL while Cloudflare is used only as DNS/proxy configuration for the Hostinger Cloud app. The route boundary must mount before normal routes, allow `/`, `/health`, Activation schemas, `/activation/*`, `/tenant/activation/*`, and only the Tenant GPT handoffs `GET /auth/oauth/authorize`, `POST /auth/oauth/code`, and `POST /auth/oauth/token`. It must reject wrong methods, wildcard OAuth paths, `/auth/login`, `/auth/register`, `/auth/google`, admin auth, core auth, and every unrelated route with a structured no-secret boundary error. It strips cookies, preserves bearer-token transport, and does not itself mint tokens, resolve credentials, call providers, make business authorization decisions, mutate DNS, deploy a Worker, perform SSH deployment, or write externally. The exact OAuth handoffs enter the shared `authRoutes` logic and are included in the attested gateway policy hash. Merge to `main` is the normal promotion trigger; Hostinger Cloud auto-deploys the app after the branch is merged. Merge requires focused host-boundary tests, Custom GPT schema server-separation tests, safe token-diagnostic tests, docs parity, green CI, and post-deploy smoke against `activation.mad4b.com` after Hostinger auto-deploy.

> Change-governance contract for Tenant tool input-schema strictness: review must cover the complete enabled `tenant_platform_endpoint_tools` registry rather than only current projection candidates. Every enabled row must contain valid JSON with top-level `type='object'` and `additionalProperties=false`; intentionally flexible nested objects remain allowed. The migration must repair every enabled missing or open schema before adding the idempotent `chk_tenant_platform_enabled_input_schema_strict` database invariant. Tenant listing and direct `/gpt/tools/call` dispatch must resolve the same live schema authority independently from manifest state, fail closed before preflight with `403 tenant_tool_input_schema_not_strict`, structured reason details, and `secrets_included=false`, while Admin tools remain unaffected. Visibility-policy changes must advance the Tenant tool-list cache version. Regression coverage must prove missing, invalid, array, non-object, and top-level open schemas are blocked; strict schemas with flexible nested objects remain allowed; listing and dispatch use the same authority; the dispatch guard precedes preflight; the migration preserves existing properties and required fields; the constraint prevents future enabled drift; and all tests are registered in `schemas:guard` and the central test manifest. Merge requires green CI and release readiness. Apply requires checksum and statement-count authorization, governed dry-run and execution, schema/constraint readback, a full enabled-registry SQL assertion of zero missing/non-strict rows, and capability projection readback proving both Tenant schema gap classes are zero. Reopening the top-level schema or bypassing the invariant requires a separate reviewed breaking-contract change.

> Change-governance contract for Tenant blocked capability export cleanup: review must confirm the migration is idempotent, updates only the reviewed `tenant_tool_export.*` rows, joins the current compiled manifest, requires `status='blocked'`, `export_status='active'`, `exposure_scope='tenant'`, `export_surface='tenant_platform_tool'`, and `source_table='tenant_platform_endpoint_tools'`, changes only capability export visibility metadata, and contains no provider call, credential payload access, raw secret access, external send/write, destructive SQL, schema change, or manifest mutation. The migration must be covered by deterministic allowlist tests already registered in `schemas:guard` and the central test manifest, pass CI and release readiness, be authorized through the governed migration bootstrap, execute through the governed migration runner with checksum and statement-count verification, and be followed by SQL and capability projection readback proving the eight exports are disabled and `UNSAFE_ACTIVE_TENANT_EXPORT` is zero. Re-enabling an affected export requires a separate governed change that first advances the corresponding current manifest to an exportable status and restores the Tenant catalog/runtime contract with regression coverage.

> Change-governance contract for Tenant capability export registry cleanup: review must confirm the migration is idempotent, updates only the eight reviewed `tenant_tool_export.*` rows in `platform_plugin_capability_exports`, joins the current compiled manifest, requires `status='blocked'`, `export_status='active'`, `exposure_scope='tenant'`, `export_surface='tenant_platform_tool'`, and `source_table='tenant_platform_endpoint_tools'`, changes only export visibility metadata, and contains no provider call, credential payload access, raw secret access, external send/write, destructive SQL, schema change, or manifest mutation. The migration must be registered in `schemas:guard` and the central test manifest, pass CI and release readiness, be authorized through the governed migration bootstrap, execute through the governed migration runner with checksum and statement-count verification, and be followed by SQL readback plus capability projection readback proving the eight exports are `disabled` and `UNSAFE_ACTIVE_TENANT_EXPORT` is zero. Re-enabling any affected export requires a separate governed change that first advances its current manifest to an exportable status and restores both catalog and export registry authority with regression coverage.

> Change-governance contract for Tenant blocked export registry cleanup: review must confirm the migration is idempotent, updates only the reviewed Tenant tool keys, joins the current compiled manifest, requires `status='blocked'` and `is_enabled=1`, changes only registry visibility metadata, records `manifest_blocked` and `fail_closed` markers, and contains no provider call, credential payload access, raw secret access, external send/write, destructive SQL, schema change, or manifest mutation. The migration must be registered in `schemas:guard` and the central test manifest, pass CI and release readiness, be authorized through the governed migration bootstrap, execute through the governed migration runner with checksum and statement-count verification, and be followed by SQL readback plus capability projection readback proving the targeted rows are disabled and `UNSAFE_ACTIVE_TENANT_EXPORT` is zero. Re-enabling any affected tool requires a separate governed change that first advances its current manifest to an exportable status and adds regression coverage.

> Change-governance contract for Tenant tool manifest authority: review must confirm Tenant tool listing and direct `/gpt/tools/call` dispatch both resolve the current `platform_capability_compiled_manifests` row for `tenant_tool.<tool_key>`; `tenant_platform_endpoint_tools.is_enabled=1` alone is never sufficient exposure authority; current `blocked` and unknown manifest statuses fail closed; current `shadow_ready`, `active`, and `certified` statuses retain their governed rollout behavior; Admin tools remain unaffected; tools without a manifest retain temporary compatibility until an explicit cutover; listing cache versions advance whenever visibility policy changes; dispatch reads current manifest state rather than trusting cached listing; capability-prefix matching is exact and does not use SQL wildcard semantics; rejection returns `403 tenant_tool_capability_blocked`, structured details, and `secrets_included=false`; and tests prove hidden listing, direct-dispatch denial before preflight, Admin non-interference, unmanifested compatibility, exact-prefix matching, and CI registration. Merge requires green CI, release readiness, post-deploy projection readback, and verification that unsafe active Tenant exports no longer remain callable. No provider call, credential payload read, manual row disable, migration, external send/write, or manual deployment is introduced.

> Change-governance contract for Tenant Activation session-context isolation: review must confirm `GET /tenant/activation/session-context` derives Tenant, user, workspace, and brand scope from the signed OAuth JWT and authenticated membership context; rejects cross-user and cross-tenant overrides; rejects `tenant_id`, `user_id`, `workspace_id`, `workspace_key`, `brand_key`, `include_turns`, `context_scope`, raw dumps, and unknown query parameters; preserves `tenant_oauth` for the Tenant route and `admin_service` for the separate Admin route; keeps raw turn previews unavailable by default; returns no-secret responses; and scopes summaries, graph memory, and product guidance to the signed principal. Injectable Tenant route dependencies are test seams only and must retain production defaults, must not become caller-controlled, and must not widen permissions, bypass OAuth, call providers, expose raw turns, or alter production execution. Merge requires focused cross-tenant regression coverage, Tenant/Admin OpenAPI and route-policy parity, green CI, release readiness, and post-deploy parity readback. No migration, provider call, credential payload read, external send/write, or manual deployment is introduced.

> Change-governance contract for `1038_sprint69_github_actions_workflow_control_dispatch.sql`: review must confirm that the migration is registry metadata only, additively registers three GitHub Actions endpoints in SQL authority, extends admin endpoint dispatch exports/bindings, and activates `missing_endpoint_registry_first_policy_v1` so missing provider endpoints are added to the DB registry after deep scan rather than invoked through raw fallback. The change must preserve `fallback_allowed=FALSE`, admin-only scope, schema-bound path/body parameters, no provider call during migration, no credential payload read, no raw secrets, no external send/write, and no workflow rerun/dispatch during apply. Merge requires green CI, docs parity, endpoint/export/binding readback, and release readiness; production apply remains checksum-bound and separately governed.

> Change-governance contract for `1026_sprint69_github_actions_runs_read_dispatch.sql`: review must confirm additive/idempotent registry metadata only, canonical endpoint authority for method/path/provider/auth/schema/transport, read-only exposure of `github_list_workflow_runs_for_repo`, bounded query filters including 40-hex `head_sha`, active endpoint export, active dispatch binding, and focused regression coverage. Merge requires green CI, test-manifest registration, synchronized docs, and review that no raw method, raw URL, provider write, credential payload read, raw secret output, external send/write, deployment, destructive SQL, or runtime fallback broadening is introduced. Production apply remains checksum-bound and separate from PR merge.

> Change-governance contract for `1025_sprint69_github_ref_dispatch_catalog_persistence.sql`: review must confirm additive/idempotent registry metadata only, preservation of endpoint authority for method/path/provider/auth/schema/transport, read-only exposure of `github_get_git_ref_head` and `github_get_reference`, strict `branch`/`ref` path-parameter validation, active endpoint exports, active dispatch bindings, and focused regression coverage. Merge requires green CI, test-manifest registration, synchronized docs, and review that no raw method, raw URL, provider write, credential payload read, raw secret output, external send/write, deployment, destructive SQL, or runtime fallback broadening is introduced. Production apply remains checksum-bound and separate from PR merge.

> Change-governance contract for `1030_sprint69_canonical_capability_domain.sql`: review must confirm additive/idempotent SQL only, canonical capability and alias registry creation, readback through `v_capability_alias_integrity`, Admin/Tenant catalog backfill, and no route/infrastructure dispatch rule leakage. The migration header must retain `no_provider_call`, `no_credential_payload_read`, `no_raw_secrets`, `no_external_send`, `no_external_write`, and `secrets_included=false`. Merge requires green CI and synchronized surface-contract documentation; production SQL apply remains a separate checksum-bound operation with governed bootstrap authorization, zero-risk preflight, migration-ledger evidence, schema/readback verification, and no deployment or provider execution.

> Change-governance contract for `1029_sprint69_minimal_dynamic_brand_resolution.sql` and `1030_sprint69_generic_platform_resource_context.sql`: review must confirm additive/idempotent SQL only, expected descriptor and Tenant/Admin tool registrations, active blocking policy seeds, deterministic backend matching, signed-principal Tenant authority, bounded prompt candidates, backward compatibility, and focused resolver/wiring coverage. Both migration headers must retain `no_provider_call`, `no_credential_payload_read`, `no_raw_secrets`, `no_external_send`, `no_external_write`, and `secrets_included=false`. Merge requires green CI and synchronized documentation; production SQL apply remains a separate checksum-bound operation with zero-risk preflight, migration-ledger evidence, schema/registry readback, and no deployment or provider execution.

> Spec 007 source-link correction contract: `20260702_dynamic_capability_readback_source_link_fix.sql` is an additive idempotent migration that repairs one missing governance source link using canonical capability `platform_capability_governance_compile_persist`. Review must reject any return to zero-row-prone `INSERT ... SELECT` behavior. Merge requires the focused regression test, test-manifest registration, governed-runner allowlist, green CI, and documented ledger/row readback. No provider call, credential payload read, external send/write, runtime cutover, or secret inclusion occurs.

> Spec 007 change-governance contract: `20260630_dynamic_capability_governance_persistence.sql` and `20260701_dynamic_capability_certification_readback.sql` are additive SQL-primary changes. Review must confirm no second capability, adapter, or certification authority is introduced; the new readback registry is versioned and no-secret; generic and specialized certification sources reconcile explicitly; acknowledgement and verification remain separate states; and apply is blocked for missing, stale, revoked, conflicting, or ambiguous assurance. Merge requires focused tests, test-manifest registration, green CI, documentation parity, and no runtime cutover. Production apply remains checksum-bound with schema/readback evidence and performs no provider call, credential payload read, raw-secret output, external send/write, deployment, or automatic callable promotion; `secrets_included=false`.

> Change-governance contract for `1024_sprint69_github_create_reference_201_contract_reconciliation.sql`: review that the diff contains one idempotent `UPDATE endpoints` statement scoped to `ACT-GH-EP-011`, `github_api_mcp`, and `github_create_branch_reference`; preserves all existing response entries; adds only `responses.201`; and contains no tool/export/route/binding registration or provider execution. Merge requires the focused regression test, test-manifest registration, green CI, and documented rollout boundaries. Production apply requires checksum-bound migration authorization, zero-risk preflight, ledger/schema readback, and later create-ref certification before the acknowledged operational alert may be resolved.

## OpenAPI Endpoint Inventory Synchronization

A change affecting `1024_sprint69_openapi_endpoint_inventory_sync.sql`, the inventory sync service, Admin routes, or OpenAPI contracts is incomplete until the runbook, migration index, deployment parity evidence, generated work maps, and surface-contract queue are current. Required safety evidence includes `auto_promote=false`, non-callable inventory rows, typed confirmation and capability-envelope gating for manual apply, transactional/advisory-lock behavior, same-cycle readback, and explicit no-provider/no-credential/no-external-write/no-secret assertions.


> Change-governance contract for `1019_sprint69_github_branch_cleanup_sweep.sql`: review fixed branch-prefix scope, protected/default-branch blocking, open-PR and unique-commit guards, pagination bounds, candidate sorting and deletion caps, fresh base/head SHA checks, fingerprint and typed-confirmation binding, capability-envelope authorization, pre-delete and absence readbacks, stop-on-first-failure behavior, partial-success evidence, and rollback limitations for Git ref deletion. Merge requires green CI and documented dry-run evidence; apply requires a fresh reviewed plan. Force deletion, stale evidence, unknown-outcome retries, credential payload reads, raw-secret output, or `secrets_included=true` are prohibited.

> Change-governance contract for `319_sprint69_dynamic_container_authority_foundation.sql` and `320_sprint69_dynamic_container_authority_runtime_contracts.sql`: review additive schema compatibility, multi-parent cycle and closure limits, classification/role eligibility, deny-first resource authorization, exact delegation evidence, authority-epoch/cache invalidation, immutable resolution and override ledgers, one-time exact-scope consumption, workspace/brand team object-level authorization, last-admin protection, query/index impact, rollback strategy, OpenAPI 3.1 contracts, and focused regression tests. Merge requires green CI and reviewable generated documentation; production apply requires the governed migration runner, typed confirmation, migration-ledger/schema/readback proof, projection dry-run, shadow/performance gates, and a separate explicit enforcement approval. No provider calls, credential payload reads, raw-secret returns, external sends/writes, deployment, or `secrets_included=true` output are permitted.

> Change-governance contract for `1013_sprint69_approval_hold_identity_collation_alignment.sql`: review the exact four altered `varchar(36)` identity columns, `information_schema`-guarded idempotent dynamic SQL, preservation of indexes/defaults/nullability, exclusion of 64/128-character contracts, expired-orphan-only repair, active-orphan fail-closed preflight, rollback SQL, compatibility join, readiness view, blocking policy, focused regression tests, and governed production apply/readback. Merge requires green CI and exact-SHA gating; apply requires the governed migration runner, typed confirmation, same-cycle view readback, and release readiness. No provider calls, credential payload reads, external sends/writes, or secrets are permitted.

> Change-governance contract for `314_sprint69_dynamic_audit_runtime_closure.sql`: review the scheduler lifecycle, MySQL advisory-lock concurrency, additive schema/view changes, idempotent evidence writes, bounded result payloads, checkpoint transaction boundaries, query/index impact, migration rollback approach, test coverage, and production readback. The change must remain no-trigger and no-secret, must not claim out-of-band Drive observation or exhaustive repo coverage, and must not infer deployment parity. Merge requires green CI and documented rollout; apply requires the governed migration runner and typed confirmation.

> Reference contract: changes represented by `1004_sprint68_hostinger_ssh_executor_db_gate.sql`, `1004_sprint69_agent_governance_admin_tools.sql`, and `1005_sprint69_agent_skill_coverage_prompt_enrichment.sql` require explicit safety markers, focused regression tests, registry/tool binding review, canonical deployment-manifest parity, and database/readback evidence. Hostinger execution gates must default disabled and remain target- and expiry-bound; Agent Governance tools remain admin-only; skill coverage remains read-only. No deployment may be declared complete before same-cycle dry-run, approved capability envelope, exact SHA, bounded execution, health/readback, and gate reset or expiry.

<!-- surface-contract-auto-remediation:start -->
## Automated Surface Contract Attestations

> Generated by `surface-contract-auto-remediator.mjs`. Each attestation is bound to the migration SHA-256 and becomes invalid automatically when SQL changes. This block documents static no-provider/no-secret/no-external-side-effect evidence only; it does not authorize execution, provider calls, credential access, database writes, deployment, or external sends.

- `1003_sprint68_supervisor_chain_runtime_guards.sql` — SHA-256 `45a76d8242bcb32cdc278d7f2514cdca8e3970471606c751c6a9f44736dd2b2d`; surfaces: tools=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `1011_sprint69_governed_repository_engine_v6.sql` — SHA-256 `9660199415f17eaddd937c0ae72def3200ab0b3dfe64586afe8dd41e3e905a25`; surfaces: tools=23, policies=2, routes=1; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness, verify_tool_registry_binding.
- `1012_sprint69_sql_only_runtime_auth_schema.sql` — SHA-256 `4b416fd2645cd3ae9afc9a9e49c493f25692a86dbfc6a6a5998ce8827288dc94`; surfaces: tools=1, views=2; static preflight: pass/0; runtime reviews: verify_readback_view, verify_tool_registry_binding.
- `1013_sprint69_approval_hold_identity_collation_alignment.sql` — SHA-256 `2b9fdfcdc14d3f33d3041bb41cf66b407092e4304f09db79e5cbc2f85381ae9a`; surfaces: tools=5, views=1; static preflight: pass/0; runtime reviews: verify_readback_view, verify_tool_registry_binding; evidence: human review by platform_admin:0e76b224-7671-47dd-ad68-014fb042df80.
- `1013_sprint69_operational_alerting_control_plane.sql` — SHA-256 `5bf408260ea63fdd9a1e75b297218d931f3bf07683dc562da790e54930204b68`; surfaces: tools=8, views=4, routes=4; static preflight: pass/0; runtime reviews: verify_readback_view, verify_tool_registry_binding.
- `1014_sprint69_approval_hold_collation_reconciliation_rule.sql` — SHA-256 `83f1d284104650e0cd7609110027b2676d2e7706bb5783dbb8b379b9d7d72153`; surfaces: tools=2; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `1014_sprint69_github_branch_multi_parent_merge_commit_policy.sql` — SHA-256 `84ff6a7a767223389b3202b4bd3388d510c04e3b0e0074ab53cd8bcb3f1cdbe0`; surfaces: tools=6; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `1016_sprint69_tenant_safe_tool_route_rebinding.sql` — SHA-256 `2f300c461d3ec97dbaf5e5bb93b996541c4caf0a08eaae7e0f6a4bfc5ff9280b`; surfaces: tools=3, routes=4; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `1017_sprint69_hybrid_local_managed_agent_runtime.sql` — SHA-256 `1a15b603515d6319142e2a4bf1496fe6e48e6468e296f530fa5851723e6b4618`; surfaces: tools=4, routes=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `1019_sprint69_github_multi_parent_policy_record_only_authorization.sql` — SHA-256 `7231c44fea9a20930c5961932ec04875fff0e7039cb3b09f9bcc23d79daa6316`; surfaces: tools=5; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `1020_sprint69_multi_surface_tenant_agent_runtime.sql` — SHA-256 `aba1c04c229d1acd4d050df5f76654ca364bd4871039d6794f161f06875432ba`; surfaces: tools=5, views=2, routes=5; static preflight: pass/0; runtime reviews: verify_readback_view, verify_tool_registry_binding.
- `1022_sprint69_repository_close_superseded_positive_smoke_policy.sql` — SHA-256 `e4eb42f1e0fdb0e3710dfd166f6707c171461eda82dfa7b59d11dffdb789e6e4`; surfaces: tools=1, policies=1; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness, verify_tool_registry_binding.
- `1023_sprint69_github_rest_endpoint_dispatch_foundation.sql` — SHA-256 `44e13630c7a12aca402cc5649cea84f73d51b7276586a6cdadf4e77179437760`; surfaces: tools=20, routes=3; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `1023_sprint69_resource_api_coverage_gate.sql` — SHA-256 `b21696d3e14b574a62e105d72cf658e1da66a4f8d56dd4e8f855674efad1e9c9`; surfaces: tools=11, views=5, policies=2, routes=26; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness, verify_readback_view, verify_tool_registry_binding.
- `1023_sprint69_sql_cache_runtime_policy.sql` — SHA-256 `7ee1213176aeed389d412448d9bd9f86cabb65953e862266dd3d4cce83307efc`; surfaces: policies=1; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness.
- `1024_sprint69_github_issue_label_response_schema_alignment.sql` — SHA-256 `f621119403524d66e361f400706a913c9d2c7d56355ac7b6b3a65f79ca8910f1`; surfaces: tools=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `1025_sprint69_activation_archive_dynamic_control_authority.sql` — SHA-256 `38d2a37d1ba244231b06758d5988a994417ccb67491419dce5b6fab0bc9e7c63`; surfaces: routes=2; static preflight: pass/0; runtime reviews: none.
- `1025_sprint69_github_ref_dispatch_catalog_persistence.sql` — SHA-256 `cc460618033e19cf54ff7e0141f4e11d2ff375334d800f002d1d51347bfe3369`; surfaces: tools=10; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `1025_sprint69_growth_audit_evidence_admin_tenant_support.sql` — SHA-256 `4699f2b2d5fe510704600d2f5a76f384b3b35e6aefafea9c8ee7b832ff4ac94b`; surfaces: tools=2, policies=1, routes=1; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness, verify_tool_registry_binding; evidence: human review by platform_admin:f242960c-2857-4b4d-a504-ee50f8a278b4.
- `1025_sprint69_platform_degradation_prevention.sql` — SHA-256 `905aea2084a7d93b09184f5106e771ac00a8790b5100ce176400e70fd84df8ca`; surfaces: tools=7; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `1025_sprint69_resource_surface_policy_governance.sql` — SHA-256 `59b615774d0f9ff7ba43d646c8aa3cdcdd2eaa59cd9c5de5253768982b5c5493`; surfaces: tools=2, policies=1; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness, verify_tool_registry_binding.
- `1026_sprint69_github_actions_runs_read_dispatch.sql` — SHA-256 `911073a565b2aadc1c1a78bb9489c290b187a036b128cd1a986a5418577a53d9`; surfaces: tools=12, routes=1; static preflight: pass/0; runtime reviews: review_openapi_contract, verify_tool_registry_binding; evidence: human review by platform_admin:f242960c-2857-4b4d-a504-ee50f8a278b4.
- `1026_sprint69_repository_reconciliation_automation.sql` — SHA-256 `288babca148977b93d172e8a9cfe2681070a506fe3b7cf43b1d48ab498f609f2`; surfaces: tools=5, policies=1; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness, verify_tool_registry_binding; evidence: human review by platform_admin:f242960c-2857-4b4d-a504-ee50f8a278b4.
- `1028_sprint69_gpt_session_archive_actionable_ref_metrics.sql` — SHA-256 `5e133636df15f903cfa945b5e441c4a3547eaf97793f6a7cb8e78b87a5207941`; surfaces: views=3; static preflight: pass/0; runtime reviews: verify_readback_view.
- `1029_sprint69_minimal_dynamic_brand_resolution.sql` — SHA-256 `7c9ba638a41e4be16a78e406f519ff14c1c642e07cc5959c68de49dc9fb5d9cd`; surfaces: tools=3, policies=2, routes=1; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness, verify_tool_registry_binding.
- `1029_sprint69_registry_export_schema_parity_gate.sql` — SHA-256 `3d074b6cbcb9662546b7e48a48bb20afbd7e214050e1821e0a6a10acda414d69`; surfaces: views=1; static preflight: pass/0; runtime reviews: verify_readback_view.
- `1030_sprint69_canonical_capability_domain.sql` — SHA-256 `d26b954de4bb7496cb77888cf445688a29f56059278854cdb97f2dd19dad3819`; surfaces: tools=3, views=1; static preflight: pass/0; runtime reviews: verify_readback_view, verify_tool_registry_binding.
- `1030_sprint69_default_blocker_recovery_governance_seed.sql` — SHA-256 `b24b6ff0110ea41964fd0ed68659ae5b481ae8bd98c3730bac2d06169209edd3`; surfaces: tools=33, policies=1; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness, verify_tool_registry_binding.
- `1030_sprint69_generic_platform_resource_context.sql` — SHA-256 `d3dc914451fa81d96b2d07dd7f44fa41a27d0beb03893ae4aae533a40a258a8a`; surfaces: tools=6, policies=2, routes=1; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness, verify_tool_registry_binding.
- `1031_sprint69_strict_platform_plugin_resolve_contract.sql` — SHA-256 `462a3da9bff92152d4bca2140f4a733ee127408e2b8120296a98d500e779707b`; surfaces: tools=2; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `1032_sprint69_cloudflare_mutation_policy_contract.sql` — SHA-256 `b1c1bae5836c40f489579dd19a3da8084ee9e3cad9535415792fe4a2ede1a6e7`; surfaces: tools=7, views=1, policies=1; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness, verify_readback_view, verify_tool_registry_binding.
- `1033_sprint69_n8n_instance_mode_ownership_policy.sql` — SHA-256 `674ba2df11e5e20091c1a1b5bdd74b2f035fd6a8134c2ded4eb7a8b86c19b5c9`; surfaces: tools=4, views=1, policies=1; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness, verify_readback_view, verify_tool_registry_binding.
- `1034_sprint69_repository_automation_control_plane.sql` — SHA-256 `2802bd37dfb3dafbf66ee35d05d040995ded44a39856e538ef3610901029777f`; surfaces: tools=4, routes=4; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `1035_sprint69_capability_enablement_broker_ledgers.sql` — SHA-256 `0e087111ce1175725f6cde55b653ca76570a4687966936b7fba34315418ec3e3`; surfaces: views=1; static preflight: pass/0; runtime reviews: verify_readback_view.
- `1036_sprint69_capability_enablement_virtual_admin_tool_bridge.sql` — SHA-256 `87cc0d29d74d91a260d89e520a824e879837c159b9794adbd56783936c36f293`; surfaces: tools=5; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `1036_sprint69_governance_debt_cleanup.sql` — SHA-256 `9052c49ccd913f0cb60ba9775c4b35542f05d1ed355f0681a3d3b08c001f6181`; surfaces: tools=1, routes=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `1036_sprint69_remote_runtime_deploy_dispatch_certification_renewal.sql` — SHA-256 `21ebeeb4aa3097b3ddee0c8535024c044abc383b4671209175c37f902475d89b`; surfaces: tools=3; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `1037_sprint69_record_only_authorization_retirement.sql` — SHA-256 `4c980fea8b9f3f73ea7401fbea9cc21bde5be6cec6e85945e700123d273da53c`; surfaces: tools=3; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `1037_sprint69_temporary_hostinger_ssh_executor_gate.sql` — SHA-256 `070833a7c07a2aaea36fc34d98702a5acf74b64fa5b21127a4fa51676d031ed1`; surfaces: tools=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `1038_sprint69_github_actions_workflow_control_dispatch.sql` — SHA-256 `163085b3b9f80b1dc6a3339d8e43dfb5455c34a4cec3a371365a754d45016ef2`; surfaces: tools=17, policies=1, routes=3; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness, verify_tool_registry_binding.
- `1038_sprint69_hostinger_deploy_resource_authority_binding.sql` — SHA-256 `be45dacbadf79dc14e69c2898044df3a959bf96dc5e4badc9a2569debf746849`; surfaces: tools=2; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `1039_sprint69_disable_temporary_hostinger_deploy_gates.sql` — SHA-256 `18248ee2b544457dccde27063a6e8bcc03c78976a7cab48a5417717128b4bdc1`; surfaces: tools=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `1040_sprint69_capability_enablement_operational_dashboard.sql` — SHA-256 `2282274085d80d987d2117f22aa92cdb724209bf6a9c325d1ad16515f8897d77`; surfaces: tools=4, views=2; static preflight: pass/0; runtime reviews: verify_readback_view, verify_tool_registry_binding.
- `1041_sprint69_hard_disable_temporary_hostinger_executor_gate.sql` — SHA-256 `da692b27fd75232c3b344813652dadb10fc25edbe6f08166421d9b3579be9efc`; surfaces: tools=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `1044_sprint69_dynamic_container_projection_apply_governance.sql` — SHA-256 `d1d44b50138a23b4881a9924a2bfca3db2fa19fef4cf30572dc51e41815bd650`; surfaces: tools=4, policies=1; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness, verify_tool_registry_binding.
- `1046_sprint69_dynamic_container_shadow_sampler_tool.sql` — SHA-256 `301c23fac7e5029ade95d17e5ba1c31690e9858133917c665c8730b71e5ed774`; surfaces: tools=3, routes=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260615_tenant_growth_dashboard_product.sql` — SHA-256 `c4a2a2d19c1d0cb1270597df810b03bce6f30e5800df782b627b25b2a5edba59`; surfaces: tools=6, views=3; static preflight: pass/0; runtime reviews: verify_readback_view, verify_tool_registry_binding.
- `20260625_repository_mutation_descriptor_policy_recovery.sql` — SHA-256 `9aa9b798a5f5d5f42f90f0f7f7f9b46a19599c81aaac5333393034667a0fc003`; surfaces: tools=7, views=1; static preflight: pass/0; runtime reviews: verify_readback_view, verify_tool_registry_binding.
- `20260627_activation_gateway_rollout_surface.sql` — SHA-256 `60febc2c4ec53e45a9ccc3bf40c52bd2e013b1b60ec1ce9a80c2ec0a7e500189`; surfaces: tools=15, views=4, policies=1; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness, verify_readback_view, verify_tool_registry_binding.
- `20260629_authority_scope_shadow_readiness.sql` — SHA-256 `4c830fd95c20bdd81a813dab25f8fac980e34f7b72cf58a28e821b59657f4cfa`; surfaces: tools=1, views=3; static preflight: pass/0; runtime reviews: verify_readback_view, verify_tool_registry_binding.
- `20260629_sql_cache_admin_tool_export.sql` — SHA-256 `c503df8476680e4fbb67f4c0aeaa031bf8a94c8fcd2dbdaa2f683b406a8f6798`; surfaces: tools=1, routes=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260701_dynamic_capability_certification_readback.sql` — SHA-256 `420449ed7e2e5e8bc6f757b154be3ef3be2b31d11513174fb0754ea66f11dcce`; surfaces: tools=2, views=1; static preflight: pass/0; runtime reviews: verify_readback_view, verify_tool_registry_binding.
- `20260701_repository_operation_leases.sql` — SHA-256 `2d8380c6f6ac6dd893509329aa78cc32c98725345b2bc9afdfb7424ddf539c16`; surfaces: tools=5; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260702_dynamic_capability_readback_source_link_fix.sql` — SHA-256 `c7a18fa6047b26448ff6e0033e02edd417fcd68b2b17fb469d05080f70f76a6b`; surfaces: tools=2; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260702_session_archive_capability_family_authorization.sql` — SHA-256 `95ca55a48b6fbee795f3c360db48b2e95d94f385e9578387fe3bf4ad6c4140fa`; surfaces: tools=2; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260704_platform_resource_authority_grant_tool.sql` — SHA-256 `80e407bea72401c6e284cd3080fddbee144bd315ecc06694defcd7763a54a410`; surfaces: tools=1, routes=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260704_runtime_dispatch_certification_issuer.sql` — SHA-256 `c03c0c4551e1218699411daa9ac891a07b5f5cebeefd555bb849a2d85f8fdd08`; surfaces: tools=6; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260704_user_dashboard_dynamic_tabs_aliases.sql` — SHA-256 `567a5b10f5cfc00ce8714270a612a86cf8cbd0b72af664dca253cf465bd04cf0`; surfaces: tools=1, routes=7; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260705_governed_migration_ledger_capability_envelope_trace.sql` — SHA-256 `0151b0d4e06d2136daac2395bf3bf53f12f9ebd56543d3db68303005f1094e1c`; surfaces: views=1; static preflight: pass/0; runtime reviews: verify_readback_view.
- `20260705_session_archive_capture_gate_and_smoke_policy.sql` — SHA-256 `486d2d5c42ac0ae5db9da1ccac40d672544abd80fd4ad648b5d72c65ea919796`; surfaces: tools=9, policies=1; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness, verify_tool_registry_binding.
- `20260706_session_archive_stale_closure_autosweep.sql` — SHA-256 `169d2f5ae00ff0890146c1a6e3aabcdecbf1fcf2cee24bb4c3d74d29d7275a32`; surfaces: tools=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260709_tenant_resolution_registry_schema.sql` — SHA-256 `553d90eb41fdde473f73552ef28b6290a62ddd42cef252072a2df93614a236db`; surfaces: tools=18; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260710_repo_conflict_intelligence.sql` — SHA-256 `54f38805f95041d459ef8553dd2ee954973823e8a66a6f7abb5cd851ca5215f2`; surfaces: routes=5; static preflight: pass/0; runtime reviews: none.
- `20260711_repo_conflict_intelligence_phase2.sql` — SHA-256 `809eebbfb345329def2dd03c17c707d56f4c229e3f44060c52a0cd56e5bfb828`; surfaces: routes=4; static preflight: pass/0; runtime reviews: none.
- `20260711_repo_conflict_intelligence_tenant_readiness.sql` — SHA-256 `53e468ed631dfac4eed334966ada38501357f70f7b4d4bd27dd72f2f6e65887e`; surfaces: tools=1, routes=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260711_temporary_hostinger_probe_config_authority.sql` — SHA-256 `0f45a1811bcfd3a98911db41d78077611cec490f451d2742543574c94f17b4c9`; surfaces: tools=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260711_transactional_outbox_shadow_sync_foundation.sql` — SHA-256 `7b721841e6c876ab2f03dedb8affca6ceb37d0c31172cd4706207eb528d1df05`; surfaces: routes=1; static preflight: pass/0; runtime reviews: none.
- `20260712_github_rerun_workflow_response_schema_alignment.sql` — SHA-256 `51b5a8f1276d4afa80348438a176f38a47a9438ecedd3f762050d6b9b3dc0743`; surfaces: tools=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260712_local_manager_repair_connector_action.sql` — SHA-256 `e3e0db9a3114005c3aac7b093180389240c5762a507a35f14b02b11c5b1a8ed8`; surfaces: tools=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260712_release_operation_ledger.sql` — SHA-256 `bdf9afedaa86c8ffe1ef90c3c5d299defe8425fc4c091f18f7bf8a919ec68040`; surfaces: tools=3, routes=6; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260713_dynamic_release_gate_manager.sql` — SHA-256 `d707147297156f84d9e16b08da241ee4c98b5727e90ba13ce4a66a0ed6cd03aa`; surfaces: tools=11, policies=1, routes=7; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness, verify_tool_registry_binding.
- `20260713_local_manager_desktop_command_mutation_policy.sql` — SHA-256 `be6348feef5adfdeada74ca12435f5afea4380455ff3a66fb97d89d104d89c92`; surfaces: tools=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260713_release_operation_ledger_mutation_policy.sql` — SHA-256 `89abe9b2c586d9db2af0b44a42a3d6479630f43a167c913128e2b6933f98798d`; surfaces: tools=4, policies=1; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness, verify_tool_registry_binding.
- `20260714_async_release_deploy_contract.sql` — SHA-256 `5ea43039c7b4a6b47be178db8f5d4a82e1a62e6798a70bd52b07700efa292c2b`; surfaces: tools=4, routes=2; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260714_supervisor_runtime_admin_tool_exports.sql` — SHA-256 `3a62e6de8c90af137e6a0369cbec470ededfaf8028563fbeefc876d7369e464b`; surfaces: tools=1, routes=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260714_tenant_connection_shadow_contract_bootstrap.sql` — SHA-256 `5f3324f7ea7c58f86d9eb997de756f6f7a36e962dd70bc5509f831e9ac0220c3`; surfaces: tools=19, policies=1; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness, verify_tool_registry_binding.
- `20260715_capability_envelope_template_resolver.sql` — SHA-256 `f9a1bf861e412fddd7b03f963d8dcc163e90735f9797665d0efbd0a98894b289`; surfaces: tools=4, policies=1, routes=4; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness, verify_tool_registry_binding.
- `20260715_dynamic_container_canary_probe_sampler_tool.sql` — SHA-256 `fcbd4fcd7e0b3e5aab720cb0ba91473922f5a16c8eff1cd8fe45a6083dfabc2a`; surfaces: tools=4, routes=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260715_dynamic_container_canary_runtime_observability.sql` — SHA-256 `345e670941c8fea4716fb578fc598abe1db6d68e43fffbb3477f82f508bd48a2`; surfaces: tools=10, views=1, policies=1, routes=2; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness, verify_readback_view, verify_tool_registry_binding.
- `20260715_dynamic_container_rollout_readiness_current_evidence.sql` — SHA-256 `c672feca7dd1ceed92147d0910cebe136979bcbc73da17ea259dd52e58ea507a`; surfaces: tools=2, views=5; static preflight: pass/0; runtime reviews: verify_readback_view, verify_tool_registry_binding.
- `20260715_platform_capability_shadow_certification_issue.sql` — SHA-256 `61e643e4396fdd242a0c33788cc538d8d8b234697e90066a617d4c72a663c6e0`; surfaces: tools=25, policies=1; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness, verify_tool_registry_binding.
- `20260715_supervisor_behavioral_certification_capability_policy.sql` — SHA-256 `38f9be1609c90c81cda31528b80af68a44457b4969da9b703f47ed731c3cae97`; surfaces: tools=2; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260716_dynamic_container_preview_canary_probe_sampler_tool.sql` — SHA-256 `739e55d21be3d172836488a2b02b82977132b0ec0f1781bc32bb6f08d6d8f56c`; surfaces: tools=3, routes=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260716_github_list_repository_issues_array_contract.sql` — SHA-256 `d130440a5520900921c9048ce6cfae9c8d999586c63d7de5c720f55626ad130a`; surfaces: tools=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260716_repository_main_moved_trigger_coordinator.sql` — SHA-256 `479504fc1b44d511dfe81d4f281b75a4122b633079084b5b9c742fee89e2d072`; surfaces: tools=2, policies=1, routes=2; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness, verify_tool_registry_binding.
- `20260716_self_healing_release_advisor_mutation_policy.sql` — SHA-256 `04ac4116223ad1254a79bd8882b46e8bb233807398211f07995950ea578dc026`; surfaces: tools=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260716_self_healing_release_advisor.sql` — SHA-256 `d19bec9012817a59a700bb4f3db5bb9656f7119b702c98df739afb399236773f`; surfaces: tools=2, policies=1, routes=2; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness, verify_tool_registry_binding.
- `20260717_runtime_contract_root_cause_reconciliation.sql` — SHA-256 `077fa86a32f2fa53e811e55cab1a643ece711cba2d5bc0e401065707356b108e`; surfaces: tools=1, routes=3; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260717_tenant_task_source_repair_apply_gate.sql` — SHA-256 `73ad3e1c2f7d829330d7147b25b8acc1fc46420f4b18abea38950c3023d18610`; surfaces: tools=13, policies=1, routes=1; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness, verify_tool_registry_binding.
- `20260717_virtual_tool_capability_projection.sql` — SHA-256 `f9fb7f4d515e628502b2aa4df2b5115aa0f5ee63be22c3ec2547bb73014bf4c8`; surfaces: tools=9, views=12; static preflight: pass/0; runtime reviews: verify_readback_view, verify_tool_registry_binding.
- `20260717_virtual_tool_readback_readiness.sql` — SHA-256 `f16ab3288621bfd508417f21377efa6ffb43dc6cef13c9335a4d3304064f63cd`; surfaces: tools=3, views=5; static preflight: pass/0; runtime reviews: verify_readback_view, verify_tool_registry_binding.
- `20260718_expand_resource_authority_shell_alias_contract.sql` — SHA-256 `307a2b2a7c1c192955df6a46a3db410080372448d8f2766487ffe968abbb41ce`; surfaces: tools=1, views=5; static preflight: pass/0; runtime reviews: verify_readback_view, verify_tool_registry_binding.
- `20260718_github_list_issue_comments_endpoint.sql` — SHA-256 `b64bd583f01e849fedb391b689acbc573053fa881fe1ad1f99d3636fd53549ae`; surfaces: tools=9, routes=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260718_growth_intelligence_report_read_tool.sql` — SHA-256 `e3654653085d972eb087dfb6dff2b723f3a50d2cb33377d3b4d5f1cbab0c76dd`; surfaces: routes=1; static preflight: pass/0; runtime reviews: none.
- `20260718_repair_activation_session_context_tool_registration.sql` — SHA-256 `0fa7a8933cff3e2971cddac68898c63897b773e56c21013c9c2b506dd416020c`; surfaces: routes=1; static preflight: pass/0; runtime reviews: none.
- `20260718_repair_resource_authority_grant_tags_csv.sql` — SHA-256 `9ad359c36d35b3e46040a14143b3ebc4428951b0a64cd09e5655398a16e142c7`; surfaces: views=1; static preflight: pass/0; runtime reviews: verify_readback_view.
- `20260718_tenant_connect_bootstrap_tool.sql` — SHA-256 `7deae52537a799d77997d63171d08d1cc7113acd3d27d76a7ba9343f960307f0`; surfaces: tools=1, routes=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260718_virtual_tool_single_file_mutation_classification.sql` — SHA-256 `6ca0f52de53c58fdc1ccba2c6ff135629517582977a35a25afa11d473d5e8ae1`; surfaces: tools=6, views=6; static preflight: pass/0; runtime reviews: verify_readback_view, verify_tool_registry_binding.
- `20260719_expand_resource_authority_tenant_gpt_oauth_smoke.sql` — SHA-256 `2544bdece49e08a18739bd818dc6ca3b1b58c83b662adebdd032ee786708a653`; surfaces: tools=1, views=4; static preflight: pass/0; runtime reviews: verify_readback_view, verify_tool_registry_binding.
- `20260719_fix_growth_intelligence_report_read_tool_path.sql` — SHA-256 `b79194500a97934c42e7338bfe426901e83af810dc5d2982ce50447a767d0310`; surfaces: routes=1; static preflight: pass/0; runtime reviews: none.
- `20260719_tenant_blocked_capability_exports_fail_closed.sql` — SHA-256 `279fa864ec39c35ccc1d0e9e0d8b74c8525098ff9cb0bd41586e186bcb35930c`; surfaces: tools=2; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260719_tenant_blocked_tool_exports_fail_closed.sql` — SHA-256 `48ea345fb10af81fd7bb8724f72024d2a7a5988bdced9df3b824ca626864b2c0`; surfaces: tools=2; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260719_tenant_connection_effective_credential_plan_readback_resolution.sql` — SHA-256 `8a95ed8b1225ecfded27e24a58dba431608ec63cde54671eb7b55ef09dd40054`; surfaces: tools=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260719_virtual_tool_export_shadow_alignment.sql` — SHA-256 `892c2955d925b9e5f87aac28395298ce9f886264fd4ca0133391669e77287c0b`; surfaces: tools=1, views=4; static preflight: pass/0; runtime reviews: verify_readback_view, verify_tool_registry_binding.
- `20260720_cleanup_tenant_gpt_oauth_smoke_authority.sql` — SHA-256 `1d2807db7ca9966dabfb3e3e6421d5cdf93d98f5eebc115cddb2294d688e3c78`; surfaces: tools=1, views=4; static preflight: pass/0; runtime reviews: verify_readback_view, verify_tool_registry_binding.
- `20260720_credential_intake_platform_secret_governance_hardening.sql` — SHA-256 `c19f54c7877a1b8e0077e7ebae57e12beae6071eb83c4bb29bab5f61673b2ccf`; surfaces: views=4; static preflight: pass/0; runtime reviews: verify_readback_view.
- `20260720_dynamic_container_canary_closeout_tool.sql` — SHA-256 `9fd363c33d5cc96dc45cb1094d1999db8e21b7192b73e4d8ae3ecb411e0acbc3`; surfaces: tools=6, policies=1, routes=1; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness, verify_tool_registry_binding.
- `20260720_github_file_patch_shadow_certification_issue.sql` — SHA-256 `722d79bedd460a0a8c9236e1df3abaaac0615642eea15f4c89198e254ad8d5fe`; surfaces: tools=12, policies=1; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness, verify_tool_registry_binding.
- `20260720_tenant_export_manifest_eligibility_hardening.sql` — SHA-256 `4b7540a8fa597d6183054ed7088b27b6771140b4e43282d6b360e311522280ea`; surfaces: tools=6, views=1; static preflight: pass/0; runtime reviews: verify_readback_view, verify_tool_registry_binding.
- `20260721_ci_guard_operational_alert_ingestion_slo.sql` — SHA-256 `2e06ff902f359931f62004d0b1b8c8efe3dbef712950a0b425fe79b1da9aea79`; surfaces: routes=1; static preflight: pass/0; runtime reviews: none.
- `20260721_github_file_patch_runtime_authority_preservation_metadata.sql` — SHA-256 `8f2e81ce248e07c7b75e1312cbf364bf695dabffd1e712fd6399da244e1894be`; surfaces: policies=1; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness.
- `20260721_github_repository_main_moved_webhook_apply_policy.sql` — SHA-256 `0a5b0c9abbece392cc0deabe01753dd26dba45ac24d90f1b468e500769867d7e`; surfaces: tools=4; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260721_repository_authority_capability_bindings_v2.sql` — SHA-256 `55753aa8a28a6a7847608377f942f97a2e7a6a06fd06c5a3badb433c908965ca`; surfaces: tools=6, views=2; static preflight: pass/0; runtime reviews: verify_readback_view, verify_tool_registry_binding.
- `20260722_agent_skill_grant_approval_provenance.sql` — SHA-256 `db8a4583a063187811c7bf1aae7a379742ddf1f862b2ff220f869683d2f5dd2e`; surfaces: tools=4, views=3; static preflight: pass/0; runtime reviews: verify_readback_view, verify_tool_registry_binding.
- `20260722_close_verified_high_operational_attention.sql` — SHA-256 `33c7f974474cb3f5c3825d2ffa3572d15222fb2a65931161b23a475a6d06964e`; surfaces: tools=7, policies=1; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness, verify_tool_registry_binding.
- `20260722_generalized_surface_callability_and_reconciliation_guard.sql` — SHA-256 `ca74e4cea69cbd4942f3cea280ffaff79b67d73e8ff714dd0f5c7080091b4c7a`; surfaces: plugins=1, tools=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260722_resolve_persisted_completed_task_alerts.sql` — SHA-256 `af02185302465cf4b1355f9025ae09b9f009453bc4249f97079e91cd2207ba86`; surfaces: tools=2; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260722_resolve_remaining_critical_operational_attention.sql` — SHA-256 `79fdfa174668ffa01a8b389e308108981c0656baee3afa29310e8b92712ede9f`; surfaces: tools=5, views=1; static preflight: pass/0; runtime reviews: verify_readback_view, verify_tool_registry_binding.
- `20260722_resolve_verified_medium_readiness_and_connector_attention.sql` — SHA-256 `44e9746993bff219a43f7c0e2023ca1c87522ca3c0b1f31adebacebf9fd4483d`; surfaces: tools=8, views=1; static preflight: pass/0; runtime reviews: verify_readback_view, verify_tool_registry_binding.
- `20260723_default_workspace_classification_repair.sql` — SHA-256 `aefb44aadda523d3f9b67aeb1590ddf836985158376eca9ea2a009caf6352091`; surfaces: tools=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260723_refresh_hostinger_ssh_deploy_policy_occurrence_resolution.sql` — SHA-256 `1f78fd0f0687803c2a1ba1d07d11e9443a45790156efb99fc2775b8f0b673477`; surfaces: tools=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260723_resolve_hostinger_ssh_deploy_policy_occurrence.sql` — SHA-256 `5d73ea37732f1da461d9d280e4f1719199e6011a1495c6e1b5af7311fceb888c`; surfaces: tools=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260723_resolve_process_local_feature_flag_scope.sql` — SHA-256 `25a155eaaa30051f171e114938693647f07385d516174beb7272bca3653758c7`; surfaces: tools=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260724_dynamic_container_topology_verification_tool.sql` — SHA-256 `a258f841d2e1b5debcf765f06be279dd241c37ec218507f5040183aec7e1536f`; surfaces: tools=2, routes=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260725_repository_authority_capability_readiness_repair.sql` — SHA-256 `516a2b52e3cd330f480eb10f8f1cb5016c9f995ae08535addeb489195d846ae9`; surfaces: tools=4; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260726_support_ticket_resolution_triage_playbook.sql` — SHA-256 `4a77d846849a0fcc7a7a0d6c667515f6fa22c770833eaf9f2eb784c2b3875a52`; surfaces: tools=2; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `308_sprint69_activation_guidance_intelligence.sql` — SHA-256 `dde33c80a6a38b9968c76f30b12e6091b5ac794c707080c8f57d78c589df5077`; surfaces: routes=2; static preflight: pass/0; runtime reviews: none.
- `308_sprint69_dynamic_governed_migration_reconciliation.sql` — SHA-256 `0635ebaa25216ae9e2da27b4ba08da697f14e36a73e289d3e7985878f8022fb4`; surfaces: tools=5; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `309_sprint69_activation_guidance_invocation_registry.sql` — SHA-256 `1d74f06f2c6003a4a4ca78bbbe1972a2cb47ddcddeace35df847a8c4442ec28a`; surfaces: tools=5; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `310_sprint69_activation_awareness_completeness_control_plane.sql` — SHA-256 `65646875dd99fdbf99643fe84b75a52ca2055673f1f9cd7d0d2cbd0ae4595f33`; surfaces: views=4, routes=5; static preflight: pass/0; runtime reviews: verify_readback_view.
- `311_sprint69_platform_tool_dispatch_binding_integrity.sql` — SHA-256 `cd92ff1bfe26f8c1aa25a00ae022217d8d39f0c2d1be35d37c03e3f8a75c7feb`; surfaces: tools=19, views=1; static preflight: pass/0; runtime reviews: verify_readback_view, verify_tool_registry_binding.
- `311_sprint69_semantic_capability_effective_resolution.sql` — SHA-256 `4d7ac3faeffd686925d2416e7c9eab117446368fb8f29dd9bf0dd927fc86e133`; surfaces: tools=10, views=4; static preflight: pass/0; runtime reviews: verify_readback_view, verify_tool_registry_binding.
- `311_sprint69_superseded_closed_pr_branch_cleanup.sql` — SHA-256 `d0aa47f17b4862018e5cb12e9c03a01566e26c606817a0e1618c324622dcb203`; surfaces: views=1; static preflight: pass/0; runtime reviews: verify_readback_view.
- `314_sprint69_capability_assurance_graph.sql` — SHA-256 `7c9b9e5e64cf30e6196dec0a3d25d54e44c9166a7703f9ea77b6c3f5a0a2ed30`; surfaces: tools=10, views=8, policies=1, routes=1; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness, verify_readback_view, verify_tool_registry_binding.
- `315_sprint69_capability_vault_record_tool_export.sql` — SHA-256 `91d22441a35cab9e753a17a89a02d2dcb6931aff157a424efcbdbbfbbb3ab3b2`; surfaces: tools=11, routes=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `316_sprint69_safe_branch_cleanup_support.sql` — SHA-256 `eafc937a5b0b1c37e84d26416cfb551a8aae3badbd5c08785a5012f4b6bf0cdb`; surfaces: tools=3; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `317_sprint69_superseded_orphan_branch_cleanup.sql` — SHA-256 `9572f0ff01ab6f5a713b3763fa51dbbc6197ea772cd492c63125b973ffc8ee1d`; surfaces: views=1; static preflight: pass/0; runtime reviews: verify_readback_view.
<!-- surface-contract-auto-remediation:end -->

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

`965_sprint68_hostinger_apply_policy_safe_field_names.sql` is the reference pattern for a policy/readback-only credential-governance repair: document the patch index and deployment parity, retain explicit no-provider-call/no-credential-payload-read/no-external-write/no-secret markers, provide a readback view, and add focused regression coverage before merge.

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
| Governed durable response chunk recovery smoke | `docs/durable-governed-response-chunks.md`, `AI_Agent_Knowledge_Guide.md`, `http-generic-api/openapi.yaml`, focused smoke/runtime tests, and test-manifest registration. The tool must remain Admin-only and virtual behind `callAdminTool`, require typed `RUN_RESPONSE_CHUNK_DURABLE_RECOVERY_SMOKE` confirmation, return bounded evidence without the raw payload, evict only its own process-local cache entry, prove first recovery from MySQL, validate SHA-256/UTF-8/Unicode/cursor/no-secret/TTL evidence, perform no provider call or external write, and rely on natural TTL cleanup. |
| Automatic governed migration reconciliation | For `1018_sprint69_governed_response_chunk_schema_reconciliation.sql`, require exact `information_schema`-guarded migration logic, DB authorization row, exact active policy rules, runtime config, bounded scheduler adapter, focused tests, `AI_Agent_Knowledge_Guide.md`, canonical SQL/schema-repair sources, patch index, deployment parity, Hostinger deploy/runtime-sync runbooks, and same-cycle ledger/schema readback. The migration text must include `no_provider_call`, `no_credential_payload_read`, `no_raw_secrets`, `no_external_send`, `no_external_write`, and `secrets_included=false`. The scheduler must delegate to the governed reconciler under an advisory lock, never execute raw SQL, and fail closed on missing policy, authorization, preflight, confirmation, or readback. |
| Local connector recovery / tunnel provisioning behavior | `http-generic-api/openapi.yaml`, `AI_Agent_Knowledge_Guide.md`, `Updating Registry Patch Index.md`, `deployment_parity_checklist.md`, and relevant admin-control tests when HTTP 530/1033/self-repair behavior changes |
| Repository branch reconciliation behavior | `AI_Agent_Knowledge_Guide.md`, `Updating Registry Patch Index.md`, `deployment_parity_checklist.md`, shared reconciliation runbook, and relevant branch/admin tests when branch drift repair or GitHub ref update behavior changes. Exact-branch cleanup limit overrides must remain SHA-bound, expiring, reasoned, bounded by the code hard cap, and must never enable force or generic fallback deletion. |
| Repository Intelligence and governed repository mutation behavior | `AI_Agent_Knowledge_Guide.md`, `docs/governed-repository-engine-v6.md`, `http-generic-api/openapi.yaml`, affected canonical sources, targeted tests, migration/authorization policy, and this governance note. V2/V3/V4 remain read-only; V5 remains comment-only. V6 plans must be provider-authoritative, expiring, hashed, tenant/workspace/user scoped, and non-mutating. V6 apply/readback changes must document action-specific recipe state, authority binding and connected-system installation requirements, capability/approval/typed-confirmation binding, exact target SHA, same-cycle evidence, unique run-ledger replay prevention, `unknown_provider_outcome` recovery, audit evidence, readback, and forbidden force-push/migration-apply behavior. Planned recipes must remain fail-closed until positive smoke certification and release-readiness policy are active. Public descriptors whose names differ from runtime exports must declare explicit `handler_name` mappings. Every descriptor-backed source must declare a safe readiness tool, and `system_layer_descriptor_callability_audit` must block release readiness on missing handlers/smokes, failed callability, unauthorized mutation, or secret-bearing output. |
| Capability Enablement Broker runtime behavior | `AI_Agent_Knowledge_Guide.md`, `docs/capability-enablement-broker-runtime.md`, `docs/spec-kits/capability-enablement-broker-spec-kit.md`, focused broker tests, descriptor callability evidence, migration/readback notes, and `http-generic-api/openapi.yaml` only when the schema exposes descriptor/system-tool enumerations. The broker must remain no-provider and no-external-mutation: no credential payload read, envelope creation/approval, credential promotion, dispatch certification issuance, apply authority grant, external write, provider execution, or secrets. Internal request/step ledger persistence must be explicit, bounded, no-secret, and must not mutate authorization state. Runtime changes must document decision states, reason codes, next-action semantics, proposal semantics, tenant-safe projection, readiness smoke guarantees, system-layer descriptor source key, and release-readiness evidence. Any future executable handoff requires separate tests, policy/approval/readback contracts, typed confirmation, and explicit fail-closed behavior. |
| Growth Intelligence pilot admin entrypoint | `docs/growth-intelligence-operational-runbook.md`, `http-generic-api/openapi.yaml`, targeted pilot/admin-tool tests, and this governance note. The tool must resolve tenant, Brand Core, Business Activity, route/workflow/engine compatibility, and governed dispatch from SQL authority; persist only to internal registries; create approval holds; perform same-cycle readback; and reject provider writes, external sends, live execution, or secrets. All ten pilot stages must have explicit registry or dispatcher evidence before the run is classified complete. |
| Growth Intelligence review decisions and V5 advisory approval | `AI_Agent_Knowledge_Guide.md`, `GPT_Admin_Assistant_Knowledge_Guide.md`, `Top Level Instructions.md`, `docs/growth-intelligence-operational-runbook.md`, `docs/openapi-split-governance.md`, `docs/repo-maintenance-status.md` plus its generator, `http-generic-api/openapi.yaml`, and focused tests. Insight/action decisions are internal-registry-only; action approval must not dispatch execution. Readiness refresh may produce `review_ready` but must remain non-executable. A V5 comment requires a dedicated plan-bound hold, typed confirmation, and same-cycle readback; unrelated action holds must not be reused. Approval authorizes only one comment and does not authorize close, label, merge, patch, force-push, migration apply, secrets, or any provider write before the separate apply call. |
| GitHub fallback / capability repair behavior | `http-generic-api/openapi.yaml`, relevant admin-control tests, and the shared reconciliation runbook when fallback now emits continuation checkpoints or repair-attempt evidence |
| System/admin tool oversized-response recovery | `http-generic-api/routes/gptToolsRoutes.js`, `http-generic-api/routes/systemLayerRoutes.js`, `http-generic-api/test-gpt-tools-response-chunking.mjs`, canonical OpenAPI, agent guide, patch index, and deployment parity. Lists/calls must be bounded or chunked, expose `response_chunk_read` to authorized admin and tenant principals, support bounded dynamic TTL controls, extend expiry on successful reads, block fallback before exhaustion, and never expose secrets. |
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

## Passive authentication lifecycle docs rule

When execution, preview, dry-run, preflight, provider-client construction, token caching, or credential-resolution behavior changes, the same PR must document and test the operation ordering and authority boundaries.

Required evidence:

- preview and preflight build metadata-only auth contracts before secret lookup;
- `dry_run` and `preflight_only`, including accepted string forms, cannot mint tokens or create authenticated provider clients;
- principal, tenant, brand, business type, business activity, applicable profiles, action, endpoint, and SQL scope contract resolve before live credential materialization;
- Google action keys are explicit at every client-acquisition site, with Sheets and Drive capabilities kept separate;
- token and client cache identity includes credential scope and principal/connection dimensions;
- same-context inflight requests deduplicate, while different contexts resolve independently;
- SQL remains the default runtime authority and any Sheets authority mode is explicitly configured;
- missing scope, credential binding, or action context fails closed with a stable structured code;
- tests cover no-secret preview evidence, cache isolation, concurrency, explicit action bindings, and absence of actionless provider clients.

## Credential-bearing artifact delivery docs rule

When a route generates or distributes an artifact containing credentials, tokens, private keys, signed assertions, connection secrets, or executable configuration that embeds them, the same PR must document and test the complete delivery lifecycle.

Required evidence:

- the OpenAPI contract distinguishes metadata-only responses from credential-materializing download responses;
- authentication and admin/tenant authorization requirements are explicit;
- default metadata or preview modes exit before secret lookup or token minting;
- shared/public object storage and public-link permissions are forbidden unless a separately approved encrypted, expiring, principal-bound delivery design exists;
- responses and audit logs omit raw artifact content and secret values;
- tests assert secret-read ordering, public-sharing prohibition, and the exact number of artifact-generation call sites;
- rollout notes describe revocation, replay, expiry, and incident-response implications.

For local connector installers, the approved contract is authenticated direct download only. JSON install-bundle metadata and self-repair responses must not generate installer content. The `format=bat` download remains protected by backend-key authentication and an admin-principal guard.

## Platform Plugin resolve contract documentation rule

Changes to Platform Plugin resolve selectors, decision traces, security metrics, target authority, or approval semantics must update:

- `http-generic-api/openapi.yaml`;
- generated tenant GPT OpenAPI surfaces when tenant resolve output changes;
- `http-generic-api/docs/platform-plugin-resolver-notes.md`;
- `docs/platform-plugin-contract-migration-guide.md`;
- `docs/folder-map.md` when boundaries move or a new capability/security subsystem contract is added.

Required evidence: OpenAPI 3.1 validation, one-selector request tests, stable error codes (`MISSING_CAPABILITY_SELECTOR`, `AMBIGUOUS_CAPABILITY_SELECTOR`, `UNKNOWN_SECURITY_CONTRACT_FIELD`), public/admin trace projection tests, no-secret assertions, and a legacy selector deprecation timeline. Resolve remains preview/readiness only and must not authorize provider calls, credential payload reads, raw secret responses, runtime mutation, external sends/writes, or dispatch by itself.

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

For `surface-contract-discovery-v3`, documentation must also mention the actionable gap queue outputs `docs/surface-contract-gap-queue.md` and `docs/surface-contract-gap-queue.json`. Required evidence includes queue schema `surface-contract-gap-queue-v1`, queue class counts, score, remediation action keys, owner hints, missing docs, missing OpenAPI routes, safety marker gaps, and evidence-only safety boundaries. The queue may guide review and PR generation, but must not authorize provider calls, credential payload reads, runtime mutation, database writes, external sends, deployment, spend changes, or secrets.

For the Surface Governance Loop, documentation must mention `surface-contract-gap-triage-v1`, `surface-contract-gap-baseline-v1`, `surface-contract-new-gap-gate-v1`, `surface-contract-governance-dashboard-v1`, and `surface-contract-gap-trends-v1`. The loop must gate only new high/critical gaps absent from baseline, while keeping legacy backlog visible and non-blocking. For latest remediation targets, migration `954_sprint68_compact_operational_views_and_github_resource_coverage.sql`, migration `955_sprint68_external_delivery_admin_control_surface.sql`, and migration `956_sprint68_external_delivery_allowlist_readiness_view_updated_at.sql` must be documented in patch index, deployment parity, docs-agent governance, auto-docs README, and this governance file with readback/safety evidence and no provider/credential/external-send/deploy/secrets behavior.

Latest surface gap remediation docs must use exact migration filenames, not only migration numbers, because `surface-contract-discovery.mjs` checks exact filename or stem coverage across required documentation targets. Migration 956 is view-only and should be recorded as no-secret/no-data-mutation admin readback support for External Delivery allowlist readiness sorting.

Post-lock future-surface remediation must explicitly name `293_sprint68_system_layer_descriptor_auto_wiring.sql`, `307_sprint69_hostinger_deploy_restart_option_support.sql`, `963_sprint68_hostinger_deploy_restart_tool_exports.sql`, `964_sprint68_hostinger_stored_credential_apply_policy.sql`, `1001_sprint68_repository_advisory_comment_v5_tenant_tool_wiring.sql`, and `1001_sprint68_tenant_ticket_admin_gpt_link_support.sql` when they appear in surface queues. These migrations are registry/config/policy/readback/support metadata only. Descriptor auto-wiring and advisory comment V5 wiring remain descriptor/tenant-tool registration with approval-gated comment paths only; Hostinger deploy/restart support, exports, and stored credential binding references remain approval/envelope/feature-flag/audit/readback gated and still forbid credential payload reads, inline secrets, raw secret responses, and freeform shell; tenant-ticket/Admin GPT link support remains additive and must not replace `/me/support/tickets`. Provider calls, raw secret handling, external sends/writes, registration-time deploy/restart, ungated repository mutation, and secrets remain blocked.

Strict future-only governance lock: after `surface-contract-legacy-backlog-closure-v1`, every unbaselined future queue item blocks promotion regardless of low/medium/high/critical class. The gate mode is `future_only_all_new_gaps`; low-risk documentation, safety-marker, tool-binding, policy-readiness, and OpenAPI items must be remediated rather than allowed to accumulate. Legacy baseline items remain visible but non-blocking.

Future-surface remediation after the legacy closure must document each post-closure migration explicitly. `1000_sprint68_dr_certification_and_tool_bus_gated_read_only.sql` is a current future-surface example for metadata-only DR certification evidence and a gated read-only Tool Bus pilot. Documentation must state that it stores no backup material or recovery-key payload, returns no raw secret values, performs no provider calls, no credential payload reads, no external sends/writes, no repository mutations, no cutover, no deploy, and no secrets.

Future-surface remediation after the legacy closure must document each post-closure migration explicitly. `292_sprint68_platform_health_scorecard_operationalization.sql` and `962_sprint68_smoke_branch_cleanup_gate.sql` are current future-surface examples: 292 is additive/readback-first Platform Health Scorecard operationalization, while 962 is a typed-confirmation-only smoke-branch cleanup policy gate for `gpt/smoke-*`. The remediation does not extend the legacy closure blanket; it proves docs, route classification, readback, and safety markers for the named migrations while future migrations continue to be scored normally.

Legacy surface backlog closure may be used only for explicit historical ranges/prefixes that have already passed release readiness and are no longer blocking current runtime promotion. `surface-contract-legacy-backlog-closure-v1` currently covers migration ranges `001-291`, `305-306`, `900-910`, `950-961`, `997-999`, and `20260611_*`. It marks historical docs/OpenAPI/safety backlog as reviewed while preserving future detection for migrations outside the closure. Closure evidence must remain documentation/classification only and must not authorize provider calls, credential payload reads, runtime mutation, database writes, external sends, deploys, or secrets.

Route classifier remediation must document route class semantics before changing OpenAPI scoring: `http_route` remains OpenAPI-required, while `admin_tool_registry_route`, `tenant_tool_registry_route`, `system_tool_dispatch_route`, and `registry_only_surface` are evidence-only exemptions with reasons. External Delivery admin controls in `955_sprint68_external_delivery_admin_control_surface.sql` use `admin_platform_endpoint_tools` rows and must be classified as registry-governed controls rather than missing standalone OpenAPI paths. Schema completion migrations such as `286_sprint68_platform_schema_contract_completion_registry.sql` may contain route literals inside endpoint `schema_json`; those literals must be classified as `registry_only_surface` when they are endpoint-native synthetic contract evidence rather than Express route declarations.

Session Insight batch remediation must include exact migration filenames across all required docs: `273_sprint68_session_insight_capability_envelope_request_gate.sql`, `275_sprint68_session_insight_capability_envelope_dispatch_dry_run.sql`, `278_sprint68_session_insight_capability_envelope_actual_request_preflight.sql`, `279_sprint68_session_insight_capability_envelope_actual_request_dispatch.sql`, `280_sprint68_session_insight_capability_envelope_approval_gate.sql`, `281_sprint68_session_insight_capability_envelope_dispatch_readback.sql`, `282_sprint68_session_insight_capability_envelope_adapter_execution_gate.sql`, `283_sprint68_session_insight_capability_envelope_remaining_scope_completion.sql`, and `284_sprint68_session_insight_backlog_target_write_executor.sql`. These are governed no-hidden-execution stages: dry-run/review/preflight/request/approval/readback/gate/completion/internal SQL target write with rollback, not provider execution or external send.
## Sprint 69 daily database lifecycle snapshot change governance

Changes to `318_sprint69_database_lifecycle_daily_snapshot_runtime.sql`, `databaseLifecycleDailyRuntime.js`, `databaseTableLifecycle.js`, or the lifecycle scheduler integration require:

- one transaction covering snapshot persistence plus `last_readiness_at` and `last_snapshot_id` update;
- same-cycle schedule readback before commit, with rollback and a stable error code on mismatch;
- deterministic tests for due-window, duplicate suppression, successful commit, update failure, and readback mismatch;
- explicit evidence-only boundaries: no retention action execution, archive, delete, drop, truncate, compaction, provider call, credential read, external write, or secret return;
- daily cron `0 3 * * *` UTC and weekly review-only cron `0 3 * * 1` UTC unless a separately approved governance change updates them;
- governed migration preflight, checksum-matched ledger evidence, approval/readback for schedule and binding, and live post-deploy verification.

## Sprint 69 database lifecycle registry upsert change governance

Changes to `316_sprint69_database_lifecycle_registry_upsert_admin_tool.sql`, `database-table-lifecycle-registry-upsert.mjs`, or the `database_table_lifecycle_registry_upsert` Admin alias require: explicit no-provider/no-credential/no-secret/no-external-write markers; separate confirmation tokens for missing-only apply and existing-row refresh; transaction rollback; same-cycle `remaining_missing_count=0` readback; focused regression coverage; governed migration authorization; and rollout evidence. The surface must remain metadata-only and must not drop, truncate, delete, archive, compact, or mutate business-table contents. It does not add a public API route and `secrets_included=false`.

## Sprint 69 capability evidence surface contracts

- `312_sprint69_platform_tool_dispatch_integrity_scope_fix.sql` narrows `v_platform_tool_dispatch_integrity` to the declared admin/tenant scope without provider calls, credential reads, external sends, or runtime mutation.
- `314_sprint69_capability_authority_evidence_projection.sql` projects evidence only from active `platform_tool_dispatch_bindings` rows with a named readback policy, then rebuilds capability maturity/gap views without granting dispatch or apply authority.
## Sprint 69 supervisor causal provider certification surface

- `1008_sprint69_supervisor_causal_provider_certification_tool.sql` registers the bounded `supervisor_causal_provider_certification` admin tool. Migration execution itself performs no provider call, credential read, external send/write, or secret return. Runtime certification remains confirmation-gated, no-tool, no-repository-mutation, no-local-execution, bounded-cost, and readback/audit governed.
## Sprint 69 explicit manual delegation surfaces

- `1009_sprint69_optional_manual_agent_delegation_tools.sql` registers explicit, admin-governed manual delegation creation/dispatch/contract tools. Migration execution performs no provider call, credential read, external send/write, or secret return; runtime delegation remains opt-in and confirmation/authorization governed.
- `1010_sprint69_disable_legacy_agent_chain_dispatch_tool.sql` disables the ambiguous legacy dispatch surface and directs callers to `agent_chain_event_dispatch_manual`. It is a guarded registry update only and performs no provider call, credential read, external send/write, or secret return.

## Capability Assurance Graph change surface

Changes to 314_sprint69_capability_assurance_graph.sql, capability assurance views, reconciliation tooling, or resource-binding semantics require synchronized updates to canonicals, tests, OpenAPI/tool exports where applicable, and AI_Agent_Knowledge_Guide.md before merge.

Virtual-tool projection changes additionally require deterministic identity and ambiguity tests, Admin/Tenant projection checks, readback-contract and certification separation, persistent debt reconciliation, and explicit evidence that `apply_allowed` remains disabled until shadow/canary closeout.
### Local Connector Transient Retry Policy

`1015_sprint69_local_connector_transient_retry_policy.sql` registers the blocking `Cloudflare 1033 Retry Before Repair` execution policy and updates the governed `local_connector_self_repair` tool description. The route performs three total bounded health attempts, stops on pass or authorization-gated reachability, records no-secret `retry_evidence`, and forbids installer generation when a retry recovers.

Safety contract: `no_provider_call`, `no_credential_payload_read`, `no_raw_secrets`, `no_external_send`, `no_external_write`, and `secrets_included=false`.

## Durable governed response chunk change surface

Changes to `governedToolResponseChunkStore.js`, the `response_chunk_read` contract, or `20260618_governed_tool_response_chunks.sql` require synchronized updates to the main OpenAPI source, focused restart/cache-loss/integrity/expiry/Unicode tests, `AI_Agent_Knowledge_Guide.md`, the registry patch index, deployment parity evidence, and a human-readable ADR/runbook. The public continuation fields must remain backward compatible. Durable writes must complete before `chunk_id` is returned, secret-bearing payloads must be rejected, and production migration apply remains preflighted and typed-confirmation gated.

## Sprint 69 passive capability-resolution dry-run descriptor

- `315_sprint69_capability_envelope_bootstrap_policy_declaration.sql` closes only the remaining passive POST classification gap for `capability_resolution_dry_run`. It adds `preview_only`, `no_mutation`, and `no_execution` registry metadata without changing envelope create/approve or repository mutation authority.
- Migration execution is registry-only and declares `no_provider_call`, `no_credential_payload_read`, `no_raw_secrets`, `no_external_send`, `no_external_write`, and `secrets_included=false`. Production apply remains governed-runner, authorization, preflight, checksum, typed-confirmation, and same-cycle-readback gated.
