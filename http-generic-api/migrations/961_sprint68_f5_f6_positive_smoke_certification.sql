-- 961_sprint68_f5_f6_positive_smoke_certification.sql
-- Purpose: Certify F5/F6 after positive governed smoke evidence.
-- Evidence:
--   F5 delegated repo_patch_apply branch write: commit 151c82065ab8497d1f1dbe912f44d56d7292c67c
--   F5 file metadata readback: sha e5887d27b126905661ddf447c3b973e0b14da5eb, size 331
--   F6 guarded PR create/readback: PR #1476, draft=true, state=open, head gpt/smoke-f5-f6-completion-20260612, base main
-- No direct main write, no merge, no raw secret response, no runtime file-content return.

UPDATE runtime_dispatch_certification_registry
SET certification_status = 'positive_smoke_passed_after_review_gate_certified',
    dispatch_allowed = 1,
    apply_allowed = 1,
    requires_resource_authority = 1,
    requires_dry_run = 1,
    requires_audit_evidence = 1,
    requires_readback = 1,
    last_evidence_ref = 'F5:repo_patch_apply:branch=gpt/smoke-f5-f6-completion-20260612:commit=151c82065ab8497d1f1dbe912f44d56d7292c67c:file_sha=e5887d27b126905661ddf447c3b973e0b14da5eb',
    last_certified_at = CURRENT_TIMESTAMP,
    notes = CONCAT(COALESCE(notes,''), CASE WHEN notes IS NULL OR notes='' THEN '' ELSE '\n' END,
      '2026-06-12 F5 positive delegated smoke passed: repo_patch_apply wrote only to governed smoke branch; metadata readback succeeded; no direct main write, no merge, file_content_returned=false, secrets=false.'),
    updated_at = CURRENT_TIMESTAMP
WHERE certification_key = 'github_file_patch_apply_after_review'
  AND surface_key = 'github.file.patch_apply_after_review';

UPDATE runtime_dispatch_certification_registry
SET certification_status = 'positive_smoke_passed_after_review_gate_certified',
    dispatch_allowed = 1,
    apply_allowed = 1,
    requires_resource_authority = 1,
    requires_dry_run = 1,
    requires_audit_evidence = 1,
    requires_readback = 1,
    last_evidence_ref = 'F6:github_pr_create:pr=1476:head=gpt/smoke-f5-f6-completion-20260612:base=main:draft=true:state=open',
    last_certified_at = CURRENT_TIMESTAMP,
    notes = CONCAT(COALESCE(notes,''), CASE WHEN notes IS NULL OR notes='' THEN '' ELSE '\n' END,
      '2026-06-12 F6 positive smoke passed: guarded GitHub REST fallback created draft PR #1476 and readback verified state/head/base; direct_main_write=false, merged=false, secrets=false.'),
    updated_at = CURRENT_TIMESTAMP
WHERE certification_key = 'github_pull_request_create_after_review'
  AND surface_key = 'github.pull_request.create_after_review';

CREATE OR REPLACE VIEW v_f5_f6_positive_smoke_certification_readback AS
SELECT
  certification_key,
  surface_key,
  certification_status,
  dispatch_allowed,
  apply_allowed,
  requires_dry_run,
  requires_audit_evidence,
  requires_readback,
  last_evidence_ref,
  last_certified_at,
  0 AS direct_main_write_performed,
  0 AS merge_performed,
  0 AS file_content_returned,
  0 AS secrets_included
FROM runtime_dispatch_certification_registry
WHERE certification_key IN ('github_file_patch_apply_after_review','github_pull_request_create_after_review');
