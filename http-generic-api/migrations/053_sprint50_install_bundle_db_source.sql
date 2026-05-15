-- Sprint 50: Install bundle reads config from DB instead of env vars.
-- The local_connector_install_bundle tool now accepts user_id + device_id
-- and resolves cf_token / connector_secret from local_connector_user_configs.
-- Falls back to CLOUDFLARE_TUNNEL_TOKEN env only if no DB record exists.
-- Run POST /local-connector/install first to provision a new device.

UPDATE `admin_platform_endpoint_tools`
SET
  description = 'Generate a pre-filled Windows .bat installer for the local connector stack (cloudflared + Node.js service via NSSM). Reads cf_token and connector_secret from local_connector_user_configs in DB for the given user_id + device_id. Falls back to server env only if no DB row exists. Uploads to Google Drive, returns a shareable download link. User saves the .bat and runs as Administrator — cloudflared and NSSM are installed automatically if missing. Both services auto-restart on failure and reboot.',
  input_schema = '{
    "type": "object",
    "properties": {
      "user_id":   { "type": "string", "description": "User ID whose device config to load from DB. Defaults to platform admin." },
      "device_id": { "type": "string", "description": "Device ID (hostname) to load config for. Defaults to mohammedlap." }
    }
  }',
  http_method  = 'GET',
  http_path    = '/admin/cli/local-connector/install-bundle'
WHERE tool_key = 'local_connector_install_bundle';
