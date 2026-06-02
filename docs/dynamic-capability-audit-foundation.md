# Dynamic Capability Audit Foundation

Sprint 66 adds the first compatibility foundation for a Dynamic Capability OS.
It is intentionally metadata-first: it exposes current capability state and
audit intake points without changing dispatch behavior.

## Boundary

This foundation:

- provides compatibility views over existing registries;
- creates evidence intake tables for repo, asset, DB, and checkpoint audit data;
- does not enable watchers;
- does not execute mutations;
- does not create tenant routes;
- does not certify new apply paths.

The platform is still governed by existing policy, resource authority,
readiness, and tenant surface guards. Any future automation must write bounded
evidence into these tables and pass the existing approval/readback gates.

## Tables

`platform_audit_event_bus`

General event intake for evidence correlation. It records source family,
source key, event type, resource identity, status, and bounded evidence. It is
the future join point for GitHub callbacks, release readiness persistence,
governed migration runner evidence, Drive scans, and runtime tool evidence.

`repo_file_audit_runs`

One row per repo audit run. It stores repo, branch, commit SHA, audit scope,
summary, and source event key. This replaces large file-by-file audit reports
stored only as free text in a checkpoint.

`repo_file_audit_findings`

Normalized file-level audit findings linked to a repo audit run. Each row
stores file path, status, finding type, risk, next action, and evidence.

`asset_audit_events`

Asset evidence intake for providers such as Google Drive. This is not a Drive
watcher; it is where explicit Drive readback, periodic scans, or future change
callbacks can store bounded evidence.

`db_change_audit_events`

Database change evidence intake for governed migrations and future DB mutation
wrappers. Direct SQL mutations outside governed paths are not automatically
captured by this table.

`checkpoint_auto_rollups`

Pending or completed rollups from audit events into platform checkpoints. This
supports automatic checkpoint planning after CI/readiness evidence exists, but
does not itself write checkpoints.

## Views

`v_platform_capabilities_current`

Compatibility view over current capability sources:

- `admin_platform_endpoint_tools`
- `tenant_platform_endpoint_tools`
- `platform_engine_registry`
- `resource_authority_route_family_registry`
- `runtime_dispatch_certification_registry`
- `platform_plugin_contributions`

It normalizes source table, source key, capability family, operation class,
risk class, runtime status, exposure scope, resource authority requirement,
dispatch/apply flags, audit/readback requirements, and evidence reference.

`v_platform_bindings_current`

Compatibility view over capability bindings. It currently projects:

- app-to-tool bindings from `app_integration_tool_bindings`;
- engine-to-policy bindings from `platform_engine_policy_registry`;
- dispatch certifications from `runtime_dispatch_certification_registry`.

`v_platform_exports_current`

Compatibility view over active route/tool export surfaces currently represented
by admin and tenant tool registries. It does not add any new OpenAPI operation.

`v_platform_capability_maturity`

Computes a lightweight maturity score and status from existing evidence:
runtime status, active export, active binding, dispatch permission, authority
evidence, and audit/readback requirements.

`v_platform_capability_gaps`

Lists actionable gaps from the compatibility projection:

- `dispatch_not_allowed`
- `authority_evidence_missing`
- `active_export_missing`

## Operational Use

This foundation supports the next Dynamic Capability OS stages:

1. GitHub CI callbacks or scheduled jobs write to `platform_audit_event_bus`.
2. Repo audit tools write `repo_file_audit_runs` and `repo_file_audit_findings`.
3. Governed migration runner evidence writes `db_change_audit_events`.
4. Drive readback or periodic scans write `asset_audit_events`.
5. Checkpoint tools create `checkpoint_auto_rollups` when enough fresh evidence
   exists.
6. Planners query the compatibility views before choosing an engine, policy, or
   skill prompt.

Until those writers are added, these are compatibility views and evidence
intake tables only.
