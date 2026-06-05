-- Sprint 67: Skillpack draft installs, workspace catalog sync, and advisory routes
-- Codifies governed live registry work for tenant-private draft installs and
-- advisory-only routing. Runtime execution, WebFetch, file writes, shell,
-- package install, deploy, provider write, and secret read stay disabled unless
-- explicit runtime/tool grants are added later through approval gates.

SET @tenant_id := 'e989a841-fce0-4ced-be76-463e8202a066';
SET @owner_user_id := '0e76b224-7671-47dd-ad68-014fb042df80';
SET @admin_actor_id := '00000000-0000-4000-a000-000000000020';

-- Matt Pocock skillpack path-scope review: allow stable assets, keep
-- deprecated/in-progress/personal assets as evidence-only.
SET @matt_pkg_id := (SELECT package_id FROM platform_private_packages WHERE package_key='skillpack_mattpocock_skills' LIMIT 1);
SET @matt_repo_id := (SELECT repo_source_id FROM repo_source_registry WHERE full_name='mad4bdigital-ai/skills' LIMIT 1);

UPDATE repo_skill_candidates c
JOIN repo_source_registry r ON r.repo_source_id=c.repo_source_id
SET c.import_status='blocked_evidence_only',
    c.policy_json=JSON_OBJECT(
      'content_recognition','reviewed_path_scope_blocked',
      'path_scope_reviewed',true,
      'blocked_reason','deprecated_in_progress_or_personal_path_not_allowed_for_runtime_import',
      'review_decision','blocked_evidence_only',
      'raw_execution',false,
      'secret_values_returned',false
    )
WHERE r.full_name='mad4bdigital-ai/skills'
  AND c.source_path IN (
    'skills/deprecated/design-an-interface/SKILL.md',
    'skills/deprecated/qa/SKILL.md',
    'skills/deprecated/request-refactor-plan/SKILL.md',
    'skills/deprecated/ubiquitous-language/SKILL.md',
    'skills/in-progress/review/SKILL.md',
    'skills/in-progress/teach/SKILL.md',
    'skills/in-progress/writing-beats/SKILL.md',
    'skills/in-progress/writing-fragments/SKILL.md',
    'skills/in-progress/writing-shape/SKILL.md',
    'skills/personal/edit-article/SKILL.md',
    'skills/personal/obsidian-vault/SKILL.md'
  );

UPDATE platform_private_package_assets
SET import_status='blocked_evidence_only',
    runtime_import_allowed=0,
    risk_flags_json=JSON_ARRAY('reviewed_path_scope_blocked','deprecated_or_in_progress_or_personal','evidence_only','no_runtime_import','no_auto_install_asset'),
    updated_at=CURRENT_TIMESTAMP
WHERE package_id=@matt_pkg_id
  AND source_path IN (
    'skills/deprecated/design-an-interface/SKILL.md',
    'skills/deprecated/qa/SKILL.md',
    'skills/deprecated/request-refactor-plan/SKILL.md',
    'skills/deprecated/ubiquitous-language/SKILL.md',
    'skills/in-progress/review/SKILL.md',
    'skills/in-progress/teach/SKILL.md',
    'skills/in-progress/writing-beats/SKILL.md',
    'skills/in-progress/writing-fragments/SKILL.md',
    'skills/in-progress/writing-shape/SKILL.md',
    'skills/personal/edit-article/SKILL.md',
    'skills/personal/obsidian-vault/SKILL.md'
  );

UPDATE platform_private_packages
SET certification_status='certification_ready',
    status='active',
    auto_install_allowed=1,
    blocked_asset_manifest_json=JSON_OBJECT(
      'blocked_evidence_only_assets', JSON_ARRAY(
        'skills/deprecated/design-an-interface/SKILL.md',
        'skills/deprecated/qa/SKILL.md',
        'skills/deprecated/request-refactor-plan/SKILL.md',
        'skills/deprecated/ubiquitous-language/SKILL.md',
        'skills/in-progress/review/SKILL.md',
        'skills/in-progress/teach/SKILL.md',
        'skills/in-progress/writing-beats/SKILL.md',
        'skills/in-progress/writing-fragments/SKILL.md',
        'skills/in-progress/writing-shape/SKILL.md',
        'skills/personal/edit-article/SKILL.md',
        'skills/personal/obsidian-vault/SKILL.md'
      ),
      'blocked_reason','deprecated_in_progress_or_personal_path_scope',
      'runtime_import_allowed_assets',18,
      'blocked_assets_remaining',11,
      'runtime_tool_grants_created',false
    ),
    notes='Path-scope review completed. 18 stable skills are runtime-import allowed; 11 deprecated/in-progress/personal skills are evidence-only. No runtime grants created.',
    updated_at=CURRENT_TIMESTAMP
WHERE package_id=@matt_pkg_id;

UPDATE platform_package_versions
SET certification_status='certification_ready', status='active', updated_at=CURRENT_TIMESTAMP
WHERE package_id=@matt_pkg_id AND version='v1';

INSERT INTO repo_certification_runs
(certification_run_id, repo_source_id, package_id, candidate_id, certification_type, status, score, findings_json, blocked_reasons_json, execution_log_id)
SELECT UUID(), @matt_repo_id, @matt_pkg_id, NULL, 'path_scope', 'passed', 0.8600,
 JSON_OBJECT('decision','partial_package_ready_with_evidence_only_blocks','package_key','skillpack_mattpocock_skills','stable_runtime_import_allowed_assets',18,'blocked_evidence_only_assets',11,'runtime_tool_grants_created',false),
 JSON_ARRAY('deprecated_path','in_progress_path','personal_path'),
 'mattpocock_path_scope_review'
WHERE @matt_pkg_id IS NOT NULL;

-- Tenant-private draft installs for Superpowers and SEO/GEO packages.
SET @super_pkg_id := (SELECT package_id FROM platform_private_packages WHERE package_key='skillpack_superpowers' LIMIT 1);
SET @super_ver_id := (SELECT package_version_id FROM platform_package_versions WHERE package_id=@super_pkg_id AND version='v1' LIMIT 1);
SET @super_repo_id := (SELECT repo_source_id FROM repo_source_registry WHERE full_name='mad4bdigital-ai/superpowers' LIMIT 1);
SET @seo_pkg_id := (SELECT package_id FROM platform_private_packages WHERE package_key='skillpack_seo_geo_claude_skills' LIMIT 1);
SET @seo_ver_id := (SELECT package_version_id FROM platform_package_versions WHERE package_id=@seo_pkg_id AND version='v1' LIMIT 1);
SET @seo_repo_id := (SELECT repo_source_id FROM repo_source_registry WHERE full_name='mad4bdigital-ai/seo-geo-claude-skills' LIMIT 1);

INSERT INTO repo_install_requests
(install_request_id, tenant_id, brand_key, user_id, repo_source_id, package_id, candidate_id, requested_install_mode, resolved_install_mode, status, approval_required, approved_by, approved_at, execution_log_id)
SELECT 'req_nagy_superpowers_v1', @tenant_id, NULL, @owner_user_id, @super_repo_id, @super_pkg_id, NULL, 'auto', 'tenant_private_draft', 'applied', 0, 'admin_gpt_runtime', CURRENT_TIMESTAMP, 'superpowers_tenant_private_draft_install'
WHERE @super_pkg_id IS NOT NULL
ON DUPLICATE KEY UPDATE status=VALUES(status), resolved_install_mode=VALUES(resolved_install_mode), approved_by=VALUES(approved_by), approved_at=VALUES(approved_at), execution_log_id=VALUES(execution_log_id);

INSERT INTO repo_install_requests
(install_request_id, tenant_id, brand_key, user_id, repo_source_id, package_id, candidate_id, requested_install_mode, resolved_install_mode, status, approval_required, approved_by, approved_at, execution_log_id)
SELECT 'req_nagy_seo_geo_claude_skills_v1', @tenant_id, NULL, @owner_user_id, @seo_repo_id, @seo_pkg_id, NULL, 'auto', 'tenant_private_draft', 'applied', 0, 'admin_gpt_runtime', CURRENT_TIMESTAMP, 'seo_geo_tenant_private_draft_install'
WHERE @seo_pkg_id IS NOT NULL
ON DUPLICATE KEY UPDATE status=VALUES(status), resolved_install_mode=VALUES(resolved_install_mode), approved_by=VALUES(approved_by), approved_at=VALUES(approved_at), execution_log_id=VALUES(execution_log_id);

INSERT INTO tenant_package_installs
(install_id, tenant_id, package_id, package_version_id, enabled_scopes_json, brand_bindings_json, agent_grants_json, policy_overrides_json, install_status, approval_status, disabled_assets_json, thresholds_json)
SELECT 'install_nagy_superpowers_v1', @tenant_id, @super_pkg_id, @super_ver_id,
 JSON_OBJECT('scope_type','tenant','runtime_enabled',false,'draft',true,'advisory_agent_skill_enabled',false,'package_key','skillpack_superpowers'),
 JSON_ARRAY(), JSON_ARRAY(),
 JSON_OBJECT('auto_enable',false,'requires_explicit_runtime_tool_grant',true,'source','capability_vault_manual_tenant_private_draft','forbidden_without_grant',JSON_ARRAY('file_write','deploy','shell','package_install','publish','secret_read','provider_write','webfetch')),
 'planned','not_required',JSON_ARRAY(),JSON_OBJECT('runtime_tool_grants_created',false)
WHERE @super_pkg_id IS NOT NULL
ON DUPLICATE KEY UPDATE enabled_scopes_json=VALUES(enabled_scopes_json), agent_grants_json=VALUES(agent_grants_json), policy_overrides_json=VALUES(policy_overrides_json), install_status=VALUES(install_status), approval_status=VALUES(approval_status), updated_at=CURRENT_TIMESTAMP;

INSERT INTO tenant_package_installs
(install_id, tenant_id, package_id, package_version_id, enabled_scopes_json, brand_bindings_json, agent_grants_json, policy_overrides_json, install_status, approval_status, disabled_assets_json, thresholds_json)
SELECT 'install_nagy_seo_geo_claude_skills_v', @tenant_id, @seo_pkg_id, @seo_ver_id,
 JSON_OBJECT('scope_type','tenant','runtime_enabled',false,'draft',true,'advisory_agent_skill_enabled',false,'package_key','skillpack_seo_geo_claude_skills','webfetch_enabled',false),
 JSON_ARRAY(), JSON_ARRAY(),
 JSON_OBJECT('auto_enable',false,'requires_explicit_runtime_tool_grant',true,'source','capability_vault_manual_tenant_private_draft','forbidden_without_grant',JSON_ARRAY('file_write','deploy','shell','package_install','publish','secret_read','provider_write','webfetch')),
 'planned','not_required',JSON_ARRAY(),JSON_OBJECT('runtime_tool_grants_created',false,'webfetch_requires_explicit_runtime_grant',true)
WHERE @seo_pkg_id IS NOT NULL
ON DUPLICATE KEY UPDATE enabled_scopes_json=VALUES(enabled_scopes_json), agent_grants_json=VALUES(agent_grants_json), policy_overrides_json=VALUES(policy_overrides_json), install_status=VALUES(install_status), approval_status=VALUES(approval_status), updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_package_variants
(variant_id, package_id, base_package_version_id, scope_type, scope_id, variant_key, display_name, variant_status, created_by)
SELECT 'variant_nagy_superpowers_v1', @super_pkg_id, @super_ver_id, 'tenant', @tenant_id, 'tenant_nagy_superpowers_default', 'Nagy workspace Superpowers variant draft', 'draft', 'admin_gpt_runtime'
WHERE @super_pkg_id IS NOT NULL
ON DUPLICATE KEY UPDATE variant_key=VALUES(variant_key), display_name=VALUES(display_name), variant_status=VALUES(variant_status), updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_package_variants
(variant_id, package_id, base_package_version_id, scope_type, scope_id, variant_key, display_name, variant_status, created_by)
SELECT 'variant_nagy_seo_geo_claude_skills_v', @seo_pkg_id, @seo_ver_id, 'tenant', @tenant_id, 'tenant_nagy_seo_geo_claude_skills_default', 'Nagy workspace SEO/GEO Claude skills variant draft', 'draft', 'admin_gpt_runtime'
WHERE @seo_pkg_id IS NOT NULL
ON DUPLICATE KEY UPDATE variant_key=VALUES(variant_key), display_name=VALUES(display_name), variant_status=VALUES(variant_status), updated_at=CURRENT_TIMESTAMP;

-- Individual workspace catalog assets and owner grants for imported skills only.
INSERT INTO workspace_assets
(asset_id, tenant_id, vault_id, asset_type, asset_ref, display_name, brand_ref, site_ref, workflow_ref, session_ref, visibility, lifecycle_status, metadata_json, created_by)
SELECT UUID(), @tenant_id, NULL, 'knowledge', CONCAT('platform_package_asset:', a.asset_id),
       CONCAT(CASE WHEN p.package_key='skillpack_superpowers' THEN 'Superpowers skill: ' ELSE 'SEO/GEO skill: ' END,
              REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(a.source_path,'skills/',''), 'cross-cutting/',''), '/SKILL.md',''), '-', ' '), '_', ' ')),
       NULL, NULL, NULL, NULL, 'workspace', 'active',
       JSON_OBJECT('package_key',p.package_key,'package_id',p.package_id,'package_asset_id',a.asset_id,'source_path',a.source_path,'source_commit_sha',p.source_commit_sha,'asset_type',a.asset_type,'import_status',a.import_status,'runtime_import_allowed',a.runtime_import_allowed,'runtime_enabled',false,'advisory_catalog_visible',true,'agent_grant_required',true,'runtime_tool_grants_created',false,'webfetch_enabled',CASE WHEN p.package_key='skillpack_seo_geo_claude_skills' THEN false ELSE NULL END),
       @owner_user_id
FROM platform_private_package_assets a
JOIN platform_private_packages p ON p.package_id=a.package_id
WHERE p.package_key IN ('skillpack_superpowers','skillpack_seo_geo_claude_skills')
  AND a.asset_type='skill'
  AND a.runtime_import_allowed=1
  AND NOT EXISTS (
    SELECT 1 FROM workspace_assets wa
     WHERE wa.tenant_id=@tenant_id
       AND wa.asset_ref=CONCAT('platform_package_asset:', a.asset_id)
  );

INSERT INTO workspace_resource_grants
(grant_id, tenant_id, grantee_user_id, resource_type, resource_ref, permission, status, source, granted_by, metadata_json)
SELECT UUID(), @tenant_id, @owner_user_id, 'asset', CONCAT('platform_package_asset:', a.asset_id), 'manage', 'active', 'system_sync', @admin_actor_id,
       JSON_OBJECT('source','capability_vault_skill_asset_sync','package_key',p.package_key,'package_asset_id',a.asset_id,'source_path',a.source_path,'runtime_enabled',false,'runtime_tool_grants_created',false,'advisory_catalog_visible',true,'webfetch_enabled',CASE WHEN p.package_key='skillpack_seo_geo_claude_skills' THEN false ELSE NULL END)
FROM platform_private_package_assets a
JOIN platform_private_packages p ON p.package_id=a.package_id
WHERE p.package_key IN ('skillpack_superpowers','skillpack_seo_geo_claude_skills')
  AND a.asset_type='skill'
  AND a.runtime_import_allowed=1
  AND NOT EXISTS (
    SELECT 1 FROM workspace_resource_grants wrg
     WHERE wrg.tenant_id=@tenant_id
       AND wrg.grantee_user_id=@owner_user_id
       AND wrg.resource_type='asset'
       AND wrg.resource_ref=CONCAT('platform_package_asset:', a.asset_id)
  );

-- Advisory-only routes and workflows.
INSERT INTO task_routes
(task_key, trigger_terms, route_modules, execution_layer, priority, enabled, output_focus, notes, route_id, active, intent_key, request_type, route_mode, target_module, workflow_key, lifecycle_mode, memory_required, logging_required, review_required, allowed_states, degraded_action, blocked_action, match_rule, route_source, last_validated_at)
VALUES
('tenant_superpowers_advisory', 'debugging, systematic debugging, writing skills, testing, thinking, problem solving, planning, review, refactor, documentation, craft', 'platform_private_capability_vault_engine,tenant_superpowers_advisory,product_agent', 'Product Intelligence / Advisory Skill Routing', '78','true', 'Route tenant Superpowers planning, debugging, writing, review, and process-improvement requests to advisory skills only; no runtime tool execution.', 'Runtime actions remain blocked unless explicit tool grants exist.', 'route_tenant_superpowers_advisory','true','tenant.superpowers.advisory','productivity_process_advisory','advisory_only','tenant_superpowers_advisory','workflow_superpowers_advisory_no_execution','active','false','true','false','planning,review,code_suggestion,documentation,debugging_guidance,writing_guidance','ask_clarifying_question','block_runtime_actions_without_explicit_tool_grant', JSON_OBJECT('all_of',JSON_ARRAY(CONCAT('tenant_id:',@tenant_id)),'forbidden_runtime_actions_without_grant',JSON_ARRAY('file_write','deploy','shell','package_install','publish','secret_read','provider_write','webfetch')), 'db_registry_capability_vault', DATE_FORMAT(NOW(), '%Y-%m-%dT%H:%i:%sZ')),
('tenant_seo_geo_advisory', 'seo, geo, llm seo, ai search, content quality, domain authority, entity optimization, topical authority, keyword research, content audit, search visibility', 'platform_private_capability_vault_engine,tenant_seo_geo_advisory,product_agent', 'Growth Intelligence / Advisory Skill Routing', '82','true', 'Route tenant SEO/GEO planning, audits, and recommendations to advisory skills only; WebFetch and runtime tools stay disabled without explicit grants.', 'WebFetch/runtime actions remain blocked unless explicit grants exist.', 'route_tenant_seo_geo_advisory','true','tenant.seo_geo.advisory','seo_geo_growth_advisory','advisory_only','tenant_seo_geo_advisory','workflow_seo_geo_advisory_no_execution','active','false','true','false','planning,review,content_audit,recommendation,documentation','ask_for_brand_url_or_target_market_context','block_runtime_or_webfetch_without_explicit_tool_grant', JSON_OBJECT('all_of',JSON_ARRAY(CONCAT('tenant_id:',@tenant_id)),'forbidden_runtime_actions_without_grant',JSON_ARRAY('file_write','deploy','shell','package_install','publish','secret_read','provider_write','webfetch')), 'db_registry_capability_vault', DATE_FORMAT(NOW(), '%Y-%m-%dT%H:%i:%sZ'))
ON DUPLICATE KEY UPDATE active=VALUES(active), workflow_key=VALUES(workflow_key), blocked_action=VALUES(blocked_action), match_rule=VALUES(match_rule), last_validated_at=VALUES(last_validated_at), updated_at=CURRENT_TIMESTAMP;

INSERT INTO workflows
(workflow_id, workflow_name, module_mode, trigger_source, input_type, primary_objective, mapped_engines, engine_order, workflow_type, primary_output, priority, route_key, execution_mode, user_facing, parent_layer, status, workflow_key, active, target_module, execution_class, lifecycle_mode, route_compatibility, memory_required, logging_required, review_required, allowed_states, degraded_action, blocked_action, registry_source, last_validated_at)
VALUES
('wf_tenant_superpowers_advisory_noexec','Tenant Superpowers Advisory No-Execution Workflow','tenant_advisory_skill','prompt_router,task_route','natural_language_or_structured_task','Resolve tenant productivity/debugging/writing/process requests into advisory responses while blocking runtime actions without explicit grants.','platform_private_capability_vault_engine,tenant_superpowers_advisory,product_agent','1:prompt_router;2:capability_vault_resolver;3:tenant_variant_overlay;4:product_agent_advisory_response;5:runtime_gate','advisory_only','Bounded advisory response only. No file writes, installs, shell, deploys, provider writes, webfetch, or secrets.','78','route_tenant_superpowers_advisory','dry_run_advisory','true','platform_private_capability_vault','active','workflow_superpowers_advisory_no_execution','true','tenant_superpowers_advisory','standard','active','route_tenant_superpowers_advisory','false','true','false','planning,review,code_suggestion,documentation,debugging_guidance,writing_guidance','ask_for_goal_or_artifact_context','block_runtime_actions_without_explicit_tool_grant','db_registry_capability_vault',DATE_FORMAT(NOW(), '%Y-%m-%dT%H:%i:%sZ')),
('wf_tenant_seo_geo_advisory_noexec','Tenant SEO/GEO Advisory No-Execution Workflow','tenant_advisory_skill','prompt_router,task_route','natural_language_or_structured_task','Resolve tenant SEO/GEO/content authority requests into advisory recommendations and audit plans while blocking WebFetch and runtime actions without explicit grants.','platform_private_capability_vault_engine,tenant_seo_geo_advisory,product_agent','1:prompt_router;2:capability_vault_resolver;3:tenant_variant_overlay;4:product_agent_advisory_response;5:webfetch_runtime_gate;6:runtime_gate','advisory_only','Bounded advisory response only. No WebFetch, provider writes, file writes, installs, shell, deploys, or secrets.','82','route_tenant_seo_geo_advisory','dry_run_advisory','true','platform_private_capability_vault','active','workflow_seo_geo_advisory_no_execution','true','tenant_seo_geo_advisory','standard','active','route_tenant_seo_geo_advisory','false','true','false','planning,review,content_audit,recommendation,documentation','ask_for_brand_url_target_market_or_content_context','block_runtime_or_webfetch_without_explicit_tool_grant','db_registry_capability_vault',DATE_FORMAT(NOW(), '%Y-%m-%dT%H:%i:%sZ'))
ON DUPLICATE KEY UPDATE workflow_key=VALUES(workflow_key), active=VALUES(active), execution_mode=VALUES(execution_mode), blocked_action=VALUES(blocked_action), last_validated_at=VALUES(last_validated_at), updated_at=CURRENT_TIMESTAMP;
