-- Sprint 58b: Fix Cloudflare endpoint route_target values.
--
-- Dynamic endpoint dispatch validates that route_target is consistent with the
-- requested parent_action_key. The initial Cloudflare seed used operation names
-- as route_target, which made /admin/system/tools/call reject the rows before
-- provider execution.

UPDATE `endpoints`
   SET `route_target` = 'cloudflare_api',
       `updated_at` = CURRENT_TIMESTAMP,
       `notes` = CONCAT(COALESCE(`notes`, ''), CASE WHEN `notes` IS NULL OR `notes` = '' THEN '' ELSE '\n' END, 'migration_069 normalized route_target for system-layer endpoint binding')
 WHERE `parent_action_key` = 'cloudflare_api'
   AND `endpoint_key` IN ('cf_list_zones', 'cf_list_dns_records', 'cf_list_tunnels', 'cf_get_tunnel')
   AND `route_target` <> 'cloudflare_api';
