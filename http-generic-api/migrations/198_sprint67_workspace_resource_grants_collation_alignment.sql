-- Sprint 67: Workspace resource grants collation alignment
-- Align resource grant join keys with memberships/tenants/users on production collation.

ALTER TABLE workspace_resource_grants
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;

ALTER TABLE workspace_resource_grants
  MODIFY grant_id varchar(36) COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY tenant_id varchar(36) COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY grantee_user_id varchar(36) COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY resource_ref varchar(255) COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY granted_by varchar(36) COLLATE utf8mb4_uca1400_ai_ci NULL,
  MODIFY revoked_by varchar(36) COLLATE utf8mb4_uca1400_ai_ci NULL;
