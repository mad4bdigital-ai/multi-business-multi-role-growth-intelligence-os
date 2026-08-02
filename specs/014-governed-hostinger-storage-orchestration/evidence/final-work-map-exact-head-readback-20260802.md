# Final Work Map Exact-head Readback — 2 August 2026

## Purpose

Close T006 with executable, fail-closed evidence after repeated `main` reconciliation changed the generated Work Map registry sources and schema-classification registry.

## Initial diagnostic

The first structured guard run evaluated the pre-refresh candidate without mutating the repository.

- Run: `30756331623`
- Candidate head: `296aecb7cc98959c6c3e57268994c3ac5a2d3512`
- Artifact: `spec014-final-work-map-readback-30756331623`
- Artifact digest: `sha256:6af90dc334c1e35611388d7b00eddfadfac6bfc3b092b9afbc04eb0248deb467`
- Outcome: failed closed
- Findings: three stale registry-binding fields only

The diagnostic proved:

- Work Maps: `19`
- Schema domains: `16`
- Schema-classification coverage: `100%`
- Unresolved schema objects: `0`
- Taxonomy-gap clusters: `0`
- Intentionally unclassified objects: `0`
- Schema classification findings: `0`

## Exact refreshed binding

The deterministic producer refreshed only the bounded Spec 014 registry binding and T006 task state.

- Previous registry fingerprint: `b6f6ef53c0ddf181ef0c070e5b48905a618b28748c36f803146901d23ddbe36a`
- Current registry fingerprint: `383c65f8f709088a1b6422f8b21d144b198e0581e52c6449bc0053065a24eaac`
- Previous index source hash: `b875f59334d878209754ce9dc95b3f319982bd2af83076dd34c0c1fd0e174a47`
- Current index source hash: `752bc2ef9ed7417689f1644ab9b492009fa4611a2c91e4bf0d2ddf0326d25073`
- Previous coverage source hash: `f5b3be7e6549d47fec89925fff685cf8bfcf7683573090e8b62a2b6f05eac831`
- Current coverage source hash: `0cdfc494f247174aa8badfb019a7ce3aec1df42173f69b0f870ea9d55012159f`
- Current schema-classification registry hash: `b2148d9aefd64c764d1505464fc05b66f5e8248d32b29d1e3885b6522b869ebb`

The one-shot launcher verified its exact parent and one-file launch write set, ran the producer and readback, removed itself, and pushed the deterministic refresh commit. The launcher is not part of the final PR diff.

## Permanent controls

- Readback: `http-generic-api/scripts/spec014-final-work-map-readback.mjs`
- Deterministic producer: `http-generic-api/scripts/spec014-refresh-final-work-map-binding.mjs`
- Guard: `.github/workflows/hostinger-storage-final-work-map-readback-guard.yml`
- Manifest: `specs/014-governed-hostinger-storage-orchestration/work-map-integration.json`

The guard emits JSON and Markdown artifacts before enforcing its decision. Any future drift in map/domain sets, source hashes, classification coverage, fingerprint, readiness, or unresolved dimensions fails closed.

## Safety boundary

No Hostinger or SSH access, credential read, live database access, migration authorization, dry-run, Apply, provider dispatch, runtime mount, deployment, `main` mutation, Production promotion, or Production mutation occurred.

`repository_mutation_scope=candidate_branch_only`
`migration_apply=false`
`provider_dispatch=false`
`secrets_included=false`
