# Testing Strategy

## Unit tests

- Device canonical identity and alias resolution.
- Route channel state transitions.
- Profile overlay precedence: global -> tenant -> user -> device.
- Recovery planner reason-code mapping.
- Authorization gate decisions for installer generation.
- Sensitive field redaction.

## Integration tests

- `connector_diagnostics` returns separate route channel states.
- Target selection rejects ambiguous multi-device requests.
- Heartbeat updates route status without exposing secrets.
- Probe evidence changes route state from stale to healthy or unreachable.
- Recovery preview returns no installer secret.
- Installer generation refuses stale authorization.

## Contract tests

- OpenAPI examples validate under OpenAPI 3.1.
- Error envelopes use stable `error.code`, human message, and details.
- Additive fields remain optional for older clients.
- Tenant routes cannot request admin break-glass actions.

## Simulation tests

Simulate these failure matrices:

1. Config exists, no registered route.
2. Auth-host fails, break-glass succeeds.
3. Break-glass fails, auth-host succeeds.
4. Both external hosts fail.
5. Tunnel succeeds, local service fails.
6. Heartbeat stale but last probe success exists.
7. Device replaced while old route is still present.
8. Two devices share a hostname alias.

## Security tests

- Tenant principal cannot select break-glass route.
- Device token cannot create privileged installer when stale.
- Token hashes and endpoint secrets are not returned.
- Replay of installer token fails after TTL or generation mismatch.
- Object-level authorization blocks cross-tenant device access.

## Manual verification

- Run diagnostics for a known device with config only.
- Start local runtime and verify registration appears.
- Stop local service and verify local-service failure without deleting route.
- Disable tunnel and verify tunnel failure classification.
- Re-link a simulated replaced device and verify old generation is stale/revoked.

## CI gates

Every implementation PR must run:

- Syntax Check.
- Architecture Drift Detection.
- Execution Resolver Gate.
- Unit & Integration Tests.
- OpenAPI validation when contracts change.
- Migration authorization/readback when persistence changes.
