-- Sprint 65: Browser runtime adapter request tools
-- These tools are policy-gated request/session gates. They do not execute runtime
-- providers until each provider has a validated adapter, credentials where needed,
-- and same-cycle smoke evidence.

INSERT INTO `admin_platform_endpoint_tools`
  (`tool_key`, `display_name`, `description`, `http_method`, `http_path`, `input_schema_json`, `tags`, `is_enabled`, `sort_order`)
VALUES
  (
    'browser_runtime_visual_takeover_run',
    'Browser Runtime Visual Takeover Request',
    'Policy-gated visual takeover request gate for Auto Browser. Creates a pending runtime session until adapter PoC is validated.',
    'POST',
    '/browser-runtime/visual-takeover/run',
    '{"type":"object","required":["url"],"properties":{"binding_key":{"type":"string","default":"auto_browser_takeover_essam"},"url":{"type":"string"},"explicit_approval":{"type":"boolean"},"ttl_seconds":{"type":"integer"}}}',
    'admin,browser-runtime,visual-takeover,state_changing,audited,no_secrets,policy_gated,adapter_pending',
    1,
    149
  ),
  (
    'browser_runtime_persistent_session_run',
    'Browser Runtime Persistent Session Request',
    'Policy-gated persistent browser session request gate for Vessel Browser. Creates a pending session until adapter PoC is validated.',
    'POST',
    '/browser-runtime/persistent-session/run',
    '{"type":"object","required":["url","session_reuse_approved"],"properties":{"binding_key":{"type":"string","default":"vessel_persistent_essam"},"url":{"type":"string"},"session_reuse_approved":{"type":"boolean"},"ttl_seconds":{"type":"integer"}}}',
    'admin,browser-runtime,persistent-session,state_changing,audited,no_secrets,policy_gated,adapter_pending',
    1,
    150
  ),
  (
    'browser_runtime_cloud_extract_run',
    'Browser Runtime Cloud Extraction Request',
    'Policy-gated cloud public extraction request gate for Oxylabs Browser Agent. Remains credential-required pending PoC until credentials and adapter are configured.',
    'POST',
    '/browser-runtime/cloud-extract/run',
    '{"type":"object","required":["url"],"properties":{"binding_key":{"type":"string","default":"oxylabs_cloud_extraction"},"url":{"type":"string"},"ttl_seconds":{"type":"integer"}}}',
    'admin,browser-runtime,cloud-extraction,state_changing,audited,no_secrets,policy_gated,credential_pending,adapter_pending',
    1,
    151
  ),
  (
    'browser_runtime_stealth_extract_run',
    'Browser Runtime Stealth Extraction Request',
    'Policy-gated stealth public extraction request gate for CloakBrowser candidate. Candidate-only until review and PoC are complete.',
    'POST',
    '/browser-runtime/stealth-extract/run',
    '{"type":"object","required":["url"],"properties":{"binding_key":{"type":"string","default":"cloak_browser_stealth_public_extraction_candidate"},"url":{"type":"string"},"ttl_seconds":{"type":"integer"}}}',
    'admin,browser-runtime,stealth-extraction,state_changing,audited,no_secrets,policy_gated,candidate_only,adapter_pending',
    1,
    152
  )
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `http_method` = VALUES(`http_method`),
  `http_path` = VALUES(`http_path`),
  `input_schema_json` = VALUES(`input_schema_json`),
  `tags` = VALUES(`tags`),
  `is_enabled` = VALUES(`is_enabled`),
  `sort_order` = VALUES(`sort_order`);
