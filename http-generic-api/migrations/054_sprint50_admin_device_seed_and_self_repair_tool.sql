-- Sprint 50: Seed admin device (mohammedlap) in local_connector_user_configs
-- and add local_connector_self_repair GPT tool.
--
-- The admin device row anchors the default install-bundle DB lookup:
--   user_id  = platform admin UUID
--   device_id = mohammedlap
-- cf_token and connector_secret are NULL here — they are populated on the
-- first call to GET /admin/cli/local-connector/install-bundle (env fallback
-- writes them back to DB via COALESCE UPDATE).
-- cf_tunnel_id is the known active tunnel for connector.mad4b.com.

INSERT INTO `local_connector_user_configs`
  (config_id, user_id, tenant_id, device_id, tunnel_url,
   cf_tunnel_id, cf_tunnel_name, cf_token, connector_secret, is_enabled)
VALUES
  ('910198dc-0000-4000-b000-000000000001',
   '00000000-0000-4000-a000-000000000002',
   '00000000-0000-4000-a000-000000000001',
   'mohammedlap',
   'https://connector.mad4b.com',
   '95e4ba8c-782b-4819-9f80-04af4457ce73',
   'mohammedlap-connector',
   NULL,
   NULL,
   1)
ON DUPLICATE KEY UPDATE
  tunnel_url    = VALUES(tunnel_url),
  cf_tunnel_id  = VALUES(cf_tunnel_id),
  cf_tunnel_name= VALUES(cf_tunnel_name),
  is_enabled    = 1;

-- ── Self-repair GPT tool ──────────────────────────────────────────────────────
-- GPT calls this automatically when connector.mad4b.com returns 1033.
-- Checks CF tunnel status, generates install bundle from DB config, uploads
-- to Drive, returns diagnosis + download link in a single response.

INSERT INTO `admin_platform_endpoint_tools`
  (tool_key, display_name, description, http_method, http_path,
   path_param_keys, input_schema, fixed_body, tags, sort_order)
VALUES
('local_connector_self_repair',
 'Repair Local Connector',
 'Self-repair action for the admin local connector. Call this whenever connector.mad4b.com returns error 1033 or the connector is unreachable. Reads device config (cf_token, connector_secret) from local_connector_user_configs in DB, checks Cloudflare tunnel health via API, generates a pre-filled Windows .bat installer (cloudflared + NSSM Node service), uploads to Google Drive, and returns a diagnosis object + download link. The user downloads the .bat and runs as Administrator — both services are installed and configured to auto-restart. Defaults to admin user + mohammedlap device.',
 'POST', '/admin/cli/local-connector/self-repair',
 NULL,
 '{
   "type": "object",
   "properties": {
     "user_id":   { "type": "string", "description": "User ID whose device to repair. Defaults to platform admin." },
     "device_id": { "type": "string", "description": "Device hostname to repair. Defaults to mohammedlap." }
   }
 }',
 NULL,
 'admin,local_connector,self_repair',
 68)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description  = VALUES(description),
  input_schema = VALUES(input_schema),
  tags         = VALUES(tags);
