# Main-only GitHub Any source with governed trusted finalizer

**Date:** 9 October 2026  
**Change:** Source-only, separately reviewed PR. **NO Production promotion, database write, or live Ruleset update authorized.**

## Why this exists

GitHub Ruleset `MAD4B main review policy` (ID `24796418`) was manually created targeting `refs/heads/main`. The operator chose `Any source` for required status context `Derived State Closure`, with strict status checks, pull-request review and no bypass actors. The existing source policy controller demanded an `integration_id` in the GitHub server rule; the governed finalizer also rejected any unbound rule, even though its backend independently attests the exact GitHub merge candidate.

The core risk remains **real**: GitHub `Any source` does **not** constrain which authorized actor or app can publish a status named `Derived State Closure`. A malicious or buggy status publisher could satisfy GitHub's native check without passing MAD4B's backend attestation. There is no code-only solution that makes GitHub's unrestricted source check equivalent to an App-bound rule. This change does not suppress or redefine that risk.

## Source-bound implementation

- The canonical Constitution now explicitly opts **main only** into `any_source_with_independent_finalizer_readback`. **Production remains strictly App-bound**, and its promotion authority is unchanged.
- The policy controller can **diagnose** a Ruleset importing a context with no `integration_id`, and generates a matching representation if planning. It keeps `required_status_check_producer_bound=false` and `server_policy_gate_complete=false` because GitHub's server cannot prove publisher identity. It does not automatically apply this weaker server rule.
- The governed main finalizer verifies the Constitution opt-in, the live branch rules and managed Ruleset, exact unchanged base/head/candidate, no bypass actors, and the independently verified attestor App identity.
- The backend attestor must publish the status on the exact candidate and return `status_id`, `status_creator_id`, and `app_id`. These three positive IDs cross the workflow job boundary. The finalizer then fetches the candidate's status history and requires the **newest** `Derived State Closure` status to match *both* the returned status ID and creator ID, with state `success`. An older trusted success is insufficient if a subsequent publisher overwrote that context.
- Native negative tests reject stale statuses, a second status from the same creator, foreign publisher, wrong context, wrong App binding, malformed inputs, and changes that disable the no-auto-merge condition.
- No generic `--admin`, branch bypass, direct push, unauthenticated status simulation, or native auto-merge is introduced.

## Operational gates, separate from code completion

1. Review and merge this source patch under existing owner/independent-review policy. Changes to the control plane require exact-new-HEAD approval. **Do not modify the attested heads of PR #8480 or #8471.**
2. Verify the backend `GITHUB_APP_ID`, installation identity and `BACKEND_API_KEY` resolution **without exposing secrets**. Source-only tests cannot prove a live backend attestation.
3. Validate that the canonical source workflow and artifact digest on the exact current candidate are accessible to the finalizer. The backend must succeed at `/admin/repository-automation/policy-controller` in `attest` mode, returning the same-cycle status ID. The production database/ledger objections are independent.
4. Only after the trusted finalizer pipeline actually works, the owner may decide whether to change Ruleset `24796418` from `disabled` to `active`. Reread actual branch protection, strict checks, bypass actors, and status creator. Evaluate mode is not supported by the owner's GitHub plan.
5. Never report `server_policy_gate_complete=true` for Any source, even if a governed finalizer merge is permitted by its **separate** exact-status checks. For a GitHub-server-enforced trusted publisher guarantee, use an App-bound required status source instead.
6. Keep Production promotion, Hostinger writes, Governance DB 225/1051 operations, and secrets unchanged unless separately authorized.

## Known limitations

- A person with sufficient GitHub merge permission might bypass MAD4B's governed finalizer by merging via GitHub UI after a forged Any-source status. **The application cannot prevent that at the Ruleset layer with this setting.**
- The current manually imported Ruleset is disabled; this source patch does not activate or mutate it.
- The authentic GitHub finalizer App ID, live status publication, and Windows Staging deployment have not been validated by native runtime acceptance.

**Release decision:** Accept source improvements and diagnostic accuracy separately from live Ruleset activation. Do not certify a Production promotion or fully tamper-proof GitHub policy from Any source alone.
