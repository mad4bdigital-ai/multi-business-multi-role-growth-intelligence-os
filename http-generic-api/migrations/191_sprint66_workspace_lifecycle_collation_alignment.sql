-- Sprint 66: Workspace lifecycle collation alignment
-- Prevent cross-table join collation errors between workspace_access_requests and memberships/users.

ALTER TABLE workspace_access_requests
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE workspace_access_requests
  MODIFY request_id varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY tenant_id varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY requester_user_id varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY requester_email varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY requested_role varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'member';
