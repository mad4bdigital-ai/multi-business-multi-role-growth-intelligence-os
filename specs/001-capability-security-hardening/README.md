# Growth Intelligence Security Hardening — Spec Kit

**Feature branch:** `001-capability-security-hardening`  
**Prepared:** 2026-06-19  
**Status:** Ready for review; implementation must not start until the Constitution Check and P0 containment gates pass.

This package turns the security review findings into a traceable Spec-Driven Development workstream.

## Scope

The feature establishes one canonical security decision path for actions, tools, device operations, credential management, approvals, and dispatch readiness. It addresses:

- action/tool selector privilege escalation
- tenant exposure to admin surfaces
- ambiguous selector handling
- fail-open policy derivation
- credential/authorization conflation
- secure credential-intake isolation
- device identity, ownership, reachability, and local consent
- state-changing operation approvals
- activation/readiness status semantics
- decision-trace auditing and regression testing

## Artifact map

```text
.specify/
└─ memory/
   └─ constitution.md

specs/
└─ 001-capability-security-hardening/
   ├─ spec.md
   ├─ plan.md
   ├─ research.md
   ├─ data-model.md
   ├─ quickstart.md
   ├─ tasks.md
   ├─ traceability.md
   ├─ acceptance-matrix.md
   ├─ rollout.md
   ├─ threat-model.md
   ├─ contracts/
   │  ├─ capability-resolution.openapi.yaml
   │  └─ error-catalog.md
   └─ checklists/
      ├─ requirements.md
      ├─ security.md
      └─ release-readiness.md
```

## Recommended execution order

1. Approve the constitution and scope.
2. Apply P0 containment switches.
3. Implement canonical capability resolution and fail-closed policy evaluation.
4. Isolate tenant/admin surfaces and secure credential intake.
5. Implement device-trust and approval enforcement.
6. Replace readiness semantics and add structured decision traces.
7. Execute the full acceptance matrix in preview mode.
8. Enable controlled mutation tests in staging.
9. Complete release-readiness and production rollout gates.

## Non-negotiable rule

`dispatch_ready` MUST NOT be returned unless every required authorization, ownership, skill, credential, device, smoke, approval, and local-consent gate has passed for the same canonical capability, subject, tenant, target resource, policy version, and request.
