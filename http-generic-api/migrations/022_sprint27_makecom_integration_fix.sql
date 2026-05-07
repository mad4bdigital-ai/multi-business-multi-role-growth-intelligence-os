-- Sprint 27: Fix Make.com integration — rename misnamed action, add MCP client connection type.

UPDATE `actions`
SET
  action_key       = 'makecom_mcp_client',
  action_title     = 'Make.com MCP Client',
  connector_family = 'makecom_mcp_connector',
  module_binding   = 'makecom_mcp_connector',
  endpoint_group   = 'makecom_mcp',
  route_target     = 'makecom_mcp_client',
  notes            = 'Make.com MCP client connector. Calls Make.com MCP JSON-RPC endpoint as a client. Auth: mcp_token via token-in-URL (/mcp/u/{token}/stateless) or Authorization Bearer header. Zone-configurable via api_base_url. Renamed from make_mcp_server in Sprint 27.',
  updated_at       = NOW()
WHERE action_id = 'ACT-CAND-MCP-001';

INSERT INTO `app_integrations`
  (app_key, display_name, category, auth_type, description, docs_url, status)
VALUES
  ('makecom_mcp', 'Make.com MCP', 'automation', 'bearer_token',
   'Connect to Make.com as an MCP client — use your Make scenarios as callable tools via the MCP JSON-RPC protocol',
   'https://www.make.com/en/help/mcp', 'active')
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  status       = VALUES(status);

UPDATE `app_integrations`
SET description = 'Manage and trigger Make.com scenarios via the Make.com REST API (Authorization: Token). Use for programmatic scenario control.'
WHERE app_key = 'makecom';
