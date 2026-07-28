# Context Kernel Shadow Integration

Phase 6 introduces a default-off, read-only integration seam for low-risk Resource API reads.

## Safety contract

- The observer is injected only when explicitly configured.
- It registers on the legacy response `finish` event and runs after the response is sent.
- It never changes legacy status, headers, body, controller selection, or provider dispatch.
- Resolver and telemetry failures are isolated and cannot fail the completed request.
- Cross-tenant JWT/path mismatches are rejected before resolution and recorded as safe telemetry.
- Telemetry excludes user identifiers, headers, JWTs, request bodies, credentials, tokens, secrets, raw provider payloads, and stack traces.
- The integration is read-only and supplies `operationKind: read`, `riskClass: read`, and `allowLowRiskFallback: false`.

## Resource-first behavior

The mapper uses route evidence in this order:

1. tenant reference from the resource path;
2. exact resource type from `resourceKey`;
3. exact resource reference from `resourceId` when present;
4. brand-scoped normalization only for explicit brand resource keys.

Catalog and collection reads are observed without forcing an exact candidate. Item reads compare the kernel-selected stable/resource reference with the exact route resource reference.

## Runtime status

The feature is not enabled by default. Runtime composition must explicitly inject either `contextKernelResourceShadowMiddleware` or a `contextKernelShadow` configuration into `buildResourceApiRoutes`. Provider selection, writes, route replacement, and rollout activation remain separate governed work.
