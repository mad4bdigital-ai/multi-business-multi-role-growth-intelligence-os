-- Create the canonical Growth Intelligence Platform brand container and attach it
-- to the Platform Admin Workspace. The migration is additive and idempotent.

INSERT INTO containers (
  container_id,
  tenant_id,
  container_key,
  container_type_key,
  canonical_subject_type,
  canonical_subject_ref,
  display_name,
  status,
  version,
  metadata_json,
  created_by,
  updated_by
)
SELECT
  'ee4b3966-3afa-5bbb-ad93-563a4a3a1b9f',
  '00000000-0000-0000-0000-000000000000',
  'brand:growth_intelligence_platform',
  'brand',
  'brand_target_key',
  'growth_intelligence_platform',
  'Growth Intelligence Platform',
  'active',
  1,
  '{"topology_role":"platform_brand","brand_target_key":"growth_intelligence_platform","managed_by":"20260730_growth_intelligence_platform_brand_container"}',
  'platform_admin_service',
  'platform_admin_service'
WHERE EXISTS (
  SELECT 1
  FROM tenants
  WHERE tenant_id = '00000000-0000-0000-0000-000000000000'
    AND tenant_type = 'platform_owner'
    AND status = 'active'
)
  AND EXISTS (
    SELECT 1
    FROM brands
    WHERE target_key = 'growth_intelligence_platform'
      AND status = 'active'
  )
  AND EXISTS (
    SELECT 1
    FROM container_type_registry
    WHERE container_type_key = 'brand'
      AND status = 'active'
  )
  AND EXISTS (
    SELECT 1
    FROM containers
    WHERE container_id = '2b387496-c9f3-4f4e-a131-0249dd9714f1'
      AND tenant_id = '00000000-0000-0000-0000-000000000000'
      AND container_type_key = 'workspace'
      AND canonical_subject_type = 'workspace'
      AND canonical_subject_ref = 'b50db01b-617e-4b7a-8bda-6bf4876f754f'
      AND status = 'active'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM containers
    WHERE container_id = 'ee4b3966-3afa-5bbb-ad93-563a4a3a1b9f'
       OR (
         tenant_id = '00000000-0000-0000-0000-000000000000'
         AND container_type_key = 'brand'
         AND canonical_subject_type = 'brand_target_key'
         AND canonical_subject_ref = 'growth_intelligence_platform'
       )
  );

INSERT INTO container_relationships (
  relationship_id,
  tenant_id,
  from_container_id,
  to_container_id,
  relationship_type_key,
  priority,
  conditions_json,
  status,
  version,
  created_by,
  approved_by,
  metadata_json
)
SELECT
  '2a619ab8-1138-537a-a2c2-352233a70945',
  '00000000-0000-0000-0000-000000000000',
  '2b387496-c9f3-4f4e-a131-0249dd9714f1',
  brand_container.container_id,
  'contains',
  100,
  NULL,
  'active',
  1,
  'platform_admin_service',
  'platform_admin_service',
  '{"topology_role":"platform_admin_workspace_contains_platform_brand","managed_by":"20260730_growth_intelligence_platform_brand_container"}'
FROM containers brand_container
WHERE brand_container.tenant_id = '00000000-0000-0000-0000-000000000000'
  AND brand_container.container_type_key = 'brand'
  AND brand_container.canonical_subject_type = 'brand_target_key'
  AND brand_container.canonical_subject_ref = 'growth_intelligence_platform'
  AND brand_container.status = 'active'
  AND EXISTS (
    SELECT 1
    FROM containers workspace_container
    WHERE workspace_container.container_id = '2b387496-c9f3-4f4e-a131-0249dd9714f1'
      AND workspace_container.tenant_id = '00000000-0000-0000-0000-000000000000'
      AND workspace_container.container_type_key = 'workspace'
      AND workspace_container.canonical_subject_type = 'workspace'
      AND workspace_container.canonical_subject_ref = 'b50db01b-617e-4b7a-8bda-6bf4876f754f'
      AND workspace_container.status = 'active'
  )
  AND EXISTS (
    SELECT 1
    FROM container_relationship_type_registry
    WHERE relationship_type_key = 'contains'
      AND status = 'active'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM container_relationships existing_relationship
    WHERE existing_relationship.relationship_id = '2a619ab8-1138-537a-a2c2-352233a70945'
       OR (
         existing_relationship.tenant_id = '00000000-0000-0000-0000-000000000000'
         AND existing_relationship.from_container_id = '2b387496-c9f3-4f4e-a131-0249dd9714f1'
         AND existing_relationship.to_container_id = brand_container.container_id
         AND existing_relationship.relationship_type_key = 'contains'
         AND existing_relationship.status = 'active'
       )
  );
