-- Sprint 51: SQL-primary data source — finalize Sheets as helper/mirror only.
--
-- Sheets is no longer a runtime fallback for /governance/execution-log-latest.
-- Two changes:
--   1. governance_execution_log (existing tool) now reads from SQL execution_log table.
--   2. New tool governance_execution_log_sheets_recovery — explicit Sheets mirror
--      readback for admin recovery and parity verification.
--   3. New tool platform_data_source_census — returns row counts per SQL table +
--      Sheets mirror configuration; lets admin GPT audit migration completeness
--      without invoking raw SQL.

-- ── Update the existing execution-log tool description ────────────────────────
UPDATE `admin_platform_endpoint_tools`
SET
  description = 'Returns the most recent rows from execution_log SQL table for audit and trace lookups. SQL is the runtime source of truth; the Sheets mirror is async-only. Use governance_execution_log_sheets_recovery if you need to read from the Sheets mirror directly for parity verification or break-glass recovery.',
  display_name = 'Execution Log Latest (SQL)'
WHERE tool_key = 'governance_execution_log';

-- ── New tool: Sheets recovery readback for the execution log ──────────────────
INSERT INTO `admin_platform_endpoint_tools`
  (tool_key, display_name, description, http_method, http_path,
   path_param_keys, input_schema, fixed_body, tags, sort_order)
VALUES
('governance_execution_log_sheets_recovery',
 'Execution Log Sheets Recovery',
 'Reads the latest execution log primary row from the Google Sheets mirror. Use this only for parity verification with the SQL source of truth or for break-glass recovery when SQL execution_log is unavailable. The runtime authority is governance_execution_log (SQL).',
 'GET', '/governance/execution-log-sheets-recovery',
 NULL,
 NULL,
 NULL,
 'governance,recovery,sheets_mirror',
 75)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description  = VALUES(description),
  tags         = VALUES(tags);

-- ── New tool: data-source census ──────────────────────────────────────────────
INSERT INTO `admin_platform_endpoint_tools`
  (tool_key, display_name, description, http_method, http_path,
   path_param_keys, input_schema, fixed_body, tags, sort_order)
VALUES
('platform_data_source_census',
 'Platform Data Source Census',
 'Returns row counts and last-write timestamps for every SQL table in the platform registry (brands, actions, endpoints, plugins, execution_log, etc.) plus the Sheets mirror configuration. Use this to confirm SQL is the runtime authority, to find empty tables that may need seeding, or before any migration repair work.',
 'GET', '/admin/cli/data-source/census',
 NULL,
 NULL,
 NULL,
 'admin,data_source,audit',
 76)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description  = VALUES(description),
  tags         = VALUES(tags);
