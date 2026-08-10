-- GitHub issue-comment exact response parity — 2026-08-10
--
-- Safety contract:
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- no_runtime_dispatch=true
-- secrets_included=false
--
-- Follow-up to 20260808_github_issue_comment_dispatch_parity.sql.
-- The prior migration added responses.201 but intentionally did not delete an
-- already-stale responses.200 entry. Exact provider/runtime parity requires the
-- runtime endpoint to retain 201 Created and to stop advertising the legacy 200
-- success status for createIssueComment.
--
-- This migration mutates registry metadata only. It performs no GitHub/provider
-- call, no credential read, no runtime dispatch, and no external write.

SET @github_issue_comment_endpoint_match_count := (
  SELECT COUNT(*)
  FROM endpoints e
  WHERE e.parent_action_key = 'github_api_mcp'
    AND e.endpoint_key = 'github_create_issue_comment'
    AND e.endpoint_id IS NOT NULL
    AND e.method = 'POST'
    AND e.endpoint_path_or_function = '/repos/{owner}/{repo}/issues/{issue_number}/comments'
    AND e.status = 'active'
    AND e.execution_readiness = 'ready'
    AND e.transport_action_key = 'http_generic_api'
);

UPDATE endpoints
SET schema_json = JSON_SET(
      JSON_REMOVE(
        COALESCE(schema_json, JSON_OBJECT()),
        '$.responses.200'
      ),
      '$.responses.201',
      JSON_OBJECT(
        'description', 'Created',
        'content', JSON_OBJECT(
          'application/json', JSON_OBJECT(
            'schema', JSON_OBJECT(
              'type', 'object',
              'additionalProperties', TRUE
            )
          )
        )
      )
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE parent_action_key = 'github_api_mcp'
  AND endpoint_key = 'github_create_issue_comment'
  AND endpoint_id IS NOT NULL
  AND method = 'POST'
  AND endpoint_path_or_function = '/repos/{owner}/{repo}/issues/{issue_number}/comments'
  AND status = 'active'
  AND execution_readiness = 'ready'
  AND transport_action_key = 'http_generic_api'
  AND @github_issue_comment_endpoint_match_count = 1;

-- Keep every active export sourced from the exact canonical endpoint row aligned
-- after removing the stale 200 response. Absence of an export is not treated as
-- absence of runtime callability; runtime_endpoint_call can execute registry rows
-- directly, so runtime schema coverage is diagnosed separately below.
UPDATE platform_endpoint_tool_exports export_row
JOIN endpoints endpoint_row
  ON endpoint_row.id = export_row.source_endpoint_id
SET export_row.input_schema_json = endpoint_row.schema_json,
    export_row.updated_at = CURRENT_TIMESTAMP
WHERE endpoint_row.parent_action_key = 'github_api_mcp'
  AND endpoint_row.endpoint_key = 'github_create_issue_comment'
  AND endpoint_row.endpoint_id IS NOT NULL
  AND endpoint_row.method = 'POST'
  AND endpoint_row.endpoint_path_or_function = '/repos/{owner}/{repo}/issues/{issue_number}/comments'
  AND endpoint_row.status = 'active'
  AND endpoint_row.execution_readiness = 'ready'
  AND endpoint_row.transport_action_key = 'http_generic_api'
  AND export_row.status = 'active'
  AND @github_issue_comment_endpoint_match_count = 1
  AND NOT (export_row.input_schema_json <=> endpoint_row.schema_json);

-- Exact endpoint/export readback for this repaired operation. This is deliberately
-- stricter than the older existence-only 201 check: a legacy 200 success entry is
-- a blocking parity defect even when 201 is also present.
CREATE OR REPLACE VIEW v_github_issue_comment_exact_response_parity AS
SELECT
  endpoint_state.endpoint_match_count,
  endpoint_state.response_201_count,
  endpoint_state.legacy_response_200_count,
  export_state.active_export_count,
  export_state.export_response_201_count,
  export_state.export_legacy_response_200_count,
  export_state.export_schema_parity_count,
  CASE
    WHEN endpoint_state.endpoint_match_count = 1
     AND endpoint_state.response_201_count = 1
     AND endpoint_state.legacy_response_200_count = 0
     AND (
       export_state.active_export_count = 0
       OR (
         export_state.export_response_201_count = export_state.active_export_count
         AND export_state.export_legacy_response_200_count = 0
         AND export_state.export_schema_parity_count = export_state.active_export_count
       )
     )
    THEN 'ready'
    ELSE 'blocked'
  END AS parity_status
FROM (
  SELECT
    COUNT(*) AS endpoint_match_count,
    COALESCE(SUM(
      CASE
        WHEN JSON_EXTRACT(e.schema_json, '$.responses.201') IS NOT NULL
        THEN 1 ELSE 0
      END
    ), 0) AS response_201_count,
    COALESCE(SUM(
      CASE
        WHEN JSON_EXTRACT(e.schema_json, '$.responses.200') IS NOT NULL
        THEN 1 ELSE 0
      END
    ), 0) AS legacy_response_200_count
  FROM endpoints e
  WHERE e.parent_action_key = 'github_api_mcp'
    AND e.endpoint_key = 'github_create_issue_comment'
    AND e.endpoint_id IS NOT NULL
    AND e.method = 'POST'
    AND e.endpoint_path_or_function = '/repos/{owner}/{repo}/issues/{issue_number}/comments'
    AND e.status = 'active'
    AND e.execution_readiness = 'ready'
    AND e.transport_action_key = 'http_generic_api'
) endpoint_state
CROSS JOIN (
  SELECT
    COUNT(*) AS active_export_count,
    COALESCE(SUM(
      CASE
        WHEN JSON_EXTRACT(export_row.input_schema_json, '$.responses.201') IS NOT NULL
        THEN 1 ELSE 0
      END
    ), 0) AS export_response_201_count,
    COALESCE(SUM(
      CASE
        WHEN JSON_EXTRACT(export_row.input_schema_json, '$.responses.200') IS NOT NULL
        THEN 1 ELSE 0
      END
    ), 0) AS export_legacy_response_200_count,
    COALESCE(SUM(
      CASE WHEN export_row.input_schema_json <=> endpoint_row.schema_json THEN 1 ELSE 0 END
    ), 0) AS export_schema_parity_count
  FROM platform_endpoint_tool_exports export_row
  JOIN endpoints endpoint_row
    ON endpoint_row.id = export_row.source_endpoint_id
  WHERE endpoint_row.parent_action_key = 'github_api_mcp'
    AND endpoint_row.endpoint_key = 'github_create_issue_comment'
    AND endpoint_row.endpoint_id IS NOT NULL
    AND endpoint_row.method = 'POST'
    AND endpoint_row.endpoint_path_or_function = '/repos/{owner}/{repo}/issues/{issue_number}/comments'
    AND endpoint_row.status = 'active'
    AND endpoint_row.execution_readiness = 'ready'
    AND endpoint_row.transport_action_key = 'http_generic_api'
    AND export_row.status = 'active'
) export_state;

-- Coverage view starts from the actual runtime-callable endpoint population rather
-- than from exports. It does not pretend to prove provider-canonical equality on
-- its own; it prevents non-exported runtime rows from disappearing from schema
-- readiness inventory while provider-canonical certification is evaluated by the
-- higher-level certification/evidence plane.
CREATE OR REPLACE VIEW v_runtime_endpoint_schema_coverage AS
SELECT
  e.id AS endpoint_row_id,
  e.endpoint_id,
  e.parent_action_key,
  e.endpoint_key,
  e.method,
  e.endpoint_path_or_function,
  e.status AS endpoint_status,
  e.execution_readiness,
  e.transport_action_key,
  CASE WHEN e.schema_json IS NULL THEN 1 ELSE 0 END AS schema_contract_missing,
  CASE
    WHEN e.schema_json IS NULL THEN 1
    WHEN JSON_EXTRACT(e.schema_json, '$.responses') IS NULL THEN 1
    ELSE 0
  END AS response_contract_missing,
  COUNT(export_row.id) AS active_export_count,
  COALESCE(SUM(
    CASE
      WHEN export_row.id IS NOT NULL
       AND NOT (export_row.input_schema_json <=> e.schema_json)
      THEN 1 ELSE 0
    END
  ), 0) AS export_schema_mismatch_count,
  CASE
    WHEN e.schema_json IS NULL THEN 'schema_contract_missing'
    WHEN JSON_EXTRACT(e.schema_json, '$.responses') IS NULL THEN 'response_contract_missing'
    WHEN COALESCE(SUM(
      CASE
        WHEN export_row.id IS NOT NULL
         AND NOT (export_row.input_schema_json <=> e.schema_json)
        THEN 1 ELSE 0
      END
    ), 0) > 0 THEN 'export_schema_mismatch'
    WHEN COUNT(export_row.id) = 0 THEN 'covered_runtime_not_exported'
    ELSE 'covered_runtime_export_aligned'
  END AS schema_coverage_status
FROM endpoints e
LEFT JOIN platform_endpoint_tool_exports export_row
  ON export_row.source_endpoint_id = e.id
 AND export_row.status = 'active'
WHERE e.status = 'active'
  AND e.execution_readiness = 'ready'
  AND e.transport_action_key = 'http_generic_api'
GROUP BY
  e.id,
  e.endpoint_id,
  e.parent_action_key,
  e.endpoint_key,
  e.method,
  e.endpoint_path_or_function,
  e.status,
  e.execution_readiness,
  e.transport_action_key,
  e.schema_json;
