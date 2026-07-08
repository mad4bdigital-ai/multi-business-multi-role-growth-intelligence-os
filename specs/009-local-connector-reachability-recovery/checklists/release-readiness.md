# Release Readiness Checklist

## Specification PR readiness

- [x] Scope is documentation/specification-only.
- [x] No runtime mutation is introduced.
- [x] No Cloudflare, tunnel, device, or secret change is performed.
- [x] API draft contract is included.
- [x] Data model and migration plan are included.
- [x] Parallel rollout sequence is included.
- [x] Risk register and threat model are included.
- [x] Usage model and connection maps are included.
- [ ] Draft PR must be opened.
- [ ] CI/readback for documentation/spec changes must be recorded.

## Implementation readiness gates

- [ ] Physical migrations reviewed and applied through governed runner.
- [ ] OpenAPI contract validated and synced.
- [ ] Read-only diagnostics shipped before repair actions.
- [ ] Heartbeat and probes run in shadow mode before they affect UI state.
- [ ] Target selector UI supports multiple devices.
- [ ] Fresh authorization UX is available.
- [ ] Auto-install canary flag remains disabled until readback proves recovery.
- [ ] Break-glass mutation remains disabled until typed approval workflow is verified.

## Production readiness gates

- [ ] Canary device route registration verified.
- [ ] Canary heartbeat freshness verified.
- [ ] Auth-host and break-glass probes produce distinct classifications.
- [ ] Recovery preview returns no secrets.
- [ ] Installer generation rejects stale authorization.
- [ ] Recovery verification requires same-cycle readback.
- [ ] Alerts exist for unregistered route, stale heartbeat, repeated 502, and route conflict.
- [ ] Rollback flags have been tested.

## Closeout readiness

- [ ] Completion ledger lists every implementation PR and merge SHA.
- [ ] Residual risks are tracked with owner and due date.
- [ ] Existing config-only diagnostics deprecation plan is approved.
- [ ] Docs and runbooks are updated.
- [ ] Production parity evidence is attached.
