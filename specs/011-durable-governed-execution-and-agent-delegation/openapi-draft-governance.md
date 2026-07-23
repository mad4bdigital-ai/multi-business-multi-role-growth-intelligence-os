# OpenAPI Draft Governance for Spec 011

## Authority

`contracts/durable-governed-execution.openapi.yaml` is a design artifact. It is not included in runtime tool export, route discovery, generated client authority, or `http-generic-api/openapi.yaml` until promotion gates pass.

The canonical runtime specification remains `http-generic-api/openapi.yaml` and its governed split or generated artifacts.

## Required draft metadata

The Spec 011 draft must declare:

```yaml
x-runtime-authority: false
x-contract-status: design_only
x-promotion-gate: route_handler_registry_parity
```

## Promotion gate

A path may move from the Spec 011 draft to canonical OpenAPI only when the same implementation slice contains:

1. Route and handler.
2. Input validation and strict unknown-field behavior.
3. Authentication, Tenant membership, and object-level authorization.
4. SQL-primary semantic intent and execution-contract binding.
5. Capability, approval, idempotency, retry, readback, and evidence policy.
6. Stable structured errors and examples.
7. Unit, integration, Tenant-isolation, no-secret, and contract-parity tests.
8. Backward compatibility or an approved migration plan.
9. Generated artifact regeneration when generator authority applies.
10. CI proof that canonical OpenAPI and runtime routes are synchronized.

## Forbidden behavior

- Exporting draft-only paths as callable tools.
- Treating a draft operation ID as runtime authority.
- Updating canonical OpenAPI before route and registry authority exist.
- Maintaining different request or error contracts in the draft and runtime after promotion.
- Silently copying a draft path without its authorization and readback policies.

## Future promotion

When Phase 1 implements the first read-only endpoints, the implementation PR updates the draft status for only those promoted paths, updates canonical OpenAPI, and changes the Phase 0 CI guard. Unimplemented paths remain design-only.
