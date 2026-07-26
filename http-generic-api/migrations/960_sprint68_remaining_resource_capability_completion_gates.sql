-- 960_sprint68_remaining_resource_capability_completion_gates.sql
-- Purpose: Complete the remaining F5-L governance surfaces as registry-first,
-- no-secret, after-review gates. This migration does not bypass existing repo
-- mutation tools, does not enable direct main writes, and does not expose file
-- content or credentials.

INSERT INTO platform_resource_adapters (
  adapter_key, resource_type, provider_key, adapter_kind, installed_tool_key,
  identity_resolver_key, metadata_normalizer_key, content_policy,
  supports_plan, supports_read, supports_write, status, metadata_json
)
VALUES
  ('github.file.patch_apply.adapter', 'github_file', 'github', 'composite', 'repo_patch_apply',
   'github_file_ref_v1', 'github_file_patch_apply_summary_v1', 'content_hash_only_after_review',
   1, 0, 1, 'planned',
   JSON_OBJECT('sprint','F5','delegates_to','repo_patch_apply','requires_capability_envelope',true,'requires_typed_confirmation',true,'requires_same_cycle_patch_plan',true,'requires_readback',true,'direct_main_write_allowed',false,'secrets_included',false)),
  ('github.pull_request.create.adapter', 'github_pull_request', 'github', 'composite', NULL,
   'github_pr_ref_v1', 'github_pr_create_summary_v1', 'metadata_only_after_review',
   1, 0, 1, 'planned',
   JSON_OBJECT('sprint','F6','delegates_to','github_rest_pr_create_after_review','requires_capability_envelope',true,'requires_typed_confirmation',true,'requires_branch_readiness',true,'requires_readback',true,'draft_default',true,'secrets_included',false)),
  ('mysql.resource.governance.adapter', 'mysql_resource', NULL, 'db_adapter', NULL,
   'mysql_resource_ref_v1', 'mysql_resource_governance_summary_v1', 'metadata_only',
   1, 1, 0, 'active',
   JSON_OBJECT('sprint','G','read_only',true,'destructive_changes_allowed',false,'secrets_included',false)),
  ('tenant.workspace.policy_overlay.adapter', 'tenant_workspace_policy_overlay', NULL, 'db_adapter', NULL,
   'tenant_workspace_policy_overlay_ref_v1', 'tenant_workspace_policy_overlay_summary_v1', 'metadata_only',
   1, 1, 0, 'active',
   JSON_OBJECT('sprint','H','tenant_override_requires_binding',true,'workspace_overlay_required_for_tenant_mutation',true,'secrets_included',false)),
  ('dynamic.capability.tool_bus.adapter', 'capability_tool_bus', NULL, 'db_adapter', NULL,
   'capability_tool_bus_ref_v1', 'capability_tool_bus_summary_v1', 'metadata_only',
   1, 1, 0, 'active',
   JSON_OBJECT('sprint','I','descriptor_first',true,'collision_audit_required',true,'runtime_apply_blocked_by_default',true,'secrets_included',false)),
  ('platform.plugin.productization.adapter', 'platform_plugin_productization', 'platform_plugin_runtime', 'db_adapter', NULL,
   'platform_plugin_productization_ref_v1', 'platform_plugin_productization_summary_v1', 'metadata_only',
   1, 1, 0, 'active',
   JSON_OBJECT('sprint','J','catalog_ready_surface',true,'tenant_exposure_requires_grant',true,'secrets_included',false)),
  ('resource.recertification.scheduler.adapter', 'resource_recertification', NULL, 'db_adapter', NULL,
   'resource_recertification_ref_v1', 'resource_recertification_summary_v1', 'metadata_only',
   1, 1, 0, 'active',
   JSON_OBJECT('sprint','K','scheduled_recertification_registry_ready',true,'apply_mutations_allowed',false,'secrets_included',false)),
  ('governed.response_chunk.persistence.adapter', 'governed_response_chunk', NULL, 'db_adapter', NULL,
   'governed_response_chunk_ref_v1', 'governed_response_chunk_summary_v1', 'content_hash_only',
   1, 1, 0, 'active',
   JSON_OBJECT('sprint','L','durable_chunk_table_created',true,'chunk_body_not_indexed',true,'ttl_required',true,'secrets_included',false))
ON DUPLICATE KEY UPDATE
  provider_key=VALUES(provider_key), adapter_kind=VALUES(adapter_kind), installed_tool_key=VALUES(installed_tool_key),
  identity_resolver_key=VALUES(identity_resolver_key), metadata_normalizer_key=VALUES(metadata_normalizer_key),
  content_policy=VALUES(content_policy), supports_plan=VALUES(supports_plan), supports_read=VALUES(supports_read),
  supports_write=VALUES(supports_write), status=VALUES(status), metadata_json=VALUES(metadata_json), updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_resource_recipes (
  recipe_key, resource_type, operation_key, adapter_key, risk_class, mode,
  read_only, requires_dry_run, requires_capability_envelope, requires_typed_confirmation,
  requires_same_cycle_readback, input_schema_json, output_schema_json, policy_json,
  graph_write_policy, engine_key, status, notes
)
VALUES
  ('github.file.patch_apply_after_review', 'github_file', 'patch_apply_after_review', 'github.file.patch_apply.adapter', 'write', 'apply',
   0, 1, 1, 1, 1,
   JSON_OBJECT('type','object','required',JSON_ARRAY('path','patch_plan_sha256','typed_confirmation','capability_envelope_id'),'properties',JSON_OBJECT('owner',JSON_OBJECT('type','string'),'repo',JSON_OBJECT('type','string'),'branch',JSON_OBJECT('type','string'),'path',JSON_OBJECT('type','string'),'patch_plan_sha256',JSON_OBJECT('type','string'),'typed_confirmation',JSON_OBJECT('type','string'),'capability_envelope_id',JSON_OBJECT('type','string'))),
   JSON_OBJECT('type','object','properties',JSON_OBJECT('ok',JSON_OBJECT('type','boolean'),'classification',JSON_OBJECT('type','string'),'write_performed',JSON_OBJECT('type','boolean'),'readback_verified',JSON_OBJECT('type','boolean'),'secrets_included',JSON_OBJECT('type','boolean'))),
   JSON_OBJECT('provider_call_allowed_after_gate',true,'delegates_to','repo_patch_apply','direct_main_write_allowed',false,'requires_same_cycle_patch_plan_hash',true,'requires_branch_readiness',true,'requires_readback',true,'file_content_returned',false,'secrets_included',false),
   'none', 'resource_authority_engine', 'planned',
   'F5 after-review patch apply gate. Registry complete but apply remains blocked until positive delegated repo_patch_apply smoke certifies readback.'),
  ('github.pull_request.create_after_review', 'github_pull_request', 'create_after_review', 'github.pull_request.create.adapter', 'write', 'apply',
   0, 1, 1, 1, 1,
   JSON_OBJECT('type','object','required',JSON_ARRAY('head_branch','base_branch','title','typed_confirmation','capability_envelope_id'),'properties',JSON_OBJECT('owner',JSON_OBJECT('type','string'),'repo',JSON_OBJECT('type','string'),'head_branch',JSON_OBJECT('type','string'),'base_branch',JSON_OBJECT('type','string'),'title',JSON_OBJECT('type','string'),'draft',JSON_OBJECT('type','boolean'),'typed_confirmation',JSON_OBJECT('type','string'),'capability_envelope_id',JSON_OBJECT('type','string'))),
   JSON_OBJECT('type','object','properties',JSON_OBJECT('ok',JSON_OBJECT('type','boolean'),'classification',JSON_OBJECT('type','string'),'pull_request_created',JSON_OBJECT('type','boolean'),'readback_verified',JSON_OBJECT('type','boolean'),'secrets_included',JSON_OBJECT('type','boolean'))),
   JSON_OBJECT('provider_call_allowed_after_gate',true,'draft_default',true,'requires_branch_readiness',true,'requires_ci_or_explicit_override',true,'requires_readback',true,'direct_main_write_allowed',false,'secrets_included',false),
   'none', 'resource_authority_engine', 'planned',
   'F6 after-review PR create gate. Registry complete but dispatch remains blocked until dedicated PR-create smoke is certified.'),
  ('mysql.resource.governance_report', 'mysql_resource', 'governance_report', 'mysql.resource.governance.adapter', 'diagnostic', 'inspect',
   1, 1, 0, 0, 0,
   JSON_OBJECT('type','object','properties',JSON_OBJECT('scope',JSON_OBJECT('type','string'))),
   JSON_OBJECT('type','object','properties',JSON_OBJECT('ok',JSON_OBJECT('type','boolean'),'classification',JSON_OBJECT('type','string'),'secrets_included',JSON_OBJECT('type','boolean'))),
   JSON_OBJECT('destructive_changes_allowed',false,'migration_ledger_required',true,'readback_required_for_apply',true,'secrets_included',false),
   'summary_node', 'resource_authority_engine', 'active',
   'G MySQL resource governance diagnostic surface; no destructive SQL enabled.'),
  ('tenant.workspace.policy_overlay_report', 'tenant_workspace_policy_overlay', 'policy_overlay_report', 'tenant.workspace.policy_overlay.adapter', 'diagnostic', 'inspect',
   1, 1, 0, 0, 0,
   JSON_OBJECT('type','object','properties',JSON_OBJECT('tenant_id',JSON_OBJECT('type','string'),'workspace_id',JSON_OBJECT('type','string'))),
   JSON_OBJECT('type','object','properties',JSON_OBJECT('ok',JSON_OBJECT('type','boolean'),'classification',JSON_OBJECT('type','string'),'secrets_included',JSON_OBJECT('type','boolean'))),
   JSON_OBJECT('tenant_mutation_requires_workspace_overlay',true,'platform_admin_read_allowed',true,'tenant_cross_scope_blocked',true,'secrets_included',false),
   'summary_node', 'resource_authority_engine', 'active',
   'H tenant/workspace policy overlay readiness surface.'),
  ('dynamic.capability.tool_bus.readiness_report', 'capability_tool_bus', 'readiness_report', 'dynamic.capability.tool_bus.adapter', 'diagnostic', 'inspect',
   1, 1, 0, 0, 0,
   JSON_OBJECT('type','object','properties',JSON_OBJECT('tool_key',JSON_OBJECT('type','string'))),
   JSON_OBJECT('type','object','properties',JSON_OBJECT('ok',JSON_OBJECT('type','boolean'),'classification',JSON_OBJECT('type','string'),'secrets_included',JSON_OBJECT('type','boolean'))),
   JSON_OBJECT('descriptor_first',true,'collision_audit_required',true,'runtime_apply_blocked_by_default',true,'secrets_included',false),
   'summary_node', 'resource_authority_engine', 'active',
   'I Dynamic Capability Tool Bus readiness surface.'),
  ('platform.plugin.productization.readiness_report', 'platform_plugin_productization', 'readiness_report', 'platform.plugin.productization.adapter', 'diagnostic', 'inspect',
   1, 1, 0, 0, 0,
   JSON_OBJECT('type','object','properties',JSON_OBJECT('plugin_key',JSON_OBJECT('type','string'))),
   JSON_OBJECT('type','object','properties',JSON_OBJECT('ok',JSON_OBJECT('type','boolean'),'classification',JSON_OBJECT('type','string'),'secrets_included',JSON_OBJECT('type','boolean'))),
   JSON_OBJECT('catalog_ready_surface',true,'tenant_exposure_requires_grant',true,'private_runtime_certification_required',true,'secrets_included',false),
   'summary_node', 'resource_authority_engine', 'active',
   'J Platform Plugin catalog/productization readiness surface.'),
  ('resource.recertification.scheduler_readiness', 'resource_recertification', 'scheduler_readiness', 'resource.recertification.scheduler.adapter', 'diagnostic', 'inspect',
   1, 1, 0, 0, 0,
   JSON_OBJECT('type','object','properties',JSON_OBJECT('surface_key',JSON_OBJECT('type','string'))),
   JSON_OBJECT('type','object','properties',JSON_OBJECT('ok',JSON_OBJECT('type','boolean'),'classification',JSON_OBJECT('type','string'),'secrets_included',JSON_OBJECT('type','boolean'))),
   JSON_OBJECT('scheduled_recertification_ready',true,'expires_at_supported',true,'apply_mutations_allowed',false,'secrets_included',false),
   'summary_node', 'resource_authority_engine', 'active',
   'K scheduled recertification readiness registry surface.'),
  ('governed.response_chunk.persistence_readiness', 'governed_response_chunk', 'persistence_readiness', 'governed.response_chunk.persistence.adapter', 'diagnostic', 'inspect',
   1, 1, 0, 0, 0,
   JSON_OBJECT('type','object','properties',JSON_OBJECT('chunk_id',JSON_OBJECT('type','string'))),
   JSON_OBJECT('type','object','properties',JSON_OBJECT('ok',JSON_OBJECT('type','boolean'),'classification',JSON_OBJECT('type','string'),'secrets_included',JSON_OBJECT('type','boolean'))),
   JSON_OBJECT('durable_table_created',true,'ttl_required',true,'content_hash_indexed',true,'secret_policy','redacted_input_only','secrets_included',false),
   'none', 'resource_authority_engine', 'active',
   'L durable response chunk persistence readiness surface. Runtime fallback wiring is intentionally separate from table creation.')
ON DUPLICATE KEY UPDATE
  operation_key=VALUES(operation_key), adapter_key=VALUES(adapter_key), risk_class=VALUES(risk_class), mode=VALUES(mode),
  read_only=VALUES(read_only), requires_dry_run=VALUES(requires_dry_run), requires_capability_envelope=VALUES(requires_capability_envelope),
  requires_typed_confirmation=VALUES(requires_typed_confirmation), requires_same_cycle_readback=VALUES(requires_same_cycle_readback),
  input_schema_json=VALUES(input_schema_json), output_schema_json=VALUES(output_schema_json), policy_json=VALUES(policy_json),
  graph_write_policy=VALUES(graph_write_policy), engine_key=VALUES(engine_key), status=VALUES(status), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

INSERT INTO capability_apply_authorization_policy_registry (
  policy_key, app_key, capability_key, operation_intent, runtime_surface, status,
  allow_external_write, allow_credential_binding, allow_no_credential_binding,
  requires_ready_for_dispatch, requires_dispatch_allowed, requires_zero_blocking_gaps,
  requires_audit_evidence, requires_readback, requires_typed_confirmation, requires_same_cycle_dry_run,
  allowed_source_tiers_json, policy_json, notes
)
VALUES
  ('github_file_patch_apply_after_review_v1', 'github', 'github_file_patch_apply', 'github.file.patch_apply_after_review', 'repo_patch_apply', 'active',
   1, 0, 1, 1, 1, 1, 1, 1, 1, 1,
   JSON_ARRAY('platform_managed_fallback'),
   JSON_OBJECT('delegates_to','repo_patch_apply','direct_main_write_allowed',false,'requires_patch_plan_sha256',true,'requires_branch_readiness',true,'requires_readback',true,'file_content_returned',false,'secrets_included',false),
   'F5 policy: GitHub file patch apply can only be delegated to existing repo_patch_apply after review, envelope, typed confirmation, dry-run hash, audit evidence, and readback.'),
  ('github_pull_request_create_after_review_v1', 'github', 'github_pull_request_create', 'github.pull_request.create_after_review', 'github_pr_create_after_review', 'active',
   1, 0, 1, 1, 1, 1, 1, 1, 1, 1,
   JSON_ARRAY('platform_managed_fallback'),
   JSON_OBJECT('draft_default',true,'requires_branch_readiness',true,'requires_ci_or_explicit_override',true,'requires_readback',true,'direct_main_write_allowed',false,'secrets_included',false),
   'F6 policy: PR creation requires branch readiness, envelope approval, typed confirmation, and same-cycle PR readback before dispatch is allowed.'),
  ('mysql_resource_governance_apply_block_v1', 'mysql', 'mysql_resource_governance', 'mysql.resource.governance_apply', 'governed_resource_run', 'active',
   0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
   JSON_ARRAY('platform_managed_fallback'),
   JSON_OBJECT('destructive_changes_allowed',false,'migration_ledger_required',true,'requires_preflight',true,'secrets_included',false),
   'G policy: MySQL resource mutations remain blocked unless implemented through governed migrations with preflight and ledger.'),
  ('tenant_workspace_overlay_apply_block_v1', 'platform_orchestration', 'tenant_workspace_policy_overlay', 'tenant.workspace.policy_overlay_apply', 'governed_resource_run', 'active',
   0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
   JSON_ARRAY('platform_managed_fallback'),
   JSON_OBJECT('tenant_cross_scope_blocked',true,'workspace_binding_required',true,'secrets_included',false),
   'H policy: tenant/workspace-scoped mutations require explicit authority overlay and remain blocked by default.'),
  ('dynamic_capability_tool_bus_apply_block_v1', 'platform_orchestration', 'dynamic_capability_tool_bus', 'dynamic.capability.tool_bus_apply', 'governed_resource_run', 'active',
   0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
   JSON_ARRAY('platform_managed_fallback'),
   JSON_OBJECT('descriptor_first',true,'collision_audit_required',true,'apply_blocked_by_default',true,'secrets_included',false),
   'I policy: Tool Bus productization requires descriptor/collision audit before apply.'),
  ('platform_plugin_productization_apply_block_v1', 'platform_plugin_runtime', 'platform_plugin_productization', 'platform.plugin.productization_apply', 'governed_resource_run', 'active',
   0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
   JSON_ARRAY('platform_managed_fallback'),
   JSON_OBJECT('tenant_exposure_requires_grant',true,'private_runtime_certification_required',true,'apply_blocked_by_default',true,'secrets_included',false),
   'J policy: plugin productization exposure requires certification and grants before apply.'),
  ('resource_recertification_scheduler_apply_block_v1', 'platform_orchestration', 'resource_recertification_scheduler', 'resource.recertification.scheduler_apply', 'governed_resource_run', 'active',
   0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
   JSON_ARRAY('platform_managed_fallback'),
   JSON_OBJECT('recertification_read_only_tick',true,'mutation_blocked_by_default',true,'secrets_included',false),
   'K policy: recertification scheduling is readiness-only until a dedicated tick runner is certified.'),
  ('governed_response_chunk_persistence_apply_block_v1', 'platform_orchestration', 'governed_response_chunk_persistence', 'governed.response_chunk.persistence_apply', 'governed_response_chunks', 'active',
   0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
   JSON_ARRAY('platform_managed_fallback'),
   JSON_OBJECT('durable_table_created',true,'runtime_read_fallback_pending',true,'ttl_required',true,'secrets_included',false),
   'L policy: durable chunk persistence table is created; runtime fallback wiring remains blocked until code-level smoke certifies it.')
ON DUPLICATE KEY UPDATE
  app_key=VALUES(app_key), capability_key=VALUES(capability_key), operation_intent=VALUES(operation_intent), runtime_surface=VALUES(runtime_surface),
  status=VALUES(status), allow_external_write=VALUES(allow_external_write), allow_credential_binding=VALUES(allow_credential_binding),
  allow_no_credential_binding=VALUES(allow_no_credential_binding), requires_ready_for_dispatch=VALUES(requires_ready_for_dispatch),
  requires_dispatch_allowed=VALUES(requires_dispatch_allowed), requires_zero_blocking_gaps=VALUES(requires_zero_blocking_gaps),
  requires_audit_evidence=VALUES(requires_audit_evidence), requires_readback=VALUES(requires_readback),
  requires_typed_confirmation=VALUES(requires_typed_confirmation), requires_same_cycle_dry_run=VALUES(requires_same_cycle_dry_run),
  allowed_source_tiers_json=VALUES(allowed_source_tiers_json), policy_json=VALUES(policy_json), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

INSERT INTO runtime_dispatch_certification_registry (
  certification_key, surface_key, surface_family, tool_or_action_key, risk_class,
  certification_status, smoke_strategy, dispatch_allowed, apply_allowed,
  requires_resource_authority, requires_dry_run, requires_audit_evidence, requires_readback,
  last_evidence_ref, last_certified_at, notes
)
VALUES
  ('github_file_patch_apply_after_review', 'github.file.patch_apply_after_review', 'resource_recipe_runtime', 'repo_patch_apply', 'high',
   'after_review_gate_registered_positive_smoke_pending', 'Delegated repo_patch_apply positive smoke must prove envelope, typed confirmation, branch readback, no direct main write, file_content_returned=false, secrets=false.', 0, 0, 1, 1, 1, 1, 'migration:960:F5_gate_registered', CURRENT_TIMESTAMP, 'F5 registry complete; apply blocked until positive delegated smoke.'),
  ('github_pull_request_create_after_review', 'github.pull_request.create_after_review', 'resource_recipe_runtime', 'github_pr_create_after_review', 'high',
   'after_review_gate_registered_positive_smoke_pending', 'PR create smoke must create draft PR from governed branch, read it back, close/delete smoke branch if disposable, and prove secrets=false.', 0, 0, 1, 1, 1, 1, 'migration:960:F6_gate_registered', CURRENT_TIMESTAMP, 'F6 registry complete; dispatch blocked until dedicated PR create surface is implemented and smoked.'),
  ('mysql_resource_governance_readiness', 'mysql.resource.governance_report', 'resource_recipe_runtime', 'governed_resource_run', 'medium',
   'readiness_surface_registered', 'Readback view must show non-destructive MySQL governance policy and migration ledger requirement.', 1, 0, 1, 1, 1, 0, 'migration:960:G_readiness_registered', CURRENT_TIMESTAMP, 'G diagnostic/readiness only.'),
  ('tenant_workspace_policy_overlay_readiness', 'tenant.workspace.policy_overlay_report', 'resource_recipe_runtime', 'governed_resource_run', 'medium',
   'readiness_surface_registered', 'Readback view must show tenant/workspace overlay requirements and cross-scope blocking.', 1, 0, 1, 1, 1, 0, 'migration:960:H_readiness_registered', CURRENT_TIMESTAMP, 'H diagnostic/readiness only.'),
  ('dynamic_capability_tool_bus_readiness', 'dynamic.capability.tool_bus.readiness_report', 'resource_recipe_runtime', 'governed_resource_run', 'medium',
   'readiness_surface_registered', 'Descriptor/collision-audit readiness policy is present; apply remains blocked.', 1, 0, 1, 1, 1, 0, 'migration:960:I_readiness_registered', CURRENT_TIMESTAMP, 'I diagnostic/readiness only.'),
  ('platform_plugin_productization_readiness', 'platform.plugin.productization.readiness_report', 'resource_recipe_runtime', 'governed_resource_run', 'medium',
   'readiness_surface_registered', 'Catalog/productization readiness policy is present; tenant exposure requires grants.', 1, 0, 1, 1, 1, 0, 'migration:960:J_readiness_registered', CURRENT_TIMESTAMP, 'J diagnostic/readiness only.'),
  ('resource_recertification_scheduler_readiness', 'resource.recertification.scheduler_readiness', 'resource_recipe_runtime', 'governed_resource_run', 'medium',
   'readiness_surface_registered', 'Recertification surfaces are registry-visible and expire_at-aware; mutation tick remains blocked.', 1, 0, 1, 1, 1, 0, 'migration:960:K_readiness_registered', CURRENT_TIMESTAMP, 'K diagnostic/readiness only.'),
  ('governed_response_chunk_persistence_readiness', 'governed.response_chunk.persistence_readiness', 'resource_recipe_runtime', 'governed_response_chunks', 'medium',
   'durable_table_registered_runtime_fallback_pending', 'Durable chunk table exists; runtime DB fallback must be code-smoked before dispatch depends on it.', 1, 0, 1, 1, 1, 0, 'migration:960:L_table_registered', CURRENT_TIMESTAMP, 'L table/readiness only; runtime memory cache remains active.')
ON DUPLICATE KEY UPDATE
  surface_key=VALUES(surface_key), surface_family=VALUES(surface_family), tool_or_action_key=VALUES(tool_or_action_key), risk_class=VALUES(risk_class),
  certification_status=VALUES(certification_status), smoke_strategy=VALUES(smoke_strategy), dispatch_allowed=VALUES(dispatch_allowed), apply_allowed=VALUES(apply_allowed),
  requires_resource_authority=VALUES(requires_resource_authority), requires_dry_run=VALUES(requires_dry_run), requires_audit_evidence=VALUES(requires_audit_evidence),
  requires_readback=VALUES(requires_readback), last_evidence_ref=VALUES(last_evidence_ref), last_certified_at=VALUES(last_certified_at), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

INSERT INTO execution_policies (
  policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes
)
VALUES
  ('Resource Capability Completion Governance', 'remaining_f5_to_l_completion_gates_v1',
   JSON_OBJECT('status','active','scope',JSON_ARRAY('F5','F6','G','H','I','J','K','L'),'direct_main_write_allowed',false,'dangerous_apply_default','blocked','requires_small_safe_changes',true,'requires_ci',true,'requires_readback',true,'secrets_included',false),
   'TRUE','github_file_patch_apply|github_pr_create|mysql_resource_governance|tenant_workspace_overlay|tool_bus|plugin_productization|recertification|response_chunk_persistence',
   'platform_resource_recipes|capability_apply_authorization_policy_registry|runtime_dispatch_certification_registry|governed_tool_response_chunks','TRUE',
   'Completion umbrella policy. F5/F6 write gates are registered but blocked pending positive smoke. G-L are readiness/diagnostic surfaces.'),
  ('Governed Response Chunk Persistence', 'governed_response_chunk_persistence_v1',
   JSON_OBJECT('status','active','ttl_required',true,'content_hash_required',true,'secrets_policy','no_secret_chunk_storage_without_redaction','runtime_fallback_pending',true,'secrets_included',false),
   'TRUE','response_chunk_read|tool_response_chunking|durable_chunk_persistence','gptToolsRoutes|governed_tool_response_chunks','TRUE',
   'Creates durable table and policy for future chunk persistence; runtime DB fallback remains a follow-up code-smoked gate.')
ON DUPLICATE KEY UPDATE
  policy_value=VALUES(policy_value), active=VALUES(active), execution_scope=VALUES(execution_scope), affects_layer=VALUES(affects_layer), blocking=VALUES(blocking), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS governed_tool_response_chunks (
  chunk_id varchar(64) NOT NULL,
  source_tool_key varchar(191) NULL,
  response_sha256 char(64) NOT NULL,
  response_bytes int unsigned NOT NULL DEFAULT 0,
  response_json longtext NOT NULL,
  cursor_policy varchar(64) NOT NULL DEFAULT 'byte_cursor_v1',
  redaction_status varchar(64) NOT NULL DEFAULT 'redacted_or_non_secret',
  secrets_included tinyint(1) NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamp NOT NULL,
  PRIMARY KEY (chunk_id),
  KEY idx_governed_tool_response_chunks_expiry (expires_at),
  KEY idx_governed_tool_response_chunks_tool_created (source_tool_key, created_at),
  KEY idx_governed_tool_response_chunks_sha (response_sha256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW v_remaining_resource_capability_completion_readiness AS
SELECT 'F5' AS sprint, 'github.file.patch_apply_after_review' AS surface_key, certification_status, dispatch_allowed, apply_allowed, requires_dry_run, requires_readback, 0 AS secrets_included
  FROM runtime_dispatch_certification_registry WHERE certification_key='github_file_patch_apply_after_review'
UNION ALL
SELECT 'F6', 'github.pull_request.create_after_review', certification_status, dispatch_allowed, apply_allowed, requires_dry_run, requires_readback, 0
  FROM runtime_dispatch_certification_registry WHERE certification_key='github_pull_request_create_after_review'
UNION ALL
SELECT 'G', 'mysql.resource.governance_report', certification_status, dispatch_allowed, apply_allowed, requires_dry_run, requires_readback, 0
  FROM runtime_dispatch_certification_registry WHERE certification_key='mysql_resource_governance_readiness'
UNION ALL
SELECT 'H', 'tenant.workspace.policy_overlay_report', certification_status, dispatch_allowed, apply_allowed, requires_dry_run, requires_readback, 0
  FROM runtime_dispatch_certification_registry WHERE certification_key='tenant_workspace_policy_overlay_readiness'
UNION ALL
SELECT 'I', 'dynamic.capability.tool_bus.readiness_report', certification_status, dispatch_allowed, apply_allowed, requires_dry_run, requires_readback, 0
  FROM runtime_dispatch_certification_registry WHERE certification_key='dynamic_capability_tool_bus_readiness'
UNION ALL
SELECT 'J', 'platform.plugin.productization.readiness_report', certification_status, dispatch_allowed, apply_allowed, requires_dry_run, requires_readback, 0
  FROM runtime_dispatch_certification_registry WHERE certification_key='platform_plugin_productization_readiness'
UNION ALL
SELECT 'K', 'resource.recertification.scheduler_readiness', certification_status, dispatch_allowed, apply_allowed, requires_dry_run, requires_readback, 0
  FROM runtime_dispatch_certification_registry WHERE certification_key='resource_recertification_scheduler_readiness'
UNION ALL
SELECT 'L', 'governed.response_chunk.persistence_readiness', certification_status, dispatch_allowed, apply_allowed, requires_dry_run, requires_readback, 0
  FROM runtime_dispatch_certification_registry WHERE certification_key='governed_response_chunk_persistence_readiness';
