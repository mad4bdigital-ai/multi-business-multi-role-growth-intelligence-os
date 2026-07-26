-- Sprint 68: Chunked tool response continuation policy
-- Generalizes chunk-read fallback for any governed tool response.
-- Pattern: if response_chunked=true or page.has_more=true, read response_chunk_read until exhausted before using alternative surfaces.

INSERT INTO execution_policies (
  policy_group,
  policy_key,
  policy_value,
  active,
  execution_scope,
  affects_layer,
  blocking,
  notes
) VALUES (
  'Tool Response Continuation Governance',
  'Chunked Tool Response Continuation Contract',
  JSON_OBJECT(
    'rule','chunk_read_before_alternative_surface',
    'trigger_conditions',JSON_ARRAY('response_chunked=true','page.has_more=true','page.next_cursor IS NOT NULL'),
    'required_tool','response_chunk_read',
    'applies_to',JSON_ARRAY('admin_tools','tenant_tools','system_tools','device_tools','repo_inspect','connector_dispatch','any_governed_tool_response'),
    'required_sequence',JSON_ARRAY(
      'read_current_chunk',
      'call_response_chunk_read_with_chunk_id_and_next_cursor',
      'repeat_until_page_has_more_false',
      'only_then_use_secondary_search_slice_or_external_fallback'
    ),
    'response_contract',JSON_OBJECT(
      'must_include',JSON_ARRAY('response_chunked','chunk_id','page.cursor','page.next_cursor','page.has_more','continuation.required_tool','continuation.required_before_fallback'),
      'recommended_next_call_path','continuation.next_call',
      'fallback_allowed_only_after','all_chunks_read_or_chunk_cache_expired_or_authorized_tool_unavailable',
      'secrets_included',false
    ),
    'forbidden_behaviors',JSON_ARRAY(
      'claim_file_too_large_without_attempting_response_chunk_read',
      'switch_to_local_connector_or_external_surface_before_chunk_exhaustion',
      'summarize_chunked_result_as_complete_when_page_has_more_true'
    ),
    'degraded_classifications',JSON_OBJECT(
      'chunk_cache_expired','degraded_chunk_cache_expired_retry_original_tool',
      'response_chunk_read_unavailable','degraded_missing_chunk_read_transport',
      'authorization_failure','authorization_gated'
    ),
    'secrets_included',false
  ),
  'TRUE',
  'admin_tool_dispatch,tenant_tool_dispatch,system_tool_dispatch,device_tool_dispatch,connector_dispatch,repo_inspect,artifact_read,large_response_handling',
  'gptToolsRoutes,response_chunk_read,tool_response_auto_chunk,repo_inspect,connector_dispatch,agent_runtime_reading_policy',
  'TRUE',
  'Any chunked governed tool response must be continued through response_chunk_read until exhausted before falling back to secondary search/slice/local/external surfaces.'
)
ON DUPLICATE KEY UPDATE
  policy_value=VALUES(policy_value),
  active=VALUES(active),
  execution_scope=VALUES(execution_scope),
  affects_layer=VALUES(affects_layer),
  blocking=VALUES(blocking),
  notes=VALUES(notes),
  updated_at=NOW();
