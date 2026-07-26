# Requirements Traceability

| Requirement area | Specification | Detailed design | Verification |
|---|---|---|---|
| Container topology | FR-001–003 | `data-model.md` | Platform seed and tenant non-containment tests |
| Principal and authority | FR-004–005, FR-017 | `authority-and-policy-resolution.md` | Cross-tenant, deny precedence, platform-principal tests |
| Platform asset publication | FR-006–008 | `asset-publication-and-tenancy.md` | Discover/install/override/extend/fork/author tests |
| Settings bounds | FR-008–010 | `settings-resolution.md` | Merge properties, ambiguity, snapshot-hash tests |
| Workflow immutability | FR-018–020 | `data-model.md`, `migration-and-compatibility.md` | Active edit rejection and fork-upgrade tests |
| Runtime adapters | FR-014 | `runtime-and-state-machine.md` | Certification, readiness, and selection tests |
| Idempotency and state | FR-011–013 | `runtime-and-state-machine.md` | Duplicate create/dispatch and concurrent CAS tests |
| Callbacks and external results | FR-015 | `runtime-and-state-machine.md`, `threat-model.md` | Signature, nonce, replay, unknown-outcome tests |
| Mandatory governance | FR-009, FR-016 | `authority-and-policy-resolution.md` | Approval hash and fork escape tests |
| Security | NFR | `threat-model.md` | Security matrix and negative suites |
| Observability and readback | NFR | `observability-and-slos.md` | Evidence completeness and alert tests |
| Migration and rollout | NFR | `migration-and-compatibility.md`, `plan.md` | Shadow parity and rollback rehearsal |
| API contract | NFR | `contracts/workflow-runtime.openapi.yaml` | OpenAPI lint, examples, compatibility checks |

## Required implementation evidence

Each implementation PR should link:

- migration ID;
- unit, integration, and security test IDs;
- OpenAPI operation IDs;
- dashboard and alert IDs;
- pilot run/evidence references;
- rollback rehearsal record.
