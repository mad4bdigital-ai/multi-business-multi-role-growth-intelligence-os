# Canonical Validation Checklist
**Purpose:** Validate that runtime, documentation, and governed surfaces remain aligned with canonical authority.

## 1. Authority order validation

- [ ] `system_bootstrap.md` is treated as primary orchestration authority
- [ ] `memory_schema.json` is treated as the persistent state contract (root; domain sub-schemas in `schemas/`)
- [ ] `direct_instructions_registry_patch.md` is treated as hard enforcement authority
- [ ] `module_loader.md` is treated as execution-readiness/loading authority
- [ ] `prompt_router.md` is treated as routing authority
- [ ] Root canonical markdown files are treated as lightweight generated indexes, with source edits made under `canonicals/`
- [ ] `node build-canonicals.mjs --check` passes before canonical changes are considered complete
- [ ] `README.md` does not contradict canonical behavior

## 2. Execution chain validation

- [ ] Runtime architecture still reflects the intended chain:
  `prompt_router -> module_loader -> system_bootstrap -> runtime execution -> governed logging/writeback -> memory persistence`
- [ ] No runtime path claims success without validation evidence when canonicals require evidence
- [ ] Degraded, blocked, pending, and validating states are not collapsed into success wording
- [ ] Runtime does not bypass governed logging/writeback when execution requires it

## 3. Registry authority validation

- [ ] Runtime prefers live registry truth over stale local assumptions
- [ ] Registry-backed routing/workflow state remains authoritative
- [ ] Actions and endpoint resolution remain registry-backed
- [ ] Execution-policy enforcement remains registry-backed
- [ ] Registry Surfaces Catalog metadata is still compatible with sink validation behavior
- [ ] Validation & Repair Registry assumptions remain consistent with candidate and promotion rules

## 4. Governed sink validation

- [ ] `Execution Log Unified` remains an authoritative sink
- [ ] `JSON Asset Registry` remains an authoritative sink for allowed asset classes
- [ ] Sink write contracts are enforced through shared logic
- [ ] Sink-specific exemptions are explicit rather than implicit
- [ ] Formula-managed and protected column behavior is validated before writes
- [ ] Live header reads occur before governed writes where required

## 5. Mutation governance validation

- [ ] Duplicate handling semantics are explicit and centralized
- [ ] Mutation classes are normalized rather than inferred ad hoc
- [ ] Append/update/rename/merge behavior is consistently classified
- [ ] Sink exemptions are not mixed into unrelated general mutation rules
- [ ] Postwrite validation or readback remains present where canonicals require it

## 6. Runtime boundary validation

- [ ] `server.js` does not absorb new authority domains that belong in dedicated modules
- [ ] Connector public entrypoints are explicit
- [ ] Internal helpers remain private unless a real cross-module caller exists
- [ ] Modules are grouped by authority boundary, not by incidental utility clustering
- [ ] Cross-cutting concerns are not duplicated in multiple runtime paths

## 7. Documentation alignment validation

- [ ] Root `README.md` describes the governed architecture accurately
- [ ] `runtime_boundary_map.md` matches the actual code layout
- [ ] `governed_mutation_playbook.md` matches runtime mutation behavior
- [ ] Agent-facing guidance remains aligned with canonicals
- [ ] New documentation follows canonicals rather than inventing new policy semantics
- [ ] `schemas/` sub-schema files match the `$defs` declared in `memory_schema.json` (no orphaned or missing `$ref`)

## 8. Testing and drift detection validation

- [ ] Integration coverage exists for governed preflight behavior that is considered critical
- [ ] Connector contract expectations are testable (github.js, hostinger.js covered in `test-connectors.mjs`)
- [ ] Execution routing guard chain is covered in `test-execution-routing.mjs` (10 tests including `sameServiceNativeTarget` and transport rejection paths)
- [ ] Job runner enqueue/failure paths are covered in `test-job-runner.mjs`
- [ ] Canonical/runtime drift checks are possible and documented
- [ ] File-level validation and runtime-level validation are explicitly distinguished
- [ ] Architecture drift is detected in CI: canonical generated-output check, inline redefinition check (6 modules), line count guard, export floor
- [ ] 168 automated tests across 6 suites pass before any deployment is considered ready

## 9. Upgrade readiness gates

- [ ] Phase 0 baseline inventory exists and is current
- [ ] Phase 1 documentation alignment is complete
- [ ] Normalization-layer contracts are defined before deeper runtime decomposition
- [ ] Missing authoritative upgrade artifacts are explicitly tracked rather than ignored

## 10. Current missing-input check

As of 2026-04-20, no unresolved missing upgrade artifacts. Previously flagged items:

- `project_upgrade_programmatic_validation_matrix.md` — superseded by `validate-architecture.mjs` (104 checks in CI)
- `project_upgrade_execution_board_9_5_plus.md` — all 9 phases complete; ongoing work tracked via git commit history and deployment parity checklist
