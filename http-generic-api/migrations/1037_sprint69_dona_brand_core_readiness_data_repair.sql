-- Sprint 69: DONA Brand Core readiness data repair
-- Purpose:
--   Repair legacy DONA Tours Brand Core rows after the shared growth-audit evidence tool
--   exposed incomplete resource IDs and inactive readiness flags.
-- Safety:
--   - Scoped to brand_key = 'donatours_wp' and the known legacy row IDs only.
--   - No schema change.
--   - No destructive update.
--   - No provider call, no external send, no secret read or return.
--   - Keeps Google file-read capability bindings in shadow mode.

UPDATE `brand_core`
   SET `doc_id` = CASE `id`
     WHEN 76 THEN '1mGairpFES7rooCuTvL8BwyCrM50rMD2YLZVxF38vqys'
     WHEN 77 THEN '1QT2M4FA4V2nvXTPBgZRwo0e3QM5xVBshe0wpmN0R5zo'
     WHEN 78 THEN '14EKu9_ys9fFLUwbVxCU7EgqBPPXIVfRzixip91VPkPM'
     WHEN 79 THEN '13mk7fLQZYOu0OtR0cHMtLSLpMG967vn1jDvtHqocbLU'
     WHEN 80 THEN '1_Ft_7zFohqAvOEH5wpBNz-YAn1g6bzP3xgJInLMRubg'
     WHEN 81 THEN '1-uYHeB3kAROjq8NhUJD5HMGjmIDgGUcsdUHhCfB4Ywg'
     WHEN 82 THEN '1MtlXT5msOpDNGACSH20o9xLH7zUZqw-wuIZG8gChd8s'
     WHEN 83 THEN '1JV66r4EaNEA-vBz4jzxE2nhnQ7Gk7_yvsFHUXITbvLE'
     WHEN 84 THEN '10uHoDT_t6GyDVvN41t-gvGkM_73nGnRWvh6A5eEjJ6M'
     WHEN 85 THEN '1cSDhSy7i4o1F_Q0yrtNyYo0rWm4pNQXJ0NmKgOKsQ2o'
     ELSE `doc_id`
   END,
       `file_id` = CASE `id`
     WHEN 86 THEN '1XEsSO5E11n-fUPdnMMA-VOFFiwIYEdQp'
     ELSE `file_id`
   END,
       `active_status` = 'TRUE',
       `updated_at` = CURRENT_TIMESTAMP
 WHERE `brand_key` = 'donatours_wp'
   AND `brand_name` = 'DONA Tours'
   AND `id` BETWEEN 76 AND 86
   AND `google_drive_link` IS NOT NULL
   AND (
     `active_status` IS NULL
     OR TRIM(`active_status`) = ''
     OR `doc_id` IS NULL
     OR TRIM(`doc_id`) = ''
     OR (`id` = 86 AND (`file_id` IS NULL OR TRIM(`file_id`) = ''))
   );

SELECT
  COUNT(*) AS dona_brand_core_rows,
  SUM(CASE WHEN COALESCE(NULLIF(TRIM(`active_status`), ''), '') = 'TRUE' THEN 1 ELSE 0 END) AS active_rows,
  SUM(CASE WHEN `id` = 86 AND COALESCE(NULLIF(TRIM(`file_id`), ''), '') <> '' THEN 1
           WHEN `id` <> 86 AND COALESCE(NULLIF(TRIM(`doc_id`), ''), '') <> '' THEN 1
           ELSE 0 END) AS resource_id_rows
FROM `brand_core`
WHERE `brand_key` = 'donatours_wp'
  AND `brand_name` = 'DONA Tours'
  AND `id` BETWEEN 76 AND 86;
