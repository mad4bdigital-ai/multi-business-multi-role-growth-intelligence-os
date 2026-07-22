# Spec 011 Stable Error Codes

These codes define the design contract. Runtime promotion requires matching structured error envelopes and tests.

| Code | Meaning | Default status |
|---|---|---:|
| `DURABLE_OPERATION_NOT_FOUND` | The authorized operation does not exist or is not visible to the caller. | 404 |
| `INVALID_OPERATION_TRANSITION` | The requested transition violates the certified state machine. | 409 |
| `EXECUTION_CONTRACT_NOT_FOUND` | No SQL-primary contract matches intent, resource, and mode. | 409 |
| `EXECUTION_CONTRACT_AMBIGUOUS` | More than one authoritative contract matches. | 409 |
| `EXECUTION_CONTRACT_STALE` | Contract or resource snapshot is older than the allowed freshness boundary. | 409 |
| `IDEMPOTENCY_KEY_REQUIRED` | An unsafe retryable operation has no valid idempotency key. | 400 |
| `IDEMPOTENCY_SCOPE_CONFLICT` | The key is already bound to a different request fingerprint or scope. | 409 |
| `MUTATION_RECEIPT_REQUIRED` | Dispatch was attempted without a durable pending receipt. | 409 |
| `UNKNOWN_OUTCOME_RECONCILIATION_REQUIRED` | Dispatch outcome is unknown and retry is blocked until reconciliation. | 409 |
| `READBACK_REQUIRED` | Provider response exists but the declared readback is incomplete. | 409 |
| `DELEGATION_REQUIRED` | The requested approval mode requires a delegation grant. | 403 |
| `DELEGATION_EXPIRED` | The delegation grant expired before dispatch. | 403 |
| `DELEGATION_REVOKED` | The delegation grant was revoked. | 403 |
| `DELEGATION_SCOPE_DRIFT` | Plan, resource, intent, mode, checksum, SHA, or affected scope changed. | 409 |
| `DELEGATION_RISK_EXCEEDED` | Current risk is above the delegated ceiling. | 403 |
| `DELEGATION_LIMIT_EXCEEDED` | Mutation, retry, PR, cost, or time limit is exhausted. | 409 |
| `SELF_APPROVAL_FORBIDDEN` | An Agent attempted to expand or independently approve its own authority. | 403 |
| `HUMAN_APPROVAL_REQUIRED` | Policy requires a user decision for the current step. | 409 |
| `ENGINE_VALIDATION_REQUIRED` | Migration apply cannot proceed without compatible engine validation. | 409 |
| `MERGE_FRESHNESS_CHANGED` | Approved head or base SHA no longer matches. | 409 |
| `STRUCTURED_DIAGNOSIS_REQUIRED` | A failing CI gate did not publish the required diagnosis artifact. | 500 |
| `EVIDENCE_INCOMPLETE` | Required bounded evidence is absent, stale, or inconsistent. | 409 |

All errors include `requestId` when available, `operation_id` when created, bounded details, a canonical next action where safe, and `secrets_included=false`.
