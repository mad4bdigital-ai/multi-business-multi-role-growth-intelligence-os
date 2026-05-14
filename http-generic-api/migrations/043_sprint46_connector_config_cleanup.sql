-- Sprint 46: Clean up stale/placeholder local connector configs.
-- Removes seeded placeholders and nulls old-architecture tunnel refs.

-- ── 1. Remove seeded mohammedlap placeholder (no real tunnel, superseded by 910198dc) ──

DELETE FROM `local_connector_shell_allowlists`
  WHERE config_id = '00000000-0000-4000-b000-000000000001';

DELETE FROM `local_connector_file_access_rules`
  WHERE config_id = '00000000-0000-4000-b000-000000000001';

DELETE FROM `local_connector_app_routes`
  WHERE config_id = '00000000-0000-4000-b000-000000000001';

DELETE FROM `local_connector_user_configs`
  WHERE config_id = '00000000-0000-4000-b000-000000000001';

-- ── 2. Remove LOCAL-DEVICE-02-PENDING placeholder (disabled, no tunnel) ──

DELETE FROM `local_connector_shell_allowlists`
  WHERE config_id = '65fe5abc-4b86-11f1-b256-614c56cd019b';

DELETE FROM `local_connector_file_access_rules`
  WHERE config_id = '65fe5abc-4b86-11f1-b256-614c56cd019b';

DELETE FROM `local_connector_app_routes`
  WHERE config_id = '65fe5abc-4b86-11f1-b256-614c56cd019b';

DELETE FROM `local_connector_user_configs`
  WHERE config_id = '65fe5abc-4b86-11f1-b256-614c56cd019b';

-- ── 3. Null stale tunnel refs on DESKTOP-91FDEFP and nagy-mbp-m4 ──
-- CF tunnel f777e252 was inactive (old architecture, public DNS URL).
-- Deleted from Cloudflare. Clear DB refs so re-provisioning works cleanly.

UPDATE `local_connector_user_configs`
  SET tunnel_url = NULL,
      cf_tunnel_id = NULL,
      cf_tunnel_name = NULL,
      cf_token = NULL
  WHERE cf_tunnel_id = 'f777e252-9eb0-4bf4-b43e-ac499d1ed6a0';
