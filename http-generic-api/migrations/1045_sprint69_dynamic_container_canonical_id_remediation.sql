-- Sprint 69: Dynamic container canonical identity remediation
-- Purpose:
--   Repair the one platform-tenant canonical identity collision detected by governed
--   projection readback and deactivate the orphan artifacts created by the failed run.
-- Safety:
--   - Idempotent and scoped to one tenant, one missing planned container ID, and derived artifacts.
--   - Preserves the existing canonical container_id and normalizes its key/type/subject fields.
--   - Disables orphan relationships, role assignments, resource bindings, graph edges, and graph node.
--   - Leaves derived closure cleanup to the governed projection transaction, which rebuilds closure rows per tenant.
--   - No provider call, credential payload read, external write, secret read, or raw endpoint activation.
-- Readback after apply:
--   1. Existing canonical tenant container uses container_id 00000000-0000-4000-a000-00000000c001.
--   2. No active relationship, role assignment, resource binding, graph node, or graph edge references
--      70a55858-ded7-4cc5-af76-f3de11753b2d.
--   3. Closure rows are rebuilt and verified by the subsequent governed projection apply.

UPDATE `containers`
   SET `container_key` = 'tenant:00000000-0000-0000-0000-000000000000',
       `container_type_key` = 'tenant',
       `canonical_subject_type` = 'tenant',
       `canonical_subject_ref` = '00000000-0000-0000-0000-000000000000',
       `display_name` = COALESCE((
         SELECT `display_name`
           FROM `tenants`
          WHERE `tenant_id` = '00000000-0000-0000-0000-000000000000'
          LIMIT 1
       ), `display_name`),
       `status` = 'active',
       `updated_by` = 'migration_1045_canonical_id_remediation',
       `updated_at` = UTC_TIMESTAMP()
 WHERE `container_id` = '00000000-0000-4000-a000-00000000c001'
   AND `tenant_id` = '00000000-0000-0000-0000-000000000000';

UPDATE `container_relationships`
   SET `status` = 'disabled',
       `updated_at` = UTC_TIMESTAMP()
 WHERE `tenant_id` = '00000000-0000-0000-0000-000000000000'
   AND `status` = 'active'
   AND (`from_container_id` = '70a55858-ded7-4cc5-af76-f3de11753b2d'
        OR `to_container_id` = '70a55858-ded7-4cc5-af76-f3de11753b2d');

UPDATE `container_role_assignments`
   SET `status` = 'disabled',
       `updated_at` = UTC_TIMESTAMP()
 WHERE `tenant_id` = '00000000-0000-0000-0000-000000000000'
   AND `status` = 'active'
   AND `container_id` = '70a55858-ded7-4cc5-af76-f3de11753b2d';

UPDATE `container_resource_bindings`
   SET `status` = 'disabled',
       `updated_at` = UTC_TIMESTAMP()
 WHERE `tenant_id` = '00000000-0000-0000-0000-000000000000'
   AND `status` = 'active'
   AND `container_id` = '70a55858-ded7-4cc5-af76-f3de11753b2d';

UPDATE `platform_graph_edges`
   SET `lifecycle_status` = 'disabled',
       `updated_at` = UTC_TIMESTAMP()
 WHERE `source_node_id` = 'container:70a55858-ded7-4cc5-af76-f3de11753b2d'
    OR `target_node_id` = 'container:70a55858-ded7-4cc5-af76-f3de11753b2d';

UPDATE `platform_graph_nodes`
   SET `lifecycle_status` = 'disabled',
       `updated_at` = UTC_TIMESTAMP()
 WHERE `node_id` = 'container:70a55858-ded7-4cc5-af76-f3de11753b2d'
    OR (`source_table` = 'containers'
        AND `source_pk` = '70a55858-ded7-4cc5-af76-f3de11753b2d');

DELETE FROM `container_closure`
 WHERE `ancestor_container_id` = '70a55858-ded7-4cc5-af76-f3de11753b2d'
    OR `descendant_container_id` = '70a55858-ded7-4cc5-af76-f3de11753b2d';
