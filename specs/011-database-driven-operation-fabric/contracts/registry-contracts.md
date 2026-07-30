# Conceptual Registry Contracts

These contracts define future additive SQL surfaces. They are not executable migration SQL.

## `operation_registry`

```text
operation_key varchar(191) primary key
version int not null
operation_class varchar(64) not null
scope_type varchar(32) not null
risk_level varchar(16) not null
execution_mode varchar(32) not null
input_schema_json json not null
output_schema_json json not null
status enum(draft,shadow,active,degraded,disabled,archived)
revision_hash char(64) not null
created_at datetime(3)
updated_at datetime(3)
```

## `operation_step_registry`

```text
step_key varchar(191) primary key
operation_key varchar(191) not null
operation_version int not null
sequence_no int null
handler_key varchar(191) not null
input_mapping_json json null
success_condition_json json null
retry_policy_json json null
failure_policy varchar(64) not null
timeout_ms int null
status enum(draft,shadow,active,disabled,archived)
revision_hash char(64) not null
```

## `operation_execution_bindings`

```text
binding_key varchar(191) primary key
operation_key varchar(191) not null
operation_version int not null
adapter_key varchar(191) not null
runtime_key varchar(191) null
priority int not null
fallback_rank int not null
compatibility_json json not null
requires_approval boolean not null
requires_readback boolean not null
valid_from datetime(3) null
valid_until datetime(3) null
status enum(draft,shadow,active,degraded,disabled,archived)
revision_hash char(64) not null
```

## `execution_adapter_registry`

```text
adapter_key varchar(191) primary key
adapter_family varchar(64) not null
handler_key varchar(191) not null
runtime_surface varchar(191) null
capabilities_json json not null
supports_idempotency boolean not null
supports_readback boolean not null
supports_resume boolean not null
certification_status varchar(32) not null
status enum(draft,shadow,active,degraded,disabled,archived)
revision_hash char(64) not null
```

## `operation_tool_projections`

```text
projection_key varchar(191) primary key
operation_key varchar(191) not null
audience enum(admin,tenant,internal)
tool_key varchar(191) not null
http_method varchar(16) not null
http_path varchar(500) not null
source_revision_hash char(64) not null
projection_revision_hash char(64) not null
previous_projection_key varchar(191) null
visibility_status enum(draft,shadow,active,blocked,disabled,archived)
created_at datetime(3)
applied_at datetime(3) null
```

## `generated_artifact_registry`

```text
artifact_key varchar(191) primary key
path_pattern varchar(500) not null
generator_key varchar(191) not null
source_authority_json json not null
reconciliation_policy varchar(64) not null
run_stage varchar(64) not null
validation_key varchar(191) null
manual_edit_policy enum(allow,review,deny)
status enum(draft,shadow,active,disabled,archived)
revision_hash char(64) not null
```

## Required implementation properties

- UTF-8 collation consistent with platform policy.
- Foreign keys or equivalent application-enforced integrity documented explicitly.
- Indexes for active operation, binding priority, audience projection, and generated path lookup.
- JSON validity constraints and strict schema validation in application code.
- No credential payload or arbitrary executable source columns.
- Immutable revision hashes for active records.
- Same-cycle readback views and migration attestation.
