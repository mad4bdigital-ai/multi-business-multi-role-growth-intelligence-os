-- Sprint 66: admin tool registry updated_at column.
-- Ensures admin_platform_endpoint_tools has an updated_at column so registry
-- updates can expose operational freshness without requiring external audit
-- joins. This is additive and idempotent for current production schema.

ALTER TABLE admin_platform_endpoint_tools
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;
