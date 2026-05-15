-- Sprint 49: Local connector install bundle tool
-- Allows admin GPT to generate a pre-filled Windows .bat installer for the
-- Cloudflare tunnel connector and hand the user a Drive download link.

INSERT INTO `admin_platform_endpoint_tools`
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, sort_order)
VALUES
('local_connector_install_bundle',
 'Generate Connector Installer',
 'Generate a pre-filled Windows .bat installer for the Cloudflare tunnel connector (connector.mad4b.com). Reads CLOUDFLARE_TUNNEL_TOKEN from server env, embeds it in the script, uploads to Google Drive, and returns a shareable download link. User saves the file and runs as Administrator — cloudflared is installed automatically if missing.',
 'GET', '/admin/cli/local-connector/install-bundle',
 NULL,
 NULL,
 NULL,
 'admin,cloudflare,local_connector', 67)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description  = VALUES(description),
  tags         = VALUES(tags);
