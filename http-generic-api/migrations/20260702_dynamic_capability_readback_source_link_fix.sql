-- Spec 007 PR4 follow-up: deterministically register the readback contract authority.
-- The original migration used INSERT ... SELECT from a capability key that was not present,
-- which allowed a successful zero-row statement. This follow-up uses the canonical existing
-- governance capability directly so the authority link is always materialized idempotently.
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
  SHA2(CONCAT('spec007:readback-contract-authority:', 'platform_capability_governance_compile_persist'), 256),
  'platform_capability_governance_compile_persist',
  'readback_contract_registry',
  'platform_capability_readback_contracts',
  NULL,
  'declared',
  1.0000,
  NULL,
  JSON_OBJECT(
    'schema_version', 'dynamic-capability-readback-contract-v1',
    'authority', 'mysql_primary',
    'canonical_capability_key', 'platform_capability_governance_compile_persist',
    'certification_authority_reused', 'platform_capability_certifications',
    'specialized_certification_source_reused', 'runtime_dispatch_certification_registry',
    'adapter_authority_reused', 'platform_resource_adapters',
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
