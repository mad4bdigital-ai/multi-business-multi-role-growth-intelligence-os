-- 904_sprint68_resource_manifest_positive_smoke_certification.sql
-- Records the governed positive apply smoke for resource_manifest_create after
-- Drive multipart transport and endpoint schema validation were fixed.

UPDATE runtime_dispatch_certification_registry
SET certification_status = 'manifest_create_positive_apply_smoke_passed',
    apply_allowed = 1,
    last_evidence_ref = 'governed_resource_run:resource_manifest_create_positive_smoke:2026-06-10:file:1uYzW6CUmKPs7dl_usgYr6XckBut-XrGb',
    last_certified_at = CURRENT_TIMESTAMP,
    expires_at = NULL,
    notes = CONCAT(
      COALESCE(notes, ''),
      CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE '\n' END,
      '2026-06-10 positive apply smoke passed: classification=manifest_created_with_readback; file_id=1uYzW6CUmKPs7dl_usgYr6XckBut-XrGb; readback_required=true; readback_ok=true; graph_write_made=false; file_content_returned=false; secrets_included=false.'
    )
WHERE certification_key = 'resource_manifest_create'
  AND surface_key = 'governed_resource_run'
  AND tool_or_action_key = 'governed_resource_run'
  AND dispatch_allowed = 1
  AND requires_dry_run = 1
  AND requires_audit_evidence = 1
  AND requires_readback = 1;
