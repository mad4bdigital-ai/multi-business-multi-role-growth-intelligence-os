# Governed Operational Evidence Cycle

## Purpose

This phase extends the merged Authority Data Foundation and Governed Live Evidence implementation with one operationally usable, fail-closed evidence cycle for `T001` and `T002`.

It does not create another authority inventory, catalog, ownership review, or migration planner. It composes the canonical implementations already merged through PRs #3962, #4000, and #4255.

## Integrated flow

```text
reviewed repository source documents
  -> exact main commit and Git blob bindings
  -> eight canonical repository snapshots
  -> canonical Authority Evidence Source Bundle
  -> typed short-lived operation authorization
  -> bounded read-only Production catalog observation
  -> Authority Live Census Adapter
  -> governed immutable live evidence packet
  -> human ownership review
  -> explicit T001/T002 closeout decision
  -> separately governed migration design and implementation
```

## Repository snapshot authority

The cycle requires exactly one reviewed JSON source document for each canonical family:

1. `system_tool_registry`
2. `admin_endpoint_catalog`
3. `direct_http_routes`
4. `runtime_action_registry`
5. `descriptor_catalog`
6. `provider_binding_catalog`
7. `local_device_catalog`
8. `compatibility_alias_registry`

A source manifest binds every document to:

- one full `main` commit SHA;
- one repository-relative file path;
- the exact Git blob SHA at that commit;
- the exact SHA-256 of the source file bytes;
- one canonical source family.

The collector reads only the checked-out repository. It performs no network request, provider call, credential read, database query, external write, or repository mutation.

It never infers missing actor, subject, Tenant, Workspace, resource, capability, provider, credential-scope, risk, revision, freshness, revocation, invalidation, atomicity, readback, idempotency, or rollback sources. Missing controls remain blocking inventory gaps.

## Freshness model

The reviewed source files are immutable repository definitions. Their blob and content identities remain historical facts. `observed_at` is the time the trusted workflow reads those exact definitions from the pinned `main` commit.

The manifest must pin the exact current `main` SHA used by the workflow. If `main` moves after review, the cycle fails closed and a new manifest review is required.

The repository snapshot observation and live SQL observation must still fit the existing ten-minute evidence-cycle bound.

## Operational authorization

The live job exists only under `workflow_dispatch` and additionally requires:

- repository variable `UEACP_LIVE_EVIDENCE_ENABLED=true`;
- typed input `I_AUTHORIZE_READ_ONLY_UEACP_EVIDENCE`;
- approval through the `ueacp-live-evidence` GitHub Environment;
- an exact target schema token;
- a reviewed source manifest present on current `main`.

After those gates, the workflow creates an authorization valid for thirty minutes and binds it to the GitHub run ID, exact `main` SHA, Production runtime environment, and target schema.

No push, pull-request, schedule, issue-comment, or workflow-run event can execute the live job. Pull requests execute the contract job only.

## Live catalog boundary

The cycle reuses `.github/scripts/authority-live-census-observation.mjs` and `authorityLiveCensusAdapter.js`.

The observer:

- permits `SELECT`, `WITH`, and `SHOW` only;
- rejects SQL mutation tokens;
- excludes raw column defaults;
- exposes view definitions as SHA-256 only;
- applies canonical object, column, index, foreign-key, view, and dependency limits;
- requires same-cycle schema and count readback;
- emits explicit no-effect and no-secret markers.

The workflow does not generate or apply migration SQL.

## Output

The uploaded artifact contains only:

- short-lived authorization metadata without credentials;
- repository source attestation;
- eight canonical no-secret snapshots;
- raw bounded catalog observation;
- immutable governed live evidence packet.

The packet may reach only `ready_for_human_ownership_review`. It does not contain human ownership decisions and therefore cannot close `T001` or `T002`.

## Fail-closed conditions

The cycle blocks when:

- any canonical source family is missing or duplicated;
- a source path escapes the repository root;
- the source file is absent at the pinned ref;
- Git blob SHA or content SHA-256 differs;
- a source document contains sensitive values;
- a path contract is incomplete or conflicting;
- the manifest does not pin current `main`;
- authorization is absent, expired, too long, or unsafe;
- source and SQL observations exceed the bounded cycle window;
- the target schema differs from the authorization;
- catalog integrity or same-cycle readback fails;
- the resulting packet contains blocking issues.

## Safety and task state

This phase performs no migration design or apply, database mutation, provider call, credential payload read, external write, runtime authority change, deployment, Production promotion, PEP activation, legacy removal, or task auto-closure.

`T001`, `T002`, and `T021`–`T024` remain open until:

1. reviewed source documents for all eight families are merged;
2. an explicitly authorized operational cycle succeeds;
3. human ownership review is completed after the latest observation;
4. T001/T002 are explicitly closed with immutable evidence;
5. migration design and implementation are separately reviewed and authorized.
