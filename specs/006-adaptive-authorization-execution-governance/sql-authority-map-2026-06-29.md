# SQL Authority Map — Adaptive Authorization and Execution Governance

**Feature:** `006-adaptive-authorization-execution-governance`  
**Observed:** 2026-06-29  
**Runtime authority:** MySQL primary  
**Status:** approved mapping for pre-PR2 planning; no migration executed

## Evidence summary

The generated platform domain map currently identifies 571 schema sources across the repository. The live capability report observed 604 capabilities, 620 resolved MySQL source mappings, 1,469 capability envelopes, 44 generic certifications, and `platform_evidence_events` as a canonical evidence ledger. The platform data-source census confirms SQL as runtime authority and Sheets as asynchronous mirror/recovery only.

## Logical resource mapping

| Logical resource | Primary SQL authority | Supporting authorities or projections | Owner | Revision source | Decision |
|---|---|---|---|---|---|
| CanonicalCapability | `platform_semantic_capabilities` | `actions`, `endpoints`, `agent_skills`, `platform_plugin_capabilities`, `platform_resource_operation_registry` | Platform registry | capability version plus source-resolution revision | reuse and extend only if immutable version fields are missing |
| CapabilityAlias | `platform_capability_source_links`, `platform_capability_source_resolutions` | `platform_endpoint_aliases`, `platform_tool_dispatch_bindings`, app integration and agent binding tables | Platform registry | source-link revision, resolution timestamp and source hash | reuse; no new alias authority |
| RelationshipTuple | existing membership, role, container and resource-grant authorities | `memberships`, `role_assignments`, `workspace_resource_grants`, `container_relationships`, `container_role_assignments`, `cms_site_access_grants`, effective authority views | Tenant and resource authority owners | authority epoch plus row revision or `updated_at` | build a read projection; do not create a competing writable relationship authority |
| CapabilityGrant | existing scoped grant tables | `agent_skill_grants`, `app_action_grants`, `admin_scope_grants`, `permission_grants`, `workspace_resource_grants`, `local_connector_capability_grants` | Grant-table owner by scope | grant row revision, status and expiry | build a normalized projection; no generic duplicate grant table initially |
| ApprovalPolicy | `execution_policies` | `capability_apply_authorization_policy_registry`, resource and provider policy registries | Security and runtime policy | immutable policy key/version and update revision | reuse; add version metadata only where absent |
| AuthorizationDecision | `decision_runs` plus `authority_scope_shadow_evidence` | `agent_tool_calls` and bounded runtime decision logs | Authorization runtime | decision row ID, policy revision vector and issue time | extend existing tables with typed hashes, effect, expiry and revision vector; no new table initially |
| ExecutionEnvelope | `capability_resolution_envelope_ledger` | capability-envelope binding and evidence link tables | Runtime governance | envelope hash, referenced revisions and row state | reuse and add missing nonce, idempotency, consumption or revision fields additively |
| ApprovalRequest | `approval_holds` | domain-specific request tables | Approval workflow | hold ID, status and expiry | reuse as mutable request lifecycle |
| ApprovalDecision | `platform_evidence_events` linked to `approval_holds` | existing domain-specific append-only decision event tables | Approval workflow and audit | event ID, evidence hash and decision time | reuse append-only evidence events; extend event schema if binding fields are missing |
| CapabilityAdapterBinding | `platform_capability_provider_bindings`, `platform_resource_adapters` | `endpoints`, app integration bindings, `platform_capability_certifications` | Integration and runtime registry | binding revision, adapter version and certification revision | reuse; no new adapter registry |
| CapabilityExecution | `execution_log` | `agent_tool_calls`, `platform_engine_execution_runs`, connected execution records | Runtime execution | execution ID, attempt and completion state | reuse canonical execution log with additive capability/envelope references where required |
| ExecutionEvidence | `platform_evidence_events` | `audit_payload_evidence`, `connected_execution_evidence_reports`, bounded `execution_log` evidence | Observability and audit | evidence event ID/hash and observed timestamp | reuse append-only evidence ledger |
| ReconciliationCheckpoint | no general cross-controller authority found | domain-specific projection runs, freshness ledgers and connected-execution cursors | Reconciliation runtime | controller key, scope key, cursor, lease and observed revision | approve one additive `reconciliation_checkpoints` migration candidate after schema review |

## Pilot authority mapping

| Pilot capability | Identity and grants | Target resource authority | Envelope and evidence | Initial rule |
|---|---|---|---|---|
| `activation.skills.read` | `platform_semantic_capabilities`, `agent_skills`, `agent_skill_grants` | activation grant views and authenticated tenant scope | `decision_runs`, `authority_scope_shadow_evidence` | shadow read only |
| `platform.output-artifact.write` | semantic capability and scoped grants | `output_artifacts` | capability envelope ledger, `execution_log`, `platform_evidence_events` | shadow, then separately approved internal canary |
| `content.wordpress.publish` | semantic capability, resource authority and CMS grant | `cms_sites`, `cms_site_access_grants`, `brand_site_bindings` | provider binding, envelope, execution and readback evidence | shadow only until certification and readback gates pass |

## Approved additive migration boundary

No migration is executed by this mapping. Future migration work may include:

1. additive columns on `decision_runs` for typed subject/resource hashes, effect, expiry and revision vector;
2. additive fields on `capability_resolution_envelope_ledger` for nonce, idempotency, single-use consumption and complete revision binding where absent;
3. additive event binding fields for approval decisions in `platform_evidence_events` where absent;
4. additive capability/envelope references in `execution_log` where absent;
5. one new `reconciliation_checkpoints` table only if a final schema census confirms no general controller cursor authority.

Every migration requires a separate reviewed PR, checksum-bound authorization, governed execution and same-cycle schema readback.

## Prohibited duplication

- Do not create `canonical_capabilities` while `platform_semantic_capabilities` remains authoritative.
- Do not create a universal grant table that replaces scoped grant owners during migration.
- Do not create a generic relationship write authority over tenant and resource owners.
- Do not create a second envelope or evidence ledger.
- Do not move authorization identity to routes, tools, tabs or provider actions.

## T006 closure

T006 is complete. Every logical resource is mapped either to an existing SQL authority/projection strategy or to an explicitly bounded additive migration candidate. This mapping grants no migration or execution authority and starts no PR2 implementation.
