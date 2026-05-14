-- Sprint 47: GPT session turn writing — performance indexes
-- Speeds up: open-session lookup (originator+started_at), turn replay (session_id+record_type+event_timestamp),
--            tenant-scoped session list (tenant_id+originator+started_at)

CREATE INDEX IF NOT EXISTS idx_cs_originator_started
  ON `customer_sessions` (originator, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_se_session_record_type
  ON `session_events` (session_id, record_type, event_timestamp ASC);

CREATE INDEX IF NOT EXISTS idx_cs_tenant_originator_started
  ON `customer_sessions` (tenant_id, originator, started_at DESC);
