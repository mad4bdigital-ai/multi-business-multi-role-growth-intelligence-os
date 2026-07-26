-- Sprint 66: Tenant activation install guidance
-- Clarifies that tenant GPTs should not automatically call connect_device_install
-- when connect_status already reports a registered device. The released Local
-- Manager download page is the preferred handoff for optional device management.

UPDATE `tenant_platform_endpoint_tools`
   SET `description` = 'Read connection status, onboarding state, registered devices, Local Manager handoff URLs, and GPT guidance. If a registered device exists, do not call connect_device_install automatically; only offer Local Manager or call install when the user explicitly asks to add, replace, or reinstall a device.'
 WHERE `tool_key` = 'connect_status';

UPDATE `tenant_platform_endpoint_tools`
   SET `description` = 'Provision or retrieve a local connector install bundle only when no registered device exists or the user explicitly asks to add, replace, or reinstall a device. For existing devices, prefer the released Local Manager page returned by connect_status.'
 WHERE `tool_key` = 'connect_device_install';
