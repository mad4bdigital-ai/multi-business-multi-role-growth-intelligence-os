# Activation surface coverage exclusions

Add a JSON file here only when a new tenant/user-scoped table must **not** appear in activation.

Required fields:

```json
{
  "surface_key": "example_table",
  "source_table": "example_table",
  "reason": "Excluded because it stores internal-only telemetry and has no user-visible authorization meaning.",
  "owner": "platform-governance",
  "review_after": "2026-12-31"
}
```

Rules:

- Do not exclude tables just to bypass the activation contract.
- Exclusions must have a specific reason and owner.
- Tables that represent user-visible authorization, access, grants, workspaces, connectors, installations, resources, or memberships should use `../<surface_key>.json` instead.
- Exclusion files must not contain secret values or credentials.
