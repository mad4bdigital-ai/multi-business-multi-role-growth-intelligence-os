# Growth Intelligence Platform Spec Kit Constitution

**Version**: 1.0.0  
**Ratified**: 2026-07-22  
**Applies to**: Active specifications under `specs/`, their implementation plans, tasks, contracts, migrations, runtime changes, and completion evidence.

## Purpose

The platform adopts specification-driven development for governed brownfield delivery. Specifications are the source of product and operational intent. Runtime code, schemas, migrations, policies, tests, deployment evidence, and documentation must trace back to approved specification requirements.

Spec Kit does not create execution authority. All repository, database, provider, deployment, permission, credential, billing, external-send, or destructive mutations remain subject to the platform's existing capability, approval, resource-authority, typed-confirmation, audit, and readback contracts.

## Principle I — Registry and SQL authority

- SQL is the runtime authority; Sheets remain asynchronous mirror and recovery only.
- Specifications may describe target behavior but must not be treated as live registry authority.
- Runtime actions, endpoints, policies, workflows, capabilities, resources, and credentials must resolve from governed registry/bootstrap authority.
- A specification must identify every authority source it depends on and every authority it does not create.

## Principle II — Specification before implementation

- Every non-trivial behavior change begins with an active feature specification.
- The required sequence is `Specify → Clarify → Plan → Tasks → Implement → Verify → Closeout`.
- Brownfield specifications must distinguish current behavior, verified production evidence, gaps, and proposed behavior.
- Implementation may not silently widen scope beyond the approved specification and plan.
- Production incidents and operational learnings must update the active specification or create a successor specification.

## Principle III — Complete operation paths

Every specification must describe:

1. actors and authenticated principals;
2. entry points and preconditions;
3. normal success path;
4. alternate and degraded paths;
5. authorization, resource, tenant, workspace, and Brand resolution;
6. idempotency, replay, retry, timeout, and unknown-outcome handling;
7. approval and typed-confirmation boundaries;
8. state transitions and terminal states;
9. audit, observability, readback, delivery, and acknowledgement;
10. rollback, recovery, and post-incident reconciliation.

A path is incomplete when it ends at transport success without authoritative readback or when it reports success from narrative rather than evidence.

## Principle IV — Security, tenant isolation, and no secrets

- Authentication and authorization are separate gates.
- Tenant and user identity derive from signed principal context and active membership; caller overrides are forbidden.
- Protected-resource, audience, issuer, purpose, scope, resource authority, and object-level authorization must be explicit.
- Default access is deny.
- Tokens, authorization codes, passwords, credential payloads, provider headers, raw secrets, and unbounded logs must never appear in specifications, tests, fixtures, GPT-visible responses, or completion evidence.
- Security-sensitive specifications require replay, confused-deputy, cross-tenant, privilege-expansion, and wrong-resource scenarios.

## Principle V — Contract-first public surfaces

- Public HTTP contracts use OpenAPI 3.1.
- Structured data contracts use JSON Schema 2020-12 unless an existing repository convention requires another version.
- Every public operation defines operation ID, authentication, authorization, parameters, responses, stable errors, examples, rate/retry behavior where applicable, and no-secret guarantees.
- Generated OpenAPI and canonical files must be updated through their source generators; generated roots are never edited directly.
- Contract changes must identify compatibility, deprecation, migration, and consumer-readiness impact.

## Principle VI — Durable and replay-safe execution

- Unsafe retryable mutations require durable operation identity and idempotency scope.
- Authorization codes, approvals, envelopes, and mutation receipts are one-time or lifecycle-governed.
- Transport failure after dispatch is an unknown outcome until reconciled.
- A mutation may not be replayed until same-cycle readback proves absence or deterministic idempotency.
- Recovered success must cite evidence from the same operation fingerprint.

## Principle VII — Evidence and truthful lifecycle states

Specifications must keep these states distinct where applicable:

- validation state;
- evidence state;
- execution state;
- delivery state;
- consumer acknowledgement state;
- rollback or compensation state.

`prepared`, `executed`, `delivered`, `acknowledged`, and `verified` are not interchangeable. Completion requires declared readback from authoritative sources.

## Principle VIII — Brownfield compatibility and minimal safe change

- Existing public interfaces remain stable unless a breaking change is explicitly approved.
- Specifications must identify current consumers, legacy compatibility windows, feature flags, and cutoff dates.
- Changes should be additive and reversible first.
- Shared authentication, session, routing, and registry code are high-risk hotspots and require focused changes, isolated tests, and explicit rollback plans.
- New dependencies or parallel sources of truth require documented justification.

## Principle IX — Testing and fault injection

Every implementation plan must cover:

- unit tests for deterministic policy and state logic;
- integration tests across boundaries;
- contract and OpenAPI parity tests;
- invalid input and authorization tests;
- cross-tenant and wrong-resource tests;
- replay and idempotency tests;
- timeout, transient transport, and unknown-outcome tests;
- deployment parity and production smoke tests;
- rollback or disable-path validation.

Security and lifecycle behavior must be tested from observable contracts rather than only by source-string assertions.

## Principle X — Governed delivery and closeout

- Feature work occurs on a dedicated branch named after the specification.
- Pull requests must pin head/base SHA, pass required CI, and include risks, tests, API/database impact, rollout, and rollback notes.
- Protected branches are never force-pushed.
- Merge approval is invalidated by head or base drift.
- Production deploy follows the governed GitHub `main` to Hostinger auto-deploy path unless break-glass authority is separately approved.
- Completion evidence must confirm merge, production parity, health, migrations if any, runtime smoke, unresolved gaps, and documentation alignment.
- Historical specifications move to `docs/history/<topic>/`; active governed delivery remains under `specs/<feature>/`.

## Required Spec Kit artifacts

An active feature specification must include, as applicable:

- `manifest.json`
- `spec.md`
- `research.md`
- `concerns.md`
- `operation-paths.md`
- `plan.md`
- `data-model.md`
- `contracts/`
- `quickstart.md`
- `tasks.md`
- `checklists/requirements.md`
- `checklists/security.md` for sensitive surfaces
- `checklists/operations.md` for runtime or deployment surfaces
- `completion.json`

Omitted artifacts require an explicit rationale in the manifest.

## Constitution gates

Before planning:

- current production behavior and authority sources are identified;
- scope and non-goals are explicit;
- unresolved ambiguity is recorded.

Before implementation:

- requirements are testable;
- operation paths and concerns are complete;
- contracts and data/state models are drafted;
- migration, rollout, and rollback posture is known.

Before merge:

- implementation traces to tasks and requirements;
- tests and contract parity pass;
- security and operational checklists pass;
- current head/base freshness is confirmed.

Before closeout:

- production parity and health are verified;
- same-cycle runtime smoke passes;
- completion evidence is valid and no-secret;
- unresolved work is explicitly classified and assigned.

## Amendment policy

- Constitutional changes require a dedicated reviewed PR.
- A breaking governance change increments the major version.
- A new mandatory principle or gate increments the minor version.
- Clarifications and wording corrections increment the patch version.
- Amendments must update templates and active specifications affected by the change.

## Governance precedence

Platform safety/runtime policy, top-level platform instructions, `AI_Agent_Knowledge_Guide.md`, and canonical source files retain higher authority. This constitution governs the specification lifecycle and cannot override runtime safety or authorization policy.
