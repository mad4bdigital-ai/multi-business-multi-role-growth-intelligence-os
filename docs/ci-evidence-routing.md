# CI Evidence Routing

## Purpose

Repository automation must provide one bounded, machine-readable and human-readable report for each governed workflow run. Agents and reviewers must not reconstruct pass/fail state by manually scanning multiple GitHub Actions job logs when a canonical report exists.

The machine policy is `.github/ci-evidence-routing.json`.

## Authority order

Use evidence in this order:

1. Canonical summary artifact for the exact workflow run and exact head SHA.
2. Structured JSON source reports referenced by that summary.
3. Workflow and job status only as transport/completion signals.
4. Job logs as diagnostic-only evidence.

A valid canonical report is the source of truth for classification, first failure, blocking finding, executed tests, and whether deeper log diagnosis is required. Job logs may never override a valid structured report.

## When job logs may be opened

Logs are allowed only when the canonical summary explicitly requests diagnostic access or when one of these fail-closed conditions exists:

- canonical summary is missing or malformed;
- structured source report integrity fails;
- the report declares that its bounded diagnostic is insufficient for root cause;
- a workflow crashed before it could publish structured evidence.

A failing test with a bounded, redacted diagnostic in the report does not require manual log reading.

## Exact-head rule

Never mix reports, statuses, artifacts, or logs from different SHAs or workflow runs. Every final statement must identify:

- workflow name;
- run ID;
- exact head SHA;
- head and base refs;
- canonical report contract;
- first blocking finding or failed test;
- whether log access was required and why.

A report whose declared SHA conflicts with the workflow head is an evidence-integrity failure and must fail closed.

## E2E Phase Governance

`E2E Phase Governance` publishes:

- raw evaluation artifact: `e2e-phase-evaluation-<run_id>`;
- raw execution artifact: `e2e-phase-execution-<run_id>`;
- canonical summary artifact: `e2e-phase-summary-<run_id>`;
- GitHub Step Summary generated from `mad4b.ci-evidence-summary.v1`.

For workstream failures, `e2e-parallel-test-runner.mjs` captures bounded redacted stdout/stderr tails inside `e2e-parallel-execution.json`. This is the primary failure diagnostic. Raw Job logs remain secondary.

## Branch Test Diagnostic Shards

`Branch Test Diagnostic Shards` publishes `mad4b.test-diagnostic-summary.v2` as `branch-test-diagnostic-<run_id>-summary`. Use that summary before shard or sequential logs. Exact rerun coordinates from the report should be used for isolation instead of manually reading every shard.

## Context Kernel Hardcoding Report

`Context Kernel Hardcoding Report` scans the exact changed-file scope for the candidate head and publishes:

- structured scanner source: `context-kernel-hardcoding-source.json`;
- canonical decision: `mad4b.context-kernel-hardcoding-summary.v1`;
- artifact: `context-kernel-hardcoding-summary-<run_id>`;
- GitHub Step Summary containing the first runtime finding, path, line, bounded evidence, and remediation.

The canonical report is uploaded before enforcement. Therefore a blocked guard remains diagnosable without reading the failed Job log. The aggregate full-repository baseline is not a substitute for the exact changed-file report and must not be used to attribute a PR failure.

## Agent response rule

When reporting CI state, state the canonical report result first. Separate report-derived facts from any later log-derived root-cause detail. Never describe a Job log snippet as the workflow result, and never cite an older successful run as evidence for a newer head.
