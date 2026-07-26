# Dynamic Interruption Readiness Automation

## Purpose

The interruption readiness gate prevents avoidable delivery stops from being
discovered late. It classifies environment and integration blockers before a long
test or merge sequence begins, while preserving local user changes.

## Canonical Contract

`http-generic-api/scripts/interruption-readiness.mjs` is the executable contract.
`http-generic-api/interruptionReadiness.js` contains the deterministic classifiers
covered by `http-generic-api/test-interruption-readiness.mjs`.

The gate checks:

- Node runtime compatibility with `http-generic-api/package.json`.
- Resolution of every declared direct API dependency.
- Exact installed direct dependency version parity with `package-lock.json`.
- Availability and mergeability of the configured target, defaulting to
  `origin/main`.
- Changes and two-sided overlap on sensitive runtime surfaces, with recommended
  targeted tests.
- Dirty worktree state and EOL/trailing-whitespace-only drift that can block branch
  switching.
- Freshness of previously recorded readiness evidence across long test or resume
  cycles.

The gate never resets, checks out, stashes, deletes, or rewrites user files. When
local drift would make integration unsafe, the recovery directive is to use an
isolated clean worktree.

## Commands

Local preflight:

```bash
cd http-generic-api
npm run readiness:interruptions
```

Machine-readable evidence:

```bash
node scripts/interruption-readiness.mjs --json --report-file interruption-readiness.json
```

Freshness verification after a long-running operation:

```bash
node scripts/interruption-readiness.mjs --verify-evidence interruption-readiness.json
```

The evidence snapshot binds the result to `HEAD`, target ref SHA, merge base,
`package-lock.json` SHA-256, installed direct dependency versions, and a content
fingerprint covering staged, unstaged, and untracked non-ignored files. A change
to any bound input invalidates the baseline.
The default freshness window is six hours and can be reduced with
`--max-age-minutes`.

CI merge guard before dependency installation:

```bash
node scripts/interruption-readiness.mjs --ci --skip-dependencies --skip-worktree
```

CI dependency guard after `npm ci`:

```bash
node scripts/interruption-readiness.mjs --ci --skip-merge --skip-worktree
```

CI writes that result as a baseline, runs the test sequence, then rejects the run
if the baseline became stale. Checkout uses full history so the target SHA and
merge base are always evidence-bound.

## Decision Model

- `blocker`: execution stops because evidence is not trustworthy or integration is
  unsafe.
- `warning`: execution may proceed locally, but the condition needs explicit
  attention.
- `info`: readiness evidence passed or targeted verification is recommended.

CI upgrades Node engine mismatch and EOL-only drift to blockers. Missing dependencies,
an unavailable target ref, and merge conflicts are always blockers.

## Extension Rule

When a runtime boundary becomes conflict-prone, add it and its smallest proving
tests to `SENSITIVE_SURFACE_TESTS`. Do not add broad test suites when a targeted
contract test can prove the changed boundary.

## Operational Knowledge

Interpret the report before changing code:

- `dependencies` blocker means the test environment is incomplete; it is not
  evidence of an application regression.
- `merge_conflicts` blocker means integration must be reconciled before final
  validation; repeated testing of the stale branch cannot prove delivery safety.
- `line_ending_drift` means preserve the local file and integrate from an isolated
  worktree. Do not normalize or revert a user-owned file merely to switch branches.
- `sensitive_overlap` means both integration sides changed a governed boundary.
  Run the recommended targeted tests after resolving the overlap.
- `evidence_freshness` blocker means the repository or dependency contract changed
  after validation began. Discard prior results and restart from a new baseline.

## Dynamic Verification Plan

Each report includes `verification_plan.commands`, generated from committed branch
changes plus current tracked and untracked worktree changes. Rules map governed
surfaces to the smallest proving tests. The plan always includes the readiness
contract test and deduplicates commands across overlapping rules.

Reports also expose `coverage` so downstream automation can distinguish checks that
passed from checks intentionally skipped. The sequential executor rejects blocked
baselines and unsupported/missing readiness evidence before executing any step.
Valid evidence must include generator-produced checks, summary, coverage,
continuity snapshot, and verification plan. The executor recalculates summary and
status from checks and rejects contradictory evidence, unknown check levels,
invalid summary counters, and non-boolean coverage flags.

Execute the generated plan sequentially:

```bash
npm run readiness:verify-plan -- \
  --evidence interruption-readiness.json \
  --result-file interruption-verification-result.json
```

The executor accepts only commands already registered in the test manifest or the
small canonical validation allowlist. It runs without a shell, checks baseline
freshness before every step and after completion, stops on the first failure, and
writes `interruption_verification_execution.v1` evidence. Use `--dry-run` to inspect
the authorized sequence without executing tests.

Blocked continuity and unauthorized-command paths also write result evidence when
`--result-file` is provided, preserving the stop reason for diagnosis and restart.

## Checkpoint, Resume, And Lease

The sequential executor writes an atomic checkpoint before and after each step.
Resume requires the same absolute evidence file and the same generated plan hash:

```bash
npm run readiness:verify-plan -- \
  --evidence interruption-readiness.json \
  --result-file interruption-verification-result.json \
  --resume
```

Previously passed steps are skipped with `resumed_from_checkpoint=true`. Failed,
pending, or running steps are executed again only after the baseline passes the
freshness gate.

Resume binds to the evidence content identity, not only its file path. Replacing a
baseline file in place invalidates the checkpoint and prevents reuse of prior
passed steps. Evidence identity includes coverage, checks, status, summaries,
continuity snapshot, and verification plan.

When a result file is supplied, the executor claims an exclusive `.lease` file.
A second executor is blocked and cannot overwrite the owner's checkpoint. A stale
lease or a recent orphaned lease can be recovered only with
`--recover-stale-lease`. Time-based stale classification uses the configured
`--lease-timeout-minutes` threshold, which defaults to 120 minutes.

Keep evidence, result, and lease artifacts outside the repository, such as
`$RUNNER_TEMP` or the operating-system temporary directory. This prevents
operational ledgers from becoming worktree changes that invalidate their own
continuity fingerprint.

The executor enforces that `--result-file` is outside the repository. Stale lease
recovery also refuses to proceed while the recorded owner PID is still alive.

`--recover-stale-lease` also recovers a recent orphaned lease immediately when its
recorded PID is valid and confirmed dead. Invalid or unknown PID ownership remains
blocked rather than guessed.

Recovered leases retain bounded provenance containing the recovery classification,
previous owner token, and previous PID across subsequent heartbeats.

The result ledger preserves up to 20 bounded prior-attempt summaries and 200
secret-free current-attempt events. Events record lease acquisition/recovery,
step start/pass/failure, resume, completion, and blockers without capturing command
stdout, stderr, environment variables, or dependency payloads.

Events form a SHA-256 chain. Resume validation rejects a corrupted, reordered, or
partially inconsistent retained event timeline before reusing passed checkpoints.

## Deferred Recovery Verification Matrix

Run these paths when command execution is available:

| Scenario | Expected result |
|---|---|
| Clean first run | All generated steps pass; lease is removed |
| Resume matching checkpoint | Contiguous passed prefix is skipped |
| Resume after evidence replacement | Blocked with evidence identity mismatch |
| Resume with non-contiguous passed steps | Blocked as inconsistent checkpoint |
| Second executor with active owner | Blocked without result overwrite |
| Explicit recovery while owner PID alive | Blocked |
| Explicit recovery with dead valid PID | Lease reclaimed with recovery provenance |
| Invalid/malformed lease ownership | Blocked without guessing |
| Step failure | Failed checkpoint persisted; lease removed |
| Worktree change between steps | Blocked by freshness before next step |

`test-interruption-verification-recovery.mjs` automates the first-run, matching
resume, active-owner rejection, orphan recovery, replaced-evidence rejection,
tampered-event rejection, and blocked-baseline rejection using only temporary
artifacts outside the repository.

Missing or invalid `package-lock.json` does not crash the readiness CLI. Dependency
readiness reports missing lock entries as blockers, and the continuity snapshot
retains a null lock hash so the evidence cannot be treated as a locked environment.
