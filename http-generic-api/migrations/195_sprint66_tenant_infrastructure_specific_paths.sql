-- Sprint 66: Explicit tenant infrastructure readiness paths
-- Moves tenant DB/SSH readiness tools to auth-type-specific paths so GET
-- tools do not rely on body/default auth_type injection.

UPDATE tenant_platform_endpoint_tools
   SET http_path = '/me/infrastructure/database/connections/{connection_id}/status',
       fixed_body = NULL,
       tags = 'tenant,infrastructure,database,status,read_only,no_secrets,no_network,no_query,auth_scoped,specific_path'
 WHERE tool_key = 'tenant_database_connection_status';

UPDATE tenant_platform_endpoint_tools
   SET http_path = '/me/infrastructure/database/connections/{connection_id}/preflight',
       fixed_body = NULL,
       tags = 'tenant,infrastructure,database,preflight,dry_run,read_only,no_secrets,no_network,no_query,auth_scoped,specific_path'
 WHERE tool_key = 'tenant_database_preflight';

UPDATE tenant_platform_endpoint_tools
   SET http_path = '/me/infrastructure/ssh/connections/{connection_id}/status',
       fixed_body = NULL,
       tags = 'tenant,infrastructure,ssh,status,read_only,no_secrets,no_command,no_network,auth_scoped,specific_path'
 WHERE tool_key = 'tenant_ssh_connection_status';

UPDATE tenant_platform_endpoint_tools
   SET http_path = '/me/infrastructure/ssh/connections/{connection_id}/preflight',
       fixed_body = NULL,
       tags = 'tenant,infrastructure,ssh,preflight,dry_run,read_only,no_secrets,no_command,no_network,auth_scoped,specific_path'
 WHERE tool_key = 'tenant_ssh_preflight';
