-- Sprint 69: grant logic evaluation only to healthy active agents selected by active task routes.
-- Additive/idempotent. No provider execution, external writes, or secret reads.

INSERT IGNORE INTO `agent_skill_grants`
  (`grant_id`, `agent_id`, `skill_id`, `tenant_id`, `brand_key`, `granted_by`, `status`)
SELECT DISTINCT
  CONCAT(
    SUBSTRING(MD5(CONCAT('supervisor-route-logic:', a.agent_id)), 1, 8), '-',
    SUBSTRING(MD5(CONCAT('supervisor-route-logic:', a.agent_id)), 9, 4), '-',
    SUBSTRING(MD5(CONCAT('supervisor-route-logic:', a.agent_id)), 13, 4), '-',
    SUBSTRING(MD5(CONCAT('supervisor-route-logic:', a.agent_id)), 17, 4), '-',
    SUBSTRING(MD5(CONCAT('supervisor-route-logic:', a.agent_id)), 21, 12)
  ),
  a.agent_id,
  sk.skill_id,
  NULL,
  NULL,
  'supervisor_runtime_activation',
  'active'
FROM `task_routes` tr
JOIN `agents` a
  ON BINARY a.execution_layer = BINARY tr.execution_layer
 AND a.status = 'active'
 AND a.health_status = 'active'
JOIN `agent_skills` sk
  ON sk.skill_key = 'logic.evaluate_pack'
 AND sk.status = 'active'
WHERE LOWER(COALESCE(NULLIF(TRIM(tr.active), ''), NULLIF(TRIM(tr.enabled), ''), 'false'))
        IN ('true', '1', 'yes', 'active', 'enabled')
  AND NOT EXISTS (
    SELECT 1
    FROM `agent_skill_grants` existing
    WHERE BINARY existing.agent_id = BINARY a.agent_id
      AND BINARY existing.skill_id = BINARY sk.skill_id
      AND existing.tenant_id IS NULL
      AND existing.status = 'active'
      AND (existing.expires_at IS NULL OR existing.expires_at > NOW())
  );
