## Scope

- What changed:
- Affected boundary: root canonicals / `src` execution resolver / `http-generic-api` runtime / local connector / docs only

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
