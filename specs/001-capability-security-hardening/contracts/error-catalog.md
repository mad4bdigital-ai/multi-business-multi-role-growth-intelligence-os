# Error Catalog

| HTTP | Code | Meaning |
|---:|---|---|
| 400 | `MISSING_CAPABILITY_SELECTOR` | No selector supplied |
| 400 | `AMBIGUOUS_CAPABILITY_SELECTOR` | Multiple selectors supplied |
| 400 | `INVALID_CAPABILITY_ARGUMENTS` | Request schema or typed arguments invalid |
| 401 | `AUTHENTICATION_REQUIRED` | Missing or invalid authentication |
| 403 | `CAPABILITY_NOT_TENANT_EXPOSED` | Capability exists but is not exposed to tenant principals |
| 403 | `ADMIN_TOOL_FORBIDDEN` | Platform-admin-only tool requested by unauthorized principal |
| 403 | `SKILL_NOT_GRANTED` | Required skill is not granted |
| 403 | `RESOURCE_NOT_AUTHORIZED` | Caller lacks object-level access |
| 403 | `CREDENTIAL_SCOPE_MISMATCH` | Credential binding does not authorize target scope |
| 403 | `LOCAL_CONSENT_REQUIRED` | Local approval is required and absent |
| 403 | `APPROVAL_REQUIRED` | Required approval is absent |
| 404 | `CAPABILITY_NOT_FOUND` | Selector cannot be resolved |
| 404 | `RESOURCE_NOT_FOUND` | Public-safe resource lookup failure |
| 409 | `POLICY_NOT_FOUND` | Capability lacks complete policy; execution denied |
| 409 | `SURFACE_POLICY_MISMATCH` | Surface alias policy conflicts with canonical policy |
| 409 | `DEVICE_ID_REQUIRED` | Device-scoped capability lacks device ID |
| 409 | `DEVICE_NOT_AUTHORIZED` | Device cannot be used by this subject/tenant |
| 409 | `DEVICE_OFFLINE` | Device is registered but offline |
| 409 | `DEVICE_HEARTBEAT_STALE` | Heartbeat is older than policy threshold |
| 409 | `CONNECTOR_IDENTITY_MISMATCH` | Connector does not match registered device identity |
| 409 | `CREDENTIAL_NOT_VALIDATED` | Credential is pending or failed validation |
| 409 | `CREDENTIAL_REVOKED` | Credential is revoked |
| 409 | `APPROVAL_EXPIRED` | Approval is expired |
| 409 | `APPROVAL_REPLAYED` | Approval has already been consumed |
| 409 | `INTAKE_SESSION_REPLAYED` | Intake session has already been consumed |
| 409 | `INTAKE_SESSION_EXPIRED` | Intake session expired |
| 400 | `credential_intake_binding_context_required` | Intake creation lacks immutable subject/tenant/integration/target/purpose context |
| 400 | `credential_intake_redirect_not_allowed` | Redirect is malformed, cross-origin without registration, non-HTTPS, or absent from the integration allowlist |
| 410 | `credential_intake_binding_mismatch` | Persisted intake context no longer matches its immutable binding digest |
| 410 | `credential_intake_authority_revoked` | Tenant membership, tenant state, integration policy, source mode, auth type, or app lifecycle changed after session creation |
| 422 | `TARGET_NOT_SUPPORTED` | Target does not support the capability |
| 422 | `COMMAND_NOT_ALLOWLISTED` | Local command is not registered |
| 422 | `PATH_OUTSIDE_ALLOWED_ROOT` | File path escapes approved roots |
| 426 | `CONNECTOR_UPGRADE_REQUIRED` | Connector version is unsupported |
| 429 | `RATE_LIMITED` | Request exceeds policy |
| 500 | `SECURITY_DECISION_ERROR` | Unexpected internal decision failure; fail closed |
| 503 | `CONNECTOR_UNAVAILABLE` | Required connector is unavailable |
| 503 | `POLICY_AUTHORITY_UNAVAILABLE` | Policy/registry authority unavailable; fail closed |

## Response rules

- Tenant-facing messages MUST not reveal the existence of foreign-tenant resources.
- `requestId` SHOULD be returned when available.
- Internal traces MAY contain richer non-secret reason and evidence references.
- No error response may include credential values, raw tokens, connector secrets, or sensitive local output.
