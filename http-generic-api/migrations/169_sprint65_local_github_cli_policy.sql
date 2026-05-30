-- Sprint 65: clarify local GitHub CLI credential boundary.
--
-- The local connector /github endpoint runs the device-local gh CLI. It must not
-- be treated as the normal platform repo mutation path because it depends on
-- local gh installation/auth. Normal repo work should use the auth-host
-- GitHub App / DB-backed admin_control github route, where credentials are
-- resolved by governed backend registry/credential policy.

UPDATE `local_gateway_tools`
   SET `description` = 'Admin-only local GitHub CLI recovery when gh is installed and authenticated on the device. Prefer auth-host admin_control github for normal repo mutations because it uses the governed GitHub App / DB-backed credential route.',
       `credential_notes` = 'Requires explicit local gh CLI auth on the device. Does not read platform GitHub credentials from the local connector. Normal repo mutations use auth-host GitHub App / DB-backed admin_control github.',
       `notes` = 'Break-glass local CLI only. If GH_AUTH_REQUIRED is returned, use auth_host_admin_control_github instead of configuring secrets in the connector.'
 WHERE `tool_key` = 'local.admin.github_cli';

UPDATE `admin_platform_endpoint_tools`
   SET `description` = 'Run the device-local gh CLI only for admin break-glass recovery. Prefer admin_control github for normal repo reads/mutations; that path uses auth-host GitHub App / DB-backed credential resolution.',
       `tags` = 'local,device,github,admin_recovery,break_glass,requires_local_gh_auth,prefer_auth_host_github_app'
 WHERE `tool_key` = 'connector_github';

UPDATE `tenant_platform_endpoint_tools`
   SET `description` = 'Run the device-local gh CLI only where explicitly exposed and locally authenticated. Prefer governed auth-host GitHub App routes for platform repo work.',
       `tags` = 'local,device,github,admin_recovery,break_glass,requires_local_gh_auth,prefer_auth_host_github_app'
 WHERE `tool_key` = 'connector_github';
