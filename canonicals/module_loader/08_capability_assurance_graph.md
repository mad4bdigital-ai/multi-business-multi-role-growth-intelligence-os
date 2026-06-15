## Capability Assurance Loader Dependencies

For governed capability execution, module_loader must resolve and return:
- canonical capability row and plugin key;
- active binding and export state;
- authority requirement type;
- fresh capability envelope and expiry;
- effective resource bindings when resource-scoped authority is required;
- approval and quota state when required;
- audit, readback, certification, and rollback requirements;
- resolved source provenance;
- open blocking capability debt.

The loader must keep invocation authority and resource authority separate. Admin or Tenant tool exposure may satisfy neither a missing actor scope nor a missing external-resource binding.

Required assurance surfaces include:
- `platform_plugin_capabilities`
- `platform_plugin_bindings`
- `platform_plugin_capability_exports`
- `capability_resolution_envelope_ledger`
- `platform_evidence_events`
- `platform_capability_certifications`
- `platform_capability_source_links`
- `platform_capability_debt`

When canonical tables are not yet promoted as primary authority, loader output must identify compatibility projection use and preserve source-table/source-key evidence.

Secret-like fields, credential payloads, and plaintext secret values must not enter the loaded assurance context. Only governed references and hashes are allowed.
