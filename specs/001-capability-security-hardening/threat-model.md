# Threat Model

## Protected assets

- tenant and platform resources
- platform-managed and tenant-managed integrations
- credential bindings and intake sessions
- local devices and files
- shell/service execution
- Cloudflare zones and DNS
- n8n instances and workflows
- approval decisions
- audit integrity
- capability registry and policy definitions

## Trust boundaries

1. Chat/client → authenticated API
2. tenant principal → platform-admin surface
3. API dispatcher → policy engine
4. policy engine → credential registry
5. policy engine → device connector
6. platform → third-party provider
7. platform → local operating system
8. runtime → audit store

## Primary threats

### T1 Selector substitution

An attacker changes `action_key` to `tool_key` to remove smoke or approval gates.

**Mitigation:** canonical identity, one-selector validation, parity tests.

### T2 Tenant-to-admin capability access

A tenant invokes a known administrative tool key.

**Mitigation:** principal/surface policy before resource or credential resolution; fail closed.

### T3 Ambiguous selector smuggling

Different parsers or layers choose different selectors.

**Mitigation:** reject zero/multiple selectors at the boundary.

### T4 Credential-state confusion

A credential exists or is "not required," and the system treats that as authorization.

**Mitigation:** independent authorization, requirement, resolution, and usability decisions.

### T5 Secure-intake abuse

An attacker creates intake sessions for another tenant, redirects a victim, or replays a session.

**Mitigation:** dedicated wrapper, subject/tenant/purpose binding, allowlisted redirect, nonce, expiry, single use, audit.

### T6 Foreign or stale device execution

An authorized skill is used against a foreign, archived, offline, or impersonated device.

**Mitigation:** ownership, caller permission, connector identity, heartbeat freshness, capability support.

### T7 Missing local consent

A remote request executes a sensitive local operation without user awareness.

**Mitigation:** risk-based local approval, UAC where necessary, bounded approval token.

### T8 Arbitrary shell/file escape

Arguments inject shell commands or file paths escape approved roots.

**Mitigation:** capability-specific command aliases, typed arguments, no general shell, canonical path checks, symlink defense.

### T9 Platform-managed credential misuse

A tenant uses a shared platform credential on an unauthorized zone or resource.

**Mitigation:** resource ownership and target allowlist independent of credential source.

### T10 Approval replay

A valid approval is reused for another target or later request.

**Mitigation:** request digest, capability/subject/target binding, expiry, consumption state.

### T11 Policy missing → allow

Unclassified tool or missing binding falls through to default false gates and execution.

**Mitigation:** default deny and complete-policy invariant.

### T12 Misleading readiness

A registered device is shown as healthy and trusted without live evidence.

**Mitigation:** component-level readiness and freshness rules.

### T13 Audit evasion

Early failure hides unevaluated controls or execution occurs without a trace.

**Mitigation:** decision trace for all attempts; explicit `not_evaluated`; execution invariant.

## Abuse cases to test

- tenant admin requests `credential_intake_session_create` raw admin alias
- tenant member requests platform-managed Cloudflare mutation
- both action and tool selectors supplied
- valid skill plus foreign device ID
- valid device plus stale heartbeat
- valid approval used for a different target
- consumed intake nonce replayed
- `pending_validation` credential used for provider smoke
- path traversal and symlink escape
- command argument with metacharacters
- dual-surface capability returns different policy
- unregistered capability with `state_changing=true`
