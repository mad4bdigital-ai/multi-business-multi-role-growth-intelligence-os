# Spec Kit Work Map Integration Governance

## Purpose

Every new Spec Kit must evaluate the complete generated platform Work Map registry before implementation. The gate prevents directional specifications from integrating only the surfaces that the author remembered while omitting data, authority, connectors, workflows, observability, delivery, lifecycle, or other platform dimensions.

## Authoritative sources

The automation consumes existing generated sources:

- `docs/work-maps/README.md`
- `docs/work-maps/work-map-coverage-matrix.md`
- every Work Map listed by the index
- `.specify/work-map-schema-classification-registry.json`

The Work Maps remain generator-owned. A Spec Kit never edits generated map files to satisfy the gate.

## Governing flow

```text
Repository sources
→ generated Work Maps
→ coverage matrix
→ schema classification registry
→ effective Work Map registry
→ Spec Kit scaffold
→ explicit map/domain decisions
→ cross-map dependency review
→ dimension discovery
→ implementation readiness
→ CI gate
```

## New Spec Kit workflow

Create the normal Spec Kit files, then run:

```text
node http-generic-api/scripts/spec-kit-work-map-governance-gate.mjs \
  --scaffold NNN-feature-name \
  --owner platform-team
```

The generated `work-map-integration.json` contains one decision for every current Work Map and schema domain. The author must resolve every row and bind relevant dimensions to requirements, tasks, acceptance tests, and evidence.

## Decision states

- `integrate`: the feature adds a direct integration point with the dimension.
- `reuse`: existing platform behavior is sufficient and will be consumed unchanged.
- `extend`: an existing map, registry, contract, or runtime surface needs bounded extension.
- `not_applicable`: evidence proves the dimension does not apply.
- `deferred_with_risk`: the gap is owned, approved, and bound to a later gate.
- `blocked`: implementation cannot start until named blockers are removed.
- `needs_analysis`: draft-only state; prohibited once implementation begins.

## Existing-map-first rule

The required order is:

```text
reuse existing map
→ extend existing map
→ compose existing maps
→ extend existing generator or taxonomy
→ propose a new map
```

A new map is proposal-only and requires separate approval. The proposing Spec Kit cannot use that proposed map as readiness evidence in the same delivery cycle.

## Schema classification

The generated coverage matrix may expose schema objects that the current generator taxonomy did not classify. Such objects are not silently accepted.

Each object must be resolved by exactly one rule in:

```text
.specify/work-map-schema-classification-registry.json
```

A classification rule must provide:

- one domain;
- existing Work Map references;
- a bounded matcher;
- architectural rationale.

Unknown or ambiguously matched objects fail CI.

## Intentional unclassified exceptions

An object may remain intentionally unclassified only when the registry contains an exact exception with:

- object name and type;
- owner;
- rationale;
- nearest existing maps reviewed;
- review gate;
- expiry date no more than 90 days away.

Expired, stale, unowned, map-less, inferred, or overlapping exceptions fail closed.

## Staleness

The manifest binds:

- Work Map index source hash;
- coverage matrix source hash;
- effective registry fingerprint;
- map and domain counts;
- classification registry hash;
- remaining unresolved classification count.

When maps, migrations, schema taxonomy, or classification rules change, affected manifests become stale and must be regenerated or reviewed.

## CI commands

```text
node http-generic-api/scripts/work-map-schema-classification.mjs --ci
node http-generic-api/scripts/spec-kit-work-map-governance-gate.mjs --ci --changed
node http-generic-api/test-work-map-schema-classification.mjs
```

The dedicated workflow is:

```text
.github/workflows/spec-kit-work-map-integration.yml
```

## Legacy behavior

Existing Spec Kits without `work-map-integration.json` are grandfathered until they opt in. New Spec Kits are never grandfathered. Once a legacy Spec Kit adds the manifest, future changes remain governed by the new gate.

## Safety boundary

The automation is repository governance only. It does not:

- apply database migrations;
- change provider connections;
- load credentials;
- deploy;
- execute external writes;
- approve runtime authority;
- modify generated Work Maps manually.
