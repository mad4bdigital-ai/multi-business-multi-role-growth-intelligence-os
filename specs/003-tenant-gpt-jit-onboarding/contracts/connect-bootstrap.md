# Contract: `connect_bootstrap`

The final `parent_action_key` and `endpoint_key` must be resolved from registry/bootstrap authority.

## Invocation

```json
{
  "name": "connect_bootstrap",
  "tool_args": {
    "mode": "managed",
    "workspace_key": "optional-public-key"
  }
}
```

Identity fields (`user_id`, `tenant_id`, `role`, email, tokens, or provider credentials) are forbidden and must be derived from the authenticated session.

## Success

```json
{
  "ok": true,
  "bootstrap": {
    "account": "created_or_existing",
    "tenant": "created_or_existing",
    "workspace": "created_or_existing",
    "connection": "activated_or_existing"
  },
  "principal": {
    "workspace_key": "ws_public_123",
    "role": "owner"
  },
  "activation": {
    "mode": "managed",
    "status": "active",
    "validation_status": "verified"
  },
  "next_actions": [],
  "secrets_included": false,
  "requestId": "req_123"
}
```

## Required errors

`OAUTH_REQUIRED`, `ACCOUNT_DISABLED`, `MEMBERSHIP_REVOKED`, `TENANT_SUSPENDED`, `TENANT_SELECTION_REQUIRED`, `TENANT_PROVISIONING_FAILED`, `ACTIVATION_FAILED`, `ACTIVATION_VALIDATION_FAILED`, and `IDEMPOTENCY_CONFLICT`.

## Invariants

- Never create a replacement tenant for a blocked principal.
- Never report active without final readback.
- Never return secrets.
- Replaying a completed request returns stable state without duplicate writes.
