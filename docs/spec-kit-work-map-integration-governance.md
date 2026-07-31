# Spec Kit Work Map Integration Governance

## Purpose

Every new Spec Kit must evaluate the complete generated platform Work Map registry before implementation. The gate prevents directional specifications from integrating only the surfaces that the author remembered while omitting data, authority, connectors, workflows, observability, delivery, lifecycle, or other platform dimensions.

## Authoritative sources

The automation consumes existing generated sources:

- `docs/work-maps/README.md`
- `docs/work-maps/work-map-coverage-matrix.md`
- every Work Map listed by the index
- `http-generic-api/scripts/platform-work-map-schema-intelligence.mjs`
- `.specify/work-map-intentional-unclassified.json`

The Work Maps remain generator-owned. A Spec Kit never edits generated map files to satisfy the gate.

## Governing flow

```text
Repository sources
→ generated Work Maps
→ canonical generator classification
→ unresolved/intentional classification gate
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

The canonical schema-intelligence generator classifies every discovered table and view into an existing platform domain. Its rules were extended to cover the previously uncategorized Dynamic Container, Context Kernel connection ownership, canonical identifier, Growth Dashboard, operation artifact, operational alert, platform outbox, secret movement, repository automation, SQL cache policy, and governed projection surfaces.

The classification gate regenerates the schema-intelligence maps in memory and requires:

```text
accounted objects = discovered objects
unresolved objects = 0
```

A newly introduced object that does not match an existing domain is emitted as `Other / unresolved` and fails CI. Classification changes are made in the existing generator and existing Work Map patterns; they do not create a new map automatically.

## Intentional unclassified exceptions

An object may remain intentionally unclassified only through an exact entry in:

```text
.specify/work-map-intentional-unclassified.json
```

The entry requires:

- object name and type;
- owner;
- detailed rationale;
- at least two nearest existing maps reviewed;
- proof that reuse, extension, map composition, and generator/taxonomy extension were considered;
- approval reference;
- follow-up gate;
- expiring timestamp.

Permanent, expired, stale, unowned, map-less, inferred, or incomplete exceptions fail closed. The current registry contains no exceptions.

## Staleness

The Spec Kit manifest binds:

- Work Map index source hash;
- coverage matrix source hash;
- Work Map registry fingerprint;
- map and domain counts;
- remaining taxonomy-gap clusters.

The classification gate independently binds the live generator output to migrations and the intentional-exception registry. When maps, migrations, schema taxonomy, or classification rules change, CI regenerates the live classification report and rejects unresolved drift.

## CI commands

```text
node http-generic-api/scripts/work-map-classification-gate.mjs --ci
node http-generic-api/scripts/spec-kit-work-map-governance-gate.mjs --ci --changed
node http-generic-api/test-work-map-classification-gate.mjs
node http-generic-api/test-spec-kit-work-map-governance-gate.mjs
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
