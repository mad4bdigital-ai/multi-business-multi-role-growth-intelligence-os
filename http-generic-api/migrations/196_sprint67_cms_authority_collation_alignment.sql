-- Sprint 67: CMS authority collation alignment
-- Align CMS authority join keys with users/memberships/resource authority tables on production collation.

ALTER TABLE cms_sites
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;

ALTER TABLE cms_sites
  MODIFY site_id varchar(36) COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY app_key varchar(64) COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY normalized_domain varchar(255) COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY canonical_target_key varchar(255) COLLATE utf8mb4_uca1400_ai_ci NULL;

ALTER TABLE cms_site_access_grants
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;

ALTER TABLE cms_site_access_grants
  MODIFY grant_id varchar(36) COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY site_id varchar(36) COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY tenant_id varchar(36) COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY user_id varchar(36) COLLATE utf8mb4_uca1400_ai_ci NULL,
  MODIFY workspace_id varchar(36) COLLATE utf8mb4_uca1400_ai_ci NULL,
  MODIFY connection_id varchar(36) COLLATE utf8mb4_uca1400_ai_ci NULL,
  MODIFY claim_id varchar(36) COLLATE utf8mb4_uca1400_ai_ci NULL;
