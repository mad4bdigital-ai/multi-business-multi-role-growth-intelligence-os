# Lane D — Local Manager UI States

## Scope

UI/copy only. This lane must not:
- execute auto-repair
- generate privileged installers
- rotate tokens
- mutate routes
- call break-glass diagnostics as a tenant fallback

## State mapping

| UI state | Intended use | Primary action |
|---|---|---|
| `connected` | selected device passed latest reachability checks | none |
| `needs_attention` | known device has unhealthy route/heartbeat/probe evidence | `view_recovery_plan` |
| `relink_required` | fresh Local Manager authorization is required | `forget_device_and_link_again` |
| `choose_device` | multiple devices or ambiguous target | `choose_device` |
| `admin_repair_required` | tenant-safe recovery cannot continue | none |
| `verification_pending` | provider/local step acknowledged but not verified | `retry_status_check` |
| `recovery_failed` | same-cycle readback failed | `view_recovery_plan` |

## UX rules

- Select target first.
- Show device label and canonical device id; do not rely on hostname.
- Do not display secrets, signed URLs, raw machine identifiers, or authorization headers.
- Do not describe installer launch as success.
- Do not describe service running as route healthy.
- Do not show `recovered` until same-cycle readback succeeds.

## Mock integration payload

Use `apps/local-manager/reachability-ui-states.json` for copy and frontend state enumeration.
