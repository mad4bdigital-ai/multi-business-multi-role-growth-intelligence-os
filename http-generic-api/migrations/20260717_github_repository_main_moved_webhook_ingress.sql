-- Signed GitHub webhook ingress for repository.main_moved coordination.
-- This migration provisions reference metadata only. It does not create or store a webhook secret.

INSERT INTO secret_references
  (ref_id, tenant_id, owner_type, owner_id, action_key, provider_family,
   connector_family, credential_type, scope_json, consent_status,
   rotation_status, validation_status, status, secret_key, store_type, description)
VALUES
  ('d12f63ab-f9ad-4c22-8a56-13463104af34',
   '00000000-0000-0000-0000-000000000000',
   'platform', 'platform', 'repository_main_moved_webhook_ingest', 'github',
   'github_webhook', 'webhook_secret',
   JSON_OBJECT('repository','mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os','branch','main','event_types',JSON_ARRAY('ping','push')),
   'not_required', 'pending_initial_provisioning', 'pending_provisioning',
   'active', 'GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_SECRET', 'db_encrypted',
   'Reference-only metadata for signed GitHub repository main movement webhook verification. The encrypted value must be provisioned separately in platform_secrets.')
ON DUPLICATE KEY UPDATE
  tenant_id=VALUES(tenant_id), owner_type=VALUES(owner_type), owner_id=VALUES(owner_id),
  action_key=VALUES(action_key), provider_family=VALUES(provider_family), connector_family=VALUES(connector_family),
  credential_type=VALUES(credential_type), scope_json=VALUES(scope_json), consent_status=VALUES(consent_status),
  rotation_status=VALUES(rotation_status), validation_status=VALUES(validation_status), status=VALUES(status),
  secret_key=VALUES(secret_key), store_type=VALUES(store_type), description=VALUES(description);

INSERT INTO execution_policies
  (policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
VALUES
  ('Release Intelligence Governance','github_repository_main_moved_webhook_ingress_v1',
   JSON_OBJECT(
     'rule','signed_github_webhook_may_invoke_internal_repository_main_moved_coordinator_only',
     'enforcement_mode','blocking',
     'signature_algorithm','hmac-sha256',
     'signature_header','x-hub-signature-256',
     'event_header','x-github-event',
     'delivery_header','x-github-delivery',
     'allowed_events',JSON_ARRAY('ping','push'),
     'allowed_repository','mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os',
     'allowed_branch','main',
     'credential_ref','ref:secret:GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_SECRET',
     'fail_closed_when_secret_missing',true,
     'release_operation_creation_forbidden',true,
     'gate_mutation_forbidden',true,
     'capability_envelope_creation_forbidden',true,
     'job_enqueue_forbidden',true,
     'provider_calls_forbidden',true,
     'external_writes_forbidden',true,
     'execution_allowed',false,
     'secrets_included',false),
   'TRUE','repository_main_moved_webhook_ingest|repository_main_moved_trigger_coordinator',
   'githubRepositoryMainMovedWebhookService|repositoryMainMovedTriggerRoutes|credentialResolver',
   'TRUE','Webhook verification is fail-closed and may call only the existing advisory coordinator. Secret provisioning is a separate governed operation.')
ON DUPLICATE KEY UPDATE
  policy_value=VALUES(policy_value), active=VALUES(active), execution_scope=VALUES(execution_scope),
  affects_layer=VALUES(affects_layer), blocking=VALUES(blocking), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;
