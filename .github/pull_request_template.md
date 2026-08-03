## Scope

- What changed:
- Affected boundary: root canonicals / `src` execution resolver / `http-generic-api` runtime / local connector / docs only

## Phase and E2E Contract

- Contract path: `specs/<feature-key>/e2e-phases.json` or `.changes/e2e/<feature-key>.json`
- Current phase: `mvp` / `operational` / `resilient` / `canary` / `production`
- PR mode: standard feature / parallel workstream / integration rollup
- Workstream ID, when applicable:
- Integration branch, when applicable:
- [ ] Every changed runtime file is covered by the contract scope
- [ ] The declared E2E journey starts at a real entrypoint and ends with observable readback
- [ ] Component or policy tests are not being presented as E2E evidence

## Parallel Work Evidence

Complete this section for a workstream or integration PR.

- Dependencies:
- Deliverables:
- Integration points:
- Work commit SHAs:
- [ ] Workstream branch matches its declared pattern
- [ ] Workstream PR targets the declared integration branch, not `main`
- [ ] Shared files are covered by an explicit `declared_overlaps` entry
- [ ] Required workstream or convergence tests are declared and executable
- [ ] Integration rollup contains the recorded work commits

## Canonical CI Evidence

- Workflow:
- Run ID:
- Candidate kind: `head` / `merge_candidate`
- Exact candidate SHA:
- Head SHA, when candidate kind is `merge_candidate`:
- Canonical report contract/artifact:
- First blocking finding or failed test:
- Job-log access required: no / yes, with policy reason
- [ ] Report, artifacts, and checks belong to the same exact candidate SHA
- [ ] Head evidence and merge-candidate evidence are labeled separately
- [ ] Canonical summary was read before any Job log
- [ ] Job logs were treated as diagnostic-only and did not override structured evidence

## Repository Automation / Tool Lifecycle

- Automation classification: none / permanent reusable tool / temporary work-branch aid / product runtime
- Registered tool key, when permanent:
- Canonical lifecycle report:
- [ ] Reusable tools live under the governed tool root and are registered
- [ ] Permanent workflows contain no PR number, date, SHA, tenant, ticket, or work-branch literal
- [ ] Pull-request workflows are read-only
- [ ] Mutating tools require explicit dispatch and an exact expected head SHA
- [ ] `main` and `Production` mutations are rejected unless separately governed
- [ ] Force push and workflow self-deletion are absent
- [ ] Temporary workflows, triggers, and patch runners are removed from the final merge diff

## Tests Run

- [ ] Root typecheck: `npm run typecheck`
- [ ] Root tests: `npm test -- --runInBand`
- [ ] Runtime tests: `cd http-generic-api && npm test`
- [ ] Runtime architecture validation: `cd http-generic-api && npm run validate`
- [ ] Targeted tests listed below, if this PR is narrower than the full suite:

## API / OpenAPI Impact

- [ ] No API/OpenAPI impact
- [ ] `http-generic-api/openapi.yaml` updated
- [ ] Split OpenAPI artifacts reviewed or regenerated where needed
- [ ] Custom GPT operation limits and schema tests still pass

## Database / Migration Impact

- [ ] No database or migration impact
- [ ] Migration is dry-run safe or has an explicit non-mutating check
- [ ] Rollback or recovery note included for schema/data changes

## Security / Connector Risk

- [ ] No auth, credential, connector, local execution, or break-glass impact
- [ ] Auth scopes and platform fallback behavior reviewed
- [ ] Connector/local execution path is admin-only or tenant-scoped as intended
- [ ] No secrets are added to code, docs, logs, or generated artifacts

## Rollback Note

Describe rollback for migrations, live mutations, connector changes, or externally consumed API changes. If not applicable, write `N/A`.
