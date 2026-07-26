# Terminology Review — Adaptive Authorization and Execution Governance

**Feature:** `006-adaptive-authorization-execution-governance`  
**Review date:** 2026-06-29  
**Review type:** governed administrative review against security, runtime, tenant, and platform authority surfaces  
**Outcome:** accepted for pre-PR2 readiness

## Review basis

The terminology was checked against the feature specification, threat model, runtime contract, tenancy and resource-grant authorities, generated policy/authority maps, the SQL-primary data model, and the live capability readiness report.

This review closes terminology ambiguity for design and planning. It does not replace focused code-owner review on later implementation PRs.

## Accepted vocabulary

| Term | Accepted meaning | Must not be conflated with |
|---|---|---|
| Canonical capability | Immutable provider-independent operation identity with a version | route, endpoint, tool, skill, UI tab, provider action |
| Alias | A discoverability or compatibility key that resolves to a canonical capability | grant or execution authority |
| Binding | A registry relationship between a capability and source, adapter, resource, or runtime | authorization decision |
| Availability | Whether a capability or adapter is present and eligible for consideration | grant, authorization, approval |
| Grant | Durable or bounded permission assigned to a subject and scope | approval for one request |
| Authorization | A current subject-action-resource-context decision | discovery, availability, grant existence |
| Approval | A scoped decision required by policy for a specific request, session, resource, or bounded automatic window | authorization or active grant state |
| Execution envelope | Short-lived no-secret evidence binding a decision, request hash, adapter, revisions, approval, expiry, and idempotency | reusable credential or standing grant |
| Adapter | Certified implementation capable of performing a canonical capability | canonical capability identity |
| Readback | Post-attempt evidence that distinguishes acknowledgement, observation, verification, mismatch, incompleteness, and compensation | provider acknowledgement alone |
| Reconciliation | Bounded detection and repair planning for authority or evidence drift | silent recovery or automatic permission grant |
| Revision vector | Traceable versions or epochs for every authority used by a decision | one global mutable timestamp |
| Shadow mode | Adaptive decision and evidence generation without changing enforcement or calling mutating providers | canary or active enforcement |
| Canary mode | Explicit bounded cohort enforcement with rollback and evidence thresholds | global cutover |
| Projection | Read model derived from canonical authorities | writable authority source |

## Owner-surface review

| Owner surface | Evidence reviewed | Result |
|---|---|---|
| Security | fail-closed requirements, threat model, approval binding, replay prevention, redaction rules | accepted |
| Runtime | state separation, envelope lifecycle, adapter selection, readback and reconciliation semantics | accepted |
| Tenant | authenticated tenant/workspace identity, membership, role and resource-grant scope | accepted |
| Platform | semantic capability registry, source resolution, provider bindings, certifications and evidence ledgers | accepted |

## Required semantic separations

1. `grant_state=active` remains active when runtime approval is required.
2. Aliases and UI exposure never grant execution authority.
3. An eligible adapter does not imply authorization.
4. Authorization does not imply approval is unnecessary.
5. Provider acknowledgement is not effect verification.
6. Recovered status requires same-cycle evidence.
7. Tenant, workspace, brand and resource scope come from authenticated authority, not caller overrides.
8. A stale authority revision invalidates the approval or execution envelope that depended on it.

## Naming decisions

- Use `canonical capability`, not `action`, as the public authorization identity.
- Use `source link` and `source resolution` for mappings from routes, tools, skills and endpoints.
- Use `provider binding` or `resource adapter binding` for implementation selection.
- Use `approval hold` for the mutable request lifecycle and `approval decision event` for append-only decisions.
- Use `authorization decision` for the typed subject-action-resource-context result.
- Use `execution evidence` for bounded no-secret post-attempt records.
- Use `reconciliation checkpoint` only for controller cursor and lease state, not for business authority.

## Review closure

T005 is complete as a governed administrative terminology review. Later implementation PRs remain required to obtain focused security, runtime and tenant code review for their concrete changes. No runtime behavior, migration, provider call or enforcement state was changed by this review.
