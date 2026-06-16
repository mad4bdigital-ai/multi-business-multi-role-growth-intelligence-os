-- Migration execution safety: no_provider_call true; no_credential_payload_read true; no_raw_secrets true;
-- no_external_send true; no_external_write true; secrets_included=false.
-- Sprint 69: retire the legacy chain dispatch tool that lacks explicit delegation opt-in fields.
-- Runtime already rejects calls without manual API opt-in; this removes the misleading tool surface.

UPDATE admin_platform_endpoint_tools
SET is_enabled = 0,
    description = 'Disabled: use agent_chain_event_dispatch_manual with explicit manual API delegation opt-in.',
    tags = 'admin,agents,delegation,legacy,disabled,manual-api-required,no-secrets',
    updated_at = CURRENT_TIMESTAMP
WHERE tool_key = 'agent_chain_event_dispatch'
  AND is_enabled <> 0;
