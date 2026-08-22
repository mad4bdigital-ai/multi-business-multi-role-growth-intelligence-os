-- Sprint 69: Binding identifier width compatibility.
--
-- The connector registry bridge introduced 36-character binding identifiers,
-- but later governed capability migrations use stable descriptive identifiers
-- longer than 36 characters. Widen both registry columns before those writers
-- execute. This is schema-only and stores no credentials or external payloads.
-- No external calls, provider writes, deployment, or Production access.

ALTER TABLE `app_integration_action_bindings`
  MODIFY COLUMN `binding_id` VARCHAR(128) NOT NULL;

ALTER TABLE `credential_bindings`
  MODIFY COLUMN `binding_id` VARCHAR(128) NOT NULL;
