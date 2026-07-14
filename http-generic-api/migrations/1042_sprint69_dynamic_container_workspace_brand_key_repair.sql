-- Sprint 69: Dynamic container workspace Brand key namespace repair
-- Purpose:
--   Repair workspace_registry.linked_brand_key values that were seeded with brand
--   display/normalized names instead of canonical brands.target_key values. The dynamic
--   container projection service resolves workspace linked brands through target_key;
--   these mismatches produce high-risk held identity issues and block useful shadow samples.
-- Safety:
--   - Scoped to six verified one-to-one workspace_id + tenant_id + current linked_brand_key pairs.
--   - Updates only linked_brand_key and updated_at.
--   - No schema change, no destructive write, no provider call, no external send, no secret read.
--   - activation_smoke_workspace is intentionally excluded because activation_smoke_brand has no
--     canonical brands.target_key match in the same-cycle readback.
-- Readback after apply:
--   1. The six workspace rows should resolve directly to brands.target_key.
--   2. dynamic_container_projection_dry_run should no longer report the six brand namespace high-risk issues.
--   3. dynamic_container_rollout_readiness may still be insufficient_samples until shadow evidence exists.

UPDATE `workspace_registry`
   SET `linked_brand_key` = CASE `workspace_id`
     WHEN 'f54a3f38-11f5-42bf-bd88-d02a29d6b2de' THEN 'allroyalegypt_wp'
     WHEN 'ddaa8900-3ba2-404d-8dbc-5efabcb2a310' THEN 'almallah_wp'
     WHEN 'acc3c6f4-b0f2-43cd-80fa-d2c04322212c' THEN 'arab_cooling'
     WHEN '2e63e36b-8080-4c1c-9143-b863a5d6aa53' THEN 'donatours_wp'
     WHEN '5e13af4a-57a1-42ed-9231-61688b8d3da4' THEN 'dreamdesert_wp'
     WHEN 'a5bc3549-1de8-4ea4-a453-e1496954cc60' THEN 'egypttourgates_wp'
     ELSE `linked_brand_key`
   END,
       `updated_at` = CURRENT_TIMESTAMP
 WHERE (`workspace_id`, `tenant_id`, `linked_brand_key`) IN (
   ('f54a3f38-11f5-42bf-bd88-d02a29d6b2de', '4bc39fca-270e-4daa-b373-db75e1f36ccd', 'allroyalegypt brand'),
   ('ddaa8900-3ba2-404d-8dbc-5efabcb2a310', 'a3a85f32-e5f5-4c35-bda2-7435af71c855', 'almallah group'),
   ('acc3c6f4-b0f2-43cd-80fa-d2c04322212c', '65f3f066-eefa-4625-9023-8318c858e94b', 'Arab Cooling'),
   ('2e63e36b-8080-4c1c-9143-b863a5d6aa53', '5751a185-e9bf-4d2b-b62f-2d66712496fe', 'dona tours'),
   ('5e13af4a-57a1-42ed-9231-61688b8d3da4', '20a71f0b-baa0-4bd9-949b-c55be5916c97', 'dream desert brand'),
   ('a5bc3549-1de8-4ea4-a453-e1496954cc60', '63835b65-00cb-4d22-94fd-1b18e6e9e200', 'egypttourgates')
 );
