START TRANSACTION;

INSERT INTO platform_semantic_capabilities (
  capability_key, display_name, description, resource_type, operation_key,
  risk_class, default_execution_mode, input_schema_json, output_schema_json,
  default_policy_key, requires_connection, requires_workspace_authority,
  requires_approval, requires_audit_evidence, requires_readback,
  schema_version, status, notes
) VALUES (
  'connector.inventory.read',
  'Read Connector Inventory',
  'Resolve a no-secret, scope-aware connector readiness projection for a platform administrator or tenant principal.',
  'connector_collection',
  'read',
  'A',
  'preview',
  '{"type":"object","properties":{"tenantId":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":100},"cursor":{"type":"string"}},"additionalProperties":false}',
  '{"type":"object","required":["manifest","items","page","secretsIncluded"],"properties":{"manifest":{"type":"object"},"items":{"type":"array"},"page":{"type":"object"},"secretsIncluded":{"const":false}},"additionalProperties":false}',
  NULL,
  0, 0, 0, 1, 0,
  1,
  'active',
  'UEACP phase 1 read-only shadow capability. No execution authority, provider call, credential payload read, or external write.'
)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  resource_type = VALUES(resource_type),
  operation_key = VALUES(operation_key),
  risk_class = VALUES(risk_class),
  default_execution_mode = VALUES(default_execution_mode),
  input_schema_json = VALUES(input_schema_json),
  output_schema_json = VALUES(output_schema_json),
  requires_connection = VALUES(requires_connection),
  requires_workspace_authority = VALUES(requires_workspace_authority),
  requires_approval = VALUES(requires_approval),
  requires_audit_evidence = VALUES(requires_audit_evidence),
  requires_readback = VALUES(requires_readback),
  schema_version = VALUES(schema_version),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

COMMIT;
