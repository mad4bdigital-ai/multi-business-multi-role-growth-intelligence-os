-- Credential authority hardening: separate explicit platform binding permission
-- from implicit platform fallback permission for the read-only resolution-plan tool.
-- Additive metadata contract only. No secret values, provider calls, or Production apply.

UPDATE `admin_platform_endpoint_tools`
SET `input_schema` = JSON_SET(
      CASE
        WHEN JSON_VALID(COALESCE(NULLIF(`input_schema`, ''), '{}')) THEN `input_schema`
        ELSE JSON_OBJECT('type','object','properties',JSON_OBJECT(),'additionalProperties',FALSE)
      END,
      '$.properties.allow_platform_binding',
      JSON_OBJECT(
        'type','boolean',
        'default',TRUE,
        'description','When false, explicit platform-owned credential bindings are excluded independently of implicit platform fallback.'
      )
    ),
    `description` = 'Read-only credential lifecycle diagnostic. Separately controls explicit platform bindings and implicit platform fallback; returns pointer metadata and effective status without credential values.',
    `updated_at` = CURRENT_TIMESTAMP
WHERE `tool_key` = 'credential_effective_plan';
