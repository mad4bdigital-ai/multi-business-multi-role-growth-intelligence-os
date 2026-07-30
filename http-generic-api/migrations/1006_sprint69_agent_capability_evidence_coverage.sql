-- Sprint 69: Agent capability retrieval, invocation evidence, and runtime coverage.
-- Additive only. This migration does not change runtime authority or provider dispatch.

CREATE TABLE IF NOT EXISTS `capability_retrieval_events` (
  `retrieval_id` CHAR(36) NOT NULL,
  `execution_trace_id` VARCHAR(191) NULL,
  `tenant_id` CHAR(36) NULL,
  `workspace_id` CHAR(36) NULL,
  `user_id` VARCHAR(191) NULL,
  `brand_key` VARCHAR(191) NULL,
  `agent_id` VARCHAR(191) NULL,
  `intent_hash` CHAR(64) NULL,
  `intent_contract_json` JSON NULL,
  `requested_capability_type` VARCHAR(32) NULL,
  `candidate_count` INT NOT NULL DEFAULT 0,
  `selected_bundle_id` VARCHAR(191) NULL,
  `decision_status` VARCHAR(32) NOT NULL DEFAULT 'started',
  `resolver_version` VARCHAR(64) NULL,
  `scoring_version` VARCHAR(64) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`retrieval_id`),
  KEY `idx_capability_retrieval_trace` (`execution_trace_id`),
  KEY `idx_capability_retrieval_agent_created` (`agent_id`, `created_at`),
  KEY `idx_capability_retrieval_tenant_created` (`tenant_id`, `created_at`),
  KEY `idx_capability_retrieval_decision` (`decision_status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `capability_retrieval_candidates` (
  `retrieval_candidate_id` CHAR(36) NOT NULL,
  `retrieval_id` CHAR(36) NOT NULL,
  `capability_type` VARCHAR(32) NOT NULL,
  `capability_key` VARCHAR(191) NOT NULL,
  `candidate_rank` INT NULL,
  `final_score` DECIMAL(8,6) NULL,
  `intent_score` DECIMAL(8,6) NULL,
  `activity_score` DECIMAL(8,6) NULL,
  `input_score` DECIMAL(8,6) NULL,
  `readiness_score` DECIMAL(8,6) NULL,
  `history_score` DECIMAL(8,6) NULL,
  `brand_affinity_score` DECIMAL(8,6) NULL,
  `eligibility_status` VARCHAR(32) NOT NULL DEFAULT 'candidate',
  `blocker_code` VARCHAR(128) NULL,
  `selection_status` VARCHAR(32) NOT NULL DEFAULT 'not_selected',
  `evidence_json` JSON NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`retrieval_candidate_id`),
  KEY `idx_capability_candidate_retrieval_rank` (`retrieval_id`, `candidate_rank`),
  KEY `idx_capability_candidate_key` (`capability_type`, `capability_key`),
  KEY `idx_capability_candidate_selection` (`selection_status`, `created_at`),
  CONSTRAINT `fk_capability_candidate_retrieval`
    FOREIGN KEY (`retrieval_id`) REFERENCES `capability_retrieval_events` (`retrieval_id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `capability_invocations` (
  `invocation_id` CHAR(36) NOT NULL,
  `retrieval_id` CHAR(36) NULL,
  `parent_invocation_id` CHAR(36) NULL,
  `execution_trace_id` VARCHAR(191) NULL,
  `workflow_run_id` VARCHAR(191) NULL,
  `step_run_id` VARCHAR(191) NULL,
  `agent_id` VARCHAR(191) NULL,
  `capability_type` VARCHAR(32) NOT NULL,
  `capability_key` VARCHAR(191) NOT NULL,
  `lifecycle_stage` VARCHAR(32) NOT NULL,
  `authorization_status` VARCHAR(32) NULL,
  `dispatch_status` VARCHAR(32) NULL,
  `execution_status` VARCHAR(32) NULL,
  `verification_status` VARCHAR(32) NULL,
  `started_at` DATETIME(3) NULL,
  `completed_at` DATETIME(3) NULL,
  `duration_ms` BIGINT NULL,
  `error_code` VARCHAR(128) NULL,
  `input_hash` CHAR(64) NULL,
  `output_hash` CHAR(64) NULL,
  `evidence_json` JSON NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`invocation_id`),
  KEY `idx_capability_invocation_retrieval` (`retrieval_id`, `created_at`),
  KEY `idx_capability_invocation_trace` (`execution_trace_id`, `created_at`),
  KEY `idx_capability_invocation_key_stage` (`capability_type`, `capability_key`, `lifecycle_stage`),
  KEY `idx_capability_invocation_agent_created` (`agent_id`, `created_at`),
  KEY `idx_capability_invocation_execution` (`execution_status`, `verification_status`, `created_at`),
  CONSTRAINT `fk_capability_invocation_retrieval`
    FOREIGN KEY (`retrieval_id`) REFERENCES `capability_retrieval_events` (`retrieval_id`)
    ON DELETE SET NULL,
  CONSTRAINT `fk_capability_invocation_parent`
    FOREIGN KEY (`parent_invocation_id`) REFERENCES `capability_invocations` (`invocation_id`)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_logic_runtime_coverage` AS
SELECT
  ld.logic_key,
  ld.status AS registry_status,
  COUNT(ci.invocation_id) AS evidence_event_count,
  SUM(CASE WHEN ci.lifecycle_stage = 'retrieved' THEN 1 ELSE 0 END) AS retrieval_count,
  SUM(CASE WHEN ci.lifecycle_stage = 'selected' THEN 1 ELSE 0 END) AS selected_count,
  SUM(CASE WHEN ci.lifecycle_stage = 'dispatched' THEN 1 ELSE 0 END) AS dispatch_count,
  SUM(CASE WHEN ci.lifecycle_stage = 'succeeded' OR ci.execution_status = 'success' THEN 1 ELSE 0 END) AS success_count,
  SUM(CASE WHEN ci.lifecycle_stage = 'verified' OR ci.verification_status = 'verified' THEN 1 ELSE 0 END) AS verified_count,
  MAX(CASE
    WHEN ci.lifecycle_stage IN ('dispatched', 'succeeded', 'verified')
      OR ci.execution_status = 'success'
      OR ci.verification_status = 'verified'
    THEN COALESCE(ci.completed_at, ci.started_at, ci.created_at)
    ELSE NULL
  END) AS last_used_at,
  CASE
    WHEN SUM(CASE WHEN ci.lifecycle_stage = 'verified' OR ci.verification_status = 'verified' THEN 1 ELSE 0 END) > 0 THEN 'verified'
    WHEN SUM(CASE WHEN ci.lifecycle_stage = 'succeeded' OR ci.execution_status = 'success' THEN 1 ELSE 0 END) > 0 THEN 'succeeded_not_verified'
    WHEN SUM(CASE WHEN ci.lifecycle_stage = 'dispatched' THEN 1 ELSE 0 END) > 0 THEN 'dispatched_never_succeeded'
    WHEN SUM(CASE WHEN ci.lifecycle_stage = 'selected' THEN 1 ELSE 0 END) > 0 THEN 'selected_never_dispatched'
    WHEN SUM(CASE WHEN ci.lifecycle_stage = 'retrieved' THEN 1 ELSE 0 END) > 0 THEN 'retrieved_never_selected'
    ELSE 'never_retrieved'
  END AS usage_status
FROM logic_definitions ld
LEFT JOIN capability_invocations ci
  ON ci.capability_type = 'logic'
 AND ci.capability_key COLLATE utf8mb4_unicode_ci
     = ld.logic_key COLLATE utf8mb4_unicode_ci
GROUP BY ld.logic_key, ld.status;

CREATE OR REPLACE VIEW `v_engine_runtime_coverage` AS
WITH RECURSIVE workflow_engine_tokens AS (
  SELECT
    workflow_id,
    workflow_key,
    TRIM(SUBSTRING_INDEX(COALESCE(mapped_engines, ''), '|', 1)) AS engine_key,
    CASE
      WHEN LOCATE('|', COALESCE(mapped_engines, '')) > 0
        THEN SUBSTRING(COALESCE(mapped_engines, ''), LOCATE('|', COALESCE(mapped_engines, '')) + 1)
      ELSE ''
    END AS remainder
  FROM workflows
  WHERE TRIM(COALESCE(mapped_engines, '')) <> ''

  UNION ALL

  SELECT
    workflow_id,
    workflow_key,
    TRIM(SUBSTRING_INDEX(remainder, '|', 1)) AS engine_key,
    CASE
      WHEN LOCATE('|', remainder) > 0
        THEN SUBSTRING(remainder, LOCATE('|', remainder) + 1)
      ELSE ''
    END AS remainder
  FROM workflow_engine_tokens
  WHERE remainder <> ''
),
registered_engines AS (
  SELECT
    engine_key,
    COUNT(DISTINCT workflow_id) AS workflow_binding_count,
    GROUP_CONCAT(DISTINCT workflow_key ORDER BY workflow_key SEPARATOR '|') AS workflow_keys
  FROM workflow_engine_tokens
  WHERE engine_key <> ''
  GROUP BY engine_key
)
SELECT
  re.engine_key,
  re.workflow_binding_count,
  re.workflow_keys,
  COUNT(ci.invocation_id) AS evidence_event_count,
  SUM(CASE WHEN ci.lifecycle_stage = 'retrieved' THEN 1 ELSE 0 END) AS retrieval_count,
  SUM(CASE WHEN ci.lifecycle_stage = 'selected' THEN 1 ELSE 0 END) AS selected_count,
  SUM(CASE WHEN ci.lifecycle_stage = 'dispatched' THEN 1 ELSE 0 END) AS dispatch_count,
  SUM(CASE WHEN ci.lifecycle_stage = 'succeeded' OR ci.execution_status = 'success' THEN 1 ELSE 0 END) AS success_count,
  SUM(CASE WHEN ci.lifecycle_stage = 'verified' OR ci.verification_status = 'verified' THEN 1 ELSE 0 END) AS verified_count,
  MAX(CASE
    WHEN ci.lifecycle_stage IN ('dispatched', 'succeeded', 'verified')
      OR ci.execution_status = 'success'
      OR ci.verification_status = 'verified'
    THEN COALESCE(ci.completed_at, ci.started_at, ci.created_at)
    ELSE NULL
  END) AS last_used_at,
  CASE
    WHEN SUM(CASE WHEN ci.lifecycle_stage = 'verified' OR ci.verification_status = 'verified' THEN 1 ELSE 0 END) > 0 THEN 'verified'
    WHEN SUM(CASE WHEN ci.lifecycle_stage = 'succeeded' OR ci.execution_status = 'success' THEN 1 ELSE 0 END) > 0 THEN 'succeeded_not_verified'
    WHEN SUM(CASE WHEN ci.lifecycle_stage = 'dispatched' THEN 1 ELSE 0 END) > 0 THEN 'dispatched_never_succeeded'
    WHEN SUM(CASE WHEN ci.lifecycle_stage = 'selected' THEN 1 ELSE 0 END) > 0 THEN 'selected_never_dispatched'
    WHEN SUM(CASE WHEN ci.lifecycle_stage = 'retrieved' THEN 1 ELSE 0 END) > 0 THEN 'retrieved_never_selected'
    ELSE 'never_retrieved'
  END AS usage_status
FROM registered_engines re
LEFT JOIN capability_invocations ci
  ON ci.capability_type = 'engine'
 AND ci.capability_key = re.engine_key
GROUP BY re.engine_key, re.workflow_binding_count, re.workflow_keys;
