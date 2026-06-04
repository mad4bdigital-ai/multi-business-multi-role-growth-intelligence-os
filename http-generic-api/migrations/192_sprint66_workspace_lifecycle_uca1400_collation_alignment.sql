-- Sprint 66: Workspace lifecycle production collation alignment
-- Align workspace_access_requests with memberships/users on environments using utf8mb4_uca1400_ai_ci.

ALTER TABLE workspace_access_requests
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;

ALTER TABLE workspace_access_requests
  MODIFY request_id varchar(36) COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY tenant_id varchar(36) COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY requester_user_id varchar(36) COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY requester_email varchar(255) COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY requested_role varchar(64) COLLATE utf8mb4_uca1400_ai_ci NOT NULL DEFAULT 'member';
