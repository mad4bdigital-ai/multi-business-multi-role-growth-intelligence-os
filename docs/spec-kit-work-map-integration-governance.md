# Spec Kit Work Map Integration Governance

## Purpose

Every new Spec Kit must evaluate the complete generated platform Work Map registry before implementation. The gate prevents directional specifications from integrating only the surfaces the author remembered while omitting data, authority, connectors, workflows, observability, delivery, lifecycle, or other platform dimensions.

## Authoritative sources

The automation consumes and extends the existing generated sources:

- `docs/work-maps/README.md`
- `docs/work-maps/work-map-coverage-matrix.md`
- every Work Map listed by the index
- `http-generic-api/scripts/platform-work-map-generator.mjs`
- `http-generic-api/scripts/platform-work-map-schema-intelligence.mjs`
- `.specify/work-map-schema-classification-registry.json`
- `.specify/spec-kit-work-map-integration-policy.json`

The Work Maps remain generator-owned. A Spec Kit never edits generated map files to satisfy the gate.

## Governing flow

```text
Repository sources
→ existing Work Map generator
→ canonical schema classification registry
→ complete existing-map coverage
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

```bash
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

## Complete schema classification

Every discovered table and view must resolve to one of two states:

```text
classified into an existing domain and Work Map set
or
intentionally unclassified through an approved bounded exception
```

Accidental or unresolved classification is forbidden.

The canonical registry is:

```text
.specify/work-map-schema-classification-registry.json
```

A normal classification rule contains:

- a stable rule key;
- deterministic exact, prefix, or suffix matchers;
- one existing platform domain;
- references to one or more existing Work Maps;
- a rationale.

Overlapping matching rules are ambiguous and fail closed. The generator uses `existing_map_refs` to extend current maps and the coverage matrix rather than creating new maps.

The current rules classify the previously uncategorized Dynamic Container, Context Kernel connection ownership, canonical identifier, Growth Dashboard, operation artifact, operational alert, platform outbox, secret movement, repository automation, SQL cache policy, and governed projection surfaces.

## Intentional unclassified exceptions

An object may remain intentionally unclassified only through an exact entry in the canonical classification registry.

The entry requires:

- object name and type;
- owner;
- detailed rationale;
- at least two nearest existing maps reviewed;
- review gate;
- expiry date no more than 90 days away.

Permanent, expired, stale, unowned, map-less, inferred, or incomplete exceptions fail closed. The expected steady state is:

```json
{
  "intentional_unclassified": []
}
```

## Staleness

The Spec Kit manifest binds:

- Work Map index source hash;
- coverage matrix source hash;
- Work Map registry fingerprint;
- classification registry hash;
- map and domain counts;
- unresolved and intentional exception counts.

When maps, migrations, schema taxonomy, classification rules, or exception records change, generated documentation and Spec Kit manifests become stale and must be regenerated or reviewed again.

## Generated-map synchronization

The required validation workflow is read-only. It checks an immutable pull-request head SHA and never commits, pushes, or runs the generator in write mode.

Generated changes may be published only by a producer registered in `.specify/pipeline-connectivity-contract.json`. The normal pull-request path is preview-only. An explicit `docs-agent-write` or `docs-agent-automerge` label authorizes Docs Agent to publish a real generated diff. The separate Work Map Autofix workflow requires a non-main branch and its exact expected head SHA.

```text
source change
→ read-only freshness check
→ stale: preview or explicitly authorized repair
→ generate twice and prove idempotency
→ reject files outside the governed generated root
→ re-read the remote branch head
→ normal fast-forward push only
→ read back the pushed SHA
→ explicitly dispatch CI and Work Map validation for the new head
```

A producer may not use `--force`, `--force-with-lease`, a stale branch head, a no-op commit, or a silent best-effort validation dispatch. Because pushes made with `GITHUB_TOKEN` do not provide a reliable recursive validation trigger, every governed producer must explicitly dispatch `ci.yml` and `spec-kit-work-map-integration.yml` after successful push readback. Failure to dispatch either validator fails the producer job.

The connectivity contract verifies the producer, consumer, trigger, permission, command, and graph-edge relationships. Generated Work Maps remain generator-owned and direct manual editing is prohibited.

## Implementation readiness

A runtime or repository-governance change is blocked unless:

- every map decision exists;
- every domain decision exists;
- integrated and extended decisions bind requirements, tasks, acceptance tests, and evidence;
- cross-map dependencies are valid;
- no unresolved schema object exists;
- intentional exceptions are current and approved;
- dimension discovery has no unresolved entry;
- the registry fingerprint is current;
- `review_state` is `ready_for_implementation`;
- `implementation_readiness.status` is `ready`.

Documentation-only drafting may retain unresolved decisions, but it never creates implementation authority.

## CI commands

```bash
node http-generic-api/scripts/pipeline-connectivity-check.mjs
node http-generic-api/test-pipeline-connectivity-check.mjs
node http-generic-api/scripts/platform-work-map-generator.mjs --check
node http-generic-api/scripts/work-map-schema-classification-contract.mjs
node http-generic-api/scripts/work-map-schema-classification.mjs
node http-generic-api/scripts/spec-kit-work-map-governance-gate.mjs --ci --changed
```

Regression tests:

```bash
cd http-generic-api
node test-work-map-schema-classification.mjs
node test-work-map-schema-classification-contract.mjs
node test-spec-kit-work-map-governance-gate.mjs
node test-spec-kit-completion-gate.mjs
```

The dedicated validation and repair workflows are:

```text
.github/workflows/spec-kit-work-map-integration.yml
.github/workflows/spec-kit-work-map-autofix.yml
```

## Discovery of new platform dimensions

A missing dimension is first treated as a possible gap in current taxonomy or map composition. The reviewer must compare it with the closest existing maps and document why reuse, extension, composition, and generator extension are insufficient.

Only then may the result become a separately approved `new_work_map_candidate`. That proposal does not create implementation readiness in the same cycle.

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

Generated manifests and maps must not include credentials, signed URLs, raw provider payloads, raw database rows, private document contents, or unnecessary personal information.
