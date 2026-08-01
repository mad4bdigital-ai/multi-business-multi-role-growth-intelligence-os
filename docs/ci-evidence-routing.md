# CI Evidence Routing

## Purpose

Repository automation must provide one bounded, machine-readable and human-readable report for each governed workflow run. Agents and reviewers must not reconstruct pass/fail state by manually scanning multiple GitHub Actions Job logs when a canonical report exists.

The machine policy is `.github/ci-evidence-routing.json`.

## Authority order

Use evidence in this order:

1. Canonical summary artifact for the exact workflow run and exact candidate SHA.
2. Structured JSON source reports referenced by that summary.
3. Workflow and Job status only as transport and completion signals.
4. Job logs as diagnostic-only evidence.

A valid canonical report is the status authority. Job logs may never override it.

## Candidate identity

Every report must label the tested candidate:

- `head`: the PR branch head itself. E2E Phase Governance and Context Kernel Hardcoding Report explicitly checkout this SHA.
- `merge_candidate`: GitHub's synthetic `refs/pull/<number>/merge` commit. Branch Test Diagnostic Shards use it to prove compatibility with the current base.

A merge-candidate SHA must never be described as the PR head. The two evidence kinds may complement one another, but their SHA, run ID, artifact, and conclusion must remain separate.

## Fail-closed source contract

Every E2E source JSON is stamped before upload and must declare:

- a recognized filename and exact source contract;
- boolean `ok`;
- `candidate_kind`;
- a full 40-character `candidate_sha` equal to the executed candidate;
- `secrets_included: false`.

The canonical router rejects missing, malformed, unexpected, conflicting, or mismatched reports. A successful Job without its expected structured report is an evidence-integrity error, not a pass.

The E2E source contracts are:

- `mad4b.e2e-parallel-work-evaluation.v1`;
- `mad4b.e2e-phase-evaluation.v1`;
- `mad4b.e2e-parallel-execution.v1`;
- `mad4b.e2e-phase-execution.v1`.

Context Kernel scanner evidence uses `mad4b.context-kernel-hardcoding-source.v1`.

## When Job logs may be opened

Logs are allowed only when the canonical summary explicitly requests diagnostic access or one of these fail-closed conditions exists:

- canonical summary is missing or malformed;
- structured source report integrity fails;
- the report declares that its bounded diagnostic is insufficient for root cause;
- a workflow crashes before publishing structured evidence.

A failure with a bounded redacted diagnostic in the report does not require manual log reading.

## Exact-candidate reporting rule

Every final statement must identify:

- workflow name and run ID;
- candidate kind and exact candidate SHA;
- source head SHA when different;
- head and base refs;
- canonical report contract;
- first blocking finding or failed test;
- whether log access was required and why.

Never combine evidence from different candidates into one unlabeled status.

## E2E Phase Governance

`E2E Phase Governance` explicitly checks out the declared candidate and publishes:

- `e2e-phase-evaluation-<run_id>`;
- `e2e-phase-execution-<run_id>`;
- `e2e-phase-summary-<run_id>`;
- GitHub Step Summary generated from `mad4b.ci-evidence-summary.v1`.

For workstream failures, `e2e-parallel-test-runner.mjs` places bounded redacted stdout and stderr tails inside `e2e-parallel-execution.json`. Raw Job logs remain secondary.

## Branch Test Diagnostic Shards

`Branch Test Diagnostic Shards` publishes `mad4b.test-diagnostic-summary.v2` as `branch-test-diagnostic-<run_id>-summary`. It is merge-candidate evidence; `ref` and `commitSha` identify the synthetic commit tested. Use its exact rerun coordinates rather than reading every shard log.

## Context Kernel Hardcoding Report

`Context Kernel Hardcoding Report` explicitly checks out the PR head, scans its exact changed-file scope, and publishes:

- `context-kernel-hardcoding-source.json` with `mad4b.context-kernel-hardcoding-source.v1`;
- canonical decision `mad4b.context-kernel-hardcoding-summary.v1`;
- artifact `context-kernel-hardcoding-summary-<run_id>`;
- Step Summary containing the first rule, path, line, bounded evidence, and remediation.

The canonical report is uploaded before enforcement, so a blocked guard remains diagnosable without opening its Job log.

## PR-visible evidence

`CI Evidence PR Publisher` is a trusted `workflow_run` workflow. It checks out `main`, downloads the exact completed-run canonical artifact, validates it against the workflow-run head, and maintains one comment marked with:

`<!-- mad4b-ci-evidence-authority -->`

Each workflow owns one section. A newer run replaces that section; an older run cannot overwrite newer evidence. PR-head workflows have read-only permissions and do not receive comment-writing authority.

## Agent response rule

State the canonical report result first. Clearly separate report-derived facts from any later log-derived root-cause detail. Never present a log snippet as the workflow result, never call a merge candidate the head SHA, and never cite an older run as evidence for a newer candidate.
