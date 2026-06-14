-- Sprint 69: type-aware Agent Skill runtime coverage and governed prompt enrichment metadata.
-- safety-contract: no_credential_payload_read true
-- safety-contract: no_raw_secrets true
-- safety-contract: no_external_send true
-- safety-contract: secrets_included=false
-- Additive/backward-compatible view replacement. No provider calls, no secret reads, no external writes.

CREATE OR REPLACE VIEW v_skill_runtime_coverage AS
SELECT coverage.*,
       CASE
         WHEN coverage.agent_skill_status <> 'active' THEN 'inactive_skill'
         WHEN coverage.active_grant_count = 0 THEN 'missing_active_grant'
         WHEN coverage.manifest_required = 1 AND coverage.active_manifest_count = 0 THEN 'missing_active_manifest'
         WHEN coverage.prompt_required = 1 AND coverage.manifest_prompt_present = 0 THEN 'missing_manifest_prompt'
         ELSE 'ready'
       END AS runtime_binding_status,
       CASE
         WHEN coverage.manifest_required = 1 THEN 'active_grant+active_manifest+manifest_prompt'
         WHEN coverage.approval_required = 1 THEN 'active_grant+runtime_approval'
         ELSE 'active_grant'
       END AS coverage_basis,
       CASE
         WHEN coverage.agent_skill_status = 'active'
          AND coverage.active_grant_count > 0
          AND (coverage.manifest_required = 0 OR coverage.active_manifest_count > 0)
          AND (coverage.prompt_required = 0 OR coverage.manifest_prompt_present > 0)
         THEN 'covered'
         ELSE 'gap'
       END AS coverage_status
FROM (
  SELECT s.skill_key,
         s.display_name,
         s.skill_type,
         s.scope,
         s.status AS agent_skill_status,
         s.requires_approval AS approval_required,
         COUNT(DISTINCT CASE
           WHEN g.status = 'active' AND (g.expires_at IS NULL OR g.expires_at > CURRENT_TIMESTAMP)
           THEN g.grant_id END) AS active_grant_count,
         MAX(CASE WHEN m.status = 'active' THEN 1 ELSE 0 END) AS active_manifest_count,
         MAX(CASE WHEN m.status = 'active' AND NULLIF(TRIM(m.prompt_template), '') IS NOT NULL THEN 1 ELSE 0 END) AS manifest_prompt_present,
         MAX(CASE WHEN p.status = 'active' THEN 1 ELSE 0 END) AS active_platform_prompt_count,
         MAX(CASE WHEN m.status = 'active' THEN m.status ELSE NULL END) AS manifest_status,
         MAX(CASE WHEN p.status = 'active' THEN p.status ELSE NULL END) AS prompt_registry_status,
         CASE
           WHEN JSON_EXTRACT(s.capability_json, '$.skill_manifest_key') IS NOT NULL
             OR JSON_EXTRACT(s.capability_json, '$.package_key') IS NOT NULL
           THEN 1 ELSE 0
         END AS manifest_required,
         CASE
           WHEN s.skill_type = 'logic_execution'
            AND (JSON_EXTRACT(s.capability_json, '$.skill_manifest_key') IS NOT NULL
              OR JSON_EXTRACT(s.capability_json, '$.package_key') IS NOT NULL)
           THEN 1 ELSE 0
         END AS prompt_required
    FROM agent_skills s
    LEFT JOIN agent_skill_grants g
      ON g.skill_id = s.skill_id
    LEFT JOIN skill_manifests m
      ON m.skill_key COLLATE utf8mb4_unicode_ci = s.skill_key COLLATE utf8mb4_unicode_ci
    LEFT JOIN platform_engine_skill_prompt_registry p
      ON p.skill_key COLLATE utf8mb4_unicode_ci = s.skill_key COLLATE utf8mb4_unicode_ci
   GROUP BY s.skill_key, s.display_name, s.skill_type, s.scope, s.status,
            s.requires_approval, s.capability_json
) coverage;

UPDATE admin_platform_endpoint_tools
   SET input_schema = JSON_OBJECT(
         'type', 'object',
         'additionalProperties', false,
         'properties', JSON_OBJECT(
           'skill_key', JSON_OBJECT('type','string'),
           'skill_type', JSON_OBJECT(
             'type','string',
             'enum', JSON_ARRAY('logic_execution','api_access','data_read','data_write','system_control')
           ),
           'coverage_status', JSON_OBJECT('type','string','enum',JSON_ARRAY('covered','gap')),
           'limit', JSON_OBJECT('type','integer','minimum',1,'maximum',250)
         )
       ),
       tags = 'admin,agent-governance,skills,coverage,typed,read-only,no-secrets',
       updated_at = CURRENT_TIMESTAMP
 WHERE tool_key = 'agent_governance_skill_coverage';
