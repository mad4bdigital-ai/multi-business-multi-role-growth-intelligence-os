# Public Error Catalog

All errors use the repository structured envelope and omit registry internals.

| Code | HTTP | Meaning |
|---|---:|---|
| `INTENT_AMBIGUOUS` | 409 | More than one safe candidate needs clarification. |
| `BRAND_NOT_AUTHORIZED` | 403 | Principal cannot access the Brand. |
| `RESOURCE_BINDING_NOT_FOUND` | 409 | No exact authorized resource binding exists. |
| `CONNECTION_SCOPE_MISMATCH` | 409 | Connection belongs to another resource scope. |
| `CONNECTION_NOT_READY` | 409 | Required readiness dimension is invalid/unknown. |
| `SCHEMA_NOT_VERIFIED` | 409 | Current executable input schema is unavailable. |
| `CAPABILITY_NOT_EXPOSED` | 403 | Capability is not exposed to this Tenant surface. |
| `CAPABILITY_NOT_CALLABLE` | 409 | Governance, route, export, certification, or readback is incomplete. |
| `QUESTIONNAIRE_CONTEXT_STALE` | 409 | Resource/schema revisions changed. |
| `RECOMMENDATION_CONTRADICTED` | 409 | Proposed action conflicts with current state. |
| `SCOPE_WIDENING_REQUIRES_APPROVAL` | 409 | Available alternative grants broader access. |
| `APPROVAL_REQUIRED` | 409 | Scoped approval is required. |
| `APPROVAL_MISMATCH` | 409 | Approval does not match actor/resource/action/hash. |
| `OPERATION_ALREADY_EXISTS` | 200 | Existing idempotent operation returned. |
| `OPERATION_OUTCOME_UNKNOWN` | 409 | Provider outcome is ambiguous; readback only. |
| `READBACK_NOT_VERIFIED` | 409 | Provider acknowledgement was not verified. |
| `RETRY_REVALIDATION_REQUIRED` | 409 | Fresh ECE evidence is required. |
| `RESPONSE_BUDGET_EXCEEDED` | 413 | Use the durable detail reference. |

Messages are localized. Details contain only safe field/action guidance and `requestId` when available.
