# Research and Baseline

## Incident classes

- Brand access request could widen to Workspace access.
- “Trip or activity” was useful intent but not bound to live WordPress CPT/schema.
- App-type matching could select a connection belonging to another resource.
- `active`, `ready`, and `metadata_only` were too coarse for operation readiness.
- Device reinstall guidance contradicted healthy registered devices.
- Tenant responses exposed more internal registry/graph detail than required.
- Tool inventory and capability summaries represented different views of callability.

## Existing primitives to reuse

- dynamic capability governance manifests, gaps, projections, and certifications;
- resource-context resolve/catalog/related/diagnostic surfaces;
- Business Activity registry;
- connection and credential planning surfaces;
- operation context, preflight, execute, status, resume, and readback;
- support execution-plan/workflow linkage;
- WordPress authority diagnostics;
- resource-scoped grant/effective-access registries;
- Local Manager device inventory/consent flows.

## Conclusions

1. Build a composition facade, not another authority graph.
2. Treat natural language as discovery input, not capability selection.
3. Represent readiness as a freshness-bound vector.
4. Pin exact resource and connection before schema questions.
5. Generate questions from verified schemas.
6. Run contradiction detection before recommendations.
7. Use operation references for support continuity/retry.
8. Enforce customer-safe projection at the final boundary.
9. Roll out in shadow mode before changing Tenant conversations.
10. Start with read-only and preview cohorts before mutations.

Operational counts are time-sensitive evidence and must not be hard-coded into runtime policy or acceptance tests.
