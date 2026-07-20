-- Tenant tool input-schema strictness hardening
--
-- Repairs every currently enabled Tenant tool schema and installs a durable
-- database invariant so future enabled rows cannot be missing, non-object, or
-- top-level open-ended. Nested objects retain their existing flexibility.

UPDATE tenant_platform_endpoint_tools
SET input_schema = JSON_OBJECT(
      'type', 'object',
      'additionalProperties', FALSE,
      'properties', JSON_OBJECT()
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE is_enabled = 1
  AND (input_schema IS NULL OR TRIM(input_schema) = '');

UPDATE tenant_platform_endpoint_tools
SET input_schema = JSON_SET(input_schema, '$.additionalProperties', FALSE),
    updated_at = CURRENT_TIMESTAMP
WHERE is_enabled = 1
  AND JSON_VALID(input_schema) = 1
  AND JSON_UNQUOTE(JSON_EXTRACT(input_schema, '$.type')) = 'object'
  AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(input_schema, '$.additionalProperties')), '') <> 'false';

SET @tenant_tool_schema_constraint_sql := (
  SELECT CASE
    WHEN COUNT(*) > 0
    THEN 'SELECT 1 AS tenant_tool_schema_constraint_present'
    ELSE 'ALTER TABLE tenant_platform_endpoint_tools ADD CONSTRAINT chk_tenant_platform_enabled_input_schema_strict CHECK (is_enabled = 0 OR (input_schema IS NOT NULL AND JSON_VALID(input_schema) = 1 AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(input_schema, ''$.type'')), '''') = ''object'' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(input_schema, ''$.additionalProperties'')), '''') = ''false''))'
  END
  FROM information_schema.table_constraints
  WHERE table_schema = DATABASE()
    AND table_name = 'tenant_platform_endpoint_tools'
    AND constraint_name = 'chk_tenant_platform_enabled_input_schema_strict'
);

PREPARE tenant_tool_schema_constraint_stmt FROM @tenant_tool_schema_constraint_sql;
EXECUTE tenant_tool_schema_constraint_stmt;
DEALLOCATE PREPARE tenant_tool_schema_constraint_stmt;
