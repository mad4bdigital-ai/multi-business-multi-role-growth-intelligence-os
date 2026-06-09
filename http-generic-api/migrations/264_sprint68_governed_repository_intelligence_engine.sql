-- Sprint 68: Governed Repository Intelligence Engine foundation.
--
-- Extends the existing platform_resource_* recipe layer for repository work.
-- V1 is registry/policy/plan-only for PR reconciliation and repo development
-- operations. It deliberately does not create repository_* operation tables,
-- does not execute GitHub mutations, and does not enable comments, labels,
-- closes, merges, patches, force-pushes, or migration applies.
--
-- Repository operations must follow the platform-wide contract:
-- Resource + Recipe + Authority + Policy + Evidence + Capability Envelope
-- when mutating + Same-cycle validation when sensitive + Readback + Audit.

INSERT INTO `platform_resource_types`
  (`resource_type`, `resource_family`, `provider_key`, `display_name`, `source_table`, `source_pk_column`,
   `default_identity_pattern`, `default_inspect_recipe_key`, `default_reconcile_recipe_key`,
   `supports_children`, `supports_versions`, `supports_content`, `supports_mutation`, `graph_node_type`, `status`, `metadata_json`)
VALUES
  ('github_repo', 'github_repo', 'github_api_mcp', 'GitHub Repository', NULL, NULL,
   'github://{owner}/{repo}', NULL, 'repo.pr.reconciliation_sweep',
   1, 1, 0, 0, 'resource.github_repo', 'active',
   JSON_OBJECT('v1_policy','plan_only_or_read_only_when_allowlisted','mutation_default','blocked','tenant_binding_required',true)),
  ('github_pull_request', 'github_repo', 'github_api_mcp', 'GitHub Pull Request', NULL, NULL,
   'github://{owner}/{repo}/pr/{pr_number}', 'repo.pr.classify_staleness', 'repo.pr.reconciliation_sweep',
   0, 1, 0, 0, 'resource.github_pull_request', 'active',
   JSON_OBJECT('v1_policy','metadata_only','mutation_default','blocked','classification_model','repository_pr_reconciliation_v1')),
  ('github_file', 'github_repo', 'github_api_mcp', 'GitHub File', NULL, NULL,
   'github://{owner}/{repo}/file/{path}', NULL, NULL,
   0, 1, 1, 1, 'resource.github_file', 'planned',
   JSON_OBJECT('v1_policy','patch_apply_planned_only','requires_capability_envelope',true,'force_push_allowed',false)),
  ('github_migration', 'github_repo', 'github_api_mcp', 'GitHub Migration File', NULL, NULL,
   'github://{owner}/{repo}/migration/{path}', NULL, 'repo.migration.detect_conflicts',
   0, 1, 1, 0, 'resource.github_migration', 'planned',
   JSON_OBJECT('v1_policy','detect_conflicts_only','tenant_migration_apply_allowed',false))
ON DUPLICATE KEY UPDATE
  `resource_family` = VALUES(`resource_family`),
  `provider_key` = VALUES(`provider_key`),
  `display_name` = VALUES(`display_name`),
  `source_table` = VALUES(`source_table`),
  `source_pk_column` = VALUES(`source_pk_column`),
  `default_identity_pattern` = VALUES(`default_identity_pattern`),
  `default_inspect_recipe_key` = VALUES(`default_inspect_recipe_key`),
  `default_reconcile_recipe_key` = VALUES(`default_reconcile_recipe_key`),
  `supports_children` = VALUES(`supports_children`),
  `supports_versions` = VALUES(`supports_versions`),
  `supports_content` = VALUES(`supports_content`),
  `supports_mutation` = VALUES(`supports_mutation`),
  `graph_node_type` = VALUES(`graph_node_type`),
  `status` = VALUES(`status`),
  `metadata_json` = VALUES(`metadata_json`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `platform_resource_adapters`
  (`adapter_key`, `resource_type`, `provider_key`, `adapter_kind`, `installed_tool_key`,
   `identity_resolver_key`, `metadata_normalizer_key`, `children_normalizer_key`,
   `content_policy`, `supports_plan`, `supports_read`, `supports_write`, `status`, `metadata_json`)
VALUES
  ('github.repo.pr_reconciliation.adapter', 'github_repo', 'github_api_mcp', 'endpoint_recipe', NULL,
   'parse_github_repo_ref', 'normalize_github_repo_metadata', 'normalize_github_pull_requests',
   'metadata_only', 1, 1, 0, 'active',
   JSON_OBJECT('v1_execution','plan_only','provider_calls_allowed_v1',false,'mutation_allowed_v1',false)),
  ('github.pull_request.classification.adapter', 'github_pull_request', 'github_api_mcp', 'endpoint_recipe', NULL,
   'parse_github_pull_request_ref', 'normalize_github_pull_request_metadata', NULL,
   'metadata_only', 1, 1, 0, 'active',
   JSON_OBJECT('v1_execution','plan_only','provider_calls_allowed_v1',false,'mutation_allowed_v1',false)),
  ('github.file.patch.adapter', 'github_file', 'github_api_mcp', 'composite', NULL,
   'parse_github_file_ref', 'normalize_repo_patch_context', NULL,
   'content_hash_only', 1, 0, 0, 'planned',
   JSON_OBJECT('delegates_to','repo_patch_apply','requires_capability_envelope',true,'apply_supported_v1',false))
ON DUPLICATE KEY UPDATE
  `resource_type` = VALUES(`resource_type`),
  `provider_key` = VALUES(`provider_key`),
  `adapter_kind` = VALUES(`adapter_kind`),
  `installed_tool_key` = VALUES(`installed_tool_key`),
  `identity_resolver_key` = VALUES(`identity_resolver_key`),
  `metadata_normalizer_key` = VALUES(`metadata_normalizer_key`),
  `children_normalizer_key` = VALUES(`children_normalizer_key`),
  `content_policy` = VALUES(`content_policy`),
  `supports_plan` = VALUES(`supports_plan`),
  `supports_read` = VALUES(`supports_read`),
  `supports_write` = VALUES(`supports_write`),
  `status` = VALUES(`status`),
  `metadata_json` = VALUES(`metadata_json`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `platform_resource_recipes`
  (`recipe_key`, `resource_type`, `operation_key`, `adapter_key`, `risk_class`, `mode`,
   `read_only`, `requires_dry_run`, `requires_capability_envelope`, `requires_typed_confirmation`,
   `requires_same_cycle_readback`, `authority_requirement_key`, `input_schema_json`, `output_schema_json`,
   `policy_json`, `graph_write_policy`, `engine_key`, `status`, `notes`)
VALUES
  ('repo.pr.reconciliation_sweep', 'github_repo', 'pr_reconciliation_sweep', 'github.repo.pr_reconciliation.adapter', 'diagnostic', 'reconcile',
   1, 1, 0, 0, 0, NULL,
   JSON_OBJECT('type','object','required', JSON_ARRAY('owner','repo'), 'properties', JSON_OBJECT('owner', JSON_OBJECT('type','string'), 'repo', JSON_OBJECT('type','string'), 'mode', JSON_OBJECT('type','string','enum',JSON_ARRAY('dry_run')), 'limit', JSON_OBJECT('type','integer','minimum',1,'maximum',100))),
   JSON_OBJECT('type','object','required', JSON_ARRAY('classification','summary','recommendations','secrets_included')),
   JSON_OBJECT('v1','dry_run_only','allowed_modes',JSON_ARRAY('dry_run','plan'), 'evidence_required', JSON_ARRAY('pr_metadata','changed_files','branch_reconcile','check_runs','main_parity_search','migration_conflict_scan'), 'forbidden_v1', JSON_ARRAY('comment','label','close','merge','patch','force_push','migration_apply'), 'secrets_allowed', false),
   'summary_node', 'resource_authority_engine', 'active',
   'Plan/read-only foundation recipe for repository PR reconciliation sweep. V1 emits no mutations.'),
  ('repo.pr.classify_staleness', 'github_pull_request', 'classify_staleness', 'github.pull_request.classification.adapter', 'diagnostic', 'inspect',
   1, 1, 0, 0, 0, NULL,
   JSON_OBJECT('type','object','required', JSON_ARRAY('owner','repo','pr_number'), 'properties', JSON_OBJECT('owner', JSON_OBJECT('type','string'), 'repo', JSON_OBJECT('type','string'), 'pr_number', JSON_OBJECT('type','integer'))),
   JSON_OBJECT('type','object','required', JSON_ARRAY('classification','confidence','recommended_action','secrets_included')),
   JSON_OBJECT('classification_model', JSON_ARRAY('merge_ready','behind_only','clean_but_ci_missing','stale_docs_agent_only','superseded_by_main','duplicate_migration_conflict','dirty_rebuild_required','diverged_no_overlap','diverged_same_files','manual_review_required','unsafe_to_merge'), 'v1_execution','plan_only', 'secrets_allowed', false),
   'summary_node', 'resource_authority_engine', 'active',
   'Plan-only PR staleness classification recipe. It defines the evidence contract before runtime execution is enabled.'),
  ('repo.pr.comment_recommendation', 'github_pull_request', 'comment_recommendation', 'github.pull_request.classification.adapter', 'mutation', 'apply',
   0, 1, 1, 1, 1, 'github_repo_patch_authority',
   JSON_OBJECT('type','object','required', JSON_ARRAY('owner','repo','pr_number','capability_envelope_id','typed_confirmation')),
   JSON_OBJECT('type','object','required', JSON_ARRAY('readback','audit_ref','secrets_included')),
   JSON_OBJECT('status','future_guarded_apply','requires_prior_recipe','repo.pr.reconciliation_sweep','requires_same_cycle_evidence',true,'readback_required',true,'secrets_allowed',false),
   'summary_node', 'resource_authority_engine', 'planned',
   'Future guarded PR comment recipe. Disabled in V1.'),
  ('repo.pr.close_superseded', 'github_pull_request', 'close_superseded', 'github.pull_request.classification.adapter', 'mutation', 'apply',
   0, 1, 1, 1, 1, 'github_repo_patch_authority',
   JSON_OBJECT('type','object','required', JSON_ARRAY('owner','repo','pr_number','capability_envelope_id','typed_confirmation')),
   JSON_OBJECT('type','object','required', JSON_ARRAY('readback','audit_ref','secrets_included')),
   JSON_OBJECT('status','future_guarded_apply','allowed_only_when', JSON_ARRAY('classification=superseded_by_main','confidence>=0.90','no_unique_unmerged_code=true'), 'merge_allowed',false,'force_push_allowed',false,'readback_required',true,'secrets_allowed',false),
   'summary_node', 'resource_authority_engine', 'planned',
   'Future guarded close-superseded PR recipe. Disabled in V1.'),
  ('repo.file.patch_apply', 'github_file', 'patch_apply', 'github.file.patch.adapter', 'mutation', 'apply',
   0, 1, 1, 1, 1, 'github_repo_patch_authority',
   JSON_OBJECT('type','object','required', JSON_ARRAY('owner','repo','path','branch','capability_envelope_id')),
   JSON_OBJECT('type','object','required', JSON_ARRAY('commit_sha','readback','secrets_included')),
   JSON_OBJECT('delegates_to','repo_patch_apply','status','future_guarded_apply','force_push_allowed',false,'protected_branch_default','blocked','same_cycle_readback_required',true,'secrets_allowed',false),
   'summary_node', 'resource_authority_engine', 'planned',
   'Future recipe wrapper over repo_patch_apply. Existing repo_patch_apply remains the only guarded mutation surface.'),
  ('repo.migration.detect_conflicts', 'github_migration', 'detect_conflicts', 'github.repo.pr_reconciliation.adapter', 'diagnostic', 'compare',
   1, 1, 0, 0, 0, NULL,
   JSON_OBJECT('type','object','required', JSON_ARRAY('owner','repo'), 'properties', JSON_OBJECT('owner', JSON_OBJECT('type','string'), 'repo', JSON_OBJECT('type','string'), 'base_branch', JSON_OBJECT('type','string','default','main'))),
   JSON_OBJECT('type','object','required', JSON_ARRAY('classification','conflicts','secrets_included')),
   JSON_OBJECT('v1','plan_only','tenant_migration_apply_allowed',false,'detect_duplicate_numbers',true,'detect_equivalent_canonical_migration',true,'secrets_allowed',false),
   'summary_node', 'resource_authority_engine', 'planned',
   'Future migration conflict detection recipe. Tenant migration apply remains disabled.')
ON DUPLICATE KEY UPDATE
  `resource_type` = VALUES(`resource_type`),
  `operation_key` = VALUES(`operation_key`),
  `adapter_key` = VALUES(`adapter_key`),
  `risk_class` = VALUES(`risk_class`),
  `mode` = VALUES(`mode`),
  `read_only` = VALUES(`read_only`),
  `requires_dry_run` = VALUES(`requires_dry_run`),
  `requires_capability_envelope` = VALUES(`requires_capability_envelope`),
  `requires_typed_confirmation` = VALUES(`requires_typed_confirmation`),
  `requires_same_cycle_readback` = VALUES(`requires_same_cycle_readback`),
  `authority_requirement_key` = VALUES(`authority_requirement_key`),
  `input_schema_json` = VALUES(`input_schema_json`),
  `output_schema_json` = VALUES(`output_schema_json`),
  `policy_json` = VALUES(`policy_json`),
  `graph_write_policy` = VALUES(`graph_write_policy`),
  `engine_key` = VALUES(`engine_key`),
  `status` = VALUES(`status`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `platform_resource_recipe_steps`
  (`recipe_key`, `step_order`, `step_key`, `step_kind`, `parent_action_key`, `endpoint_key`, `tool_key`,
   `source_table`, `source_pk_template_json`, `query_template_json`, `body_template_json`, `response_projection_json`,
   `required`, `on_error_policy`, `status`)
VALUES
  ('repo.pr.reconciliation_sweep', 10, 'list_open_pull_requests', 'endpoint_call', 'github_api_mcp', 'github_list_pull_requests', NULL,
   NULL, NULL, JSON_OBJECT('state','open','per_page','${options.limit}'), NULL, JSON_OBJECT('include', JSON_ARRAY('number','title','state','head','base','mergeable_state','updated_at'), 'exclude', JSON_ARRAY('body','secrets','tokens')), 1, 'fail', 'planned'),
  ('repo.pr.reconciliation_sweep', 20, 'collect_changed_files', 'endpoint_call', 'github_api_mcp', 'github_get_pull_request', NULL,
   NULL, NULL, NULL, NULL, JSON_OBJECT('include', JSON_ARRAY('changed_files','head_sha','base_sha'), 'exclude', JSON_ARRAY('patch_content','secrets','tokens')), 0, 'classify_degraded', 'planned'),
  ('repo.pr.reconciliation_sweep', 30, 'classify_pr_reconciliation_state', 'classify', NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, JSON_OBJECT('classifications', JSON_ARRAY('merge_ready','behind_only','clean_but_ci_missing','stale_docs_agent_only','superseded_by_main','duplicate_migration_conflict','dirty_rebuild_required','diverged_no_overlap','diverged_same_files','manual_review_required','unsafe_to_merge')), 1, 'fail', 'active'),
  ('repo.pr.reconciliation_sweep', 40, 'emit_no_secret_pr_evidence', 'emit_evidence', NULL, NULL, NULL,
   'audit_payload_evidence', NULL, NULL, NULL, JSON_OBJECT('secrets_included', false), 1, 'classify_degraded', 'active'),
  ('repo.pr.classify_staleness', 10, 'read_pull_request_metadata', 'endpoint_call', 'github_api_mcp', 'github_get_pull_request', NULL,
   NULL, NULL, NULL, NULL, JSON_OBJECT('include', JSON_ARRAY('number','state','head','base','mergeable_state','updated_at'), 'exclude', JSON_ARRAY('body','secrets','tokens')), 1, 'fail', 'planned'),
  ('repo.pr.classify_staleness', 20, 'classify_single_pr_state', 'classify', NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, JSON_OBJECT('classifications', JSON_ARRAY('merge_ready','behind_only','superseded_by_main','duplicate_migration_conflict','manual_review_required','unsafe_to_merge')), 1, 'fail', 'active'),
  ('repo.pr.classify_staleness', 30, 'emit_no_secret_single_pr_evidence', 'emit_evidence', NULL, NULL, NULL,
   'audit_payload_evidence', NULL, NULL, NULL, JSON_OBJECT('secrets_included', false), 1, 'classify_degraded', 'active')
ON DUPLICATE KEY UPDATE
  `step_kind` = VALUES(`step_kind`),
  `parent_action_key` = VALUES(`parent_action_key`),
  `endpoint_key` = VALUES(`endpoint_key`),
  `tool_key` = VALUES(`tool_key`),
  `source_table` = VALUES(`source_table`),
  `source_pk_template_json` = VALUES(`source_pk_template_json`),
  `query_template_json` = VALUES(`query_template_json`),
  `body_template_json` = VALUES(`body_template_json`),
  `response_projection_json` = VALUES(`response_projection_json`),
  `required` = VALUES(`required`),
  `on_error_policy` = VALUES(`on_error_policy`),
  `status` = VALUES(`status`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `platform_graph_taxonomy`
  (`taxonomy_key`, `taxonomy_type`, `taxonomy_value`, `description`, `runtime_enforced`, `validation_rule_json`, `status`)
VALUES
  ('node_type.resource.github_repo', 'node_type', 'resource.github_repo', 'Resource node for GitHub repositories governed by repository intelligence recipes.', 0, JSON_OBJECT('source','platform_resource_types'), 'active'),
  ('node_type.resource.github_pull_request', 'node_type', 'resource.github_pull_request', 'Resource node for GitHub pull requests classified by repository intelligence recipes.', 0, JSON_OBJECT('source','platform_resource_types'), 'active'),
  ('edge_type.has_repository_recipe', 'edge_type', 'has_repository_recipe', 'Connects repository resources to governed repository recipes.', 0, JSON_OBJECT('source','platform_resource_recipes'), 'active'),
  ('edge_type.has_repository_evidence', 'edge_type', 'has_repository_evidence', 'Connects repository recommendations to no-secret evidence.', 0, JSON_OBJECT('source','audit_payload_evidence'), 'active')
ON DUPLICATE KEY UPDATE
  `taxonomy_type` = VALUES(`taxonomy_type`),
  `taxonomy_value` = VALUES(`taxonomy_value`),
  `description` = VALUES(`description`),
  `runtime_enforced` = VALUES(`runtime_enforced`),
  `validation_rule_json` = VALUES(`validation_rule_json`),
  `status` = VALUES(`status`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `execution_policies`
  (`policy_group`, `policy_key`, `policy_value`, `active`, `execution_scope`, `affects_layer`, `blocking`, `notes`)
VALUES
  ('Repository Intelligence Governance', 'governed_repository_intelligence_engine_policy_v1',
   JSON_OBJECT(
     'rule','governed_repository_intelligence_engine',
     'contract',JSON_ARRAY('resource','recipe','authority','policy','evidence','capability_envelope_for_mutation','same_cycle_validation_for_sensitive_mutation','readback','audit','no_secret'),
     'v1','dry_run_plan_only',
     'required_tables',JSON_ARRAY('platform_resource_types','platform_resource_adapters','platform_resource_recipes','platform_resource_recipe_steps','platform_resource_authority_requirements','capability_resolution_envelope_ledger','audit_payload_evidence'),
     'forbidden_v1',JSON_ARRAY('auto_merge','force_push','close_pr','comment','label','patch','migration_apply'),
     'mutation_requires',JSON_ARRAY('capability_envelope','typed_confirmation','same_cycle_evidence','readback','audit'),
     'confidence_thresholds',JSON_OBJECT('close_superseded_minimum',0.90),
     'tenant_repo_access_requires_binding',true,
     'secrets_included',false
   ),
   'TRUE',
   'governed_repository_intelligence|repo.pr.reconciliation_sweep|platform_resource_recipes|github_repo',
   'platform_resource_recipes|platformResourceRecipeCapability|releaseReadiness|capability_resolution_envelope_ledger|audit_payload_evidence',
   'TRUE',
   'Repository intelligence must be implemented as governed resource recipes, not isolated admin tools. V1 is dry-run/plan-only.'
  )
ON DUPLICATE KEY UPDATE
  `policy_value` = VALUES(`policy_value`),
  `active` = VALUES(`active`),
  `execution_scope` = VALUES(`execution_scope`),
  `affects_layer` = VALUES(`affects_layer`),
  `blocking` = VALUES(`blocking`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;
