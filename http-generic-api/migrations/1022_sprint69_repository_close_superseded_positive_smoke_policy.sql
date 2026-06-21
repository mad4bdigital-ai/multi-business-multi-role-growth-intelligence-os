-- Sprint 69: Admin-only positive smoke policy for repo.pr.close_superseded.
-- Safety: creates only disposable GitHub refs/PR evidence during the explicit smoke tool; this migration does not activate the production recipe or production apply authority.

INSERT INTO `execution_policies`
  (`policy_group`,`policy_key`,`policy_value`,`active`,`execution_scope`,`affects_layer`,`blocking`,`notes`)
VALUES
  ('Repository Mutation Governance','repository_close_superseded_positive_smoke_policy_v1',
   JSON_OBJECT(
     'admin_only', TRUE,
     'disposable_resources_only', TRUE,
     'expected_main_sha_required', TRUE,
     'typed_confirmation_required', TRUE,
     'capability_envelope_required', TRUE,
     'same_production_evidence_predicate', TRUE,
     'same_close_write_contract', TRUE,
     'base_branch_at_main_parent', TRUE,
     'head_branch_at_exact_main_sha', TRUE,
     'close_state_and_head_sha_readback_required', TRUE,
     'cleanup_required', TRUE,
     'audit_required', TRUE,
     'production_recipe_activation', FALSE,
     'production_apply_authority_change', FALSE,
     'external_send', FALSE,
     'credential_payload_read', FALSE,
     'secrets_included', FALSE
   ),
   'TRUE',
   'admin|github|repository_close_superseded_positive_smoke|disposable_only',
   'repositoryCloseSupersededPositiveSmoke|repositoryGovernanceV6|githubRepositoryLifecycle|gptToolsRoutes|releaseReadiness',
   'TRUE',
   'Positive smoke may create and close one disposable PR and delete its disposable refs only after an approved capability envelope, exact-main pin, typed confirmation, production predicate validation, same-cycle readback, audit, and cleanup. Production repo.pr.close_superseded remains planned and github_repo_close_authority remains apply_allowed=0.' )
ON DUPLICATE KEY UPDATE
  `policy_value`=VALUES(`policy_value`), `active`=VALUES(`active`),
  `execution_scope`=VALUES(`execution_scope`), `affects_layer`=VALUES(`affects_layer`),
  `blocking`=VALUES(`blocking`), `notes`=VALUES(`notes`), `updated_at`=CURRENT_TIMESTAMP;
