-- Sprint 53: Register admin-facing session turn and session end as platform tools.
--
-- Purely additive. No table drops, no column changes, no row deletes. The
-- routes already exist at /gpt/sessions/{id}/turn and /gpt/sessions/{id}/end
-- in gptSessionRoutes.js. This migration only registers them in
-- admin_platform_endpoint_tools so the admin GPT can reach them via
-- callAdminTool. Without these rows, admin control-plane sessions stay at
-- turn_count=0 with no Drive transcript even though the route handlers and
-- the sessionArchiveService are fully wired -- the admin GPT has no
-- governed path to call them.
--
-- Both INSERTs use ON DUPLICATE KEY UPDATE so the migration is idempotent.
-- Re-running it refreshes the description/path/input_schema without
-- duplicating rows.
--
-- Important: this file contains no semicolons inside any string literal,
-- per the migrator parser constraint recorded in migration 055.

INSERT INTO `admin_platform_endpoint_tools`
  (tool_key, display_name, description, http_method, http_path,
   path_param_keys, input_schema, fixed_body, tags, sort_order, is_enabled)
VALUES
('gpt_session_turn_write',
 'GPT Session Turn Write',
 'Append one conversation turn to the active customer_sessions row. Records the full content to the Drive transcript Doc and JSONL sidecar, and stores a bounded preview, sha256 hash, and Drive anchor in gpt_session_turns. Call this after each user prompt and after each assistant reply so the admin GPT session has a complete archive. The session_id from getActivationSessionContext is the id path parameter.',
 'POST', '/gpt/sessions/{id}/turn',
 '["id"]',
 '{"type":"object","required":["id","role","content"],"properties":{"id":{"type":"string","description":"session_id returned by getActivationSessionContext"},"role":{"type":"string","enum":["user","assistant","tool"]},"content":{"type":"string","description":"Full turn content. The platform writes this to Drive and stores only a bounded preview plus hash in SQL."},"action_key":{"type":"string","description":"Optional governed action key when the turn is a tool call result."}}}',
 NULL,
 'session,archive,writeback',
 77,
 1)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description  = VALUES(description),
  http_method  = VALUES(http_method),
  http_path    = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  tags         = VALUES(tags),
  is_enabled   = VALUES(is_enabled);

INSERT INTO `admin_platform_endpoint_tools`
  (tool_key, display_name, description, http_method, http_path,
   path_param_keys, input_schema, fixed_body, tags, sort_order, is_enabled)
VALUES
('gpt_session_end',
 'GPT Session End',
 'Close the active customer_sessions row. Optionally writes a session_summaries row with the supplied summary text, finalizes the Drive transcript through closeGptSessionArchive, and triggers the exportSessionToDrive pipeline so drive_export_url is populated for activation readback. Call this when the conversation completes or at handoff.',
 'POST', '/gpt/sessions/{id}/end',
 '["id"]',
 '{"type":"object","required":["id"],"properties":{"id":{"type":"string","description":"session_id returned by getActivationSessionContext"},"summary":{"type":"string","description":"Optional summary text written to session_summaries."},"user_email":{"type":"string","description":"Optional user email used by the Drive export pipeline."}}}',
 NULL,
 'session,archive,writeback',
 78,
 1)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description  = VALUES(description),
  http_method  = VALUES(http_method),
  http_path    = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  tags         = VALUES(tags),
  is_enabled   = VALUES(is_enabled);
