# Threat Model

## Assets

- Tenant device identity and route registry.
- Local Connector device token and installer token.
- Admin break-glass authority.
- Tunnel routing metadata.
- User profile and device profile preferences.
- Recovery plan evidence.

## Abuse cases and mitigations

### Cross-tenant device targeting

Risk: an attacker guesses a device alias and routes actions to another tenant's device.

Mitigations:
- Resolve by tenant/user/canonical device ID.
- Require object-level authorization for every device and route read.
- Treat aliases as display/search helpers, not authority.

### Tenant escalation to break-glass

Risk: a tenant request uses admin break-glass route when auth-host route fails.

Mitigations:
- Route channel is part of the authorization decision.
- Break-glass endpoints are admin-only and audited.
- Recovery planner may recommend admin diagnostics but cannot execute them for tenant users.

### Stale device token installer generation

Risk: a saved token from an old install creates a privileged installer after a user is no longer present.

Mitigations:
- Require fresh authorization for privileged installer generation.
- Bind installer token to device generation, route channel, tenant, user, and TTL.
- Reject replay after generation or state change.

### Device replacement confusion

Risk: a new machine reuses an old hostname and inherits old routes.

Mitigations:
- Separate canonical device ID from hostname alias.
- Use generation and Windows install instance evidence where available.
- Mark old routes stale/replaced until verified.

### Host/tunnel spoofing

Risk: a malicious endpoint presents as a connector route.

Mitigations:
- Runtime registration must be signed by device credentials.
- Probe success must include expected device/route binding where possible.
- Endpoint host is not sufficient proof of ownership.

### Sensitive information leakage

Risk: diagnostics expose tokens, connector secrets, signed installer URLs, or machine identifiers.

Mitigations:
- Return sanitized endpoint hosts and route IDs.
- Hash sensitive aliases.
- Use structured error envelopes without stack traces.
- Audit but do not expose secret material.

## Fail-closed rules

- Unknown route channel blocks execution.
- Ambiguous target device blocks state-changing action.
- Missing freshness evidence blocks privileged installer generation.
- Break-glass unavailable does not permit tenant fallback to admin authority.
- Recovered cannot be inferred from provider acknowledgement alone.
