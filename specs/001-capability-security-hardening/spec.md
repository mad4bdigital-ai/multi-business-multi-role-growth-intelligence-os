# Feature Specification: Unified Capability Authorization & Execution Security Hardening

**Feature branch:** `001-capability-security-hardening`  
**Created:** 2026-06-19  
**Status:** Draft for approval  
**Severity:** P0 security program

## Problem statement

The platform currently exposes multiple aliases and surfaces for equivalent capabilities. Evidence shows that changing only the selector type can change smoke, approval, credential, and execution decisions. Tenant requests have also reached administrative tool surfaces, explicit tool requests have been interpreted as `no_action_requested`, and credential resolution has returned `no_credentials_required` in contexts where authorization and resource-scoping decisions were still required.

Device operations were blocked by a missing skill, which provides partial containment, but the decision evidence did not show device identity, tenant ownership, reachability, connector identity, or local-consent checks. Registration status was also described as health without live verification.

The platform needs one fail-closed decision pipeline based on canonical capability identity, authenticated subject, tenant, resource ownership, policy, and current execution conditions.

## Goals

1. Eliminate selector-based privilege escalation.
2. Prevent tenant callers from reaching platform-admin-only capabilities.
3. Separate authorization, credentials, device trust, approvals, and readiness.
4. Make all required gates explicit, testable, and auditable.
5. Ensure `dispatch_ready` is possible only after every required gate passes.
6. Provide truthful activation and operational-readiness states.
7. Preserve stable API contracts and existing layer boundaries.

## Non-goals

- Redesigning every provider integration.
- Replacing the authentication system.
- Storing or exposing credential secrets.
- Enabling arbitrary local shell access.
- Performing production mutations during initial validation.
- Rewriting unrelated workflow engines.

## Actors

- **Platform administrator:** Manages platform-level capabilities and shared infrastructure.
- **Tenant administrator:** Manages tenant-authorized resources and integrations.
- **Tenant member:** Uses explicitly granted tenant capabilities.
- **Local device owner/operator:** Grants device-local consent where required.
- **Service principal:** Executes bounded automation under registered policy.
- **Security reviewer:** Reviews decisions, evidence, exceptions, and release gates.

## User stories

### US1 — Canonical capability parity (P0)

As a security administrator, I need every alias of the same capability to receive the same or stricter effective policy so that switching from `action_key` to `tool_key` cannot escalate privileges.

**Independent test:** Resolve one dual-surface capability through each selector. The normalized `canonical_capability_id`, required gates, and final decision are identical except for stricter surface restrictions.

### US2 — Tenant/admin surface isolation (P0)

As a tenant user, I must never obtain dispatch eligibility for a platform-admin-only capability, even if I know its tool key.

**Independent test:** A tenant principal requests an admin-only credential-management tool and receives `403 CAPABILITY_NOT_TENANT_EXPOSED` before credential resolution or dispatch planning.

### US3 — Unambiguous selector contract (P0)

As an API client, I receive a stable validation error when I provide zero or multiple selectors, preventing silent precedence and policy confusion.

**Independent test:** Supplying both `action_key` and `tool_key` returns `400 AMBIGUOUS_CAPABILITY_SELECTOR`.

### US4 — Separated credential decisions (P0)

As a security reviewer, I can distinguish authorization, credential requirement, credential resolution, and credential usability so that `no_credentials_required` never implies permission.

**Independent test:** A no-secret capability still fails when principal authorization or resource ownership fails.

### US5 — Secure tenant credential intake (P0)

As a tenant administrator, I can initiate a secure credential intake only for my tenant and an allowlisted integration, without access to raw administrative tooling or secret values.

**Independent test:** An intake session is tenant-bound, subject-bound, purpose-bound, single-use, expires, and cannot be replayed or redirected to an unapproved URL.

### US6 — Device trust enforcement (P1)

As a tenant device operator, I can execute a device-scoped capability only when the device is registered to my tenant, authorized for me, online, authenticated, capable, and locally approved when required.

**Independent test:** A valid skill with a foreign, offline, archived, or stale device still fails before dispatch.

### US7 — State-changing approval enforcement (P0)

As a resource owner, I am protected from unapproved mutations by an explicit policy that binds approval to capability, subject, target, and time.

**Independent test:** A state-changing capability without its required approval cannot produce `dispatch_ready`.

### US8 — Truthful activation/readiness reporting (P1)

As a tenant user, I can tell the difference between workspace activation, device registration, connector reachability, credential validation, and execution readiness.

**Independent test:** A registered but unreachable device is shown as `registered` and `offline/not_verified`, never `healthy`.

### US9 — Structured security decision trace (P1)

As a security reviewer, I can see which gates passed, failed, were not applicable, or were not evaluated, without seeing secrets.

**Independent test:** Every preview and execution has a trace containing policy version, canonical capability, gate states, final reason, and execution status.

## Functional requirements

### Selector and canonical identity

- **FR-001:** The API MUST accept exactly one selector from the supported selector union.
- **FR-002:** The platform MUST reject multiple selectors with `AMBIGUOUS_CAPABILITY_SELECTOR`.
- **FR-003:** Every selector MUST resolve to exactly one `canonical_capability_id`.
- **FR-004:** Alias mappings MUST be registry-controlled and versioned.
- **FR-005:** Unknown, missing, or multiply mapped aliases MUST fail closed.
- **FR-006:** The security policy engine MUST evaluate canonical capability identity, not raw selector type.
- **FR-007:** Surface policy MAY add restrictions but MUST NOT weaken canonical policy.
- **FR-008:** Dual-surface parity MUST be continuously tested.

### Principal, tenant, and resource authorization

- **FR-009:** The platform MUST derive principal and tenant from authenticated context, not caller-supplied identity fields.
- **FR-010:** Every capability MUST declare allowed principal classes and surfaces.
- **FR-011:** Tenant callers MUST be denied access to platform-admin-only capabilities before credential resolution.
- **FR-012:** Target-resource ownership MUST be verified for device, connection, zone, workflow, file root, and other scoped resources.
- **FR-013:** Cross-tenant objects MUST not be discoverable through differing error detail unless explicitly authorized.
- **FR-014:** Missing authorization policy MUST result in denial.

### Gate evaluation and dispatch readiness

- **FR-015:** Gate results MUST use `pass`, `deny`, `not_applicable`, or `not_evaluated`.
- **FR-016:** Required gates MUST never remain `not_evaluated` in an allowed decision.
- **FR-017:** `dispatch_ready` MUST require all required gates to pass.
- **FR-018:** `will_execute` MUST be false in preview mode.
- **FR-019:** State-changing capabilities MUST declare an explicit mutation policy.
- **FR-020:** `no_action_requested` MUST NOT be returned when any valid executable selector was supplied.
- **FR-021:** Policy absence, classification absence, or conflicting bindings MUST fail closed.

### Credential handling

- **FR-022:** Credential requirement, resolution, and usability MUST be separate fields.
- **FR-023:** Credential resolution MUST occur only after principal, surface, tenant, and object authorization pass.
- **FR-024:** `no_credentials_required` MUST NOT alter authorization or approval results.
- **FR-025:** Credentials in `pending_validation`, revoked, expired, or wrong-scope states MUST be unusable for provider execution.
- **FR-026:** Responses and logs MUST never contain credential secret material.
- **FR-027:** Platform-managed credentials MUST still require caller authorization for the target capability and resource.
- **FR-028:** Credential scope mismatches MUST return a stable denial reason.

### Secure intake

- **FR-029:** Tenant credential intake MUST use a dedicated tenant-safe canonical capability.
- **FR-030:** Tenant requests MUST NOT dispatch the raw platform-admin credential-intake tool.
- **FR-031:** Intake sessions MUST bind subject, tenant, integration, connection target, purpose, nonce, expiry, and allowed redirect.
- **FR-032:** Intake sessions MUST be single-use and replay-resistant.
- **FR-033:** Intake creation and consumption MUST be audited without secrets.
- **FR-034:** An intake session MUST be invalidated if relevant membership or connection authority changes.

### Device and local execution

- **FR-035:** Device-scoped capabilities MUST require `device_id`.
- **FR-036:** The platform MUST verify device existence, tenant ownership, caller permission, non-archived state, connector identity, heartbeat freshness, and capability support.
- **FR-037:** Device registration MUST NOT imply online or healthy state.
- **FR-038:** Device-local consent MUST be enforced according to capability risk.
- **FR-039:** Arbitrary shell execution MUST NOT be exposed to tenant users; commands MUST be allowlisted and schema-validated.
- **FR-040:** File operations MUST enforce canonical path roots, prevent traversal and symlink escape, and separate read from write authorization.
- **FR-041:** Local approval tokens MUST be subject/device/capability/target-bound and time-limited.

### High-risk integrations

- **FR-042:** Cloudflare mutations MUST enforce tenant-to-zone ownership, record restrictions, preview, approval policy, and readback.
- **FR-043:** n8n operations MUST bind to the correct managed, dedicated, or device-local instance and separate read/run/activate permissions.
- **FR-044:** High-risk mutations MUST record before/after metadata and rollback information where supported.

### Status and observability

- **FR-045:** Activation response MUST separately report workspace, device registration, reachability, connector health, credential readiness, and execution readiness.
- **FR-046:** `healthy` MUST require a current live-health signal or policy-defined fresh heartbeat.
- **FR-047:** Every preview and execution MUST emit a structured decision trace.
- **FR-048:** Decision traces MUST contain request, principal, tenant, capability, selector, surface, policy version, registry version, gate results, final decision, execution status, and readback status.
- **FR-049:** Tenant responses MUST avoid sensitive administrative and cross-tenant detail.
- **FR-050:** Audit records MUST be immutable or tamper-evident according to platform standards.

## Non-functional requirements

- **NFR-001 Security:** All newly introduced decision paths are fail closed.
- **NFR-002 Compatibility:** Existing valid clients using one selector continue to work or receive a documented migration path.
- **NFR-003 Performance:** Preview authorization adds no more than the approved latency budget; exact budget to be measured and ratified before release.
- **NFR-004 Reliability:** Decision results are deterministic for the same authenticated context, registry version, policy version, resource state, and request.
- **NFR-005 Observability:** 100% of dispatch attempts have a decision trace.
- **NFR-006 Privacy:** No secrets, tokens, raw credentials, or sensitive local data are emitted to user-visible traces.
- **NFR-007 Architecture:** API, application, domain, and infrastructure boundaries remain intact.
- **NFR-008 Contract:** Public and governed APIs use OpenAPI 3.1 and stable structured errors.
- **NFR-009 Testability:** Every requirement maps to at least one automated or governed acceptance test.
- **NFR-010 Rollback:** P0 changes have independent feature flags or kill switches.

## Success criteria

- **SC-001:** Zero selector-parity mismatches across the registered dual-surface capability inventory.
- **SC-002:** Zero tenant principals receive `dispatch_ready` for platform-admin-only capabilities.
- **SC-003:** 100% of ambiguous selector requests are rejected.
- **SC-004:** 100% of allowed decisions have no required gate in `not_evaluated`.
- **SC-005:** 100% of state-changing dispatches have an explicit mutation-policy outcome.
- **SC-006:** Zero provider executions use credentials outside a usable validated state.
- **SC-007:** Zero device-scoped dispatches occur without successful device ownership and reachability checks.
- **SC-008:** 100% of security decisions produce a structured, secret-free trace.
- **SC-009:** Activation reports no registered-only device as healthy.
- **SC-010:** All P0 acceptance cases pass in staging and production shadow/preview evaluation before enforcement rollout.

## Assumptions

- Authenticated principal and tenant context are already available to the governed runtime.
- Registry-backed action and tool aliases can be mapped to canonical capability records.
- Device registry contains or can store ownership, status, connector identity, and heartbeat metadata.
- Approval and audit services can be extended without exposing secrets.
- Exact repository language/framework and database migration mechanism will be confirmed during implementation setup.

## Dependencies

- capability/action/tool registry
- tenant membership and role authority
- connected-system registry
- credential binding registry
- local device registry and connector heartbeat
- approval service
- execution log / audit store
- OpenAPI generation pipeline
- staging and production feature-flag support

## Out of scope risks to track separately

- Compromise of an already authorized platform-admin credential.
- Endpoint security of the local operating system outside connector controls.
- Provider-specific vulnerabilities after a correctly authorized dispatch.
- Full redesign of tenant role management.
