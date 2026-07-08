-- Sprint 69: declare explicit same-cycle readback for operational alert mutations.
-- Additive metadata repair only. No provider calls, external sends, credentials, or alert execution.

UPDATE admin_platform_endpoint_tools
   SET tags = CASE tool_key
     WHEN 'activation_operational_attention_sync_api'
       THEN 'admin,activation,alerts,sync,state_changing,sql_only,in_app_notification,readback,same_cycle_readback,no_provider_call,no_external_send,no_secrets'
     WHEN 'activation_operational_alert_lifecycle_api'
       THEN 'admin,activation,alerts,lifecycle,state_changing,audited,readback,same_cycle_readback,no_secrets'
     ELSE tags
   END
 WHERE tool_key IN (
   'activation_operational_attention_sync_api',
   'activation_operational_alert_lifecycle_api'
 );
