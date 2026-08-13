# Traceability — Spec 019

| Requirement | Design artifact | Planned implementation |
|---|---|---|
| Pressure observation | `spec.md` G1; `data-model.md` | PR-B |
| Domain classification | `spec.md` G2; `operation-paths.md` | PR-B |
| Immutable plan | `contracts/lifecycle-plan.schema.json` | PR-B |
| Exact authority | `contracts/authority-binding.schema.json` | PR-C |
| Typed approval | `contracts/approval-binding.schema.json` | PR-C |
| Durable receipt | `contracts/mutation-receipt.schema.json` | PR-C/D |
| Response chunk pilot | `operation-paths.md` | PR-D |
| Repo audit supersession | `operation-paths.md` | PR-E |
| Engine runs plan-only | `spec.md` domain policy | PR-B/H |
| Logical versus physical reclaim | `data-model.md` and contracts | PR-B/I |
| Error taxonomy | `contracts/error-catalog.json` | PR-B onward |
| Readback and observability | `testing-strategy.md`, `spec.md` | PR-D/F |
| No arbitrary SQL | `threat-model.md`, security checklist | All PRs |
