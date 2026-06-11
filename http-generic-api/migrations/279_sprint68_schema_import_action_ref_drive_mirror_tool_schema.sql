-- Sprint 68: Schema import action-ref Drive mirror tool schema
-- Purpose:
--   Expose explicit admin-only Drive mirroring parameters for schema_import_action_ref.
--   The route mirrors parent schemas into json_assets before split import so runtime does not depend on Drive.

UPDATE admin_platform_endpoint_tools
   SET description = 'Resolve an action parent schema reference and split it into endpoint-level schema_json contracts while preserving the parent action as a lightweight reference. Optionally mirrors an admin-approved Drive parent schema into json_assets before import. Does not return secrets.',
       input_schema = '{"type":"object","required":["action_key"],"properties":{"action_key":{"type":"string"},"imported_by":{"type":"string"},"preserve_parent_schema_reference":{"type":"boolean","default":true},"mirror_drive_if_needed":{"type":"boolean","default":false,"description":"When true, mirror the action parent schema from an approved Drive file into json_assets before importing."},"source_drive_file_id":{"type":"string","description":"Optional explicit Google Drive file id. If omitted, the route may use the action schema file id or governed notes-derived Drive file id."},"dry_run":{"type":"boolean","default":false}}}',
       tags = 'schema,admin,openapi,reference_preservation,drive_mirror,no_secrets'
 WHERE tool_key = 'schema_import_action_ref';
