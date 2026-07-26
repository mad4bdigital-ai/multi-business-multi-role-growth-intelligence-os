-- Sprint 65: CloakBrowser candidate runtime
-- Adds CloakBrowser as a governed browser runtime candidate only.
-- This does not activate execution. Activation requires license, supply-chain,
-- binary trust, abuse-prevention, and proxy policy review plus a platform PoC.

INSERT INTO `browser_runtime_registry` (
  `runtime_key`,
  `provider`,
  `display_name`,
  `device_id`,
  `capability_class`,
  `capabilities_json`,
  `degraded_capabilities_json`,
  `status`,
  `endpoint_url`,
  `public_url`,
  `metadata_json`
) VALUES (
  'cloak_browser_candidate_v1',
  'cloakbrowser',
  'CloakBrowser Stealth Chromium Candidate',
  NULL,
  'stealth_public_extraction',
  '["playwright_api_compatible","puppeteer_api_compatible","stealth_chromium","humanized_interactions","persistent_profiles_candidate","docker_candidate"]',
  '["not_validated_in_platform","binary_trust_review_required","proxy_policy_review_required","captcha_avoidance_policy_review_required","not_for_credentials_by_default"]',
  'candidate_under_review',
  NULL,
  'https://github.com/CloakHQ/CloakBrowser',
  '{"source_url":"https://github.com/CloakHQ/CloakBrowser","use_case":"stealth_public_extraction","candidate_reason":"Stealth Chromium with Playwright and Puppeteer compatible APIs. Useful candidate for public extraction and anti-bot protected public pages after governance review.","classification_notes":["candidate only","do not use for credentialed sessions by default","requires license and binary supply-chain review","requires proxy cost and abuse policy before activation"],"install_options":{"python":"pip install cloakbrowser","node":"npm install cloakbrowser playwright-core","docker":"docker run --rm cloakhq/cloakbrowser cloaktest"},"governance":{"domain_allowlist_required":true,"audit_required":true,"no_credential_logging":true,"no_cookie_token_echo":true,"no_payment_or_checkout_submit":true,"explicit_approval_for_proxy_use":true,"explicit_approval_for_login_session_reuse":true,"artifact_redaction_required":true},"review_status":"candidate_added_pending_poc"}'
)
ON DUPLICATE KEY UPDATE
  `provider` = VALUES(`provider`),
  `display_name` = VALUES(`display_name`),
  `device_id` = VALUES(`device_id`),
  `capability_class` = VALUES(`capability_class`),
  `capabilities_json` = VALUES(`capabilities_json`),
  `degraded_capabilities_json` = VALUES(`degraded_capabilities_json`),
  `status` = VALUES(`status`),
  `endpoint_url` = VALUES(`endpoint_url`),
  `public_url` = VALUES(`public_url`),
  `metadata_json` = VALUES(`metadata_json`);

INSERT INTO `browser_runtime_bindings` (
  `binding_key`,
  `runtime_key`,
  `use_case`,
  `tenant_id`,
  `user_id`,
  `allowed_brands_json`,
  `allowed_actions_json`,
  `domain_allowlist_json`,
  `policy_json`,
  `status`
) VALUES (
  'cloak_browser_stealth_public_extraction_candidate',
  'cloak_browser_candidate_v1',
  'stealth_public_extraction',
  NULL,
  NULL,
  '[]',
  '["public_page_extract","site_diagnostics","anti_bot_public_page_poc"]',
  '["mad4b.com","n8n.mad4b.com"]',
  '{"candidate_only":true,"activation_requires":["license_review","binary_trust_review","supply_chain_review","proxy_policy_review","abuse_prevention_review","poc_success"],"blocked_by_default":["credentialed_login","session_reuse","payment_or_checkout_submit","destructive_clicks","captcha_solving_service"],"controls":{"domain_allowlist_required":true,"audit_required":true,"no_credential_logging":true,"no_cookie_token_echo":true,"explicit_approval_for_proxy_use":true,"artifact_redaction_required":true}}',
  'planned'
)
ON DUPLICATE KEY UPDATE
  `runtime_key` = VALUES(`runtime_key`),
  `use_case` = VALUES(`use_case`),
  `tenant_id` = VALUES(`tenant_id`),
  `user_id` = VALUES(`user_id`),
  `allowed_brands_json` = VALUES(`allowed_brands_json`),
  `allowed_actions_json` = VALUES(`allowed_actions_json`),
  `domain_allowlist_json` = VALUES(`domain_allowlist_json`),
  `policy_json` = VALUES(`policy_json`),
  `status` = VALUES(`status`);
