-- 953_sprint68_resource_graph_projection_positive_smoke_certification.sql
-- Records the positive graph projection apply smoke after candidate/advisory rows
-- were written and read back. This migration is idempotent and does not call
-- providers, read credentials, or store secrets.

UPDATE runtime_dispatch_certification_registry
SET certification_status = 'resource_graph_projection_apply_smoke_passed',
    apply_allowed = 1,
    last_evidence_ref = 'resource_graph_projection_apply:0188f06bcc39da3108b694e87fa1482f9e28c361168b85744bec987b901f9865:nodes=10:edges=10:evidence=10',
    last_certified_at = CURRENT_TIMESTAMP,
    notes = 'Positive smoke applied candidate/advisory graph projection rows only. Readback: nodes=10, edges=10, evidence=10. runtime_enforced=0, provider_calls_made=0 by runtime path, file_content_returned=false, secrets_included=false. Initial HTTP response timed out after write, so DB readback and envelope reference were used as same-cycle evidence.'
WHERE certification_key = 'resource_graph_projection_apply'
  AND surface_key = 'governed_resource_run'
  AND tool_or_action_key = 'governed_resource_run'
  AND dispatch_allowed = 1
  AND requires_dry_run = 1
  AND requires_readback = 1;
