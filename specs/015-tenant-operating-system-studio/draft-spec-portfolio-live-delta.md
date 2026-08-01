# Open Draft Portfolio — Live Delta

## Why this file exists

The base registry `draft-spec-portfolio.json` is an exact observed snapshot. New Draft PRs may appear while its exact-head CI is running. This append-only delta records those arrivals without silently rewriting the original scan boundary.

## Delta snapshot

```text
base_observed_at: 2026-08-01T15:48:00Z
delta_observed_at: 2026-08-01T15:57:00Z
base primary Specs: 12
base related Drafts: 22
new related Drafts: 1
current related Drafts: 23
current total classified Drafts: 35
```

## PR #4464 — Hostinger Control Plane repository provenance

Classification:

```text
parent feature: 014-governed-hostinger-storage-orchestration
parent PR: #4386
role: workstream correction
base: current Hostinger Integration branch
head: 78c127f25a647a87e89c65f0b8e3cbf5d30d4653
state: open Draft
mergeable: true
```

Purpose:

- preserve the integrated Control Plane repository as an internal Base module;
- brand the official in-memory persistence adapter with module-private provenance;
- brand governed repositories only through the official factory;
- reject copied, forged, or method-shape-compatible repositories;
- enforce Base-import governance across JavaScript, CommonJS, and TypeScript source sets;
- keep the correction isolated from the already integrated durable-control-plane workstream.

Changed paths:

- `.github/workflows/hostinger-storage-control-plane-guard.yml`
- `http-generic-api/hostingerStorageControlPlaneRepository.js`
- `http-generic-api/hostingerStorageControlPlaneRepositoryBase.js`
- `http-generic-api/test-hostinger-storage-control-plane-repository-brand.mjs`
- `specs/014-governed-hostinger-storage-orchestration/e2e-phases.json`

Recommended disposition:

```text
Validate exact factory/persistence provenance and forged-repository rejection.
Keep the work non-production and in-memory.
Integrate only into PR #4386 after exact-head CI and E2E evidence.
Do not treat it as a new Spec or independent authority.
```

## Updated Hostinger train

The Hostinger parallel workstream set now includes:

```text
#4390 contracts — integrated
#4458 synthetic adapter provenance — integrated
#4459 synthetic adapter correction — integrated
#4455 Tenant Canary hardening — open at base snapshot
#4464 Control Plane repository provenance — newly open
```

The Integration branch remains the sole rollup. No child workstream independently authorizes provider dispatch, SSH, network activity, credentials, migration, deployment, or Production mutation.
