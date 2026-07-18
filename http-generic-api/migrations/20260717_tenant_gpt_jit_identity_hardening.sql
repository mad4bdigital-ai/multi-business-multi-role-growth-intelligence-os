-- Tenant GPT JIT identity hardening
-- Additive and idempotent: fail closed on duplicate provider subjects before adding uniqueness.

SET @tenant_gpt_jit_duplicate_provider_subjects := (
  SELECT COUNT(*)
  FROM (
    SELECT auth_provider, provider_id
    FROM user_credentials
    WHERE provider_id IS NOT NULL
      AND TRIM(provider_id) <> ''
    GROUP BY auth_provider, provider_id
    HAVING COUNT(*) > 1
  ) duplicate_provider_subjects
);

SET @tenant_gpt_jit_duplicate_guard_sql := IF(
  @tenant_gpt_jit_duplicate_provider_subjects = 0,
  'SELECT 1',
  'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''Duplicate auth provider subjects must be resolved before applying uq_user_credentials_provider_subject'''
);

PREPARE tenant_gpt_jit_duplicate_guard_stmt FROM @tenant_gpt_jit_duplicate_guard_sql;
EXECUTE tenant_gpt_jit_duplicate_guard_stmt;
DEALLOCATE PREPARE tenant_gpt_jit_duplicate_guard_stmt;

SET @tenant_gpt_jit_provider_subject_index_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'user_credentials'
    AND index_name = 'uq_user_credentials_provider_subject'
);

SET @tenant_gpt_jit_provider_subject_index_sql := IF(
  @tenant_gpt_jit_provider_subject_index_exists = 0,
  'ALTER TABLE user_credentials ADD UNIQUE KEY uq_user_credentials_provider_subject (auth_provider, provider_id)',
  'SELECT 1'
);

PREPARE tenant_gpt_jit_provider_subject_index_stmt FROM @tenant_gpt_jit_provider_subject_index_sql;
EXECUTE tenant_gpt_jit_provider_subject_index_stmt;
DEALLOCATE PREPARE tenant_gpt_jit_provider_subject_index_stmt;
