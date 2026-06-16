-- Sprint 69: Governed Repository Engine V6.
-- Scope: tenant-safe scope/provider authority, deep read-only PR intelligence, non-executed mutation plans, and one action-specific advisory-comment apply path.
-- Safety: reports/plans are read-only; advisory-comment apply requires exact recipe intent, authority, capability approval, run reservation, audit, and readback. Other mutations remain planned. No credential payloads or secrets.

CREATE TABLE IF NOT EXISTS `repository_mutation_plans_v6` (
  `plan_id` VARCHAR(36) NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(36) NULL,
  `workspace_id` VARCHAR(64) NULL,
  `user_id` VARCHAR(64) NULL,
  `resource_uri` VARCHAR(512) NOT NULL,
  `report_sha256` CHAR(64) NOT NULL,
  `plan_sha256` CHAR(64) NOT NULL,
  `plan_json` LONGTEXT NOT NULL,
  `status` ENUM('approval_required','approved','dispatching','write_confirmed','applied','readback_verified','readback_failed','failed_prewrite','unknown_provider_outcome','blocked','expired','cancelled') NOT NULL DEFAULT 'approval_required',
  `approval_hold_id` VARCHAR(36) NULL,
  `capability_envelope_id` VARCHAR(36) NULL,
  `expires_at` DATETIME NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_repo_v6_plan_scope` (`tenant_id`,`workspace_id`,`user_id`),
  KEY `idx_repo_v6_plan_resource` (`resource_uri`(191)),
  KEY `idx_repo_v6_plan_status` (`status`,`created_at`)
);

CREATE TABLE IF NOT EXISTS `repository_mutation_runs_v6` (
  `run_id` VARCHAR(36) NOT NULL PRIMARY KEY,
  `plan_id` VARCHAR(36) NOT NULL,
  `plan_item_id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NULL,
  `workspace_id` VARCHAR(64) NULL,
  `user_id` VARCHAR(64) NULL,
  `resource_uri` VARCHAR(512) NOT NULL,
  `recipe_key` VARCHAR(128) NOT NULL,
  `pr_number` INT NULL,
  `head_sha` VARCHAR(64) NULL,
  `branch_name` VARCHAR(255) NULL,
  `binding_id` VARCHAR(36) NOT NULL,
  `capability_envelope_id` VARCHAR(36) NOT NULL,
  `approval_hold_id` VARCHAR(36) NOT NULL,
  `status` ENUM('dispatching','write_confirmed','readback_verified','readback_failed','failed_prewrite','unknown_provider_outcome') NOT NULL DEFAULT 'dispatching',
  `provider_object_id` VARCHAR(191) NULL,
  `write_json` LONGTEXT NULL,
  `expected_readback_json` LONGTEXT NULL,
  `readback_json` LONGTEXT NULL,
  `error_json` LONGTEXT NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `provider_write_started_at` DATETIME NULL,
  `provider_write_completed_at` DATETIME NULL,
  `readback_completed_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_repo_v6_run_plan_item` (`plan_id`,`plan_item_id`),
  KEY `idx_repo_v6_run_scope` (`tenant_id`,`workspace_id`,`user_id`),
  KEY `idx_repo_v6_run_resource` (`resource_uri`(191)),
  KEY `idx_repo_v6_run_status` (`status`,`created_at`),
  KEY `idx_repo_v6_run_envelope` (`capability_envelope_id`),
  KEY `idx_repo_v6_run_approval` (`approval_hold_id`)
);

INSERT INTO `system_layer_tool_descriptor_source_registry`
  (`source_key`,`module_path`,`descriptor_export`,`handler_resolution_mode`,`tool_count_expected`,`status`,`metadata_json`,`secrets_included`)
VALUES
  ('repository_governance_v6','repositoryGovernanceV6.js','TENANT_REPOSITORY_GOVERNANCE_V6_SYSTEM_TOOLS','handler_name_or_snake_to_camel',6,'active',
   JSON_OBJECT('scope_hierarchy_required',true,'provider_binding_required_for_tenant_connections',true,'deep_read_only_evidence',true,'mutation_plan_only',false,'action_specific_apply_gated',true,'replay_guarded_run_ledger',true,'tenant_exported_tools',JSON_ARRAY('tenant_repository_intelligence_v6_report','tenant_repository_mutation_plan_v6','tenant_repository_mutation_apply_v6','tenant_repository_mutation_readback_v6'),'admin_only_tools',JSON_ARRAY('platform_repository_mutation_authority_binding_create_v6','tenant_repository_governance_v6_readiness_smoke'),'secrets_included',false),0)
ON DUPLICATE KEY UPDATE
  `module_path`=VALUES(`module_path`), `descriptor_export`=VALUES(`descriptor_export`),
  `handler_resolution_mode`=VALUES(`handler_resolution_mode`), `tool_count_expected`=VALUES(`tool_count_expected`),
  `status`=VALUES(`status`), `metadata_json`=VALUES(`metadata_json`), `secrets_included`=0,
  `updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `tenant_platform_endpoint_tools`
  (`tool_key`,`display_name`,`description`,`http_method`,`http_path`,`input_schema`,`fixed_body`,`tags`,`is_enabled`,`sort_order`)
VALUES
  ('tenant_repository_intelligence_v6_report','Tenant Repository Intelligence V6 Report',
   'Deep read-only GitHub PR intelligence with exact-head CI, branch overlap, main equivalence, migration replacement, tenant scope, and provider binding validation. No repository mutation.',
   'POST','/system/tools/call',
   JSON_OBJECT('type','object','properties',JSON_OBJECT('tool_args',JSON_OBJECT('type','object','additionalProperties',true)),'required',JSON_ARRAY('tool_args')),
   JSON_OBJECT('name','tenant_repository_intelligence_v6_report'),
   'tenant,repository_intelligence,v6,deep_read_only,scope_hardened,provider_bound,no_secrets,no_mutation,system_layer_tool,descriptor_backed',1,372),
  ('tenant_repository_mutation_plan_v6','Tenant Repository Mutation Plan V6',
   'Creates non-executed governed plans for comment, label, close, fast-forward, rebuild, patch, and merge. Every future apply requires capability envelope, approval, typed confirmation, and same-cycle readback.',
   'POST','/system/tools/call',
   JSON_OBJECT('type','object','properties',JSON_OBJECT('tool_args',JSON_OBJECT('type','object','additionalProperties',true)),'required',JSON_ARRAY('tool_args')),
   JSON_OBJECT('name','tenant_repository_mutation_plan_v6'),
   'tenant,repository_intelligence,v6,mutation_plan,dry_run,approval_required,no_secrets,no_mutation,system_layer_tool,descriptor_backed',1,373),
  ('tenant_repository_mutation_apply_v6','Tenant Repository Mutation Apply V6',
   'Applies one active action-specific repository mutation plan item after exact tenant scope, authority binding, capability envelope, approval hold, typed confirmation, unchanged target SHA, same-cycle evidence, audit, and readback validation. Replay is blocked by a unique run ledger.',
   'POST','/system/tools/call',
   JSON_OBJECT('type','object','properties',JSON_OBJECT('tool_args',JSON_OBJECT('type','object','additionalProperties',true)),'required',JSON_ARRAY('tool_args')),
   JSON_OBJECT('name','tenant_repository_mutation_apply_v6'),
   'tenant,repository_intelligence,v6,mutation_apply,capability_required,approval_required,typed_confirmation,readback,replay_guarded,no_secrets,system_layer_tool,descriptor_backed',1,375),
  ('tenant_repository_mutation_readback_v6','Tenant Repository Mutation Readback V6',
   'Reads and verifies one V6 repository mutation run without replaying the provider write. Supports recovery from write-confirmed and unknown-provider-outcome states when provider evidence is available.',
   'POST','/system/tools/call',
   JSON_OBJECT('type','object','properties',JSON_OBJECT('tool_args',JSON_OBJECT('type','object','additionalProperties',true)),'required',JSON_ARRAY('tool_args')),
   JSON_OBJECT('name','tenant_repository_mutation_readback_v6'),
   'tenant,repository_intelligence,v6,mutation_readback,no_provider_write,replay_guarded,no_secrets,system_layer_tool,descriptor_backed',1,376)
ON DUPLICATE KEY UPDATE
  `display_name`=VALUES(`display_name`), `description`=VALUES(`description`), `http_method`=VALUES(`http_method`),
  `http_path`=VALUES(`http_path`), `input_schema`=VALUES(`input_schema`), `fixed_body`=VALUES(`fixed_body`),
  `tags`=VALUES(`tags`), `is_enabled`=VALUES(`is_enabled`), `sort_order`=VALUES(`sort_order`);

INSERT INTO `platform_resource_authority_requirements`
  (`requirement_key`,`resource_family`,`operation_class`,`display_name`,`description`,`required_gates_json`,`authority_sources_json`,`credential_scope_required`,`active_grant_required`,`ownership_claim_required`,`audit_required`,`readback_required`,`break_glass_allowed`,`apply_allowed`,`secrets_may_be_returned`,`status`,`notes`)
VALUES
  ('github_repo_comment_authority','github_repo','repo_mutation','GitHub repository advisory comment authority','Approval-gated advisory comment only.',
   JSON_ARRAY('resource_resolution','ownership_claim','active_grant','scoped_credential','policy_gate','scope_guard','capability_envelope','approval_hold','typed_confirmation','same_cycle_evidence','audit_evidence','readback'),
   JSON_ARRAY('platform_resource_authority_bindings','connected_systems','installations','capability_resolution_envelope_ledger','approval_holds'),1,1,1,1,1,0,1,0,'active','Only advisory comment creation is allowed; no label, close, merge, patch, force push, or migration apply.'),
  ('github_repo_label_authority','github_repo','repo_mutation','GitHub repository label authority','Future approval-gated label mutation authority.',
   JSON_ARRAY('resource_resolution','ownership_claim','active_grant','scoped_credential','policy_gate','scope_guard','capability_envelope','approval_hold','typed_confirmation','same_cycle_evidence','audit_evidence','readback'),
   JSON_ARRAY('platform_resource_authority_bindings','connected_systems','installations','capability_resolution_envelope_ledger','approval_holds'),1,1,1,1,1,0,0,0,'planned','No label adapter is enabled by this migration.'),
  ('github_repo_close_authority','github_repo','repo_mutation','GitHub pull request close authority','Future high-confidence superseded PR close authority.',
   JSON_ARRAY('resource_resolution','ownership_claim','active_grant','scoped_credential','policy_gate','scope_guard','capability_envelope','approval_hold','typed_confirmation','same_cycle_evidence','audit_evidence','readback'),
   JSON_ARRAY('platform_resource_authority_bindings','connected_systems','installations','capability_resolution_envelope_ledger','approval_holds'),1,1,1,1,1,0,0,0,'planned','Close remains disabled until exact main equivalence and no-unique-work validation are certified.'),
  ('github_repo_branch_authority','github_repo','repo_mutation','GitHub branch mutation authority','Future non-force fast-forward and rebuild authority.',
   JSON_ARRAY('resource_resolution','ownership_claim','active_grant','scoped_credential','policy_gate','scope_guard','capability_envelope','approval_hold','typed_confirmation','same_cycle_evidence','protected_branch_guard','audit_evidence','readback'),
   JSON_ARRAY('platform_resource_authority_bindings','connected_systems','installations','capability_resolution_envelope_ledger','approval_holds'),1,1,1,1,1,0,0,0,'planned','Force push is permanently forbidden.'),
  ('github_repo_patch_authority','github_repo','repo_mutation','GitHub repository patch authority','Future bounded file patch authority with path allowlist, expected blob SHA, validation, rollback evidence, and same-cycle readback.',
   JSON_ARRAY('resource_resolution','ownership_claim','active_grant','scoped_credential','policy_gate','scope_guard','capability_envelope','approval_hold','typed_confirmation','same_cycle_evidence','path_allowlist','expected_blob_sha','audit_evidence','readback'),
   JSON_ARRAY('platform_resource_authority_bindings','connected_systems','installations','capability_resolution_envelope_ledger','approval_holds'),1,1,1,1,1,0,0,0,'planned','Patch remains disabled until bounded path and rollback certification passes.'),
  ('github_repo_merge_authority','github_repo','repo_mutation','GitHub pull request merge authority','Future exact-head, required-check, protected-branch-aware merge authority.',
   JSON_ARRAY('resource_resolution','ownership_claim','active_grant','scoped_credential','policy_gate','scope_guard','capability_envelope','approval_hold','typed_confirmation','same_cycle_evidence','required_checks','audit_evidence','readback'),
   JSON_ARRAY('platform_resource_authority_bindings','connected_systems','installations','capability_resolution_envelope_ledger','approval_holds'),1,1,1,1,1,0,0,0,'planned','Automatic merge remains disabled until action-specific positive smoke certification passes.')
ON DUPLICATE KEY UPDATE
  `resource_family`=VALUES(`resource_family`), `operation_class`=VALUES(`operation_class`), `display_name`=VALUES(`display_name`),
  `description`=VALUES(`description`), `required_gates_json`=VALUES(`required_gates_json`), `authority_sources_json`=VALUES(`authority_sources_json`),
  `credential_scope_required`=VALUES(`credential_scope_required`), `active_grant_required`=VALUES(`active_grant_required`),
  `ownership_claim_required`=VALUES(`ownership_claim_required`), `audit_required`=VALUES(`audit_required`), `readback_required`=VALUES(`readback_required`),
  `break_glass_allowed`=VALUES(`break_glass_allowed`), `apply_allowed`=VALUES(`apply_allowed`), `secrets_may_be_returned`=VALUES(`secrets_may_be_returned`),
  `status`=VALUES(`status`), `notes`=VALUES(`notes`), `updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `platform_resource_recipes`
  (`recipe_key`,`resource_type`,`operation_key`,`adapter_key`,`risk_class`,`mode`,`read_only`,`requires_dry_run`,`requires_capability_envelope`,`requires_typed_confirmation`,`requires_same_cycle_readback`,`authority_requirement_key`,`input_schema_json`,`output_schema_json`,`policy_json`,`graph_write_policy`,`engine_key`,`status`,`notes`)
VALUES
  ('repo.pr.comment_advisory','github_pull_request','comment_advisory','github.pull_request.mutation_engine_v6','mutation','apply',0,1,1,1,1,'github_repo_comment_authority',
   JSON_OBJECT('type','object','required',JSON_ARRAY('owner','repo','pr_number','plan_id','capability_envelope_id','approval_hold_id','typed_confirmation')),
   JSON_OBJECT('type','object','required',JSON_ARRAY('comment_id','readback','audit_ref','secrets_included')),
   JSON_OBJECT('adapter','repositoryGovernanceV6','comment_only',true,'replay_guarded',true,'forbidden',JSON_ARRAY('label','close','merge','patch','force_push','migration_apply'),'same_cycle_readback',true,'secrets_allowed',false),
   'summary_node','resource_authority_engine','active','V6 advisory comment adapter is active only through the action-specific capability, approval, typed-confirmation, replay, audit, and readback gates.'),
  ('repo.pr.label','github_pull_request','label','github.pull_request.label.adapter','mutation','apply',0,1,1,1,1,'github_repo_label_authority',
   JSON_OBJECT('type','object','required',JSON_ARRAY('owner','repo','pr_number','labels','capability_envelope_id','approval_hold_id','typed_confirmation')),
   JSON_OBJECT('type','object','required',JSON_ARRAY('readback','audit_ref','secrets_included')),
   JSON_OBJECT('status','future_guarded_apply','same_cycle_readback',true,'secrets_allowed',false),'summary_node','resource_authority_engine','planned','No label adapter enabled yet.'),
  ('repo.pr.close_superseded','github_pull_request','close_superseded','github.pull_request.close_superseded.adapter','mutation','apply',0,1,1,1,1,'github_repo_close_authority',
   JSON_OBJECT('type','object','required',JSON_ARRAY('plan_id','plan_item_id','capability_envelope_id','approval_hold_id','typed_confirmation')),
   JSON_OBJECT('type','object','required',JSON_ARRAY('run_id','state','readback','audit_ref','secrets_included')),
   JSON_OBJECT('requires_exact_main_equivalence',true,'requires_complete_equivalence_evidence',true,'minimum_confidence',0.98,'requires_unchanged_head_sha',true,'same_cycle_readback',true,'secrets_allowed',false),'summary_node','resource_authority_engine','planned','Close adapter exists but remains disabled until positive action-specific smoke certification.'),
  ('repo.branch.fast_forward','github_branch','fast_forward','github.branch.fast_forward.adapter','mutation','apply',0,1,1,1,1,'github_repo_branch_authority',
   JSON_OBJECT('type','object','required',JSON_ARRAY('owner','repo','branch','base_ref_sha','branch_ref_sha','capability_envelope_id','typed_confirmation')),
   JSON_OBJECT('type','object','required',JSON_ARRAY('readback','audit_ref','secrets_included')),
   JSON_OBJECT('force',false,'protected_branch_default','blocked','same_cycle_readback',true,'secrets_allowed',false),'summary_node','resource_authority_engine','planned','Delegates only to governed non-force fast-forward adapter after certification.'),
  ('repo.branch.rebuild_fresh','github_branch','rebuild_fresh','github.branch.rebuild_fresh.adapter','mutation','apply',0,1,1,1,1,'github_repo_branch_authority',
   JSON_OBJECT('type','object','required',JSON_ARRAY('owner','repo','source_pr_number','target_branch','capability_envelope_id','approval_hold_id','typed_confirmation')),
   JSON_OBJECT('type','object','required',JSON_ARRAY('new_pr_url','readback','audit_ref','secrets_included')),
   JSON_OBJECT('force_push_allowed',false,'protected_branch_default','blocked','conflict_resolution','manual_or_bounded_patch_only','secrets_allowed',false),'summary_node','resource_authority_engine','planned','Fresh rebuild remains disabled until bounded patch and conflict certification exist.'),
  ('repo.file.patch_apply','github_file','patch_apply','github.file.bounded_patch.adapter','mutation','apply',0,1,1,1,1,'github_repo_patch_authority',
   JSON_OBJECT('type','object','required',JSON_ARRAY('owner','repo','path','expected_blob_sha','patch_sha256','capability_envelope_id','approval_hold_id','typed_confirmation')),
   JSON_OBJECT('type','object','required',JSON_ARRAY('commit_sha','readback','rollback_ref','audit_ref','secrets_included')),
   JSON_OBJECT('status','future_guarded_apply','bounded_paths_required',true,'expected_blob_sha_required',true,'rollback_evidence_required',true,'force_push_allowed',false,'same_cycle_readback',true,'secrets_allowed',false),'summary_node','resource_authority_engine','planned','Patch adapter is intentionally fail-closed until bounded path, validation, and rollback certification exist.'),
  ('repo.pr.merge_ready','github_pull_request','merge_ready','github.pull_request.merge.adapter','mutation','apply',0,1,1,1,1,'github_repo_merge_authority',
   JSON_OBJECT('type','object','required',JSON_ARRAY('owner','repo','pr_number','head_sha','capability_envelope_id','approval_hold_id','typed_confirmation')),
   JSON_OBJECT('type','object','required',JSON_ARRAY('merge_sha','readback','audit_ref','secrets_included')),
   JSON_OBJECT('requires_exact_head_sha',true,'requires_required_checks',true,'requires_clean_merge_state',true,'same_cycle_readback',true,'secrets_allowed',false),'summary_node','resource_authority_engine','planned','Merge adapter remains disabled until positive smoke certification exists.')
ON DUPLICATE KEY UPDATE
  `resource_type`=VALUES(`resource_type`), `operation_key`=VALUES(`operation_key`), `adapter_key`=VALUES(`adapter_key`), `risk_class`=VALUES(`risk_class`),
  `mode`=VALUES(`mode`), `read_only`=VALUES(`read_only`), `requires_dry_run`=VALUES(`requires_dry_run`),
  `requires_capability_envelope`=VALUES(`requires_capability_envelope`), `requires_typed_confirmation`=VALUES(`requires_typed_confirmation`),
  `requires_same_cycle_readback`=VALUES(`requires_same_cycle_readback`), `authority_requirement_key`=VALUES(`authority_requirement_key`),
  `input_schema_json`=VALUES(`input_schema_json`), `output_schema_json`=VALUES(`output_schema_json`), `policy_json`=VALUES(`policy_json`),
  `graph_write_policy`=VALUES(`graph_write_policy`), `engine_key`=VALUES(`engine_key`), `status`=VALUES(`status`), `notes`=VALUES(`notes`), `updated_at`=CURRENT_TIMESTAMP;


INSERT INTO `app_integration_tool_bindings`
  (`binding_id`,`app_key`,`tool_key`,`tool_surface`,`binding_role`,`credential_source`,`exposure_scope`,`status`,`notes`)
VALUES
  ('bind_tool_github_tenant_repository_mutation_apply_v6','github','tenant_repository_mutation_apply_v6','tenant_platform_tool','state_changing','tenant_connection','tenant','active',
   'Tenant-scoped GitHub repository mutation dispatcher. Exact connected-system installation and action-specific V6 authority remain mandatory; this binding does not grant provider-write authority by itself.')
ON DUPLICATE KEY UPDATE
  `tool_surface`=VALUES(`tool_surface`), `binding_role`=VALUES(`binding_role`),
  `credential_source`=VALUES(`credential_source`), `exposure_scope`=VALUES(`exposure_scope`),
  `status`=VALUES(`status`), `notes`=VALUES(`notes`), `updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `runtime_dispatch_certification_registry`
  (`certification_key`,`surface_key`,`surface_family`,`tool_or_action_key`,`risk_class`,`certification_status`,`smoke_strategy`,
   `dispatch_allowed`,`apply_allowed`,`requires_resource_authority`,`requires_dry_run`,`requires_audit_evidence`,`requires_readback`,
   `last_evidence_ref`,`last_certified_at`,`notes`)
VALUES
  ('tenant_repository_mutation_apply_v6','tenant_repository_mutation_apply_v6','repository_mutation','tenant_repository_mutation_apply_v6','high',
   'negative_gate_passed_positive_apply_pending','negative_gate_and_readback',1,0,1,1,1,1,
   'test-repository-governance-v6.mjs',NULL,
   'Dispatch certification allows capability-envelope planning and approval routing only. Provider apply remains denied unless an active action-specific recipe, exact repository authority binding, approved apply-authorization hold, immutable plan evidence, unique run reservation, and same-cycle readback all pass.')
ON DUPLICATE KEY UPDATE
  `surface_key`=VALUES(`surface_key`), `surface_family`=VALUES(`surface_family`),
  `tool_or_action_key`=VALUES(`tool_or_action_key`), `risk_class`=VALUES(`risk_class`),
  `certification_status`=VALUES(`certification_status`), `smoke_strategy`=VALUES(`smoke_strategy`),
  `dispatch_allowed`=VALUES(`dispatch_allowed`), `apply_allowed`=VALUES(`apply_allowed`),
  `requires_resource_authority`=VALUES(`requires_resource_authority`), `requires_dry_run`=VALUES(`requires_dry_run`),
  `requires_audit_evidence`=VALUES(`requires_audit_evidence`), `requires_readback`=VALUES(`requires_readback`),
  `last_evidence_ref`=VALUES(`last_evidence_ref`), `last_certified_at`=VALUES(`last_certified_at`),
  `notes`=VALUES(`notes`), `updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `capability_apply_authorization_policy_registry`
  (`policy_key`,`app_key`,`capability_key`,`operation_intent`,`runtime_surface`,`status`,
   `allow_external_write`,`allow_credential_binding`,`allow_no_credential_binding`,
   `requires_ready_for_dispatch`,`requires_dispatch_allowed`,`requires_zero_blocking_gaps`,
   `requires_audit_evidence`,`requires_readback`,`requires_typed_confirmation`,`requires_same_cycle_dry_run`,
   `allowed_source_tiers_json`,`policy_json`,`notes`)
VALUES
  ('repo_pr_comment_advisory_v6_apply_policy','github','tenant_repository_mutation_apply_v6','repo.pr.comment_advisory.apply',
   'tenant_repository_mutation_apply_v6','active',1,1,1,1,1,1,1,1,1,1,
   JSON_ARRAY('tenant_managed','workspace_owner_managed'),
   JSON_OBJECT(
     'recipe_key','repo.pr.comment_advisory',
     'exact_plan_binding_required',true,
     'required_context',JSON_ARRAY('plan_id','plan_item_id','resource_uri','recipe_key','expected_commit_sha'),
     'provider_binding_required',true,
     'same_cycle_reanalysis_required',true,
     'unique_run_reservation_required',true,
     'force_push_allowed',false,
     'automatic_replay_allowed',false,
     'secrets_included',false
   ),
   'Only the V6 advisory-comment recipe may receive apply authorization. Label, close, branch, patch, and merge intents have no active apply-authorization policy in this migration.')
ON DUPLICATE KEY UPDATE
  `app_key`=VALUES(`app_key`), `capability_key`=VALUES(`capability_key`),
  `operation_intent`=VALUES(`operation_intent`), `runtime_surface`=VALUES(`runtime_surface`),
  `status`=VALUES(`status`), `allow_external_write`=VALUES(`allow_external_write`),
  `allow_credential_binding`=VALUES(`allow_credential_binding`), `allow_no_credential_binding`=VALUES(`allow_no_credential_binding`),
  `requires_ready_for_dispatch`=VALUES(`requires_ready_for_dispatch`), `requires_dispatch_allowed`=VALUES(`requires_dispatch_allowed`),
  `requires_zero_blocking_gaps`=VALUES(`requires_zero_blocking_gaps`), `requires_audit_evidence`=VALUES(`requires_audit_evidence`),
  `requires_readback`=VALUES(`requires_readback`), `requires_typed_confirmation`=VALUES(`requires_typed_confirmation`),
  `requires_same_cycle_dry_run`=VALUES(`requires_same_cycle_dry_run`),
  `allowed_source_tiers_json`=VALUES(`allowed_source_tiers_json`), `policy_json`=VALUES(`policy_json`),
  `notes`=VALUES(`notes`), `updated_at`=CURRENT_TIMESTAMP;
INSERT INTO `execution_policies`
  (`policy_group`,`policy_key`,`policy_value`,`active`,`execution_scope`,`affects_layer`,`blocking`,`notes`)
VALUES
  ('Repository Intelligence Governance','governed_repository_engine_v6_policy_v1',
   JSON_OBJECT(
     'engine_version','v6_scope_provider_deep_reconciliation',
     'scope_rule','tenant_must_match_and_workspace_user_must_belong_to_tenant',
     'binding_match','hierarchical_and_not_cross_scope_or',
     'provider_binding',JSON_OBJECT('connected_system_required_for_tenant_owned_installation',true,'platform_managed_compatibility_only_for_admin_grant_or_system_seed',true),
     'deep_evidence',JSON_ARRAY('exact_head_sha','check_runs','commit_statuses','required_checks_when_visible','merge_base','ahead_behind','same_file_overlap','main_tree','exact_file_sha_parity','migration_slug_replacement'),
     'mutation_plans',JSON_ARRAY('repo.pr.comment_advisory','repo.pr.label','repo.pr.close_superseded','repo.branch.fast_forward','repo.branch.rebuild_fresh','repo.file.patch_apply','repo.pr.merge_ready'),
     'future_apply_requires',JSON_ARRAY('active_action_specific_authority','capability_envelope','approval_hold','typed_confirmation','same_cycle_evidence','exact_target_sha','audit','readback'),
     'force_push_allowed',false,
     'provider_write_allowed_by_v6_report_or_plan',false,
     'secrets_included',false
   ),
   'TRUE',
   'tenant_repository_intelligence|v6|scope_hardening|provider_binding|deep_reconciliation|mutation_planning',
   'repositoryGovernanceV6|repositoryTenantIntelligenceV2|platformResourceRecipeCapability|systemLayerRoutes|platform_resource_authority_bindings|connected_systems|installations|repository_mutation_plans_v6|releaseReadiness',
   'TRUE',
   'V6 intelligence and planning are read-only. Provider writes are available only through active action-specific recipes; all other mutation adapters remain planned until positive smoke certification and release-readiness coverage pass.'),
  ('Repository Mutation Governance','governed_repository_mutation_plan_v6_policy_v1',
   JSON_OBJECT(
     'plan_only',false,
     'apply_allowed_only_via_active_action_specific_recipe',true,
     'active_adapters',JSON_ARRAY('comment_advisory'),
     'planned_adapters',JSON_ARRAY('label','close_superseded','fast_forward','rebuild_fresh','patch_apply','merge_ready'),'replay_guard','unique_plan_item_run_ledger','unknown_provider_outcome_requires_readback',true,
     'forbidden_without_action_specific_certification',JSON_ARRAY('comment','label','close','merge','patch','branch_update','force_push','migration_apply'),
     'force_push_allowed',false,
     'secrets_included',false
   ),
   'TRUE',
   'repository_mutation|v6|action_specific_apply|approval_gated|replay_guarded|no_force_push',
   'platform_resource_recipes|platform_resource_authority_requirements|repository_mutation_plans_v6|repository_mutation_runs_v6|capability_resolution_envelope_ledger|approval_holds',
   'TRUE',
   'Mutation planning never grants execution authority. Apply is allowed only for an active action-specific recipe and is replay-guarded through repository_mutation_runs_v6 with same-cycle evidence and readback.' )
ON DUPLICATE KEY UPDATE
  `policy_value`=VALUES(`policy_value`), `active`=VALUES(`active`), `execution_scope`=VALUES(`execution_scope`),
  `affects_layer`=VALUES(`affects_layer`), `blocking`=VALUES(`blocking`), `notes`=VALUES(`notes`), `updated_at`=CURRENT_TIMESTAMP;
