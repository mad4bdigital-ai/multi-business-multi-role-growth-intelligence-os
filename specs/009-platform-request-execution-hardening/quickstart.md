# Quickstart

1. Resolve the signed principal and authorized tenant/workspace/resource.
2. Call `operation_context_get` for a bounded snapshot.
3. Preview the requested high-level operation.
4. Execute with an idempotency key and operation-scoped approval.
5. Verify same-cycle readback and evidence.
6. Resume by `operation_id` after retryable failures.

Example intent:

```json
{
  "operation": "repo.spec.extend",
  "scope": {
    "admin": true,
    "tenant_user": true,
    "design_only": true,
    "allow_runtime_changes": false,
    "allow_database_migrations": false,
    "allow_merge": false
  }
}
```
