# GitHub Ruleset Live Drift — 2026-10-15

> **Read-only policy comparison, no GitHub Ruleset writes authorized.** Live inspected at repository main `6b439a2810eadfba53c224a274ca12ced20c14b4` and Production `e0c07f6fba431650b87d7a6f3dde76a364be6223`. Local authority: `http-generic-api/config/repository-governance-constitution.json`, `branches.main` and `branches.Production`. Related governance tracking: [issue #6625](https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/issues/6625). Latest [post-merge readback run 38655206725](https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/actions/runs/38655206725) returned `GOVERNANCE_SERVER_POLICY_DRIFT` with no mutation.

## Current GitHub server facts (read-only)

| Property | main live Ruleset #24796418 | main declared policy | Production live | Production declared policy |
|---|---|---|---|---|
| Protection | One active repo Ruleset targeting `refs/heads/main`; branch `protected=true` | PR and direct-push, force-push and deletion protection | `protected=false`, **no active Production ruleset** | Governed Production Promotion, PR gate and protected branch |
| Required checks | `Syntax Check`, `Unit & Integration Tests`, `Policy Objection Gate`, `Derived State Closure Detector` | `Derived State Closure` with trusted same-cycle candidate attestation | None required | `Governed Production Promotion` |
| Strict check matching | `strict_required_status_checks_policy=false` | `strict_required_status_checks=true` | None | strict required |
| PR reviews | `required_approving_review_count=0`, `dismiss_stale_reviews_on_push=false`, `required_review_thread_resolution=false`, `require_last_push_approval=false` | PR required, stale approval dismissal true, conversation resolution true | No enforcement | Governed PR and exact promotion authority |
| Force push/deletion | Ruleset contains `non_fast_forward` and `deletion` rules | Block both | Neither protected | Block both |
| Check producer identity | Required status contexts have `integration_id=null`; finalizer identity unresolved by policy readback | Same-cycle trusted finalizer/identity provenance; source mode `any_source_with_independent_finalizer_readback` still carries residual publisher risk | No producer binding | Trusted production-promotion attestor |
| Readback visibility | Classic branch-protection API returned HTTP 403; policy readback therefore does **not prove** direct-push prohibition | Must be independently evidenced | HTTP 403 and no active rules | Production promotion must be explicitly certified |

Main Ruleset: [MAD4B main review policy #24796418](https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/rules/24796418). **Live Ruleset is not equivalent to the source constitution**, even though individual PRs can meet the operational manual attestation and CI gates.

## Bounded remediation decision, not an Apply

1. **Do not silently change the currently required contexts.** First map exact `Derived State Closure`/ `Derived State Closure Detector` check publication, trusted attestor App/installation ID, and GitHub current-merge-candidate SHA binding. Replacing the working context with an unproduced one would deadlock PR merges; retaining only the wrong producer would weaken server enforcement.
2. **Main proposal (needs explicit approval):** activate required fresh review and conversation resolution settings, choose approved strict-check mode, and enforce correct finalizer-produced check identity only after same-cycle producer proof; preserve non-fast-forward, deletion and existing working CI checks. Evaluate Single Owner Review Gate operational flow separately before making it a mandatory Ruleset check. No blanket bypass or review removal.
3. **Production proposal (separate, higher-risk approval):** design an independently named Production branch ruleset; require `Governed Production Promotion` only after validating its trusted check producer and promotion workflow, protected-branch PR controls and exact-SHA readback. **No Production branch write, promotion, or ruleset activation is authorized by this report.**
4. Investigate the read-only API visibility defect (classic protection 403) separately from actual missing rules; 403 is **not** evidence that all protections are absent.
5. Generate two **exact, diff-only payloads** in a separate governed review: main Ruleset #24796418 minimal update and new Production Ruleset creation. Include current server fingerprint, expected head SHA, complete old/new rules, rollback plan, strict owner authorization, and verify independent readback after Apply if approved.
6. Audit any optional `required_status_checks` App binding and native auto-merge settings from the authoritative server; do not infer state from `null` or unresolved App identity. No force push, no direct protected-branch update, and no scope expansion.

## Pending owner decisions (explicit, narrow)

- [ ] Approve exact main Ruleset mutation plan, **after** check-context/producer contract is verified (not approved here)
- [ ] Separately approve Production Ruleset activation scope and readiness, **after** promotion attestor works (not approved here)
- [ ] Confirm whether Single Owner Review Gate should be enforced by the server. Existing owner preference is to keep working single-owner flow without adding a new mandatory protection requirement unless separately approved.
- [ ] Confirm server-side policy readback matches declared intent with no unresolved evidence or visibility blockers

**Safety:** `read_only=true`; `github_ruleset_mutation=false`; `production_mutation=false`; `provider_secret_read=false`; `migration_apply=false`.
