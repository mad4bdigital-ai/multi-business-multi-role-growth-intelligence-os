-- Add the canonical SQL provenance link required by the capability assurance compiler.
-- The resolver code change is deployed separately; this migration is additive and idempotent.
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false

INSERT INTO platform_capability_source_links (
  link_id,
  capability_key,
  source_kind,
  source_ref,
  source_sha,
  resolution_status,
  confidence,
  evidence_id,
  metadata_json,
  observed_at,
  updated_at
)
VALUES (
  SHA2(CONCAT(
    'tenant_tool.tenant_connection_effective_credential_plan_view',
    '|mysql_registry|',
    'tenant_platform_endpoint_tools:tenant_connection_effective_credential_plan_view'
  ), 256),
  'tenant_tool.tenant_connection_effective_credential_plan_view',
  'mysql_registry',
  'tenant_platform_endpoint_tools:tenant_connection_effective_credential_plan_view',
  NULL,
  'resolved',
  1.0000,
  NULL,
  JSON_OBJECT(
    'source_table', 'tenant_platform_endpoint_tools',
    'source_key', 'tenant_connection_effective_credential_plan_view',
    'reconciled_by', 'platform_capability_assurance_reconcile',
    'provider_calls', false,
    'external_writes', false,
    'credential_payload_reads', false,
    'secrets_included', false
  ),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON DUPLICATE KEY UPDATE
  capability_key = VALUES(capability_key),
  source_kind = VALUES(source_kind),
  source_ref = VALUES(source_ref),
  source_sha = VALUES(source_sha),
  resolution_status = VALUES(resolution_status),
  confidence = VALUES(confidence),
  evidence_id = VALUES(evidence_id),
  metadata_json = VALUES(metadata_json),
  observed_at = VALUES(observed_at),
  updated_at = CURRENT_TIMESTAMP;
