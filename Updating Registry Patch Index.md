# Updating Registry Patch Index

> Hostinger Production deploy-branch allowlist closure: `20260727_remote_runtime_hostinger_production_branch_allowlist.sql` updates existing command, Admin tool, execution-policy, and certification registry rows so the governed executor accepts only `main` or `Production` with an exact pinned commit SHA. The migration performs no provider call, credential payload read, external send, or external write, and includes no secrets: `no_provider_call`, `no_credential_payload_read`, `no_external_send`, `no_external_write`, `secrets_included_false`. Merge and documentation do not apply the migration or authorize deployment.

> Dynamic Container read-only canary promotion closure: `20260715_dynamic_container_canary_promotion_tool.sql` registers `dynamic_container_canary_promotion_policy_v1`, the governed `dynamic_container_canary_promotion` Admin tool, and its app integration binding. Production ledger evidence is run `2b2015d2-73d0-40a2-af33-57678af0389a`, checksum `1c0327e8a8c5533683f92a4906d221af052ba633421464605a68488d3e5b665f`, four statements, and zero-risk preflight. Runtime apply remains limited to one active `read_only_canary` from global `shadow`, consumes a fresh plan-bound Capability Envelope transactionally, requires exact typed confirmation and same-cycle readback, and never changes global rollout policy or mutation enforcement. The migration and documentation perform no provider call, credential payload read, raw-secret access, external send/write, or secret inclusion; `secrets_included=false`.

> Spec 007 virtual governed tool capability projection: `20260717_virtual_tool_capability_projection.sql` and `20260717_virtual_tool_readback_readiness.sql` additively project active `platform_tool_dispatch_bindings` into canonical capabilities, bindings, alias exports, provenance, shadow readback contracts, and persistent typed debt. Identity, scope, operation class, readback, and canonical-source conflicts fail closed; virtual Admin surfaces cannot project to Tenant. `platformVirtualToolCapabilityReconciler.js` maintains the projection inside the existing assurance transaction. All projected capabilities remain `apply_allowed=0` until separate certification and shadow/canary evidence pass.

> Spec 007 corrective mutation classification: `20260718_virtual_tool_single_file_mutation_classification.sql` additively normalizes `single_file_mutation`, `atomic_change_set`, `compound_mutation`, and `transactional_guarded` into the `state_changing` operation family, then idempotently reconciles capabilities, bindings, exports, provenance, shadow readback contracts, and typed debt. The correction contains no tool-name special case, destructive SQL, provider call, credential payload read, external runtime write, or secret output; projected apply remains disabled. `registryTagParser.js` separately normalizes registry tags from arrays, JSON-array strings, or legacy CSV before preflight policy evaluation.

> Spec 007 corrective export shadow alignment: `20260719_virtual_tool_export_shadow_alignment.sql` additively recreates `v_platform_virtual_tool_exports_current` with `export_status='shadow'` and reconciles existing virtual-tool capability-export aliases without touching Admin or Tenant tool catalogs, dispatch bindings, certification, or runtime activation. The migration contains no destructive SQL, provider call, credential payload read, external runtime write, or secret output.

> Spec 007 GitHub file-patch shadow certification: `20260720_github_file_patch_shadow_certification_issue.sql` registers the Admin-only `github_file_patch_shadow_certification_issue` tool and its envelope-gated policy. The issuer verifies fixed consumed smoke envelopes and branch-scoped resource-authority bindings, activates only `repository_change_set_apply`, records acknowledgement and same-cycle verification evidence, and certifies the current readback contract. It does not promote target runtime dispatch/apply, active exports, Tenant authority, or protected-branch access and performs no provider call or external write during certification issuance.

> Spec 007 runtime-authority preservation correction: `20260721_github_file_patch_runtime_authority_preservation_metadata.sql` updates only Admin tool, capability, apply-policy, and execution-policy metadata so the shadow-certification plan is explicitly bound to the pre-existing specialized runtime-certification snapshot and same-cycle readback proves that snapshot remains unchanged. It does not update `runtime_dispatch_certification_registry`, target capability exports, dispatch bindings, Tenant authority, or protected-branch authority and performs no provider call or external write.

> Static and migration execution safety: the two migrations perform no provider call, credential payload read, raw-secret access, external send, external write, deployment, or runtime cutover and declare `secrets_included=false`. Repository merge or migration presence is not production apply authority. Completion requires governed migration preflight/apply, exact checksum and statement-count ledger evidence, schema/view readback, governance compiler visibility for `github_file_patch_apply`, Admin-only alias verification for `repo_patch_batch_apply`, absent Tenant projection, shadow readback readiness, and independent certification remaining gated.

> Rollback and compatibility: the change is additive and retains existing compatibility views. Rollback is to stop using the governed combined views and focused reconciler, restore the previous readiness view definition, and mark projection-created rows inactive or resolved through a separately reviewed migration; no destructive table drop or provider rollback is required.


> GitHub Actions diagnostics endpoint registry closure: `1031_sprint69_github_actions_diagnostics_endpoints_seed.sql` seeds read-only diagnostics surfaces for `/repos/{owner}/{repo}/actions/runs/{run_id}/jobs` and `/repos/{owner}/{repo}/actions/runs/{run_id}/pending_deployments`, plus a separately governed pending-deployment review endpoint. It is endpoint-registry-only, idempotent through `ON DUPLICATE KEY UPDATE`, and now includes explicit safety markers: `no_provider_call`, `no_credential_payload_read`, `no_raw_secrets`, `no_external_send`, `no_external_write`, and `secrets_included_false`. OpenAPI path coverage is tracked in `http-generic-api/openapi/github-actions-diagnostics.yaml`; runtime binding readback target is `github_list_jobs_for_workflow_run`.

> DB-backed Resource API surface registry closure: `20260709_resource_api_dynamic_db_surfaces.sql` additively seeds `platform_data_table_registry` with the compact Resource API surface set for endpoint/tool/registry/capability/user-grant readback. It is idempotent through `ON DUPLICATE KEY UPDATE`, performs no provider call, no credential payload read, no raw-secret access, no external send/write, and declares `secrets_included=false`. Production apply was executed through `governed_migration_execute` with checksum `51ae02ddb9d83305432dc3d997426c6bee6ba5048eb8c3bfec3e2cdc6a68b498`, one statement, zero-risk preflight, ledger run `ea0c2abf-b2d1-4660-8929-7229b1fcb851`, and same-cycle readback of ten active resource surfaces.

> Hostinger deploy resource authority binding: `1038_sprint69_hostinger_deploy_resource_authority_binding.sql` additively creates a temporary, target-bound `platform_resource_authority_bindings` row for `resource_type='remote_runtime_target'`, `resource_uri='hostinger://auth.mad4b.com/production'`, and `allowed_modes_json=['deploy']`. It is required because deploy-release envelope preflight now requires dynamic resource authority before actual deploy execution. The binding expires after two hours and performs no provider call, no credential payload read, no raw-secret access, no external send/write, no deploy, and declares `secrets_included=false`. Runtime deploy still requires dry-run `dispatch_ready=true`, a fresh approved deploy envelope, bounded execution, and post-deploy parity/readback.

> DONA Brand Core readiness data repair: `1037_sprint69_dona_brand_core_readiness_data_repair.sql` is a narrowly scoped data-repair migration for `brand_key='donatours_wp'`, `brand_name='DONA Tours'`, and legacy row IDs 76-86. It backfills known Google Docs/Sheets/folder resource IDs from existing `google_drive_link` authority and marks those known rows active so `growth_audit_evidence_prepare` can classify Brand Core as ready. It creates no schema, tools, routes, providers, exports, external sends, browser actions, credential payload reads, raw-secret output, or Google file-read promotion; `files.object.read` remains `shadow`. Completion requires governed migration authorization, checksum-bound dry-run/apply, ledger readback, row-count/resource-ID/active-status readback, `growth_audit_evidence_readiness_smoke`, and a `growth_audit_evidence_prepare` readback for `donatours.com` with no `brand_core_strategy_not_ready` degraded surface.

> GitHub Actions workflow-control dispatch: `1038_sprint69_github_actions_workflow_control_dispatch.sql` additively registers SQL-authoritative endpoints for `github_rerun_workflow_run`, `github_rerun_failed_jobs_for_workflow_run`, and `github_create_workflow_dispatch` under `github_api_mcp`. It also exports them through the governed admin endpoint dispatcher and records `missing_endpoint_registry_first_policy_v1`, which requires a deep scan of endpoint/tool/export/binding registries before runtime use and requires missing provider surfaces to be added to SQL authority instead of using raw URL/method fallback. The migration performs no GitHub call, workflow rerun, workflow dispatch, credential payload read, raw-secret access, external send/write, deployment, or runtime execution; `secrets_included=false`. Runtime use remains admin-only and must use registry-resolved method/path/schema with same-cycle readback.

> GitHub Actions workflow-runs read dispatch: `1026_sprint69_github_actions_runs_read_dispatch.sql` additively registers the read-only SQL authority endpoint `github_list_workflow_runs_for_repo` for `GET /repos/{owner}/{repo}/actions/runs`, exposes it through `github_rest_endpoint_dispatch`, and adds bounded query filters including `head_sha`, `page`, and `per_page`. The scope is registry metadata only and replaces unsupported raw fallback inspection of `/actions/runs`; it performs no provider call during migration, credential payload read, raw-secret access, external send/write, deployment, or raw URL/method dispatch; `secrets_included=false`. Runtime completion requires governed migration authorization, checksum-bound dry-run/apply, endpoint/export/binding readback, binding-integrity audit with zero gaps, and a live read-only workflow-runs lookup for the PR head SHA.

> GitHub direct ref dispatch persistence: `1025_sprint69_github_ref_dispatch_catalog_persistence.sql` additively exposes the already-active SQL authority endpoints `github_get_git_ref_head` and `github_get_reference` through `github_rest_endpoint_dispatch`, adds `branch` and `ref` path-parameter schema entries, and seeds admin-scoped endpoint export plus dispatch-binding metadata. The migration is registry metadata only: no provider call, credential payload read, raw secret access, external send/write, deployment, or fallback raw URL/method behavior is introduced; `secrets_included=false`. Runtime completion requires governed migration authorization, checksum-bound dry-run/apply, catalog readback, `platform_tool_binding_integrity_audit` with zero gaps, and live read-only Git ref readback through `runtime_endpoint_call`.

> Canonical capability domain closure: `1030_sprint69_canonical_capability_domain.sql` additively creates `canonical_capabilities`, `capability_aliases`, and `v_capability_alias_integrity`, then backfills aliases from the existing Admin and Tenant tool catalogs without changing the current dispatch authority. The migration is internal SQL only and declares `no_provider_call`, `no_credential_payload_read`, `no_raw_secrets`, `no_external_send`, `no_external_write`, and `secrets_included=false`. Production apply remains blocked until governed authorization bootstrap, exact checksum/statement-count dry-run, ledger evidence, registry/readback verification, and release-readiness review complete.

> Platform Resource Context surface closure: `1029_sprint69_minimal_dynamic_brand_resolution.sql` additively registers the compatibility Brand/Workspace resolver, bounded Brand-reference interpretation policy, tool descriptor, and blocking execution policy; `1030_sprint69_generic_platform_resource_context.sql` additively registers resource-first Brand, Workspace, Asset, CMS Site, and Connection resolution plus catalog, exact-related-resource, diagnostic-handoff, and readiness helpers. Both migrations remain read-only/diagnose-only registry seeds with deterministic backend authority, signed-principal Tenant scope, no provider call, no credential payload read, no raw secrets, no external send, no external write, and `secrets_included=false`. Repository merge does not authorize SQL application; apply remains checksum-bound with governed preflight, ledger persistence, descriptor/tool/policy readback, and focused CI evidence.

> Spec 007 source-link correction: `20260702_dynamic_capability_readback_source_link_fix.sql` deterministically registers `platform_capability_readback_contracts` under the existing canonical capability `platform_capability_governance_compile_persist`. It replaces the prior zero-row-prone `INSERT ... SELECT` behavior with an idempotent literal `VALUES ... ON DUPLICATE KEY UPDATE` statement. No provider call, credential payload read, external send/write, runtime cutover, or secret inclusion occurs.

> Spec 007 capability-governance contracts: `20260630_dynamic_capability_governance_persistence.sql` additively persists immutable compilation runs, manifests, provenance links, and typed gap snapshots; `20260701_dynamic_capability_certification_readback.sql` additively introduces the versioned `platform_capability_readback_contracts` registry and readiness view while reusing `platform_resource_adapters`, `platform_capability_certifications`, `runtime_dispatch_certification_registry`, `platform_capability_source_links`, and `platform_evidence_events` as existing authorities. Neither migration performs provider calls, credential payload reads, raw-secret returns, external sends/writes, deployment, callable promotion, or runtime-authority cutover; `secrets_included=false`. Apply remains checksum-bound and separately governed.

> GitHub create-reference 201 contract reconciliation: `1024_sprint69_github_create_reference_201_contract_reconciliation.sql` additively updates only `endpoints.schema_json.responses.201` for `ACT-GH-EP-011` / `github_create_branch_reference`. It registers no tools, exports, routes, dispatch bindings, credentials, or provider writes. Authorization and application remain separate governed migration steps; completion requires checksum-bound approval, zero-risk preflight, ledger/schema readback, and a matching create-ref certification. Safety markers prohibit provider calls, credential payload reads, raw secrets, external sends, and external writes; `secrets_included=false`.

## 2026-06-22 OpenAPI Endpoint Inventory Synchronization

`1024_sprint69_openapi_endpoint_inventory_sync.sql` adds an additive run ledger, governed runtime configuration, a non-callable `internal_platform_api` inventory action, and six curated Admin tool bindings for OpenAPI inventory status/sync plus Dynamic Container preview/readiness surfaces. Inventory rows remain `inventory_only` and `pending_governance_review`; `auto_promote=false`; no provider calls, credential payload reads, external sends/writes, deployment, or raw-secret output occur. Manual apply requires typed confirmation, a ready `platform_orchestration` capability envelope, advisory locking, a transaction, and same-cycle count readback. Removed operations are deprecated rather than deleted.


> Governed branch cleanup sweep: `1019_sprint69_github_branch_cleanup_sweep.sql` registers a dry-run-first admin tool and policy for bounded deletion of disposable GitHub branches. Apply requires fresh base and branch SHA evidence, a reviewed candidate fingerprint, typed confirmation, a ready capability envelope, open-PR and unique-commit guards, pre-delete SHA readback, and same-cycle absence readback. It never force-deletes or retries unknown mutation outcomes, performs no credential payload reads or raw-secret returns, and declares `secrets_included=false`.

> Dynamic Container Authority surface contract: `319_sprint69_dynamic_container_authority_foundation.sql` and `320_sprint69_dynamic_container_authority_runtime_contracts.sql` add SQL-primary container types, multi-parent relationships and closure, classifications, composable roles, exact resource bindings, immutable resolution/shadow evidence, explicit override governance, rollout-readiness views, and workspace/brand team-management authority. Both migrations are additive, leave enforcement disabled by default, perform no provider calls, credential payload reads, raw-secret returns, external sends/writes, or deployment, and declare `secrets_included=false`. Promotion requires governed migration preflight, migration-ledger and schema/readback verification, projection dry-run, shadow comparison, performance gates, and explicit enforcement approval.

> 2026-06-17 Approval Hold identity root repair: `1013_sprint69_approval_hold_identity_collation_alignment.sql` aligns the ten `varchar(36)` Approval Hold identity keys to `utf8mb4_unicode_ci`, preserving lengths, nullability, defaults, and indexes while leaving 64/128-character contracts untouched. It repairs only expired pending requests whose temporary smoke/test hold was already cleaned up, records the previous reference in `decision_note`, and fails closed if any active orphan remains. Readback authority is `v_approval_hold_identity_collation_readiness`; blocking policy is `approval_hold_identity_collation_v1`; release readiness requires 10/10 present and ready columns, zero mismatches, zero orphans, and zero provider/credential/external/secret activity. The explicit runtime compatibility join remains until production readback is verified.

> 2026-06-15 Dynamic Audit runtime closure: `314_sprint69_dynamic_audit_runtime_closure.sql` adds the scheduler run ledger, runtime configuration, pipeline count/quality/readiness views, and governed migration authorization. It is additive and idempotent; creates no MySQL triggers; performs no provider calls, credential payload reads, raw-secret returns, external sends, or deployment execution; stores no raw before/after bodies; never infers `deployed_commit_sha`; and declares `secrets_included=false`. Runtime verification requires fresh scheduler success, bounded backlog, repo/Drive/checkpoint evidence, DB semantic quality, duplicate-key checks, and no-secret evidence readback.

> 2026-06-14 governed surface contract: `1004_sprint68_hostinger_ssh_executor_db_gate.sql`, `1004_sprint69_agent_governance_admin_tools.sql`, and `1005_sprint69_agent_skill_coverage_prompt_enrichment.sql` are additive registry/view migrations. The Hostinger executor gate defaults disabled and is target- and expiry-bound; actual SSH execution still requires same-cycle dry-run, approved capability envelope, exact commit SHA, path allowlist, bounded output, and post-deploy readback. The Agent Governance tools remain admin-authenticated and the skill-coverage change is read-only metadata/view enrichment. No migration performs provider calls, credential payload reads, raw-secret returns, external sends, or deployment execution; `secrets_included=false`.

<!-- surface-contract-auto-remediation:start -->
## Automated Surface Contract Attestations

> Generated by `surface-contract-auto-remediator.mjs`. Each attestation is bound to the migration SHA-256 and becomes invalid automatically when SQL changes. This block documents static no-provider/no-secret/no-external-side-effect evidence only; it does not authorize execution, provider calls, credential access, database writes, deployment, or external sends.

- `1003_sprint68_supervisor_chain_runtime_guards.sql` — SHA-256 `45a76d8242bcb32cdc278d7f2514cdca8e3970471606c751c6a9f44736dd2b2d`; surfaces: tools=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `1006_sprint69_agent_capability_evidence_coverage.sql` — SHA-256 `76ca5a7cf4730d905d6114600ecbc76f0ed35e51d8aba4668cdcb9759cb5f942`; surfaces: tools=2, views=2; static preflight: pass/0; runtime reviews: verify_readback_view, verify_tool_registry_binding.
- `1007_sprint69_agent_capability_coverage_admin_tools.sql` — SHA-256 `11b93401bbd0ed64e3e564d183c5a5d9775bcabbe3ccd7002d97e38b0d107a40`; surfaces: tools=1, routes=2; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
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
- `20260723_auth_email_outbox_admin_tools.sql` — SHA-256 `523c654fffb341b622c33b108855f021d9f3d1308d68fbac6b09c95fa9760d4e`; surfaces: tools=1, routes=3; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260723_auth_email_outbox_skip_ineligible_policy_tags.sql` — SHA-256 `902adface82d05157908220e94873f00d3dc0a5be6ab7e35cc03aa5930b0db14`; surfaces: routes=1; static preflight: pass/0; runtime reviews: none.
- `20260723_auth_email_outbox_skip_ineligible_tool.sql` — SHA-256 `f030698268610edebe042890a7fb7144a0c658c490ceb20e28344895ffc8386e`; surfaces: tools=1, routes=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260723_default_workspace_classification_repair.sql` — SHA-256 `aefb44aadda523d3f9b67aeb1590ddf836985158376eca9ea2a009caf6352091`; surfaces: tools=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260723_refresh_hostinger_ssh_deploy_policy_occurrence_resolution.sql` — SHA-256 `1f78fd0f0687803c2a1ba1d07d11e9443a45790156efb99fc2775b8f0b673477`; surfaces: tools=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260723_resolve_hostinger_ssh_deploy_policy_occurrence.sql` — SHA-256 `5d73ea37732f1da461d9d280e4f1719199e6011a1495c6e1b5af7311fceb888c`; surfaces: tools=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260723_resolve_process_local_feature_flag_scope.sql` — SHA-256 `25a155eaaa30051f171e114938693647f07385d516174beb7272bca3653758c7`; surfaces: tools=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260724_auth_email_delivery_attempts.sql` — SHA-256 `8dee614630ee025cb20983da4d35f2df976722115327c153adc03e1a6b05bf5b`; surfaces: tools=1, routes=3; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260724_dynamic_container_topology_verification_tool.sql` — SHA-256 `a258f841d2e1b5debcf765f06be279dd241c37ec218507f5040183aec7e1536f`; surfaces: tools=2, routes=1; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260725_repository_authority_capability_readiness_repair.sql` — SHA-256 `d655e9a45b9fd6b0d7b9c7f3069fbc50d5fd5a76ac0d426629b42a5de971c58b`; surfaces: tools=4; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260726_support_ticket_resolution_triage_playbook.sql` — SHA-256 `4a77d846849a0fcc7a7a0d6c667515f6fa22c770833eaf9f2eb784c2b3875a52`; surfaces: tools=2; static preflight: pass/0; runtime reviews: verify_tool_registry_binding.
- `20260728_brand_scoped_user_skill_activation.sql` — SHA-256 `11ef8f3613b30da9c5a37e0589f678ab427892a8526bab31a0b73fee4591cf5a`; surfaces: views=1; static preflight: pass/0; runtime reviews: verify_readback_view.
- `20260729_auth_mad4b_proxy_rollout_surface.sql` — SHA-256 `31b8b2e2ca0f76774969674562c512fcea7a47d2deb8e6f7265155e40ec4206c`; surfaces: tools=12, views=1, policies=1; static preflight: pass/0; runtime reviews: verify_policy_seed_readiness, verify_readback_view, verify_tool_registry_binding.
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

> 2026-06-14 Hostinger apply-policy safe-field contract: `965_sprint68_hostinger_apply_policy_safe_field_names.sql` preserves deny semantics while replacing sensitive-looking policy keys with safe field names. It performs no provider call, credential payload read, external send/write, deploy, or secret return. Readback authority is `v_hostinger_apply_policy_safe_field_readiness`; regression coverage is `test-hostinger-apply-policy-safe-field-names.mjs`.

> 2026-06-12 System-layer ResponseTooLarge recovery: `/system/tools`, `/admin/system/tools`, `/system/tools/call`, and `/admin/system/tools/call` now return bounded/page-aware or chunked envelopes and expose `response_chunk_read` to tenant and admin principals. Chunk retention is size-aware, optionally controlled by `response_options.chunk_ttl_ms` or `response_options.chunk_ttl_minutes` (5–120 minutes), and refreshed after every successful read. Responses include non-secret cache TTL/expiry/read-count metadata, and fallback remains blocked until continuation is exhausted or unavailable.

> 2026-06-12 Post-lock future surface remediation note: under `future_only_all_new_gaps`, the current future queue is remediated for `293_sprint68_system_layer_descriptor_auto_wiring.sql`, `307_sprint69_hostinger_deploy_restart_option_support.sql`, `963_sprint68_hostinger_deploy_restart_tool_exports.sql`, `964_sprint68_hostinger_stored_credential_apply_policy.sql`, `1001_sprint68_repository_advisory_comment_v5_tenant_tool_wiring.sql`, and `1001_sprint68_tenant_ticket_admin_gpt_link_support.sql`. The scope is registry/config/policy/readback/support metadata only: migration 964 permits stored credential binding references for Hostinger deploy/restart authorization while continuing to forbid credential payload reads, inline secrets, raw secret responses, freeform shell, provider calls, external sends/writes, registration-time deploy/restart, and secrets.

> 2026-06-12 DR/Tool Bus future surface remediation note: `1000_sprint68_dr_certification_and_tool_bus_gated_read_only.sql` records metadata-only isolated restore certification summaries and a Tool Bus gated read-only pilot policy. It stores no backup material, no recovery-key payload, and no raw secret values; it allows no provider calls, credential payload reads, raw secrets, external sends, external writes, repository mutations, cutover, deploys, or secrets. The migration surfaces are runtime config metadata and blocking execution policies only.

> 2026-06-12 Future surface remediation note: `292_sprint68_platform_health_scorecard_operationalization.sql` and `962_sprint68_smoke_branch_cleanup_gate.sql` were reviewed as post-closure future-surface items. Migration 292 operationalizes the Platform Health Scorecard with additive registry/readback tables, remediation metadata, snapshot history, tenant rollout readback, ledger hygiene, and admin tool registry rows. Migration 962 adds a governed smoke-branch cleanup gate for `gpt/smoke-*` branches only with exact typed confirmation; protected branches, direct-main writes, generic unmerged deletion, merge, provider calls, credential payload reads, raw secrets, external sends, external writes, deploys, and secrets remain blocked.

> 2026-06-12 Legacy surface backlog full-closure note: `surface-contract-discovery.mjs` now applies `surface-contract-legacy-backlog-closure-v1` to the historical SQL-backed surface backlog. Closed ranges are `001-291`, `305-306`, `900-910`, `950-961`, `997-999`, plus `20260611_*` migration files. Closed migrations are treated as documented, their legacy route-like literals are classified as `legacy_closure_route_reviewed`, and historical missing safety markers are treated as reviewed closure evidence. Future migrations outside these explicit ranges/prefixes remain normally scored and can still open docs, OpenAPI, or safety gaps. Safety: no provider calls, no credential payload reads, no runtime mutation, no database writes, no external sends, no deploys, and no secrets.

> 2026-06-12 Schema contract completion blocker remediation note: `286_sprint68_platform_schema_contract_completion_registry.sql` is now documented and classified as registry-only for route scoring. Its `/contacts` and `/platform/wordpress/blog-publish-recovery` literals live inside endpoint `schema_json` synthetic endpoint-native contracts, not newly declared Express routes. The classifier marks them `registry_only_surface`, so they remain visible as schema contract evidence without creating OpenAPI false positives. Safety: update-only registry completion, no provider calls, no credential payload reads, no external sends, no deploys, and no secrets.

> 2026-06-12 Route classifier and Session Insight batch remediation note: `surface-contract-discovery.mjs` now classifies SQL route-like literals as `http_route`, `admin_tool_registry_route`, `tenant_tool_registry_route`, `system_tool_dispatch_route`, `registry_only_surface`, or `false_positive_route_like_string` before OpenAPI scoring. `955_sprint68_external_delivery_admin_control_surface.sql` admin control paths are `admin_tool_registry_route` and no longer count as OpenAPI gaps. Session Insight batch documentation covers exact migrations `273_sprint68_session_insight_capability_envelope_request_gate.sql`, `275_sprint68_session_insight_capability_envelope_dispatch_dry_run.sql`, `278_sprint68_session_insight_capability_envelope_actual_request_preflight.sql`, `279_sprint68_session_insight_capability_envelope_actual_request_dispatch.sql`, `280_sprint68_session_insight_capability_envelope_approval_gate.sql`, `281_sprint68_session_insight_capability_envelope_dispatch_readback.sql`, `282_sprint68_session_insight_capability_envelope_adapter_execution_gate.sql`, `283_sprint68_session_insight_capability_envelope_remaining_scope_completion.sql`, and `284_sprint68_session_insight_backlog_target_write_executor.sql`. Scope remains evidence-only: no provider calls, no credential payload reads, no runtime mutation outside governed migrations, no unreviewed DB writes, no external sends, no deploys, and no secrets.

> 2026-06-12 Latest Surface Gap Remediation note: documents exact migration coverage for `954_sprint68_compact_operational_views_and_github_resource_coverage.sql`, `955_sprint68_external_delivery_admin_control_surface.sql`, and `956_sprint68_external_delivery_allowlist_readiness_view_updated_at.sql`. Migration 954 adds compact operational/resource readiness views and GitHub inspect resource coverage using existing governed inspection surfaces. Migration 955 adds External Delivery admin readback/control views, admin tool registry rows, and a blocking governance policy for no-secret/no-send controls. Migration 956 refreshes `v_external_delivery_recipient_allowlist_readiness` with `created_at`/`updated_at` for admin sorting, view-only/no secrets/no data mutation. Documentation remediation is evidence-only and does not authorize provider calls, credential payload reads, runtime mutation, database writes, external sends, deploys, or secrets.

> 2026-06-12 Surface Governance Loop note: adds `surface-contract-gap-triage.mjs`, generated triage/baseline/dashboard/trend outputs, and a new-gaps-only gate. The loop consumes `surface-contract-gap-queue.json`, classifies immediate-review vs legacy backlog, baselines current known gaps, and fails only future high/critical gaps absent from the baseline. It also documents latest remediation targets `954_sprint68_compact_operational_views_and_github_resource_coverage.sql` and `955_sprint68_external_delivery_admin_control_surface.sql`: migration 954 adds compact operational readiness/resource views plus GitHub inspect resource coverage without new provider behavior; migration 955 adds External Delivery admin overview/recent-send/Gmail-connection readback views plus governed control tools and policy. Evidence-only automation remains no provider calls, no credential payload reads, no runtime mutation outside governed migrations, no unreviewed database writes, no external sends, no deploys, and no secrets.

> 2026-06-12 Actionable surface contract gap queue note: upgrades `surface-contract-discovery.mjs` to `surface-contract-discovery-v3` and adds generated remediation outputs `docs/surface-contract-gap-queue.md` and `docs/surface-contract-gap-queue.json`. The queue ranks migration surface gaps by documentation coverage, OpenAPI route gaps, surface type, missing safety markers, and recency, then emits owner hints and remediation actions such as `document_surface_contract`, `review_openapi_contract`, `verify_tool_registry_binding`, `verify_policy_seed_readiness`, `verify_readback_view`, and `add_explicit_safety_markers`. Evidence-only automation remains no provider calls, no credential payload reads, no runtime mutation, no database writes, no external sends, no deploys, and no secrets.

> 2026-06-11 Deep surface contract coverage note: upgrades `surface-contract-discovery.mjs` to `surface-contract-discovery-v2`, adds all-migration coverage metrics, machine-readable `docs/surface-contract-discovery-status.json`, high/medium/low documentation gap classification, SQL route/OpenAPI coverage scoring, per-doc-target gap counts, safety marker coverage counts, and tests against migrations 287, 910, and 954. Evidence-only automation remains no provider calls, no credential payload reads, no runtime mutation, no database writes, no external sends, no deploys, and no secrets.

> 2026-06-11 Automatic surface contract discovery note: adds `http-generic-api/scripts/surface-contract-discovery.mjs`, generated report `docs/surface-contract-discovery-status.md`, workflow coverage for `http-generic-api/migrations/**`, and tests in `test-surface-contract-discovery.mjs`. `repo-maintenance-sync.mjs --write` now runs OpenAPI route autofill, repository maintenance docs, and SQL-backed surface discovery. The discovery layer scans migrations for routes, tools, views, policies, plugins, and safety markers, then opens reviewable auto-sync PRs through `.github/workflows/openapi-auto-sync.yml`. It is documentation evidence only: no provider calls, credential payload reads, raw secrets, runtime mutation, database writes, external sends, spend changes, deployment, or secrets.

> 2026-06-11 External Delivery no-send orchestration graph note: PR #1363 adds migration `287_sprint68_external_delivery_orchestration_graph_plugin.sql` and test `test-external-delivery-orchestration-graph.mjs`. The migration registers `support_ticket_external_delivery_orchestrator` as a read-only/no-send orchestration graph plugin with seven stages and six edges over external delivery readiness, approval policy, credential candidate metadata, credential binding state, provider gate, execution plan record, and completion certification. It extends `v_platform_orchestration_graph_readiness`, adds `v_platform_orchestration_external_delivery_readiness`, and seeds blocking policy `support_ticket_external_delivery_orchestration_readback_policy_v1`. Apply evidence: governed ledger run `2e1a62ca-894d-4f22-92ca-7a3db2209812`, statement_count=6, preflight_status=pass, risk_count=0, secrets_included=0; readback status `ready_no_send_external_delivery_graph` with 7/7 stages and 6/6 edges. No provider calls, credential payload reads, raw secrets, external sends, external writes, spend changes, or secrets are enabled.

> 2026-06-11 Session Insight capability binding hardening note: PR #1358 adds migration `910_sprint68_session_insight_capability_binding_hardening.sql`, removes `--explain` from Session Insight actual capability envelope creation, and adds regression coverage to prevent redacted policy explain fields from blocking approval gates. The migration persists app/action/tool graph rows for `session_insight`, including `session_insight_development_backlog_apply`, `session_insight_integration_backlog_apply`, and `session_insight_runtime_repair_backlog_apply`, all with `credential_source='none'` and `primary_executor='session_insight_backlog_target_write_execute'`. Tool bindings cover execute/list/rollback for the internal SQL backlog target write surface. Apply evidence: dry-run passed with 5 idempotent insert statements, destructive=0, risk_count=0; apply ledger `6e6745a1-94ce-4b5d-a43d-d030d0307508`; release readiness run `f5c1cba0-dd95-42d2-8fef-3ac6e512392e` passed 67/67. No provider credentials, credential payload reads, external writes, raw transcripts, or secrets are enabled.

> 2026-06-11 Session Insight backlog target write executor note: migration `284_sprint68_session_insight_backlog_target_write_executor.sql` adds internal SQL target-write tables `session_insight_backlog_target_items` and `session_insight_backlog_target_writes`, readback/issue views, policy `session_insight_backlog_target_write_executor_policy_v1`, and tools `session_insight_backlog_target_write_execute`, `session_insight_backlog_target_write_list`, and `session_insight_backlog_target_write_rollback`. Execute requires typed confirm `EXECUTE_SESSION_INSIGHT_BACKLOG_TARGET_WRITE`; rollback requires `ROLLBACK_SESSION_INSIGHT_BACKLOG_TARGET_WRITE`. Scope is internal SQL backlog writes only after the capability-envelope chain completes. No provider calls, credential payload reads, external writes, raw transcripts, or secrets are enabled.

> 2026-06-11 Session Insight capability-envelope release-readiness note: migrations `277` through `283` close the Session Insight capability-envelope roadmap as gated no-execution layers. The chain adds dispatch dry-run review, actual request preflight, actual envelope request ledger, approval gate, dispatch readback, adapter execution gate, and remaining scope completion. Admin tools registered include the `session_insight_capability_envelope_*` review/preflight/request/approval/readback/adapter gate surfaces plus `session_insight_remaining_scope_completion_*`. Typed confirmations are `REQUEST_ACTUAL_CAPABILITY_ENVELOPE_NO_EXECUTION`, `APPROVE_ACTUAL_CAPABILITY_ENVELOPE_NO_EXECUTION`, `OPEN_ADAPTER_EXECUTION_GATE_NO_APPLY`, and `COMPLETE_REMAINING_SCOPE_AS_GATED_NO_EXECUTION`. Release-readiness details live in `docs/session-insight-capability-envelope-release-readiness.md`. No adapter apply, runtime execution, `promotion_allowed`, `execution_allowed`, `target_write_allowed`, target write, raw transcript, credential payload read, or secrets are enabled by this chain.

> 2026-06-09 ads provider governance snapshot record gate note: PR adds migration `264_sprint68_ads_governance_snapshot_record_gate.sql`, route `/platform/orchestration/ads-provider/snapshot-record`, admin tool `ads_provider_governance_snapshot_record`, OpenAPI operation `adsProviderGovernanceSnapshotRecord`, and test `test-ads-governance-snapshot-record-gate.mjs`. The route recomputes the proposal, verifies `candidate_sha256`, requires `idempotency_key`, `capability_envelope_id`, and `apply=true`, then records snapshot/recommendation rows idempotently. Default mode is dry-run. No provider calls, credential payload reads, spend changes, external writes, deploys, publishing, or secret return. Repo mutation used capability envelope `3cc59f04-bbff-453e-9e19-b58dce9f4a20`.

> 2026-06-09 ads provider governance snapshot proposal note: PR adds migration `263_sprint68_ads_governance_snapshot_proposal.sql`, route `/platform/orchestration/ads-provider/snapshot-propose`, admin tool `ads_provider_governance_snapshot_propose`, OpenAPI operation `adsProviderGovernanceSnapshotPropose`, and test `test-ads-governance-snapshot-proposal.mjs`. The route produces `snapshot_candidate` and `recommendation_candidate` from governance metadata only and does not write `platform_orchestration_state_snapshots` or `platform_orchestration_recommendations`. No provider calls, credential payload reads, spend changes, external writes, deploys, publishing, or secret return. Repo mutation used capability envelope `51e534b6-109b-46c7-9514-99e71bab8c0b`.

> 2026-06-09 orchestration readback surface note: PR adds migration `262_sprint68_orchestration_readback_surface.sql`, views `v_platform_orchestration_graph_readiness` and `v_platform_orchestration_ads_governance_readiness`, route `/platform/orchestration/readback`, admin tool `platform_orchestration_readback`, OpenAPI operation `platformOrchestrationReadback`, and test `test-orchestration-readback-surface.mjs`. This surface reads graph/stage/edge readiness plus latest snapshots/recommendations only. It performs no provider calls, credential payload reads, spend changes, external writes, deploys, publishing, or secret return. Repo mutation used capability envelope `082a8246-d1b3-4c44-a6ee-1c526327cd8a`.

> 2026-06-09 orchestration intelligence foundation note: PR adds migration `261_sprint68_orchestration_intelligence_foundation.sql`, creating `platform_orchestration_plugins`, `platform_orchestration_stages`, `platform_orchestration_edges`, `platform_orchestration_state_snapshots`, and `platform_orchestration_recommendations`. It registers `orchestration_intelligence_engine`, `orchestration_intelligence_policy_v1`, six active policy rules, and seeds `ads_provider_governance_orchestrator` with seven stages and six edges. This is read-only/diagnose-only foundation: no provider call, no credential payload read, no spend change, no external write, no deploy, and `secrets_included=false`. Repo mutation used capability envelope `b4df7d64-946b-4c19-9369-50928fb8947c`.

> 2026-06-09 platform development constitution enforcement note: PR #1107 adds migration `260_sprint68_platform_development_constitution_policies.sql`, seeds 20 blocking policies into `execution_policies` as the current runtime enforcement source, and extends `releaseReadiness.js` so those policies become required runtime policy seeds. The safety class is idempotent policy seed only: no destructive SQL, no provider calls, no credential reads, no deploy, and `secrets_included=false`. Repo mutation used capability envelope `5ffc2021-1c0d-4f8c-ae42-e1da5e71e12a`; branch drift was checked and classified `diverged_no_overlap` before continuing bounded docs/test-manifest changes.

> 2026-06-09 ads provider preflight surface blueprint note: PR adds `ads_provider_preflight_surface_blueprint_policy_v1`, table `ads_provider_preflight_surface_blueprint_registry`, tool `ads_provider_preflight_surface_blueprint`, and migration `254_sprint67_ads_provider_preflight_surface_blueprint.sql`. The blueprint is design-only: it proposes names for future provider-specific preflight/readiness/execution surfaces after contract validation, but does not create tools, tables, credentials, adapters, provider calls, or spend surfaces.

> 2026-06-09 ads provider preflight contract note: PR adds `ads_provider_preflight_contract_policy_v1`, table `ads_provider_preflight_contract_registry`, validator `ads_provider_preflight_contract_validate`, and migration `253_sprint67_ads_provider_preflight_contract.sql`. The validator checks provider profile metadata/governance before provider-specific preflight surfaces are designed. It does not create tools, credentials, adapters, provider calls, or spend surfaces. `execution_enabled_default=false` is required.

> 2026-06-09 ads provider profile onboarding flow note: PR adds `ads_provider_profile_onboarding_flow_policy_v1`, table `ads_provider_profile_onboarding_requests`, tools `ads_provider_profile_request`, `ads_provider_profile_approve`, `ads_provider_profile_disable`, and migration `252_sprint67_ads_provider_profile_onboarding_flow.sql`. Approved providers start as `draft` profiles with `execution_enabled_default=false`; onboarding does not create provider-specific tools, credentials, adapters, or spend surfaces. No provider call, no spend change, no secrets.

> 2026-06-09 ads provider capability profile registry note: PR adds `ads_provider_capability_profile_registry_policy_v1`, table `ads_provider_capability_profile_registry`, lookup tool `ads_provider_profile_lookup`, and migration `251_sprint67_ads_provider_capability_profile_registry.sql`. `google_ads` is seeded as the first active profile. Future ads providers must be onboarded as profiles with `execution_enabled_default=false`; profiles describe capability keys, meters, preflight/readiness ledgers, validators, execution adapter, and enablement family. No provider call, no spend change, no secrets.

> 2026-06-09 Google Ads credential readiness ledger note: PR adds `google_ads_credential_readiness_ledger_policy_v1`, table `google_ads_credential_readiness_ledger`, and migration `250_sprint67_google_ads_credential_readiness_ledger.sql`. `google_ads_credential_readiness_gate` now records every result with `credential_readiness_id` and `readiness_sha256`. Future execution must require a ready ledger row before provider execution. No credential payload read, no provider call, no spend change, `secrets_included=false`.

> 2026-06-09 execution enablement approval flow note: PR adds `execution_enablement_approval_flow_policy_v1`, table `execution_enablement_requests`, tools `execution_enablement_request`, `execution_enablement_approve`, `execution_enablement_revoke`, and migration `249_sprint67_execution_enablement_approval_flow.sql`. Enablement rows now have a governed lifecycle: request -> approval hold -> scoped expiring enablement row -> revoke. No provider call, no credential read, no spend change.

> 2026-06-09 execution enablement registry note: PR adds `execution_enablement_registry_policy_v1`, table `execution_enablement_registry`, tool `execution_enablement_gate`, and migration `248_sprint67_execution_enablement_registry.sql`. Provider execution remains blocked unless an explicit active enablement row exists. Google Ads skeleton now calls the gate and blocks with `blocked_execution_enablement_missing_or_disabled` when no row exists. No provider call, no spend change, `secrets_included=false`.

> 2026-06-08 Google Ads credential readiness note: PR adds `google_ads_credential_readiness_gate_policy_v1`, tool `google_ads_credential_readiness_gate`, and migration `246_sprint67_google_ads_credential_readiness_gate.sql`. It checks active Google Ads connection and credential binding metadata only. It does not read encrypted credentials, decrypt tokens, call Google Ads, or mutate spend. Future execution requires this gate in addition to preflight validation and explicit enablement.

> 2026-06-08 Google Ads execution adapter skeleton note: PR adds `google_ads_budget_execution_adapter_skeleton_policy_v1`, audit table `google_ads_budget_execution_gate_audit`, skeleton `google_ads_budget_change_execution_adapter`, and migration `245_sprint67_google_ads_execution_adapter_skeleton.sql`. The skeleton validates `preflight_id` through `requireValidatedPreflightForExecution`, records audit, then blocks provider execution. Admin endpoint remains disabled; no Google Ads call, no credential read, no spend mutation.

> 2026-06-08 preflight execution gate helper note: PR adds `preflight_execution_gate_helper_policy_v1`, helper `preflightLedgerExecutionGate.js`, and migration `243_sprint67_preflight_execution_gate_helper.sql`. Future execution adapters must use `requireValidatedPreflightForExecution` before mutation. The helper wraps `preflight_ledger_validate`, enforces ready preflight rows, optional envelope match, hash/readback, and no-provider/no-spend/no-secret markers. No execution.

> 2026-06-08 preflight ledger validator note: PR adds `preflight_ledger_validator_policy_v1`, table `preflight_ledger_validator_registry`, tool `preflight_ledger_validate`, and migration `242_sprint67_preflight_ledger_validator.sql`. Future execution adapters should validate `preflight_id` through this tool rather than reading family ledgers directly. The validator checks ready state, optional envelope match, no-provider/no-spend/no-secret markers, and payload hash. No execution.

> 2026-06-08 Google Ads preflight ledger note: PR adds `google_ads_budget_preflight_ledger_policy_v1`, table `google_ads_budget_preflight_ledger`, and migration `241_sprint67_google_ads_budget_preflight_ledger.sql`. `google_ads_budget_change_preflight` now records every result with `preflight_id` and `preflight_sha256`; future Google Ads execution adapters must require a ready ledger row before mutation. No provider call, no credential read, no spend change, `secrets_included=false`.

> 2026-06-08 Google Ads budget preflight note: PR adds `google_ads_budget_change_preflight_policy_v1`, tool `google_ads_budget_change_preflight`, and migration `238_sprint67_google_ads_budget_change_preflight.sql`. It requires a ready Google Ads capability envelope and `budget_quota_authority_dry_run=ready_for_dispatch` before any future budget mutation adapter. It is preflight only: no Google Ads provider call, no credential read, no spend change, `secrets_included=false`.

> 2026-06-08 budget/quota authority note: PR adds `budget_quota_authority_registry_policy_v1`, table `budget_quota_authority_registry`, tool `budget_quota_authority_dry_run`, and migration `236_sprint67_budget_quota_authority_registry.sql`. It is dry-run only, blocks missing/exceeded spend authority, routes approval-required spend through envelope approval, and includes no provider spend or connector forwarding. `secrets_included=false`.

> 2026-06-08 repo patch capability envelope note: PR adds `repo_patch_apply_capability_envelope_requirement_v1` and migration `234_sprint67_repo_patch_capability_envelope_requirement.sql`. `repo_patch_apply` requires `capability_envelope_id` before GitHub App token resolution; `repo_inspect` remains read-only and ungated. Runtime order: input/path validation, protected branch guard, capability envelope guard, GitHub App token resolution, stale/diverged branch preflight, then contents mutation. SQL safety: policy/runtime-config seed only, no destructive SQL, `secrets_included=false`.

Last updated: 2026-06-07 (shared reconciliation continuation engine and scoped resume policy)

## Current Patch Set

### 2026-06-08 — Admin Branch Reconcile Continuation Adapter

- Status: PR pending; CI required before merge.
- Branch: `gpt/admin-branch-reconcile-adapter-20260608`
- Scope:
  - Added virtual admin tool `admin_branch_reconcile` for non-protected repository work branches.
  - Added branch classification: `clean`, `behind_only`, `ahead_only`, `diverged`, and `unknown`.
  - Added no-secret shared reconciliation checkpoint evidence for stale/diverged branch states.
  - Added safe apply path only for `behind_only` branches using GitHub ref update with `force:false` and explicit `FAST_FORWARD_<BRANCH_SLUG>` confirmation.
  - Added migration `234_sprint68_admin_branch_reconcile_continuation_policy.sql` and tracked it in governed migration runner and release readiness.
- Runtime behavior:
  - `diagnose` and `dry_run` fetch base ref, branch ref, and compare state, then return continuation evidence.
  - `apply` is blocked for `diverged`, `ahead_only`, `unknown`, protected/default branches, or missing confirmation.
  - The adapter never force-pushes and must verify compare state after a fast-forward apply before reporting reconciliation.
- SQL safety class:
  - Policy seed only; `INSERT INTO execution_policies ... ON DUPLICATE KEY UPDATE`.
  - No destructive SQL, no secret values, and `secrets_included=false`.
- Evidence:
  - `test-admin-branch-reconcile-adapter.mjs` asserts classification, confirmation, continuation evidence, no force-push, migration policy, runner allowlist, and release-readiness tracking.
  - PR CI/manual CI evidence to be recorded before merge.

### 2026-06-08 — Local Connector Tunnel Provisioning Continuation

- Status: PR pending; CI required before merge.
- Branch: `gpt/local-connector-no-token-continuation-20260608`
- Scope:
  - Added `connector_tunnel_provisioning_required` to the shared reconciliation interruption signals.
  - Added `buildLocalConnectorTunnelProvisioningContinuationEvidence()` in `adminCliRoutes.js`.
  - Changed `POST /admin/cli/local-connector/self-repair` so missing DB `cf_token` and missing `CLOUDFLARE_TUNNEL_TOKEN` return a resumable 409 handoff instead of a dead-end 404.
  - Added migration `233_sprint68_local_connector_tunnel_provisioning_continuation_policy.sql` to register the blocking policy `Local Connector Tunnel Provisioning Continuation Contract`.
  - Added migration 233 to the governed migration runner allowlist and release-readiness expected ledger coverage.
- Runtime behavior:
  - If connector recovery starts from HTTP 530/1033 and self-repair cannot find a tunnel token, the response includes `continuation.checkpoint`, `resume_plan`, `provisioning.required_next_action=provision_tunnel_token`, and `secrets_included=false`.
  - Agents must provision the tunnel token through an authorized secret/config path, then retry self-repair and verify connector health in the same cycle before reporting recovery.
  - The response and audit payload must not include `cf_token`, `connector_secret`, `CLOUDFLARE_TUNNEL_TOKEN`, or `BACKEND_API_KEY`.
- SQL safety class:
  - Policy seed only; `INSERT INTO execution_policies ... ON DUPLICATE KEY UPDATE`.
  - No destructive SQL, no secret values, and `secrets_included=false`.
- Evidence:
  - `test-admin-control.mjs` asserts continuation evidence, no-secret handoff, policy migration, runner allowlist, and release-readiness tracking.
  - `test-shared-reconciliation-engine.mjs` asserts `connector_tunnel_provisioning_required` is a generalized signal.
  - PR CI/manual CI evidence to be recorded before merge.

### 2026-06-08 — Chunked Tool Response Continuation Contract

- Status: PR #868 opened; CI required before merge.
- Branch: `gpt/chunk-read-generalized-fallback-20260608`
- Scope:
  - Added `CHUNKED_TOOL_RESPONSE_CONTINUATION_CONTRACT` in `http-generic-api/routes/gptToolsRoutes.js`.
  - Chunked responses now include `continuation.required_tool=response_chunk_read`, `continuation.required_before_fallback`, and a `continuation.next_call` payload.
  - Added migration `232_sprint68_chunked_tool_response_continuation_policy.sql` to register the blocking policy `Chunked Tool Response Continuation Contract`.
  - Added migration 232 to the governed migration runner allowlist and release-readiness expected ledger coverage.
  - Updated `AI_Agent_Knowledge_Guide.md` so agents must exhaust `response_chunk_read` before local slices, secondary search, connector reads, or external fallbacks.
- Runtime behavior:
  - Any governed tool response with `response_chunked=true`, `page.has_more=true`, or `page.next_cursor` must be continued through `response_chunk_read` until `has_more=false`.
  - Alternative surfaces are allowed only after all chunks are read, the chunk cache expires and the original tool is retried, or `response_chunk_read` is unavailable/authorization-gated.
  - Agents must not claim a file/result is fully read while the response page still has more chunks.
- SQL safety class:
  - Policy seed only; `INSERT INTO execution_policies ... ON DUPLICATE KEY UPDATE`.
  - No destructive SQL, no secret values, and `secrets_included=false`.
- Evidence:
  - `test-gpt-tools-response-chunking.mjs` asserts runtime contract metadata, migration 232 content, runner allowlist, and release-readiness tracking.
  - PR CI/manual CI evidence to be recorded before merge.

### 2026-06-07 — Shared Reconciliation Continuation Engine

- Status: PR #855 opened, CI success on branch before docs-agent note; targeted docs alignment added in PR.
- Branch: `gpt/shared-reconciliation-continuation-20260607`
- Scope:
  - Added `http-generic-api/sharedReconciliationEngine.js` as the shared continuation/reconciliation contract for resumable governed operations.
  - Added migration `231_sprint68_shared_reconciliation_continuation_policy.sql` to register the blocking policy `Shared Reconciliation Engine Continuation Contract`.
  - Added `http-generic-api/docs/shared-reconciliation-continuation-runbook.md` for operations after tool timeout, session expiry, branch drift, deployment reload gaps, unsupported fallback, credential intake, or approval pauses.
  - Added tests `test-shared-reconciliation-engine.mjs` and `test-shared-reconciliation-continuation-policy.mjs`, and added both to the test manifest.
- Runtime behavior:
  - Continuation checkpoints must include actor scope, resource scope, resource fingerprint, current stage, interruption signal, resume metadata, and `secrets_included=false`.
  - Direct resume is allowed only when the current resource fingerprint still matches the checkpoint.
  - Drifted resources require dry-run repair, verification, apply gate, audit, and then original-operation resume.
  - The engine is shared across admin, tenant, user, and local/device flows, but authority remains scoped: tenant/user actors cannot reconcile platform or repository resources.
- SQL safety class:
  - Policy seed only; `INSERT INTO execution_policies ... ON DUPLICATE KEY UPDATE`.
  - No `DROP`, `TRUNCATE`, broad `DELETE`, broad table conversion, or secret-payload mutation.
- Evidence:
  - `node test-shared-reconciliation-engine.mjs`: pass.
  - `node test-shared-reconciliation-continuation-policy.mjs`: pass.
  - `node scripts/run-test-manifest.mjs --grep shared-reconciliation`: pass.
  - `node test-connection-capability-repair-before-fallback-policy.mjs`: pass.
  - `node test-github-branch-maintenance-fallbacks.mjs`: pass.
  - `node test-admin-workspace-authority-routes.mjs`: pass after local worktree dependency install.
  - GitHub Actions on PR creation: CI success, Docs Agent success, PR Risk Labeler success for head `43c975fd`.
- Operational note:
  - Docs Agent added `docs/auto-docs-agent/pr-855.md` and requested this targeted ledger/checklist/governance update because the PR includes a policy migration.
  - Local verification used a detached worktree and reported Node `v24.15.0` while the project engine requires `>=22 <23`; targeted tests still passed, and GitHub CI runs Node 22.

### 1. MySQL Registry Migration Baseline

- Status: committed
- Commit: `da92ab5 Refactor: Migrate from Google Sheets to MySQL and configure sqlAdapter`
- Scope:
  - Added MySQL-backed registry support.
  - Added `migrate-sheets-to-sql.mjs` migration flow.
  - Added `sqlAdapter.js`, `db.js`, and schema support.
- Evidence:
  - Commit exists in local history.
- Open risk:
  - Migration completeness claims should be re-verified against the live database before production deployment.

### 2. Server Modularization

- Status: committed
- Commit: `852cf05 Add AI resolvers and provider timeout diagnostics`
- Files:
  - `http-generic-api/server.js`
  - `http-generic-api/authService.js`
  - `http-generic-api/stateManager.js`
- Scope:
  - Extracted auth/schema guard wrappers into `authService.js`.
  - Extracted registry state/cache/load wrappers into `stateManager.js`.
  - Repaired interrupted import wiring in `server.js`.
- Evidence:
  - `node --check server.js` passed from `http-generic-api`.
  - `npm.cmd test` passed from `http-generic-api`.
  - `npm.cmd run validate` passed from `http-generic-api`.

### 3. Plan And Task Generation Resolvers

- Status: committed
- Commits: `852cf05`, `8cff850 Align AI resolvers with intent maturation`
- Files:
  - `http-generic-api/services/planningResolver.js`
  - `http-generic-api/services/taskResolver.js`
  - `http-generic-api/routes/aiResolverRoutes.js`
  - `http-generic-api/routes/index.js`
  - `http-generic-api/server.js`
  - `http-generic-api/test-ai-resolvers.mjs`
  - `http-generic-api/package.json`
- Runtime behavior:
  - `POST /ai/implementation-plan` returns a Markdown implementation plan.
  - `POST /ai/task-manifest` returns a Markdown task checklist.
  - Both routes use the existing backend API key middleware.
  - Both routes call OpenAI via `fetch` and require `OPENAI_API_KEY`.
  - Outputs are returned synchronously; no database or file persistence has been added yet.
- Evidence:
  - `node test-ai-resolvers.mjs` passed from `http-generic-api`.
  - Included in `npm.cmd test`.

### 4. Provider Fetch Timeout And Diagnostics

- Status: committed
- Commit: `852cf05 Add AI resolvers and provider timeout diagnostics`
- Files:
  - `http-generic-api/execution.js`
  - `http-generic-api/executionDispatch.js`
  - `http-generic-api/server.js`
  - `http-generic-api/test-provider-fetch-timeout.mjs`
  - `http-generic-api/package.json`
  - `http-generic-api/validate-architecture.mjs`
- Scope:
  - Wrapped provider `fetch` calls with `AbortController`.
  - Added controlled provider timeout handling before worker-level timeout.
  - Added diagnostic log events:
    - `PROVIDER_FETCH_START`
    - `PROVIDER_RESPONSE_STATUS`
    - `PROVIDER_FETCH_END`
    - `PROVIDER_FETCH_TIMEOUT`
    - `PROVIDER_FETCH_ERROR`
    - `PROVIDER_ELAPSED_MS`
  - Added `provider_timeout_ms` support.
  - Returns controlled `504` response with `provider_timeout` instead of waiting for opaque `worker_timeout`.
- Evidence:
  - `node test-provider-fetch-timeout.mjs` passed from `http-generic-api`.
  - `npm.cmd run validate` passed from `http-generic-api`.

### 5. AI Resolver Intent Maturation Bridge

- Status: committed
- Commit: `d6881f8 Preserve AI intent maturation across routes`
- Files:
  - `http-generic-api/services/intentMaturationResolver.js`
  - `http-generic-api/routes/aiResolverRoutes.js`
  - `http-generic-api/services/taskResolver.js`
  - `http-generic-api/server.js`
  - `http-generic-api/test-ai-resolvers.mjs`
  - `http-generic-api/test-ai-resolver-routes.mjs`
- Scope:
  - Keeps generated plans and task manifests aligned with the existing first-class intent maturation model.
  - Normalizes AI generation requests through existing contracts:
    - `NormalizedExecutionIntent`
    - `NormalizedRouteWorkflowState`
    - `NormalizedMutationIntent`
  - Adds `intent_maturation` to AI resolver responses.
  - Injects matured intent context into plan/task prompts.
  - Adds direct route handler coverage for intent-maturation response and prompt injection.
  - Preserves upstream plan-generation `intent_maturation` context when generating task manifests.
  - Adds HTTP-level route coverage for plan -> task intent continuity.
  - Avoids creating a parallel JSON Asset persistence path.
- Evidence:
  - `node test-ai-resolvers.mjs` passed from `http-generic-api`.
  - `node test-ai-resolver-routes.mjs` passed from `http-generic-api`.
  - `npm.cmd run validate` passed from `http-generic-api`.
  - `npm.cmd test` passed from `http-generic-api`.

### 6. AI Resolver Registry Readiness

- Status: committed
- Commit: `54d8a3b Add AI registry readiness diagnostic`
- Files:
  - `http-generic-api/routeWorkflowGovernance.js`
  - `http-generic-api/stateManager.js`
  - `http-generic-api/routes/governanceRoutes.js`
  - `http-generic-api/server.js`
  - `http-generic-api/test-ai-registry-readiness.mjs`
  - `http-generic-api/package.json`
- Scope:
  - Adds a validation-only AI resolver registry readiness check for:
    - `ai_implementation_plan_generation`
    - `ai_task_manifest_generation`
  - Validates Task Routes rows by `intent_key` and executable authority.
  - Validates linked Workflow Registry rows through `workflow_key`, `workflow_id`, or compatible route binding.
  - Adds `GET /ai/registry-readiness` as a diagnostic endpoint.
  - Does not mutate live registry rows.
- Evidence:
  - `node test-ai-registry-readiness.mjs` passed from `http-generic-api`.
  - `npm.cmd run validate` passed from `http-generic-api`.
  - `npm.cmd test` passed from `http-generic-api`.

## Verification Snapshot

- `node --check server.js`: pass
- `node test-ai-resolvers.mjs`: pass
- `node test-ai-resolver-routes.mjs`: pass
- `node test-ai-registry-readiness.mjs`: pass
- `node test-provider-fetch-timeout.mjs`: pass
- `node test-routes.mjs`: pass with route runtime checks skipped by default
- `npm.cmd test`: pass
- `npm.cmd run validate`: pass, 173 passed / 0 failed

Cloud Build (all SUCCESS):

- `54d8a3b Add AI registry readiness diagnostic`: SUCCESS (build 4cfa8cd9, finished 2026-05-04 12:09 UTC)
- `d6881f8 Preserve AI intent maturation across routes`: SUCCESS (build e1fd36a4, finished 2026-05-04 11:58 UTC)
- `8cff850 Align AI resolvers with intent maturation`: SUCCESS (build fb4a8fe7, finished 2026-05-04 11:53 UTC)

Note: `npm test` through PowerShell failed because `npm.ps1` is blocked by the local execution policy. `npm.cmd test` was used instead and passed.

## Current Uncommitted Work

None. Working tree is clean. All 6 patches are committed and deployed.

## Compaction Transcript Check

- Transcript path from compacted session:
  - `C:\Users\IT\.claude\projects\d--Nagy-Multi-Business-Multi-Role-Growth-Intelligence-OS\f4bd12c1-7a6d-47fb-a002-fbef9db6c2fc.jsonl`
- Local status:
  - File exists.
  - Last write time: 2026-05-04 12:37:57 Africa/Cairo.
  - Approximate size: 4.1 MB.
- Important evidence recovered:
  - Sheets to MySQL dry run succeeded for all 15 tables.
  - Dry-run estimate: 12,613 rows across 15 tables.
  - First live `--truncate` migration migrated 14 tables and failed on `Registry Surfaces Catalog`.
  - Failure reason: duplicate `surface_id` value `surface.hosting_account_registry_sheet` against unique key `uq_surface_id`.
  - This explains why `--ignore` support was added afterward for the registry surface migration.
- Security note:
  - The raw transcript includes local paths, tool state, and `.env` content. Do not commit, paste, or share the transcript directly.

## Live Registry Row Status — VERIFIED

Rows added directly to the live authoritative workbook (Growth Intelligence OS - Registry Workbook).
No code commit was made for this step; the registry is the authority.

### Task Routes — Written and readback-verified

Written range: `Task Routes!A209:AU210` — 2 rows, 47 columns, 94 cells

| `intent_key` | `route_id` | `endpoint_path` | `workflow_key` | `active` |
|---|---|---|---|---|
| `ai_implementation_plan_generation` | `route_ai_implementation_plan_generation` | `/ai/implementation-plan` | `wf_ai_implementation_plan_generation` | `TRUE` |
| `ai_task_manifest_generation` | `route_ai_task_manifest_generation` | `/ai/task-manifest` | `wf_ai_task_manifest_generation` | `TRUE` |

### Workflow Registry — Written and readback-verified

Written range: `Workflow Registry!A240:BA241` — 2 rows, 53 columns, 106 cells

| `workflow_id` | `workflow_key` | `active` |
|---|---|---|
| `wf_ai_implementation_plan_generation` | `wf_ai_implementation_plan_generation` | `TRUE` |
| `wf_ai_task_manifest_generation` | `wf_ai_task_manifest_generation` | `TRUE` |

### Local test evidence

- `node test-ai-registry-readiness.mjs`: **pass**
- `npm.cmd test`: **33 passed, 0 failed**

## Next Steps

1. ~~Call `GET /ai/registry-readiness` against the live deployed service.~~ Done — rows added and readback-verified.
2. ~~Add Task Routes + Workflow Registry rows.~~ Done.
3. Call `GET /ai/registry-readiness` against the **deployed Cloud Run service** (not local) to confirm the live endpoint resolves the new rows from Sheets.
4. Catalog reconciliation: fix duplicate `surface_id` (`surface.hosting_account_registry_sheet`), register 8 unregistered live tabs, refresh expected column counts for tabs where live header no longer matches catalog metadata.
5. Build Sheets → SQL merge migrator: per-table natural key diff, upsert-on-match, insert-if-missing, dry-run by default, `--apply` to write.

## Remaining Decisions

- Decide whether generated plans/tasks should remain synchronous API responses or also be persisted as JSON assets.
- Decide whether OpenAI should remain a direct `fetch` integration or be routed through the existing generic HTTP connector registry.
- Verify or add the two live Task Routes rows and their linked Workflow Registry rows.

---

## Patch 7 — Production Hardening: Schema Expansion, Catalog Reconciliation, Migration Merge, CI Tests

- Status: committed
- Scope: All phases of http-generic-api production hardening
- Files changed:
  - `http-generic-api/sqlAdapter.js` — fixed column count comment (67 → 66 for validation_repair)
  - `http-generic-api/test-migrate-sql-adapter.mjs` — new: 104 unit tests for toSqlCol(), TABLE_MAP completeness, SHEET_COLUMNS counts, no post-normalisation duplicates
  - `http-generic-api/test-expand-schema-logic.mjs` — new: 623 unit tests for expand-schema toSqlCol() parity, dry-run ALTER TABLE guard, pool lifecycle
  - `http-generic-api/package.json` — added two new test files to npm test script
  - `http-generic-api/reconcile-catalog.mjs` — new: RSC health checker (7 flags, Sheets-only, no DB)
  - `http-generic-api/migrate-sheets-to-sql.mjs` — new: 15-table Sheets→SQL migrator (seed + merge modes)
  - `http-generic-api/openapi.yaml` — new: OpenAPI spec
  - `deployment_parity_checklist.md` — fixed github.js export count (2 → 14); added ACTIVITY_SPREADSHEET_ID and EXECUTION_LOG_UNIFIED_SPREADSHEET_ID to Layer 2
  - `runtime_boundary_map.md` — added Section 4b: SQL data layer boundaries (db.js, sqlAdapter.js, dataSource.js, migrate/expand/reconcile CLI tools)
  - `README.md` — added Sheets→MySQL data layer section with env vars, migration script sequence, and updated test counts

### Schema Expansion Results

- 282 new columns added across 8 tables in a single `expand-schema.mjs --apply` run:
  - `brands`: 25 → 122 columns
  - `actions`: 16 → 47 columns
  - `endpoints`: 30 → 58 columns
  - `task_routes`: 46 columns (priority dupe removed, count confirmed at 46)
  - `workflows`: 38 → 53 columns
  - `brand_core`: 8 → 20 columns
  - `registry_surfaces_catalog`: 17 → 38 columns
  - `validation_repair`: 11 → 66 columns
- `node expand-schema.mjs` (dry-run) now reports: New columns detected: 0

### Catalog Reconciliation Results

All 7 catalog health checks report 0:
- Duplicate surface_ids: 0
- Unregistered tabs: 0
- Missing tabs (required): 0
- Missing tabs (optional): 0
- GID mismatches: 0
- Column count mismatches: 0

### Migration Merge Run Results

Live merge run (`migrate-sheets-to-sql.mjs --merge --apply`) completed:
- 138 inserts across all tables
- 681 updates across all tables
- 0 errors

### OAuth Desktop App Auth Setup

- `auth.mjs` — one-time OAuth2 Desktop flow saves token to `google-oauth-token.json`
- `auth-setup.mjs` — pre-existing auth setup helper
- `get-live-headers.mjs` — live sheet header dump utility
- Token saved: `http-generic-api/google-oauth-token.json` (gitignored)
- Secret: `secrets/oauth-client.json` (gitignored)

### Audit Findings (Phase 1)

- `db.js`: pool.end() is NOT called in Express server — only in CLI scripts. Correct.
- `dataSource.js`: all three DATA_SOURCE modes (sheets/dual/sql) are correctly wired.
- `config.js`: all env vars declared with sensible defaults. ACTIVITY_SPREADSHEET_ID and EXECUTION_LOG_UNIFIED_SPREADSHEET_ID are derived constants, not raw env vars (ACTIVITY_SPREADSHEET_ID defaults to REGISTRY_SPREADSHEET_ID).
- `reconcile-catalog.mjs`: correctly does NOT import db.js or any MySQL module — Sheets-only tool.
- `expand-schema.mjs` and `sqlAdapter.js` toSqlCol() functions are textually identical — verified by test suite.
- No test files import google-oauth-token.json or secrets/ directly.
- No circular imports detected.
- TABLE_MAP: 15 entries, all present in SHEET_COLUMNS — verified by test suite.
- SHEET_COLUMNS: no post-normalisation duplicates in any of the 15 tables — verified by test suite.

### Verification Snapshot

- `node expand-schema.mjs`: New columns detected: 0
- `node migrate-sheets-to-sql.mjs --dry-run`: 13,025 rows across 15 tables, no errors
- `node reconcile-catalog.mjs`: all 7 checks = 0
- `node validate-architecture.mjs`: 173 passed, 0 failed
- `npm test`: all test files pass (46+ files, 800+ assertions)

---

## Patch 8 — DB Production Hardening: Tightening, Server Bypass Removal, Smoke Test

- Status: committed
- Date: 2026-05-04
- Files changed:
  - `http-generic-api/tighten-db.mjs` — new: dedup natural keys, UNIQUE constraints, indexes, TEXT→VARCHAR
  - `http-generic-api/smoke-test-data-flow.mjs` — new: end-to-end data-flow smoke test across all 15 SQL tables
  - `http-generic-api/server.js` — removed inline `sqlAdapter.appendRow` bypass in `performGovernedSheetMutation` (SQL mirroring now exclusively through `dataSource.js`)
  - `http-generic-api/sqlAdapter.js` — fixed `task_routes` duplicate `"priority"` column (both `"Priority"` and `"priority"` normalized to same SQL col); corrected `validation_repair` column count comment (67 → 66)
  - `http-generic-api/reconcile-catalog.mjs` — expanded: cross-workbook tab resolution via `file_id` column, `normalizeTabName()`, `isRetired()`, 7th flag `--retire-deleted` and `--demote-required`
  - `runtime_boundary_map.md` — updated reconcile-catalog boundary, added tighten-db.mjs and smoke-test-data-flow.mjs CLI boundaries
  - `README.md` — added tighten-db.mjs and smoke-test-data-flow.mjs to migration scripts; updated test counts (44+ → 46+)
  - `deployment_parity_checklist.md` — updated test assertion count; added smoke-test-data-flow.mjs to Layer 1 CI gate

### DB Tightening Results

Deduplication:
- 3,000+ duplicate rows removed across 5 tables (source: sheet duplication across brand-specific tabs migrated together)
- UNIQUE constraints now prevent re-introduction

UNIQUE constraints added:
- `task_routes.route_id`
- `workflows.workflow_id`
- `endpoints.endpoint_id`
- `execution_policies.(policy_group, policy_key)`
- `brand_core.(brand_key, asset_key)`

Indexes added: `intent_key`, `brand_scope`, `active`, `maturity(50)`, `result_state(100)`, `severity(100)`, `active_status`

TEXT → VARCHAR promotions: `registry_surfaces_catalog.file_id/source_surface_id/parent_surface_id`, `actions.action_id`, `validation_repair.validation_type/result_state/severity/rule_id`

### Smoke Test Results (2026-05-04)

`node smoke-test-data-flow.mjs` — **70 passed, 0 failed**

Live row counts verified:
| Table | Rows |
|---|---|
| brands | 6 |
| brand_core | 141 |
| actions | 19 |
| endpoints | 1,491 |
| execution_policies | 1,097 (1,088 active, 801 blocking) |
| hosting_accounts | 6 |
| site_runtime_inventory | 60 |
| site_settings_inventory | 8 |
| plugins | 10 |
| task_routes | 206 (205 active) |
| workflows | 239 |
| registry_surfaces_catalog | 395 (360 required, 383 active, 0 duplicate surface_ids) |
| validation_repair | 808 |
| json_assets | 2,791 |
| execution_log | 12,012 |

Chain verified: `seo_strategy` intent_key → `task_routes.workflow_key` = `tour_catalog_analysis_workflow` → `workflows.execution_class` resolved.

UNIQUE enforcement confirmed: `task_routes.route_id` and `workflows.workflow_id` both return `ER_DUP_ENTRY` on duplicate insert.

### Data Observations

- `donatours.com` brand has 0 rows in `site_runtime_inventory` and `site_settings_inventory` — runtime inventory not yet populated for this brand.
- 91 sheet-side duplicate natural keys remain in source Sheets (same workflow_key appearing multiple times across brand-specific tabs); migrator handles these correctly via INSERT IGNORE.
- `brand_core` has some rows with blank `brand_key`/`asset_key` after dedup — source data entry gap, not a schema failure.

### Verification Snapshot

- `node smoke-test-data-flow.mjs`: 70 passed, 0 failed
- `node tighten-db.mjs` (dry-run after apply): 0 dedup candidates, all UNIQUE constraints already present
- `node reconcile-catalog.mjs`: all 7 checks = 0
- `npm test`: 46+ files, 800+ assertions, all pass

---

## Patch 9 — Credential Sanitization, Secure Auth Resolution, Formula & AppScript Protection

- Status: committed
- Date: 2026-05-04

### Scope

**Embedded credentials removed from SQL (sanitize-credentials.mjs --apply ran):**
- `actions.api_key_value` NULLed for 6 rows (serpapi_search, scraperapi_scrape, abstractapi_scrape, googleads_api, github_api_mcp, make_mcp_server); `api_key_storage_mode` updated to `secret_reference`; `secret_store_ref` set to `ref:secret:<ENV_VAR>` format
- `brands.application_password` NULLed for 3 rows (Dona tours, AllRoyalEgypt Brand, Almallah Group)
- `hosting_accounts.api_key_reference` replaced with `ref:secret:<ENV_VAR>` for 2 rows (hostinger_cloud_plan_01, hostinger_shared_manager_01); `api_key_storage_mode` updated to `secret_reference`

**Files changed:**
- `http-generic-api/sanitize-credentials.mjs` — new: one-time cleanup script; idempotent dry-run / --apply
- `http-generic-api/authCredentialResolution.js` — rewired all four auth modes through storage-mode-aware helpers; `embedded_sheet` now logs a security warning and returns empty instead of leaking the raw value; `resolveWpAppPassword()` reads from env var first (`<TARGET_KEY_UPPER>_APP_PASSWORD`), falls back with warning; `getAdditionalStaticAuthHeaders()` now calls `resolveActionSecret()` instead of reading `api_key_value` directly
- `http-generic-api/migrate-sheets-to-sql.mjs` — added formula detection (dual FORMATTED_VALUE + FORMULA fetch); formula-driven columns excluded from merge diff and UPDATE payload; added `APPSCRIPT_MANAGED_SHEETS` set (currently: Execution Log Unified); AppScript-managed sheets receive inserts only in merge mode, never updates

### Required env vars (add after rotating secrets)

```
SERPAPI_API_KEY=<rotated>
SCRAPERAPI_API_KEY=<rotated>
ABSTRACTAPI_API_KEY=<rotated>
GOOGLEADS_DEVELOPER_TOKEN=<rotated>
GITHUB_TOKEN=<rotated>        # already in .env — confirm rotation
MAKE_MCP_TOKEN=<rotated>
DONATOURS_WP_APP_PASSWORD=<rotated>
ALLROYALEGYPT_WP_APP_PASSWORD=<rotated>
ALMALLAH_WP_APP_PASSWORD=<rotated>
HOSTINGER_CLOUD_PLAN_01_API_KEY=<rotated>
HOSTINGER_SHARED_MANAGER_01_API_KEY=<rotated>
```

### Remaining manual steps (owner)

1. **Rotate each exposed credential** at its provider dashboard (WP Admin → Application Passwords, SerpAPI dashboard, GitHub PAT settings, Hostinger API tokens, etc.)
2. **Add rotated values to .env** using the env var names above
3. **Clear the source Google Sheets cells**: in the Sheets source, blank the `application_password` column for the 3 brand rows and blank `api_key_value` for the 6 action rows and `api_key_reference` for the 2 hosting account rows. This prevents the next `migrate --merge --apply` from writing NULLs over if the sheet still has values (migrator will update SQL with whatever is in Sheets on the next merge run).
4. **AppScript audit**: open Apps Script on the Activity Workbook; confirm no trigger writes credential values into sheet cells. Confirm all enforcement events write only to `Execution Log Unified` and not to credential-holding columns.

### Formula & AppScript notes

**Sheet formulas:** The migrator now fetches both `FORMATTED_VALUE` and `FORMULA` render options per sheet. Any column that contains a formula (`=`) in any data row is tracked in `formulaColumns` and excluded from:
- the row signature used for change detection in merge mode
- the `updateRowById` payload (formula-computed values are never written back to SQL from a stale snapshot)

This means formula-driven columns (e.g. auto-computed scores, cross-sheet lookups, array formula outputs) are treated as read-only by the migrator. The SQL values for those columns are only updated when the Sheets source is re-seeded (`--truncate`), not in incremental merge mode.

**AppScript on Activity Workbook:** `Execution Log Unified` is registered in `APPSCRIPT_MANAGED_SHEETS`. In merge mode, the migrator inserts new rows but never updates existing SQL rows. This prevents the migrator from overwriting AppScript enforcement-event edits (row annotations, status updates, computed fields) with stale SQL snapshots. The Execution Log is already `NATURAL_KEYS = null` (append-only), so merge mode skips it entirely anyway — the AppScript registration serves as an explicit declaration of intent for future maintainers.

### Verification

- `npm.cmd test`: 623 passed, 0 failed
- `node smoke-test-data-flow.mjs`: 70 passed, 0 failed
- `node --check authCredentialResolution.js`: OK
- `node --check migrate-sheets-to-sql.mjs`: OK
- DB: `actions.api_key_value` NULL for all `embedded_sheet` rows; `hosting_accounts.api_key_reference` updated to `ref:secret:` format; `brands.application_password` NULL

---

## Patch 10 — Parent Action External Auth Strategy

- Status: committed
- Date: 2026-05-17
- Migration: `http-generic-api/migrations/076_sprint61_parent_action_auth_strategy.sql`

### Scope

External endpoint credential selection is now governed from the parent action row instead of duplicated per endpoint.

Authoritative policy location:

```text
actions.runtime_binding_profile.auth_strategy
```

Optional endpoint override location:

```text
endpoints.runtime_binding_profile.auth_strategy_override
```

Runtime selector fields exposed through endpoint tools:

```text
credential_scope = platform | user | tenant | connection | auto
user_id
tenant_id
connection_id
app_key
scopes
auth_type
allow_platform_fallback
auth_context
```

### Files changed

- `http-generic-api/userAppConnectionCredentials.js` — generic `user_app_connections` resolver for user/tenant/connection credentials.
- `http-generic-api/authCredentialResolution.js` — parent action auth strategy resolver and scoped credential contract builder.
- `http-generic-api/authInjection.js` — recognizes `custom_headers` auth mode.
- `http-generic-api/executionPreparation.js` — merges runtime auth selector fields into `auth_context`.
- `http-generic-api/routes/systemLayerRoutes.js` — forwards the external auth selector set from exported tool calls to the runtime facade.
- `http-generic-api/migrations/076_sprint61_parent_action_auth_strategy.sql` — idempotent DB reconciliation for parent auth policies and exported tool schemas.
- `docs/external-endpoint-auth-strategy.md` — operating guide.
- `docs/registry-taxonomy.md`, `README.md`, `AI_Agent_Knowledge_Guide.md`, `connector_contracts.md`, `deployment_parity_checklist.md` — documentation alignment.

### Runtime behavior

- Parent actions default to platform credentials unless runtime scope requests user, tenant, connection, or auto.
- Scoped credentials resolve from `user_app_connections.encrypted_credentials`.
- Secret material remains encrypted or referenced. It is not copied into `actions`, `endpoints`, or tool export rows.
- If `credential_scope` is `user`, `tenant`, or `connection` and `allow_platform_fallback=false`, the runtime must return a scoped credential error rather than using a platform secret.
- `github_actions_status` and `github_git_data` now use GitHub App auth instead of an expiring `GITHUB_TOKEN` bearer token.

### Verification

- `cloudflare_api__cf_list_zones` with `credential_scope=platform` returned `200`.
- `cloudflare_api__cf_list_zones` with `credential_scope=user`, admin user id, and `allow_platform_fallback=false` returned `403 external_credential_connection_not_found` as expected.
- `google_drive_api__listDriveFiles` platform scope returned `200` after the Google resolver fix.
- User-scoped Google Drive without an active OAuth connection and without fallback returned the scoped auth error as expected.
- GitHub Actions status query now resolves through `github_app` and returns `200`.
- CI verification after push completed successfully.

---

## Patch 11 — Session Archive Relink After Restore

- Status: applied and documented
- Date: 2026-05-17
- Runbook: `docs/session-archive-relink-2026-05-17.md`

### Scope

A database restore removed the active `customer_sessions` row for the official session folder:

```text
session_f0132008-edae-44d0-8668-87b44b2fde26
folder_id = 1enrrI7OU3_R0vAaCyfm-N7Ii7IU5Q3AG
```

The GPT tool dispatcher continued archiving to a superseded active SQL session:

```text
session_5dee2542-80e3-45f2-8bef-087c59d5def5
folder_id = 1cYCHu2pAX8_EGa11jCQH62kbAcvSrDza
```

### Actions

- Recreated the missing `customer_sessions` row for the official `f013...` session.
- Rebound it to the official Drive folder, transcript Doc, JSONL, and Exports folder.
- Copied bounded SQL `gpt_session_turns` rows from the superseded `5dee...` session back under the official `f013...` session.
- Copied target turn range: `114..291`.
- Marked the superseded `5dee...` session as completed/superseded.
- Added a `Restore Relink Backfill — 2026-05-17` note to the official Google Doc.
- Added reusable CLI `http-generic-api/session-archive-relink-repair.mjs`.
- Added governed built-in `admin_control` shell aliases: `session_archive_relink_repair_dry_run` and `session_archive_relink_repair_apply`.
- Added migration `http-generic-api/migrations/077_sprint61_session_archive_relink_aliases.sql` to document alias usage in the admin tool registry schema.
- Verified the official folder resumed updates.

### Guardrail added

After any DB restore or replay, verify that the active `customer_sessions` row selected by `routes/gptToolsRoutes.js` points to the intended Drive folder before continuing platform work.

### Verification

- Official `Tool_Calls.jsonl` modified at approximately `2026-05-17T09:55:41Z`.
- Official `Session Transcript` modified at approximately `2026-05-17T09:53:14Z`.
- `customer_sessions.archive_status` for `f013...` is `ready`.
- `5dee...` is marked completed/superseded.

---

## Patch 12 — Local Project Path Registry and Repair Helpers

- Status: applied and documented
- Date: 2026-05-17
- Migration: `http-generic-api/migrations/078_sprint61_local_project_path_registry.sql`
- Guide: `docs/local-project-path-governance.md`

### Scope

Admins can record and update the local project path for each user/device/project in SQL, then use governed helpers to plan a move, confirm it, or mark the path as repair-required. A separate local repair script can correct incomplete manual moves on the user's device.

### SQL tables

```text
local_project_path_registry
local_project_path_events
local_project_path_repair_runs
```

### Files added

- `http-generic-api/scripts/local-project-path-helper.mjs` — SQL-backed admin helper for list/upsert/plan-move/confirm-move/repair-required/archive.
- `http-generic-api/scripts/local-project-path-repair.mjs` — device-side local repair script that copies missing files only and never deletes the source path.
- `docs/local-project-path-governance.md` — operating guide.

### Admin aliases

Built-in `admin_control` shell aliases:

```text
local_project_path_helper_dry_run
local_project_path_helper_apply
```

The dry-run alias rejects `--apply` and the apply alias rejects `--dry-run`.

### Runtime behavior

- DB helper defaults to dry-run.
- Apply-mode DB helper writes only to `local_project_path_*` tables.
- Device repair script defaults to dry-run.
- Device repair apply-mode copies missing files only, reports conflicts, and never deletes the source path.
- Local path registry is explicitly not a backup certification.

### Verification

- Tables created live in SQL.
- `admin_control` schema updated to describe local project path aliases.
- Documentation linked from `deployment_parity_checklist.md`.
- Essam `growth-intelligence-os` path registered and validated: `D:\\Nagy\\Multi-Business-Multi-Role-Growth-Intelligence-OS`.
- Essam `local-connector` path registered and validated: `C:\\mad4b-connector`.
- Local connector shell aliases added and tested on the Essam device: `local_disk_list`, `local_dir_list`, and `local_file_search`.
- `local_dir_list` verified the main repo markers including `.git`, `package.json`, `http-generic-api`, and `local-connector`.
- `local_file_search` found the main repo `package.json`.

---

## Patch 13 — Local Project Path Access Policy

- Status: applied and documented
- Date: 2026-05-17
- Migration: `http-generic-api/migrations/079_sprint61_local_project_path_access_policy.sql`

### Scope

Local project paths now carry explicit ownership/access policy fields. Tenant/user access is allowed only for separately registered tenant-owned or user/device-owned paths. Platform admin paths remain admin-only.

### SQL fields added

```text
owner_scope = platform | tenant | user | device
allowed_subject_scope = admin | tenant_admin | user_owner | none
allowed_operations_json = JSON array
```

### Current policy

```text
project_key = growth-intelligence-os
current_path = D:\\Nagy\\Multi-Business-Multi-Role-Growth-Intelligence-OS
owner_scope = platform
allowed_subject_scope = admin
```

```text
project_key = local-connector
current_path = C:\\mad4b-connector
owner_scope = device
allowed_subject_scope = user_owner
allowed_operations = health, validate, connector_status, connector_repair, bounded_dir_list, bounded_file_search
```

### Tenant rule

A tenant must not access the platform admin repo path. Tenant access is allowed only when a separate row is registered with:

```text
owner_scope = tenant
allowed_subject_scope = tenant_admin
tenant_id = <tenant id>
```

### Files changed

- `http-generic-api/migrations/079_sprint61_local_project_path_access_policy.sql`
- `http-generic-api/scripts/local-project-path-helper.mjs`
- `docs/local-project-path-governance.md`

---

## Patch 14 — Backup & Copy Governance Registry

- Status: governance-only applied; no backup executed
- Date: 2026-05-17
- Migration: `http-generic-api/migrations/080_sprint61_backup_copy_governance.sql`
- Alias schema migration: `http-generic-api/migrations/081_sprint61_backup_governance_alias_schema.sql`
- Guide: `docs/backup-and-copy-governance.md`

### Scope

Created the governance layer for copy locations, backup policies, backup run records, and restore tests. This patch records authority and policy metadata only. It does not dump a database, copy files, upload artifacts, or schedule a backup.

### SQL tables

```text
platform_copy_locations
platform_backup_policies
platform_backup_runs
platform_restore_tests
```

### Seeded copy locations

```text
repo:main:growth-intelligence-os
hostinger:auth.mad4b.com:runtime
local:Essam:growth-intelligence-os
local:Essam:local-connector
```

### Helper aliases

Built-in `admin_control` shell aliases:

```text
backup_copy_governance_helper_dry_run
backup_copy_governance_helper_apply
```

These aliases are record-only governance helpers. They do not perform backup execution. The dry-run alias rejects `--apply`, and the apply alias rejects `--dry-run`.

### Backup boundary

No apply-mode backup may run until an approved policy exists with source, destination, retention, encryption, checksum, approval, and restore-test requirements.

---

## Patch 15 — Backup Policy Draft Templates

- Status: draft metadata applied; no backup executed
- Date: 2026-05-17
- Migration: `http-generic-api/migrations/082_sprint61_backup_policy_templates.sql`
- Guide: `docs/backup-and-copy-governance.md`

### Scope

Added logical database and pending encrypted destination copy locations, plus draft backup policies for the primary database and main code branch. Also recorded dry-run governance rows. This patch does not dump a database, copy files, upload artifacts, or schedule a backup.

### Copy locations added

```text
database:mysql:auth-runtime-primary
object-storage:pending:encrypted-backups
```

### Draft policies added

```text
policy:platform-db-primary:manual-draft
backup_kind = database
status = draft
allowed_executor = none
encryption_required = true
checksum_required = true
approval_required = true
restore_test_required = true
```

```text
policy:platform-code-main:snapshot-draft
backup_kind = code
status = draft
allowed_executor = github_actions
checksum_required = true
approval_required = true
restore_test_required = true
```

### Dry-run records

```text
policy:platform-db-primary:manual-draft -> dry_run/planned
policy:platform-code-main:snapshot-draft -> dry_run/planned
```

### Execution boundary

The database policy is intentionally blocked with `allowed_executor=none` until an encrypted destination, approval flow, and restore-test target are selected.

---

## Patch 16 — Backup Approval and Restore-Test Gates

- Status: governance-only applied; no backup or restore executed
- Date: 2026-05-17
- Migration: `http-generic-api/migrations/083_sprint61_backup_approval_restore_gates.sql`
- Guide: `docs/backup-and-copy-governance.md`

### Scope

Added explicit approval tracking and planned restore-test rows for the current draft backup policies. This patch does not approve, execute, or restore any backup.

### SQL table added

```text
platform_backup_approvals
```

### Planned restore tests added

```text
policy:platform-db-primary:manual-draft -> pending://isolated-restore-db-target
policy:platform-code-main:snapshot-draft -> pending://clean-checkout-or-release-restore-target
```

### Approval requests added

```text
policy:platform-db-primary:manual-draft -> policy_activation/requested
policy:platform-code-main:snapshot-draft -> policy_activation/requested
```

### Helper actions added

```text
list-approvals
list-restore-tests
```

### Execution boundary

Requested approval is not approval. Both policies remain `draft`; no apply-mode backup may run until destination, approval, checksum, retention, and restore-test target are finalized.

---

## Patch 17 — Essam Local Backup Destination

- Status: destination registered; no backup executed
- Date: 2026-05-17
- Migration: `http-generic-api/migrations/084_sprint61_local_backup_destination.sql`
- Guide: `docs/backup-and-copy-governance.md`

### Scope

Registered the admin-selected local backup destination on the Essam device and linked existing draft policies to it. This patch does not dump a database, copy files, upload artifacts, approve a policy, or execute a restore test.

### Destination

```text
location_key = local:Essam:growth-os-backups
path = D:\\Nagy\\Growth-0s-Backups
owner_scope = platform
risk_level = critical
status = active
```

### Policy updates

```text
policy:platform-db-primary:manual-draft -> destination local:Essam:growth-os-backups
policy:platform-code-main:snapshot-draft -> destination local:Essam:growth-os-backups
```

### Restore-test target plans

```text
policy:platform-db-primary:manual-draft -> D:\\Nagy\\Growth-0s-Backups\\restore-tests\\db-isolated
policy:platform-code-main:snapshot-draft -> D:\\Nagy\\Growth-0s-Backups\\restore-tests\\code-clean-checkout
```

### Execution boundary

The policies remain `draft`. The DB policy remains blocked with `allowed_executor=none`; encrypted artifact format, checksum implementation, and explicit approval are still required before any apply-mode backup.

---

## Patch 18 — Backup Preflight, Manifest, Checksum, and Encryption Contract

- Status: preflight contract applied; no backup executed
- Date: 2026-05-17
- Migration: `http-generic-api/migrations/085_sprint61_backup_preflight_manifest_contract.sql`
- Guide: `docs/backup-and-copy-governance.md`

### Scope

Added explicit artifact contract fields, run preflight metadata, and a manifest table. This patch does not dump databases, copy files, encrypt artifacts, upload artifacts, or execute restore tests.

### SQL changes

Policy/run fields added:

```text
artifact_format
encryption_scheme
checksum_algorithm
manifest_schema_version
preflight_required
preflight_status
preflight_json
```

Table added:

```text
platform_backup_artifact_manifests
```

### Current contracts

```text
policy:platform-db-primary:manual-draft
artifact_format = sql_dump
encryption_scheme = platform_managed
checksum_algorithm = sha256
preflight_status = blocked
blockers = policy_not_active, approval_not_granted, executor_not_enabled
```

```text
policy:platform-code-main:snapshot-draft
artifact_format = zip
encryption_scheme = zip_aes256
checksum_algorithm = sha256
preflight_status = blocked
blockers = policy_not_active, approval_not_granted
```

### Helper action added

```text
preflight-policy
```

### Execution boundary

Preflight is a gate only. A blocked preflight must prevent apply-mode execution. No backup artifact exists until an approved executor writes one, records a manifest, verifies checksum, and passes restore-test requirements.

---

## Patch 19 — Backup Approval Workflow Contract

- Status: approval workflow applied; no policy approved or activated; no backup executed
- Date: 2026-05-17
- Migration: `http-generic-api/migrations/086_sprint61_backup_approval_workflow_contract.sql`
- Guide: `docs/backup-and-copy-governance.md`

### Scope

Added approval decision metadata, activation gate metadata, and helper actions for deciding approvals and activating policies only after gates pass. This patch does not approve any policy, activate any policy, dump databases, copy files, create artifacts, or run restore tests.

### SQL changes

Fields added to `platform_backup_approvals`:

```text
decision_token
decision_source
policy_snapshot_json
```

Fields added to `platform_backup_policies`:

```text
activation_gate_status
activation_gate_json
```

### Helper actions added

```text
decide-approval
evaluate-activation-gate
activate-policy
```

### Guardrails

```text
approval requires --decision-token=APPROVE:<policy_key>
activation requires --activation-token=ACTIVATE:<policy_key>
activation requires activation_gate_status=ready
```

### Current state

Both draft policies remain blocked and unapproved. No backup artifact exists.

---

## Patch 20 — Backup Executor Guard

- Status: executor guard added; no backup executed
- Date: 2026-05-17
- Script: `http-generic-api/scripts/backup-executor-guard.mjs`
- Alias schema migration: `http-generic-api/migrations/087_sprint61_backup_executor_guard_alias_schema.sql`
- Guide: `docs/backup-and-copy-governance.md`

### Scope

Added a guarded executor skeleton that evaluates execution gates, generates artifact/manifest plans, and can record metadata-only run records. It does not create backup artifacts, dump databases, copy files, encrypt artifacts, or run restore tests.

### Admin aliases

```text
backup_executor_guard_dry_run
backup_executor_guard_apply
```

### Actions

```text
plan-run
prepare-run-record
execute
```

### Execution behavior

- `plan-run` returns planned artifact and manifest refs only.
- `prepare-run-record` can record metadata only.
- `execute` returns `backup_execution_blocked` while governance blockers exist.
- Apply-mode artifact creation is intentionally not implemented in the guard.

### Current blockers

```text
policy:platform-db-primary:manual-draft -> policy_not_active, activation_gate_not_ready, preflight_not_promoted_to_active, approval_not_granted, executor_not_enabled, database_executor_must_be_local_connector_or_explicitly_changed
policy:platform-code-main:snapshot-draft -> policy_not_active, activation_gate_not_ready, preflight_not_promoted_to_active, approval_not_granted
```

### Boundary

A reviewed executor implementation must be added separately before any artifact can be created.

---

## Patch 21 — Local Backup Destination Layout

- Status: destination folders prepared; no backup artifact created
- Date: 2026-05-17
- Script: `http-generic-api/scripts/local-backup-destination-prepare.mjs`
- Guide: `docs/backup-and-copy-governance.md`

### Scope

Prepared the selected local destination on the Essam device with governance folders and a destination marker file. This patch does not dump databases, copy source files, create backup artifacts, encrypt artifacts, approve policies, or run restore tests.

### Local destination layout

```text
D:\\Nagy\\Growth-0s-Backups\\artifacts
D:\\Nagy\\Growth-0s-Backups\\manifests
D:\\Nagy\\Growth-0s-Backups\\restore-tests
D:\\Nagy\\Growth-0s-Backups\\restore-tests\\db-isolated
D:\\Nagy\\Growth-0s-Backups\\restore-tests\\code-clean-checkout
D:\\Nagy\\Growth-0s-Backups\\logs
D:\\Nagy\\Growth-0s-Backups\\.growth-os-backup-destination.json
```

### DB update

`platform_copy_locations.validation_json` for `local:Essam:growth-os-backups` now records:

```text
prepared_layout = true
no_backup_artifact_created = true
required_subdirectories = artifacts, manifests, restore-tests, restore-tests/db-isolated, restore-tests/code-clean-checkout, logs
```

### Boundary

The marker file certifies the folder as a governed destination only. It is not a backup artifact.

---

## Patch 22 — First Actual Code Backup Run

- Status: code backup executed and verified
- Date: 2026-05-17
- Runbook: `docs/backup-run-2026-05-17-code-main.md`
- Guide: `docs/backup-and-copy-governance.md`

### Scope

Executed the first actual code backup from the Essam local repo path into the governed local backup destination. This patch created a code ZIP artifact, manifest JSON, and restore-test extraction. No database dump was created.

### Backup artifact

```text
policy = policy:platform-code-main:snapshot-draft
run_id = fa521736-5217-11f1-b256-614c56cd019b
artifact = D:\\Nagy\\Growth-0s-Backups\\artifacts\\growth-os-code-main-85ea6e4f7894-20260517T174320Z.zip
manifest = D:\\Nagy\\Growth-0s-Backups\\manifests\\growth-os-code-main-85ea6e4f7894-20260517T174320Z.manifest.json
checksum_sha256 = 6c99cf7dccdbc8a2f78c9d2971c7056cadebe19a02f2f87e3ed32d0559bd110f
size_bytes = 1907954
file_count = 555
```

### Source

```text
source_path = D:\\Nagy\\Multi-Business-Multi-Role-Growth-Intelligence-OS
source_branch = main
source_commit = 85ea6e4f7894e72e5c35558ceaac13d3f2476932
```

### Restore test

```text
restore_target = D:\\Nagy\\Growth-0s-Backups\\restore-tests\\code-clean-checkout\\growth-os-code-main-85ea6e4f7894-20260517T174320Z
restore_status = passed
validated markers = package.json, http-generic-api, local-connector
```

### DB records

Recorded in:

```text
platform_backup_runs
platform_backup_artifact_manifests
platform_restore_tests
```

### Exclusions

```text
No DB dump
No untracked local files
No plaintext .env
No provider credentials
No OAuth refresh tokens
No service account JSON
```

### Remaining blocked scope

The DB backup policy remains blocked until a reviewed DB executor is implemented with encryption, checksum, manifest, and restore-test flow.

---

## Patch 23 — First Actual Database Backup Run

- Status: encrypted DB backup executed and verified
- Date: 2026-05-17
- Runbook: `docs/backup-run-2026-05-17-db-primary.md`
- Guide: `docs/backup-and-copy-governance.md`

### Scope

Executed the first actual encrypted database backup from the runtime MySQL database into the governed Essam local backup destination. The durable artifact is encrypted with AES-256-GCM and compressed with gzip. A structural restore validation was performed locally, and the plaintext restore-check SQL was removed afterward.

### Backup artifact

```text
policy = policy:platform-db-primary:manual-draft
run_id = 32658583-521c-11f1-b256-614c56cd019b
artifact = D:\\Nagy\\Growth-0s-Backups\\artifacts\\growth-os-db-primary-2026-05-17T18-10-17-164Z.sql.gz.aes256gcm
manifest = D:\\Nagy\\Growth-0s-Backups\\manifests\\growth-os-db-primary-2026-05-17T18-10-17-164Z.manifest.json
recovery_key = D:\\Nagy\\Growth-0s-Backups\\keys\\growth-os-db-primary-2026-05-17T18-10-17-164Z.recovery-key.json
checksum_sha256 = e7ac7a51a4d74d55e31954d55edf659c05ddadbacf73a0f66ea48f902f2f4756
size_bytes = 4633945
```

### Source

```text
database = u338416126_growthOS
table_count = 155
row_count = 39515
```

### Restore validation

```text
restore_target = D:\\Nagy\\Growth-0s-Backups\\restore-tests\\db-isolated\\growth-os-db-primary-2026-05-17T18-10-17-164Z
restore_status = passed
create_table_count = 155
insert_statement_count = 39561
sql_size_bytes = 63802376
plaintext_restore_sql_removed = true
```

### DB records

Recorded in:

```text
platform_backup_runs
platform_backup_artifact_manifests
platform_restore_tests
```

### Security notes

```text
DB credentials were not written to the artifact manifest or runbook.
The recovery key file is required to decrypt the artifact.
The plaintext SQL restore-check file was removed after validation.
```

---

## Patch 24 — First Actual Local n8n Backup Run

- Status: encrypted n8n local backup executed and verified
- Date: 2026-05-17
- Runbook: `docs/backup-run-2026-05-17-n8n-local.md`
- Guide: `docs/backup-and-copy-governance.md`

### Scope

Executed the first actual encrypted backup for the local n8n user data path on the Essam device. The artifact includes `D:\\n8n-data`, including `.n8n/database.sqlite`, `.n8n/database.sqlite-wal`, `.n8n/config`, nodes, storage, and related files. The durable artifact is encrypted with AES-256-GCM. A decrypt + ZIP structure validation was performed, and plaintext validation ZIP was removed afterward.

### Backup artifact

```text
policy = policy:local-n8n-data:manual
run_id = 928af7d1-521e-11f1-b256-614c56cd019b
source = D:\\n8n-data
artifact = D:\\Nagy\\Growth-0s-Backups\\artifacts\\growth-os-n8n-local-2026-05-17T18-25-41-880Z.zip.aes256gcm
manifest = D:\\Nagy\\Growth-0s-Backups\\manifests\\growth-os-n8n-local-2026-05-17T18-25-41-880Z.manifest.json
recovery_key = D:\\Nagy\\Growth-0s-Backups\\keys\\growth-os-n8n-local-2026-05-17T18-25-41-880Z.recovery-key.json
checksum_sha256 = cc3b4819a6c984d51a121446779d8110bedf15f43321deda9785676c5387fbb7
artifact_size_bytes = 13098316
source_size_bytes = 59087745
file_count = 851
```

### Restore validation

```text
restore_target = D:\\Nagy\\Growth-0s-Backups\\restore-tests\\n8n-local\\growth-os-n8n-local-2026-05-17T18-25-41-880Z
restore_status = passed
has_n8n_root = true
has_database_sqlite = true
has_config = true
has_nodes_dir = true
plaintext_validation_zip_removed = true
```

### DB records

Recorded in:

```text
platform_copy_locations
platform_backup_policies
platform_backup_approvals
platform_backup_runs
platform_backup_artifact_manifests
platform_restore_tests
```

### Security notes

```text
n8n local data is sensitive because it can contain encrypted credentials and encryption metadata.
The recovery key file is required to decrypt the artifact.
No plaintext ZIP remains after validation.
```

---

## Patch 25 — Backup and DR Baseline Finalization

- Status: finalized local DR baseline
- Date: 2026-05-17
- Finalization report: `docs/backup-finalization-2026-05-17.md`
- DR runbook: `docs/platform-disaster-recovery-runbook.md`

### Scope

Closed the remaining backup/DR baseline items after the first successful code, database, n8n, and local connector backups.

### Completed

```text
Recovery key ACL hardening applied
Local connector runtime backup executed and verified
Runtime/platform manifest created
DNS/Cloudflare blocker manifest created
Retention policy manifest created
Automation plan manifest created, not enabled
Off-device transfer plan manifest created, pending destination
Temporary DB export cleanup helper added and executed
Temporary server-side DB export directories removed
Platform disaster recovery runbook added
```

### Additional backup artifact

```text
policy = policy:local-connector-runtime:manual
source = C:\\mad4b-connector
artifact = D:\\Nagy\\Growth-0s-Backups\\artifacts\\growth-os-local-connector-2026-05-17T18-48-34-422Z.zip.aes256gcm
checksum_sha256 = 1d3a0a41c77686ff77be358ea6097d1f44a6fb120a557633aa660e7c877747f2
restore_status = passed
```

### Local manifests created

```text
D:\\Nagy\\Growth-0s-Backups\\manifests\\runtime-manifest-2026-05-17.json
D:\\Nagy\\Growth-0s-Backups\\manifests\\dns-cloudflare-manifest-2026-05-17.json
D:\\Nagy\\Growth-0s-Backups\\manifests\\backup-retention-policy-2026-05-17.json
D:\\Nagy\\Growth-0s-Backups\\manifests\\backup-automation-plan-2026-05-17.json
D:\\Nagy\\Growth-0s-Backups\\manifests\\off-device-transfer-plan-2026-05-17.json
```

### Remaining external blockers

```text
Off-device destination still pending
Recovery-key escrow still pending
Cloudflare/DNS export requires authenticated Cloudflare surface
Full isolated DB import and isolated n8n boot test are recommended for full DR certification
Automation intentionally disabled until off-device/key escrow are finalized
```

---

## Patch 26 — Tenant WordPress Validation Collation Repair and Documentation Alignment

- Status: applied, codified, documented
- Date: 2026-06-06
- Production DB repair: applied narrowly to `user_app_connections.connection_id` and `user_app_connections.app_key`
- Runtime code PRs: #684, #690
- Schema codification PR: #699
- Documentation PR: #702
- Incident runbook: `docs/tenant-wordpress-validation-collation-repair-2026-06-06.md`

### Scope

A tenant WordPress CMS connection was `status: active` but remained `validation_status: pending_validation` because the credential-intake status route was blocked by a platform mixed-collation join error. This was a platform validation-path issue, not proof of bad tenant WordPress credentials.

### Confirmed failing joins before repair

```text
user_app_connections.connection_id -> credential_intake_sessions.connection_id
workspace_app_links.connection_id -> user_app_connections.connection_id
app_integrations.app_key -> user_app_connections.app_key
platform_plugin_smoke_certifications.connection_id -> user_app_connections.connection_id
```

The failure class was `ER_CANT_AGGREGATE_2COLLATIONS`.

### Production repair

```sql
ALTER TABLE user_app_connections
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY connection_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY app_key VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;
```

No encrypted credential payload, token, JSON, secret, or user-entered credential field was modified.

### Codified files

```text
http-generic-api/migrations/208_sprint67_user_app_connection_runtime_collation_repair.sql
http-generic-api/test-runtime-collation-safe-joins.mjs
http-generic-api/test-db-collation-guard.mjs
http-generic-api/routes/tenantLifecycleRoutes.js
http-generic-api/appConnectionResolver.js
http-generic-api/platformPluginSmokeRecertification.js
```

### Documentation updates

```text
docs/tenant-wordpress-validation-collation-repair-2026-06-06.md
docs/tenant-gpt-operating-guide.md
GPT_Tenant_Connector_Knowledge.md
deployment_parity_checklist.md
docs/hostinger-node-deploy.md
```

### Verification

```text
previously failing raw joins now execute
credential-intake status reads back the WordPress connection row
release_readiness passed 66/66 after repair
PR #699 CI green and merged
PR #702 CI green and merged
```

### Remaining operational note

Hostinger/LiteSpeed may continue serving an older `SERVICE_VERSION` until process reload. The DB hotfix cleared the live validation blocker immediately; merged code fixes become active after the next production process restart/redeploy.

## Patch 27 - Support Ticket External Delivery Completion Certification

### Scope

Documents and aligns PR #1270 / migration `906_sprint68_ticket_external_delivery_completion_certification.sql`. The patch closes the Support Ticket External Delivery AM-1..AM-16 certification surface while keeping live provider dispatch gated.

### Runtime/API surface

- Route: `POST /admin/support/tickets/{ticket_id}/external-delivery/completion-certification`.
- Tool: `support_ticket_external_delivery_completion_certify`.
- OpenAPI: `http-generic-api/openapi.yaml` documents request, responses, auth, no-send flags, and error envelopes.

### Safety boundary

- No SMTP or nodemailer implementation.
- No webhook/fetch/axios external network call.
- `sandbox` returns no-network mock provider evidence.
- `live_send` remains disabled by default and blocked behind tenant enablement, approval, credential readiness, idempotency, and release readiness gates.
- Responses must include `external_send_performed: false` and `secrets_included: false`.

### Verification

- CI passed on PR #1270 and on `main` after merge.
- Guarded migration apply recorded `906_sprint68_ticket_external_delivery_completion_certification.sql` with 8 statements, preflight pass, zero risk, zero destructive statements, and no secrets.
- This documentation alignment patch updates OpenAPI and the required documentation targets after Docs Agent identified missing contract docs.
## Sprint 69 capability evidence surface contracts

- `312_sprint69_platform_tool_dispatch_integrity_scope_fix.sql` narrows `v_platform_tool_dispatch_integrity` to the declared admin/tenant scope without provider calls, credential reads, external sends, or runtime mutation.
- `314_sprint69_capability_authority_evidence_projection.sql` projects evidence only from active `platform_tool_dispatch_bindings` rows with a named readback policy, then rebuilds capability maturity/gap views without granting dispatch or apply authority.
## Sprint 69 supervisor causal provider certification surface

- `1008_sprint69_supervisor_causal_provider_certification_tool.sql` registers the bounded `supervisor_causal_provider_certification` admin tool. Migration execution itself performs no provider call, credential read, external send/write, or secret return. Runtime certification remains confirmation-gated, no-tool, no-repository-mutation, no-local-execution, bounded-cost, and readback/audit governed.
## Sprint 69 explicit manual delegation surfaces

- `1009_sprint69_optional_manual_agent_delegation_tools.sql` registers explicit, admin-governed manual delegation creation/dispatch/contract tools. Migration execution performs no provider call, credential read, external send/write, or secret return; runtime delegation remains opt-in and confirmation/authorization governed.
- `1010_sprint69_disable_legacy_agent_chain_dispatch_tool.sql` disables the ambiguous legacy dispatch surface and directs callers to `agent_chain_event_dispatch_manual`. It is a guarded registry update only and performs no provider call, credential read, external send/write, or secret return.
## Sprint 69 daily database lifecycle evidence snapshot runtime

- `318_sprint69_database_lifecycle_daily_snapshot_runtime.sql` adds the `database_lifecycle_snapshot_daily` schedule at `0 3 * * *` UTC and an internal-runtime binding for evidence-only snapshot creation.
- Snapshot persistence and the schedule fields `last_readiness_at` and `last_snapshot_id` are committed in one transaction. A same-cycle `FOR UPDATE` readback must match the written snapshot or the transaction rolls back with a stable error code.
- The existing weekly schedule remains `0 3 * * 1` UTC and becomes human review-only. Daily runtime never executes retention actions, archive, delete, drop, truncate, compaction, provider calls, credential reads, external writes, or secret return; `secrets_included=false`.

## Sprint 69 database lifecycle registry upsert Admin tool

- `316_sprint69_database_lifecycle_registry_upsert_admin_tool.sql` registers the bounded `database_table_lifecycle_registry_upsert` Admin tool through `/admin/control` and persists its governed migration authorization metadata.
- Runtime defaults to missing-only dry-run. Missing-only apply requires `APPLY_DATABASE_TABLE_LIFECYCLE_REGISTRY_UPSERT`; existing-row refresh additionally requires `--include-existing` and `APPLY_DATABASE_TABLE_LIFECYCLE_REGISTRY_REFRESH_EXISTING`.
- Apply is transactional and must pass same-cycle readback with `remaining_missing_count=0`. The change performs no provider call, credential payload read, raw-secret return, external send/write, table drop, truncate, delete, archive execution, or compaction; `secrets_included=false`.

## Sprint 69 Capability Vault record-only tool export

- `315_sprint69_capability_vault_record_tool_export.sql` exports the already implemented admin-only `/platform/capability-vault/repo-ingestion-record` route through `admin_platform_endpoint_tools` and binds it to `capability_vault_record_only_same_cycle_v1`. The tool remains confirmation-gated, transactional, audited, idempotent, no-execution, no-install, no-external-send, and no-secret.

## Capability Assurance Graph ΓÇö Migration 314

- http-generic-api/migrations/314_sprint69_capability_assurance_graph.sql adds the canonical capability graph, invocation evidence links, capability-specific resource bindings, generic certifications, provenance, debt, closure threads, and hash-only secret movement evidence.
- Apply remains envelope-gated, additive, no-provider-call, and no-plaintext-secret.
- Local connector recovery enforces `cloudflare_1033_retry_before_repair_v1`: three total bounded health attempts, early stop on pass or authorization-gated reachability, and installer generation only after retry exhaustion. Migration `1015_sprint69_local_connector_transient_retry_policy.sql` registers the blocking SQL policy and updates the governed tool description.

## Durable governed response chunk persistence

- `20260618_governed_tool_response_chunks.sql` adds the durable MySQL authority for oversized governed tool-response continuation while preserving the existing in-process cache as a hot cache.
- `1018_sprint69_governed_response_chunk_schema_reconciliation.sql` aligns pre-existing tables to the durable contract, creates `v_governed_response_chunk_schema_readiness`, registers exact migration reconciliation rules and authorization, and enables the SQL-configured automatic scheduler. Surface-governance closure requires the exact markers `no_provider_call`, `no_credential_payload_read`, `no_raw_secrets`, `no_external_send`, `no_external_write`, and `secrets_included=false`, plus explicit coverage in Docs Agent and change-governance documentation before production bootstrap.
- `governedMigrationReconciliationRuntime.js` connects the existing reconciler to the Dynamic Audit startup/interval cycle under its MySQL advisory lock. It delegates only to `governed-migration-reconciler.mjs`; it never executes raw SQL.
- Automatic apply remains deny-by-default: exact active rule, DB authorization, static preflight `pass`, typed runner confirmation, ledger evidence, and same-cycle schema readback are mandatory. Missing evidence produces blocked or skipped status.
- Runtime rollout must prove schema readiness, record-only reconciliation of the original migration, idempotent second-cycle behavior, SQL persistence before `chunk_id`, cache-miss recovery, Unicode reconstruction, expiry handling, and no-secret enforcement.

## Sprint 69 passive capability-resolution dry-run descriptor

- `315_sprint69_capability_envelope_bootstrap_policy_declaration.sql` closes only the remaining passive POST classification gap for `capability_resolution_dry_run`. It adds `preview_only`, `no_mutation`, and `no_execution` registry metadata without changing envelope create/approve or repository mutation authority.
- Migration execution is registry-only and declares `no_provider_call`, `no_credential_payload_read`, `no_raw_secrets`, `no_external_send`, `no_external_write`, and `secrets_included=false`. Production apply remains governed-runner, authorization, preflight, checksum, typed-confirmation, and same-cycle-readback gated.
