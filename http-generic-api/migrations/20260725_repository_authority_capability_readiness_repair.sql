-- Correct the unapplied repository authority and capability readiness repair.
-- Internal registry changes only: no provider call, webhook mutation, external write, or credential payload read.

INSERT INTO connected_systems
  (system_id, tenant_id, system_key, display_name, provider_family, provider_domain,
   connector_family, auth_type, service_mode, self_serve_capable, assisted_capable,
   managed_capable, status, config_json, created_at, updated_at)
VALUES
  ('2f4ce77b-0ef8-4d83-aec4-1fca5e332108',
   'f2795a7f-8d06-4053-8bee-35ca9af8b460',
   'github_rest_prod_platform_managed',
   'GitHub REST - Production Platform Managed',
   'github_com_connector',
   'https://api.github.com',
   'github_com_connector',
   NULL,
   'managed',
   0,
   1,
   1,
   'active',
   JSON_OBJECT(
     'source','migration:20260725_repository_authority_capability_readiness_repair',
     'execution_readiness','ready',
     'authority_role','repository_shared_platform_adapter',
     'provider_transport','http_generic_api',
     'provider_call_executed',FALSE,
     'external_write_executed',FALSE,
     'credential_payload_read',FALSE,
     'secrets_included',FALSE),
   CURRENT_TIMESTAMP,
   CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),
  provider_family=VALUES(provider_family),
  provider_domain=VALUES(provider_domain),
  connector_family=VALUES(connector_family),
  service_mode='managed',
  self_serve_capable=0,
  assisted_capable=1,
  managed_capable=1,
  status='active',
  config_json=VALUES(config_json),
  updated_at=CURRENT_TIMESTAMP;

UPDATE repository_authority_bindings authority
JOIN connected_systems system
  ON system.tenant_id='f2795a7f-8d06-4053-8bee-35ca9af8b460'
 AND system.system_key='github_rest_prod_platform_managed'
 AND system.status='active'
 AND system.managed_capable=1
SET authority.system_id=system.system_id,
    authority.installation_id=NULL,
    authority.authority_version=authority.authority_version+1,
    authority.lock_version=authority.lock_version+1,
    authority.metadata_json=JSON_MERGE_PATCH(
      COALESCE(authority.metadata_json, JSON_OBJECT()),
      JSON_OBJECT(
        'readiness_repair_migration','20260725_repository_authority_capability_readiness_repair',
        'system_authority_source','platform_managed_connected_system',
        'managed_system_key','github_rest_prod_platform_managed',
        'provider_call_executed',FALSE,
        'external_write_executed',FALSE,
        'credential_payload_read',FALSE,
        'secrets_included',FALSE)),
    authority.updated_at=CURRENT_TIMESTAMP
WHERE authority.binding_key='growth_intelligence_platform.github.primary.production'
  AND authority.system_binding_mode='shared_platform_adapter'
  AND authority.lifecycle_status='active'
  AND (
    NOT (
      authority.system_id COLLATE utf8mb4_unicode_ci
      <=> system.system_id COLLATE utf8mb4_unicode_ci
    )
    OR authority.installation_id IS NOT NULL
  );

UPDATE repository_capability_bindings capability
JOIN capability_apply_authorization_policy_registry policy
  ON policy.policy_key='github_repository_main_moved_webhook_provision_apply_v1'
 AND policy.app_key='github'
 AND policy.capability_key=capability.capability_key
 AND policy.operation_intent=capability.operation_intent
 AND policy.runtime_surface='system_layer'
 AND policy.status='active'
SET capability.policy_key=policy.policy_key,
    capability.capability_version=capability.capability_version+1,
    capability.lock_version=capability.lock_version+1,
    capability.metadata_json=JSON_MERGE_PATCH(
      COALESCE(capability.metadata_json, JSON_OBJECT()),
      JSON_OBJECT(
        'readiness_repair_migration','20260725_repository_authority_capability_readiness_repair',
        'policy_authority_source','capability_apply_authorization_policy_registry',
        'provider_call_executed',FALSE,
        'external_write_executed',FALSE,
        'credential_payload_read',FALSE,
        'secrets_included',FALSE)),
    capability.updated_at=CURRENT_TIMESTAMP
WHERE capability.capability_binding_key='growth_intelligence_platform.github.repository_main_moved_webhook.production'
  AND capability.lifecycle_status='active'
  AND NOT (capability.policy_key <=> policy.policy_key);
