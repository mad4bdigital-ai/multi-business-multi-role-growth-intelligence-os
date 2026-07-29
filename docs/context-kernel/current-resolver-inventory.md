# Current Context Resolver Inventory

Status: Phase 1 baseline inventory  
Behavioral impact: none  
Scanner enforcement: report-only

## Objective

Document the existing context and connection resolution surfaces before introducing the shared Admin and Tenant context kernel. This inventory records observed source behavior and identifies questions that must be resolved before production routing changes.

## Reviewed surfaces

| Surface | Source | Observed behavior | Phase 1 classification | Follow-up |
|---|---|---|---|---|
| Brand and workspace context | `http-generic-api/brandWorkspaceContextResolver.js` | Builds an authorized catalog, supports explicit tenant scope, and can return ambiguity rather than silently choosing a brand. Admin callers may operate with a wider catalog when tenant scope is absent. | Retain as a reference pattern; verify the no-tenant Admin behavior against the effective-subject requirement. | Add shared candidate/result types and isolation tests in Phase 2. |
| Application connection resolution | `http-generic-api/appConnectionResolver.js` | Resolves connection candidates through registry queries. The source contains first-row access, single-row query caps, empty-result fallbacks after query failures, and permissive default handling. | High-priority baseline findings; no behavior changed in Phase 1. | Prove uniqueness, preserve dependency failures, and replace permissive defaults before governed writes. |
| Activation session lifecycle | `http-generic-api/activationSessionLifecycleService.js` | Creates or reuses session context and includes an all-zero tenant sentinel when tenant evidence is absent. | High-priority missing-scope finding. | Replace the sentinel with an explicit unscoped or blocked state and add compatibility tests. |
| Dynamic audit runtime scope | `http-generic-api/dynamicAuditRuntime.js` | Defines a default scope object containing customer-scoping fields. | High-priority fixed-scope finding. | Resolve audit scope from the execution context and prevent customer identifiers in shared defaults. |
| Connector execution selection | `http-generic-api/connectorExecutor.js` | Uses exact and fuzzy connected-system lookup paths with single-row query caps. | Requires uniqueness and ambiguity evidence. | Bind to an exact governed connection before execution. |
| User JWT governance | `.github/workflows/ci.yml` and `http-generic-api/scripts/user-jwt-auth-governance.mjs` | CI already enforces centralized fail-closed user authentication. | Existing guardrail to preserve. | Integrate effective-subject and tenant-scope checks without duplicating authentication logic. |
| Spec Kit completion | `http-generic-api/scripts/spec-kit-completion-gate.mjs` | Enforces plan, checklist, and completion evidence for changed specification kits. | Existing governance dependency. | Keep implementation evidence separate from specification evidence. |

## Scanner categories

The Phase 1 scanner reports, but does not block on:

- fixed customer-scoping UUID literals;
- all-zero scope sentinels;
- direct first-candidate selection;
- context-sensitive queries capped to one row without scanner-visible uniqueness;
- resolver failures converted to empty or null results;
- permissive authority defaults;
- static default scope objects.

Every finding is classified as `runtime`, `test`, `migration`, or `documentation`. Runtime findings receive warning annotations; non-runtime findings receive notice annotations.

## Suppression policy

A suppression is allowed only next to the relevant source line and must include a durable reason:

```text
context-kernel-scan: allow <rule-id> -- <reason of at least twelve characters>
```

Suppressions do not change runtime behavior. They must be reviewed before the scanner becomes blocking.

## Phase 1 exit criteria

1. The scanner and its tests run in CI.
2. The baseline report is uploaded as a CI artifact.
3. Every runtime finding is assigned to `retain`, `replace`, `prove-safe`, or `remove`.
4. No production resolver behavior changes in this phase.
5. The next implementation phase starts from the reviewed baseline rather than an assumed architecture.
