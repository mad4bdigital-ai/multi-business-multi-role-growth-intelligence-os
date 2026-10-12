-- Tenant GPT OAuth server-owned correlation reference.
-- Additive only. request_correlation_ref maps to the stable OAuth correlation operation_id.
-- No foreign key is added: OAuth authorization begins before an Activation run/session exists.

ALTER TABLE `tenant_gpt_oauth_authorization_codes`
  ADD COLUMN IF NOT EXISTS `request_correlation_ref` VARCHAR(36) NULL AFTER `redirect_uri_hash`;

ALTER TABLE `tenant_gpt_oauth_authorization_codes`
  ADD INDEX IF NOT EXISTS `idx_tenant_gpt_oauth_codes_correlation_ref` (`request_correlation_ref`);
