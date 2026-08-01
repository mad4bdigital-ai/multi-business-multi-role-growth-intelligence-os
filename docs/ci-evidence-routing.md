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

- `head`: the PR branch head itself. E2E Phase Governance, Context Kernel Hardcoding Report, and PR Generated Artifact Refresh explicitly checkout this SHA.
- `merge_candidate`: GitHub's synthetic `refs/pull/<number>/merge` commit. Branch Test Diagnostic Shards use it to prove compatibility with the current base.

A merge-candidate SHA must never be described as the PR head. The two evidence kinds may complement one another, but their SHA, run ID, artifact, and conclusion must remain separate.

The pull-request generated-artifact evaluator is read-only. Its `candidate_sha` and `source_head_sha` must both equal the exact workflow-run head. It may not report or publish a generated commit.

Repository mutation is a separate governed operation. The manually dispatched Generated Artifact Refresh tool records `target_ref`, `expected_head_sha`, and the resulting commit in its own maintenance-tool report; that report must not be substituted for PR workflow evidence.

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

## PR Generated Artifact Refresh

`PR Generated Artifact Refresh` is a read-only pull-request evaluator. It uses `contents: read`, does not persist checkout credentials, and performs no commit or push.

It generates and verifies the bounded artifact set only inside the ephemeral runner workspace, then publishes `mad4b.pr-generated-artifact-refresh-summary.v1` as `pr-generated-artifact-refresh-<run_id>-summary` before enforcing the decision.

The report contains:

- exact `candidate_sha` and `source_head_sha`, both equal to the workflow-run PR head;
- bounded generated drift paths;
- `commit_sha: null` and `repository_mutation_performed: false`;
- the first failed step, command, exit status, and redacted bounded stdout/stderr tails;
- `secrets_included: false`;
- `routing.job_logs_role: diagnostic_only`.

If generated files differ, the canonical result is `generated_artifact_drift_detected`. The remediation is to run the registered governed mutation tool; the pull-request workflow itself never writes.

## Governed Generated Artifact Refresh

`Governed Generated Artifact Refresh` is a separate `workflow_dispatch` operation backed by the registered tool:

`http-generic-api/scripts/maintenance-tools/generated-artifact-refresh.mjs`

It requires:

- a governed non-protected `target_ref`;
- an exact 40-character `expected_head_sha`;
- typed confirmation `APPLY_GENERATED_ARTIFACT_REFRESH`.

The tool verifies both local and remote head identity before generation, before commit, and before normal fast-forward push. It rejects `main`, `Production`, force push, concurrent branch movement, and every changed path outside its registered allowlist.

Its canonical report contract is `mad4b.governed-generated-artifact-refresh.v1`. The JSON and Markdown report are uploaded before enforcement and declare `secrets_included: false` and `job_logs_role: diagnostic_only`.

## Repository Tool Lifecycle Governance

Repository automation changes are governed by `mad4b.repository-tool-lifecycle-report.v1`. Read its artifact before opening Job logs. In particular:

- pull-request workflows must remain read-only;
- reusable mutating tools must be registered under the governed maintenance-tool root;
- mutations require expected-head verification and protected-branch rejection;
- force push, self-deleting workflows, and branch-specific one-shot automation fail closed.

## PR-visible evidence

`CI Evidence PR Publisher` is a trusted `workflow_run` workflow. It checks out `main`, downloads the exact completed-run canonical artifact, validates it against the workflow-run identity and current PR head, and maintains one comment marked with:

`<!-- mad4b-ci-evidence-authority -->`

Each workflow owns one section. A newer run replaces that section; an older run cannot overwrite newer evidence. PR-head workflows do not receive comment-writing authority.

## Agent response rule

State the canonical report result first. Clearly separate report-derived facts from any later log-derived root-cause detail. Never present a log snippet as the workflow result, never call a merge candidate the head SHA, and never cite an older run as evidence for a newer candidate.
