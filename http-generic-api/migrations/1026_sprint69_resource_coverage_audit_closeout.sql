-- Sprint 69: Resource API coverage audit closeout.
-- Safety: metadata-only descriptor alignment. No provider calls, external sends,
-- credential reads, hard deletion, table deletion, archive execution, or secret material.

UPDATE platform_resource_type_registry
   SET operation_policy_json=JSON_SET(
         COALESCE(operation_policy_json,JSON_OBJECT()),
         '$.archive',
         CASE resource_key
           WHEN 'sessions' THEN 'completed_state_only'
           WHEN 'executions' THEN 'blocked_by_policy'
           WHEN 'approvals' THEN 'blocked_by_policy'
           WHEN 'resource_api_governance' THEN 'migration_only'
         END
       ),
       updated_at=CURRENT_TIMESTAMP
 WHERE status='active'
   AND resource_key IN ('sessions','executions','approvals','resource_api_governance');
