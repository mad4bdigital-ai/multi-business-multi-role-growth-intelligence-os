# Adaptive Authorization Verification Manifest

## Purpose

T050 registers the completed adaptive-authorization governance tests as an explicit,
deterministic verification surface. The feature manifest covers unit, integration,
tenant-isolation, replay, stale-revision, ambiguity, and redaction evidence.

`http-generic-api/scripts/run-adaptive-authorization-verification-manifest.mjs`
is invoked by `npm test` after the repository test manifest. It validates the
feature manifest, runs each bounded local Node test, rejects missing or duplicate
entries, scans output for common secret forms, and emits a summary containing the
manifest hash, revision-vector hash, request-shape hashes, and executed/passed/
failed/skipped counts.

Skipped tests never count as passing evidence.

## Registered feature tests

- T040 shadow-pilot parity: integration and tenant isolation.
- T041 mismatch classification: unit and ambiguity.
- T042 threshold approval: replay and stale revision.
- T043 legacy compatibility wrapper: integration, ambiguity, and redaction.
- T050 manifest contract and GitHub rerun response-schema regression.

## GitHub rerun response contract

`20260712_github_rerun_workflow_response_schema_alignment.sql` is an additive,
not-yet-executed migration. It adds JSON response content metadata for the
successful `201` returned by `github_rerun_workflow_run` and synchronizes the
active endpoint-tool export from canonical endpoint authority.

The migration does not call GitHub, rerun workflows, read credentials, perform
external writes, activate canary enforcement, remove routes, execute a rollout,
or include secrets.

## Safety boundary

T050 is verification registration only. All provider execution, external write,
migration execution, canary activation, route removal, and enforcement-cutover
flags remain false.
