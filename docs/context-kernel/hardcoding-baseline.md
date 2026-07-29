# Context Kernel Hardcoding Baseline

Status: Phase 1 report-only baseline  
Pull request: #3056  
Branch: `feature/012-context-kernel-phase-1`  
Behavioral impact: none

## Purpose

Record the verified aggregate result of the first repository-wide context-kernel hardcoding scan. This baseline is evidence for prioritization and later enforcement. It is not a claim that every scanner finding is a confirmed defect.

## Verified execution evidence

The scanner and its focused tests completed successfully on commit:

```text
9230e6be361ec2f8116b542ae4106eaea8bfb398
```

GitHub Actions evidence:

| Evidence | Value |
|---|---|
| Workflow | `Context Kernel Hardcoding Report` |
| Workflow run | `30049876369` |
| Mode | `report_only` |
| Files scanned | `4312` |
| Unsuppressed findings | `1201` |
| Artifact ID | `8580572598` |
| Artifact size | `38092` bytes |
| Artifact digest | `sha256:2f1734226f50e55225663b2a9042ace6ed5bee44dc78e75de8c11049dee911b0` |
| Artifact expiry | `2026-08-06T22:38:46Z` |

The detailed finding distribution and redacted finding records remain in the artifact. They are not duplicated in this document because the governed artifact response exceeded the inline extraction limit. No rule-level count is inferred or invented here.

## Interpretation

The 1201 findings are heuristic candidates, not 1201 confirmed production defects. The scanner intentionally covers runtime code, tests, migrations, specifications, and documentation. Each finding must be reviewed with its zone, rule, source context, and evidence before remediation or suppression.

## Disposition policy

Every active finding must receive one of four dispositions:

| Disposition | Meaning |
|---|---|
| `retain` | The pattern is intentional and safe in its zone, normally a synthetic fixture, migration example, or documentation sample. |
| `replace` | The pattern must be replaced by registry-backed resolution, exact binding, structured failure, or fail-closed policy. |
| `prove-safe` | The pattern may remain only after uniqueness, isolation, authority, and error behavior are demonstrated by code and tests. |
| `remove` | The fixed scope, sentinel, fallback, or unsafe selection must be deleted. |

Initial rule guidance:

| Rule | Default disposition |
|---|---|
| `fixed_customer_identifier` in runtime | `remove` |
| `zero_scope_fallback` | `remove` |
| `implicit_scope_default` | `remove` |
| `permissive_authority_default` | `replace` |
| `silent_resolution_failure` | `replace` |
| `first_candidate_selection` | `prove-safe` or `replace` |
| `unproven_single_candidate_query` | `prove-safe` or `replace` |
| Synthetic fixtures, migrations, and documentation | `retain` or reasoned suppression |

## Priority review surfaces

The Phase 1 source inventory identified the following priority surfaces for manual classification:

1. `activationSessionLifecycleService.js`: missing tenant evidence represented by an all-zero tenant sentinel.
2. `dynamicAuditRuntime.js`: a shared default scope containing customer-scoping fields.
3. `appConnectionResolver.js`: single-row query caps, first-row access, permissive defaults, and query failures converted to empty results.
4. `connectorExecutor.js`: exact and fuzzy connected-system lookup with single-row query caps.
5. Admin brand and workspace resolution: broad visibility must remain separate from tenant mutation authority.

No production resolver behavior is changed by this baseline.

## Enforcement progression

1. Keep all findings report-only during Phase 1.
2. Classify runtime findings and review proposed suppressions.
3. Add focused regression tests for confirmed unsafe patterns.
4. Introduce blocking enforcement only for high-confidence runtime rules with an approved baseline or zero-tolerance policy.
5. Keep test, migration, and documentation zones non-blocking unless a separate policy explicitly changes them.

## Known unrelated workflow drift

A separate `Frontend surface dispatch` workflow failure was observed while validating this branch. Its log showed committed deterministic frontend and generated OpenAPI evidence had drifted because of unrelated `auth-email-outbox` changes already present in the base history. The Phase 1 files do not modify those generated surfaces.

That drift is excluded from this pull request to preserve scope isolation. It requires a separate change that regenerates and reviews the affected deterministic outputs.

## Phase 1 completion criteria

- [x] Scanner implementation committed.
- [x] Focused scanner tests pass.
- [x] Repository-wide report-only workflow succeeds.
- [x] Baseline artifact is uploaded with a recorded digest.
- [x] Aggregate baseline evidence is documented.
- [ ] Runtime findings are classified individually.
- [ ] Confirmed unsafe patterns are assigned to implementation tasks.
- [ ] Blocking-mode policy is reviewed and approved.
