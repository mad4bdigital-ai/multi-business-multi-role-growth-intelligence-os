-- Sprint 65: Local connector direct fallback secondary API key
-- Adds an optional per-device local API key used only as a direct/break-glass
-- connector auth alias. connector_secret remains the primary auth-host proxy secret.

ALTER TABLE `local_connector_user_configs`
  ADD COLUMN IF NOT EXISTS `connector_local_api_key` VARCHAR(256) NULL
  COMMENT 'Optional per-device direct connector break-glass API key alias; written to CONNECTOR_LOCAL_API_KEY on installer repair.'
  AFTER `connector_secret`;
