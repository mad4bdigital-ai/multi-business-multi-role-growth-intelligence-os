-- Sprint 61: governed session archive relink shell aliases
--
-- Documents built-in admin_control shell aliases in the admin tool registry schema.
-- The aliases themselves are implemented in routes/adminCliRoutes.js:
--   - session_archive_relink_repair_dry_run
--   - session_archive_relink_repair_apply
--
-- Idempotent. No DELETE/TRUNCATE/DROP.

UPDATE admin_platform_endpoint_tools
SET input_schema = JSON_SET(
      CASE
        WHEN JSON_VALID(COALESCE(NULLIF(input_schema,''),'{}'))
          THEN COALESCE(NULLIF(input_schema,''),'{}')
        ELSE '{"type":"object","properties":{}}'
      END,
      '$.properties.alias.description',
      'For tool=shell/action=run, use an allowlisted alias. Built-in aliases include session_archive_relink_repair_dry_run and session_archive_relink_repair_apply.',
      '$.properties.extra_args.description',
      'Additional arguments passed only to allowlisted shell aliases that permit them. For session archive relink aliases, pass required --key=value fields; dry_run rejects --apply and apply rejects --dry-run.'
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE tool_key = 'admin_control';
