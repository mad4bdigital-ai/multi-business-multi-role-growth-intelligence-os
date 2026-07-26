-- Sprint 65 follow-up: make Browser4 adapter metadata deterministic across MySQL JSON/TEXT variants.
-- Migration 131 inserted the tools correctly, but JSON_SET over text-backed metadata can be
-- environment-sensitive. This repair writes the required metadata object explicitly while
-- preserving the existing Browser4 use-case flags.

UPDATE `browser_runtime_registry`
   SET `status` = CASE
       WHEN `status` IN ('planned', 'blocked_missing_java17', 'planned_poc_partial_java17_ready') THEN 'planned_adapter_available_after_connector_upgrade'
       ELSE `status`
     END,
       `metadata_json` = '{"use_case":"extraction_inspect","install_required":true,"adapter":{"route":"/browser-runtime/inspect-site/run","connector_path":"/browser4","session_lifecycle":["open","goto","snapshot_or_screenshot"],"requires_connector_upgrade":true}}'
 WHERE `runtime_key` = 'browser4_essam_v1';
