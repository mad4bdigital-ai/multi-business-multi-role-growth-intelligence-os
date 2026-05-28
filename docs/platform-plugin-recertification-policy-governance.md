# Platform Plugin recertification policy governance

## Purpose

This document describes the recertification policy registry, queue, batch runner, audit history, and rollback surfaces for Platform Plugin smoke certifications.

It is the operator-facing policy map for the work completed through Phase 44.

## Policy registry

Policies are stored in:

```text
platform_plugin_smoke_recertification_policies
```

Policy resolution is scope-aware. Narrower matches win over broader defaults.

Match dimensions:

```text
tenant_id
plugin_key
action_key
mock_provider
mock_resource
```

Default policy row:

```text
policy_id: smoke_recert_policy_default
plugin_key: *
certification_ttl_days: 90
expires_soon_days: 14
max_batch_size: 5
auto_recertification_enabled: false
provider_smoke_required: true
```

The default is intentionally conservative. Automatic recertification is disabled unless a narrower policy explicitly enables it.

## Effective policy fields

| Field | Meaning |
|---|---|
| `certification_ttl_days` | Number of days added to `certification_expires_at` when certification or recertification succeeds. |
| `expires_soon_days` | Queue threshold for `expires_soon`. |
| `max_batch_size` | Policy cap on real recertification batch size. Runtime still caps at 10. |
| `auto_recertification_enabled` | Allows automatic batch selection when there is no drift. |
| `provider_smoke_required` | Documents that provider smoke is required for this policy. |
| `allowed_expected_origin` | Optional origin allowlist. If set, queue detects `policy_expected_origin_mismatch`. |
| `status` | Active/inactive policy state. |
| `priority` | Lower value wins when multiple scopes match. |

## Policy tools

Resolve:

```text
platform_plugin_smoke_recertification_policy_resolve
POST /platform/plugins/smoke-certifications/policies/resolve
```

List:

```text
platform_plugin_smoke_recertification_policy_list
POST /platform/plugins/smoke-certifications/policies/list
```

Upsert:

```text
platform_plugin_smoke_recertification_policy_upsert
POST /platform/plugins/smoke-certifications/policies/upsert
```

Policy upsert is consequential. It writes execution-log audit evidence.

## Policy upsert audit

Every policy upsert writes an `execution_log` row with:

```text
entry_type: platform_plugin_smoke_recertification_policy_upsert
execution_class: platform_plugin_governance
source_layer: platformPluginSmokeRecertificationPolicy
```

The audit summary contains:

```text
actor
reason
upsert_mode
changed_fields
before summary
after summary
secrets_included=false
```

The audit intentionally stores `notes_present` rather than raw note content.

This allows rollback to restore operational fields without replaying raw notes.

## Queue

The recertification queue is read-only:

```text
platform_plugin_smoke_recertification_queue
POST /platform/plugins/smoke-certifications/recertification-queue
```

The queue joins certification evidence with the current connection, endpoint, and effective policy.

Queue reasons:

```text
expired
expires_soon
origin_drift
path_drift
method_drift
policy_expected_origin_mismatch
connection_missing
endpoint_missing
url_resolution_failed
```

Queue item outputs include:

```text
expired
expires_soon
reasons
drift_reasons
recertification_required
recertification_due_soon
automatic_recertification_supported
policy summary
secrets_included=false
```

Automatic recertification is supported only when:

```text
no drift reasons
tenant_id exists
user_id exists
expected_origin exists
effective policy auto_recertification_enabled=true
```

## Batch runner

The batch runner is consequential and defaults to dry-run:

```text
platform_plugin_smoke_recertification_batch
POST /platform/plugins/smoke-certifications/recertification-batch
```

Safety boundaries:

```text
dry_run=true by default
real execution uses provider_smoke=true
real execution requires explicit expected origin evidence
real execution selects only no-drift candidates
real execution honors policy max_batch_size
real execution honors policy certification_ttl_days
secrets_included=false
```

The batch runner does not bypass origin/path/method drift. It can only use recertification mode to allow expired certificates to re-run the same certified target.

## History and rollback

History:

```text
platform_plugin_smoke_recertification_policy_history
POST /platform/plugins/smoke-certifications/policies/history
```

Rollback preview:

```text
platform_plugin_smoke_recertification_policy_rollback_preview
POST /platform/plugins/smoke-certifications/policies/rollback-preview
```

Rollback apply:

```text
platform_plugin_smoke_recertification_policy_rollback_apply
POST /platform/plugins/smoke-certifications/policies/rollback-apply
```

Rollback apply requires:

```text
confirm_rollback=true
```

Rollback apply calls the same audited policy upsert service, so rollback itself writes a new audit row.

Rollback targets:

```text
rollback_to=before
rollback_to=after
```

Rollback preview returns:

```text
target_snapshot
current_policy
changed_fields
rollback safety notes
```

Rollback does not replay raw note content because audit summaries store only `notes_present`.

## Current CRM sample policy

The current live sample policy is:

```text
policy_id: smoke_recert_policy_crm_contacts_sample
tenant_id: e989a841-fce0-4ced-be76-463e8202a066
plugin_key: tenant.nagy_sample_crm_20260525
action_key: crm.contact.list
mock_provider: crm
mock_resource: contacts
certification_ttl_days: 90
expires_soon_days: 30
max_batch_size: 1
auto_recertification_enabled: true
provider_smoke_required: true
allowed_expected_origin: https://auth.mad4b.com
status: active
priority: 10
```

The policy is intentionally narrow and applies only to the sample CRM smoke target.

## Operational checklist

For a policy change:

1. Resolve current effective policy.
2. Preview the diff manually before mutation.
3. Include `actor`, `reason`, and optionally `trace_id` in the upsert request.
4. Verify `upsert.audit.id` exists.
5. Run queue readback for the affected scope.
6. For risky changes, use an approval-hold flow before apply when implemented.

For rollback:

1. Read history filtered by `policy_id` and `changed_field`.
2. Preview rollback from a chosen audit row.
3. Confirm the target snapshot and changed fields.
4. Apply with `confirm_rollback=true`, `actor`, and `reason`.
5. Verify the new audit row.
6. Confirm queue and dispatch remain healthy.

## Next governance gap

The next hardening phase is approval hold for risky fields:

```text
auto_recertification_enabled
allowed_expected_origin
max_batch_size
provider_smoke_required
status
large TTL changes
```

Risky policy changes should return an approval hold rather than applying immediately.
