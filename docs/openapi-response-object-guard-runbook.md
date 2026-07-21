# OpenAPI Response Object Guard Runbook

## Purpose

This runbook covers detection, alerting, triage, recovery, and regression prevention for malformed OpenAPI 3.1 Response Objects in canonical and generated schemas.

## Incident summary

On 2026-07-20, unquoted comma-containing descriptions inside YAML flow mappings were parsed as extra Response Object properties. For example, a description intended as one sentence produced sibling keys such as `binding mismatch` and `or concurrent update.`. Generated Custom GPT schemas then contained structurally invalid response entries.

The incident affected schema source and generated artifacts only. It did not change runtime behavior, database state, provider credentials, or deployment configuration.

## Root cause

YAML flow mappings use commas as entry separators. A plain scalar description containing commas must therefore be quoted. Without quotes, the YAML parser can turn fragments after the comma into additional mapping keys with null values.

## Preventive controls

1. `scripts/openapi-response-object-guard.mjs` validates canonical and generated OpenAPI files.
2. `scripts/split-openapi.mjs` validates Response Objects before and after generation.
3. `scripts/generate-custom-gpt-schemas.mjs` validates generated Custom GPT schemas.
4. `npm run schemas:guard` invokes both the structural guard and its regression test.
5. `.github/workflows/custom-gpt-contract-guard.yml` runs on relevant pull requests, pushes to `main`, manual runs, and a daily schedule.

## Guard scope

For a normal Response Object, the allowed top-level keys are:

- `description`
- `headers`
- `content`
- `links`
- lowercase specification extensions beginning with `x-`

For a Reference Object, the allowed top-level keys are:

- `$ref`
- `summary`
- `description`
- lowercase specification extensions beginning with `x-`

The guard also requires a non-empty `description` on non-reference responses. It intentionally validates the Response Object boundary; nested Header, Link, Media Type, and Schema Objects remain the responsibility of the broader OpenAPI lint and compatibility checks.

## Alert lifecycle

The Custom GPT Contract Guard maintains a repository Issue titled:

`[OpenAPI Guard] Custom GPT Contract Guard failing`

The alert job runs only for the repository default branch. When the guard job fails, is cancelled, or otherwise does not succeed, it creates or updates a single deduplicated Issue containing the workflow run, commit, ref, and observation time. Repeated failures update the same Issue. The first successful default-branch run comments with recovery evidence and closes the Issue automatically.

This Issue lifecycle is the repository-level operational alert. It does not bypass or write directly to the SQL operational-alert registry because no governed CI-ingestion endpoint is currently registered for this signal.

## Triage procedure

1. Open the linked workflow run and identify the first failing command.
2. Run `npm run openapi:response-objects:guard` from `http-generic-api/`.
3. Inspect every reported object path and unexpected property.
4. Quote comma-containing descriptions rather than deleting valid text.
5. Confirm `headers`, `content`, `links`, `$ref`, and lowercase `x-*` entries remain structurally correct.
6. Regenerate governed artifacts with the repository generation scripts.
7. Run `npm run test:openapi:response-objects`.
8. Run `npm run schemas:guard`.
9. Verify generated artifacts contain no null-valued description fragments.
10. Allow a successful default-branch workflow run to close the alert Issue; do not close it manually while the guard still fails.

## Recovery criteria

Recovery is complete only when:

- the structural guard passes for canonical and generated schemas;
- the regression test passes;
- schema generation and parity checks pass;
- the Custom GPT Contract Guard succeeds on the default branch;
- any open guard alert Issue is closed by the success path;
- no temporary workflow or generated-file synchronization logic remains.

## Acceptance monitoring

Before merging a change to this guard, record three consecutive successful manual Custom GPT Contract Guard runs on the proposed head. After merge, confirm at least one successful default-branch run so the alert recovery path is exercised. Run IDs and conclusions should be recorded in the pull-request validation summary.

## Escalation

Escalate when the same failure recurs after quoting and regeneration, when generated artifacts differ without source changes, or when the alert lifecycle cannot create/update Issues. Include the failing object path, run URL, head SHA, generation command, and whether the failure occurs before generation, after generation, or only in a generated artifact.
