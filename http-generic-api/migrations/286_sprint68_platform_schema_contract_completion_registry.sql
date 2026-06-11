-- Sprint 68: Platform-wide schema contract completion registry persistence
-- Purpose:
--   Persist direct registry adjustments made during platform-wide schema contract completion:
--   - align github_git_data to the shared GitHub parent schema reference;
--   - add explicit endpoint-native synthetic schemas for actions without parent OpenAPI source;
--   - clear readiness from inactive endpoints that had no schema_json.
-- Safety:
--   Idempotent UPDATE-only migration. No secrets. No provider execution.

UPDATE actions
   SET openai_schema_ref='ref:schema:github_rest_compiled_openai_v1',
       openai_schema_file_name='github_rest_compiled_openai_schema.yaml',
       openai_schema_storage_surface='sql_runtime_registry',
       updated_at=NOW()
 WHERE action_key='github_git_data'
   AND openai_schema_file_id='action_schema:github_git_data';

UPDATE endpoints
   SET schema_json = JSON_OBJECT(
         'operationId', 'list_contacts',
         'method', 'GET',
         'path', '/contacts',
         'summary', 'List CRM contacts',
         'parameters', JSON_OBJECT(
           'query', JSON_OBJECT(
             'limit', JSON_OBJECT('type','integer','minimum',1,'maximum',500),
             'cursor', JSON_OBJECT('type','string')
           )
         ),
         'responses', JSON_OBJECT(
           '200', JSON_OBJECT(
             'type','object',
             'properties', JSON_OBJECT(
               'items', JSON_OBJECT('type','array','items',JSON_OBJECT('type','object')),
               'page', JSON_OBJECT('type','object')
             )
           )
         )
       ),
       schema_overlay_status='validated_synthetic_endpoint_native_contract',
       schema_overlay_notes=JSON_OBJECT('reason','Endpoint-native CRM action had no parent OpenAPI source; added explicit minimal contract for runtime schema completeness','secrets_included',false),
       inventory_source='synthetic_endpoint_native_contract',
       schema_imported_at=COALESCE(schema_imported_at, NOW()),
       updated_at=NOW()
 WHERE parent_action_key='crm.contact.list'
   AND endpoint_key='crm.contact.list'
   AND status='active'
   AND (schema_json IS NULL OR schema_overlay_status='validated_synthetic_endpoint_native_contract');

UPDATE endpoints
   SET schema_json = JSON_OBJECT(
         'operationId', 'platform_native_wordpress_blog_publish_recovery',
         'method', 'POST',
         'path', '/platform/wordpress/blog-publish-recovery',
         'summary', 'Platform-native WordPress blog publish recovery diagnostic',
         'requestBody', JSON_OBJECT(
           'type','object',
           'properties',JSON_OBJECT(
             'target_key',JSON_OBJECT('type','string'),
             'post_id',JSON_OBJECT('type','integer'),
             'dry_run',JSON_OBJECT('type','boolean')
           )
         ),
         'responses', JSON_OBJECT('200', JSON_OBJECT('type','object'))
       ),
       schema_overlay_status='validated_synthetic_endpoint_native_contract',
       schema_overlay_notes=JSON_OBJECT('reason','Platform-native recovery route is not part of WordPress public OpenAPI parent schema; added explicit minimal contract for runtime schema completeness','secrets_included',false),
       inventory_source='synthetic_endpoint_native_contract',
       schema_imported_at=COALESCE(schema_imported_at, NOW()),
       updated_at=NOW()
 WHERE parent_action_key='wordpress_api'
   AND endpoint_key='wordpress_blog_publish_recovery'
   AND status='active'
   AND (schema_json IS NULL OR schema_overlay_status='validated_synthetic_endpoint_native_contract');

UPDATE endpoints
   SET execution_readiness='not_ready_inactive_missing_schema',
       schema_overlay_status='inactive_endpoint_execution_readiness_cleared',
       schema_overlay_notes=JSON_OBJECT('reason','Inactive endpoint had execution_readiness=ready while schema_json was missing; cleared from ready inventory during platform-wide schema contract completion','secrets_included',false),
       updated_at=NOW()
 WHERE execution_readiness='ready'
   AND schema_json IS NULL
   AND status <> 'active';
