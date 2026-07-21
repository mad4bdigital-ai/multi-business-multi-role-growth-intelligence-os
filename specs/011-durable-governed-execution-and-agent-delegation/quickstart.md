# Quickstart Scenarios

These examples describe the intended contract. They are not runtime authority until implementation and certification complete.

## 1. User-controlled operation

```json
{
  "intent": "database.migration.apply",
  "approval_mode": "user_approval_only",
  "resource_uri": "mysql://growth-os",
  "idempotency_key": "migration-20260715-apply"
}
```

Expected sequence:

1. Create durable operation.
2. Resolve execution contract.
3. Run static and engine-native validation.
4. Return `awaiting_approval` and typed next action.
5. Apply only after exact user approval.
6. Reconcile schema and ledger.
7. Return completed evidence.

## 2. Delegated repository preparation

```json
{
  "intent": "repo.change.deliver",
  "approval_mode": "delegated_plan_bound",
  "resource_uri": "github://owner/repo",
  "plan_id": "plan-123",
  "idempotency_key": "spec-011-docs-delivery"
}
```

The grant may allow branch creation, semantic documentation patch, PR creation, branch synchronization, CI rerun, and deterministic low-risk repair. It denies merge, deploy, migration apply, credential write, permission expansion, and external send.

The platform stops when:

- files outside plan change;
- head or base drift invalidates bindings;
- CI repair is not allowlisted;
- risk rises above low;
- the grant expires or is revoked;
- merge approval is required.

## 3. Unknown mutation outcome

A provider accepts a request, but the transport fails before the platform receives a response.

Expected behavior:

```text
executing
→ reconciliation_required
→ provider and ledger readback
→ confirmed_success or confirmed_failure
```

The platform does not retry until absence or safe idempotency is proven.

## 4. Human on exception

A certified low-risk documentation workflow runs under `human_on_exception`. Normal steps execute automatically. A changed generator checksum triggers:

```json
{
  "state": "awaiting_approval",
  "reason_code": "GENERATOR_AUTHORITY_DRIFT",
  "next_action": "review_regenerated_diff"
}
```

## 5. Revoked delegation

Revocation before dispatch blocks the step. Revocation after dispatch does not erase the mutation; the platform reconciles the dispatched action and prevents subsequent steps.
