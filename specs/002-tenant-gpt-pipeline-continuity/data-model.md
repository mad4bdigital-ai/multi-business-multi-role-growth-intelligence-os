# Data and Response Model

## Tenant action readiness

Existing action fields remain. Additive fields describe tenant-effective readiness:

```text
ready: boolean
preview_ready: boolean
readiness_status: string
blocked_reason: string | null
readiness:
  runtime_registry_ready: boolean
  tenant_effective_ready: boolean
  tenant_effective_status: string | null
  resolver: string | null
  checks: object | null
  secrets_included: false
```

`ready` is true only when the runtime registry prerequisite and tenant-effective resolver both pass.

## Operational connector state

```text
active  = connected system active + active non-expired installation
pending = connected system pending OR active without active installation
error   = connected system error OR installation error
```

## Nullable operational badges

```text
connectors:
  available: boolean
  active: integer | null
  pending: integer | null
  error: integer | null
```

Known zero uses `available: true` and numeric zero. Query failure or unavailable evidence uses `available: false` and null values.

## Completeness

`blocked_surfaces` is the number of blocked operational categories among connectors, tasks, agents, skills, freshness, and signals. It is not the number of blocked rows.

## Compatibility

All new fields are additive. No endpoint, request body, status code, or existing response key is removed or renamed.
