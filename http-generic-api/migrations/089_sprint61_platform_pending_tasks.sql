-- Sprint 61: Platform pending tasks registry
--
-- Stores non-blocking improvements, blockers, maintenance, certification,
-- automation, and security tasks that should be surfaced during hard activation.
--
-- Visibility rule:
-- - owner_scope='platform' is admin-only.
-- - tenant/user/device scopes are only visible to the matching principal.
--
-- Idempotent. No DELETE/TRUNCATE/DROP.

CREATE TABLE IF NOT EXISTS platform_pending_tasks (
  task_id VARCHAR(36) NOT NULL PRIMARY KEY,
  task_key VARCHAR(191) NOT NULL UNIQUE,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  task_type ENUM('improvement','blocker','maintenance','certification','automation','security','documentation') NOT NULL DEFAULT 'improvement',
  priority ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  status ENUM('pending','in_progress','blocked','done','cancelled','deferred') NOT NULL DEFAULT 'pending',
  blocker_level ENUM('none','soft','hard') NOT NULL DEFAULT 'none',
  owner_scope ENUM('platform','tenant','user','device') NOT NULL DEFAULT 'platform',
  tenant_id VARCHAR(64) NULL,
  user_id VARCHAR(64) NULL,
  device_id VARCHAR(191) NULL,
  source_surface VARCHAR(191) NULL,
  source_ref VARCHAR(500) NULL,
  activation_visibility TINYINT(1) NOT NULL DEFAULT 1,
  show_until_status_json JSON NULL,
  context_json JSON NULL,
  created_by VARCHAR(191) NULL,
  updated_by VARCHAR(191) NULL,
  due_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_platform_pending_tasks_activation (activation_visibility, status, priority, updated_at),
  KEY idx_platform_pending_tasks_scope (owner_scope, tenant_id, user_id, device_id),
  KEY idx_platform_pending_tasks_type (task_type, blocker_level, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
