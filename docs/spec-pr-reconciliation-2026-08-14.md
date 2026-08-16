# Repository-wide Spec/PR Reconciliation — 2026-08-14

## Purpose and authority

This record reconciles the current GitHub pull-request surface against the merged implementation evidence on `main`. It supersedes the older report’s assumption that PR #6950 was still open and that PR #6886 had not merged. The authoritative repository head for this record is `main@eafa2a560b4cff4d762ac15cc58eedeb2a10bbc1`.

The record is intentionally **non-destructive**. It does not close, merge, delete, or rewrite any pull request or branch. Those actions remain subject to independent review and explicit governance approval. The classifications below are routing decisions for future work, not claims that a pull request was merged.

## Current pull-request surface

At the time of collection, GitHub reported **49 open pull requests** targeting `main`, including **26 conflicting** pull requests, **17 drafts**, **23 mergeable** pull requests, and **25 dirty** pull requests. A substantial portion of the open surface is historical work whose base branch is no longer current. The current collection was obtained from the repository’s open pull-request API on 2026-08-14.

| Classification | Meaning | Required next action |
|---|---|---|
| **Absorbed** | The capability is represented by newer merged code and its remaining value is evidence or documentation. | Record the newer owner and do not merge the historical PR as-is. |
| **Superseded** | The PR’s scope is replaced by a newer Spec or merged implementation. | Close or label only after independent review confirms no unique residual delta. |
| **Still required** | The scope remains in the approved backlog, but the branch is stale or needs rebasing onto current `main`. | Extract residual scope into a fresh current-main PR. |
| **Review required** | The title or branch overlaps a governed surface, but the current evidence is insufficient to close it automatically. | Perform a file-level comparison before any closure. |

## Selected reconciliation matrix

| PR | Current state | Classification | Current owner or reason |
|---:|---|---|---|
| #6950 | Merged on 2026-08-13 | **Absorbed** | Repository reconciliation, canonical resource registry, deployment attestation, runtime integrity, and break-glass closure are now on `main` at merge SHA `273a642e7aae0eb3cbb1e3fb8ab665d4524da900`. |
| #6886 | Merged on 2026-08-13 | **Absorbed** | Spec 018 break-glass D01–D06 are represented on `main`; D07–D13 remain open in Spec 018. |
| #3136 | Open, conflicting/dirty | **Superseded** | Catalog V2 was delivered by merged PR #3260 and its completion ledger is now closed on current `main`. |
| #2949 | Draft, conflicting/dirty | **Superseded** | Database-driven Operation Fabric is recorded as complete; do not merge the historical Spec PR as a second implementation. |
| #2172 | Open, conflicting/dirty | **Absorbed** | Dynamic capability operational-alert slices are represented by merged PRs recorded in Spec 007 and the consolidated governance work. Residual 007 shadow/canary debt remains tracked in its ledger. |
| #2284 | Draft, mergeable/clean but stale | **Superseded** | Governed PR delivery is now owned by repository reconciliation and current governed delivery controls; extract only unique residual gaps. |
| #2030 | Draft, conflicting/dirty | **Superseded** | Authority hardening is owned by UEACP and the consolidated runtime governance work; no standalone historical merge should be attempted. |
| #3160 | Draft, conflicting/dirty | **Superseded** | Binding eligibility consolidation is replaced by the merged UEACP slices and current-main source-of-truth evidence. |
| #2950 | Draft, conflicting/dirty | **Still required** | Tenant GPT Effective Capability Envelope remains a P1 consumer of UEACP/Context/Operation Fabric; create a new current-main implementation PR rather than rebasing the historical branch in place. |
| #3193, #3175, #3177, #3198, #3206 | Open and mergeable/unstable | **Still required / review required** | These are possible P1 binding slices. Compare each file set against the merged UEACP slices before selecting any residual work. |
| #2385, #2642 | Draft/open with stale branches | **Still required** | Local Connector Reachability remains a P4 backlog item; preserve the design intent but do not merge stale code directly. |
| #2470, #3151 | Open, conflicting/dirty | **Review required** | These touch broad Admin/Tenant or Hostinger/runtime surfaces and need file-level evidence before supersession. |

## Decision rules for the next loop

No historical PR is treated as a source of truth merely because its title matches a Spec. The next implementation vehicle must start from current `main`, cite the owning Spec, list the absorbed PRs, and include a residual-gap diff. A PR may be closed as superseded only after its unique changed files and commits have been compared against the owner’s merged evidence.

The reconciliation does not authorize migrations, provider mutations, Production deployment, Cloudflare or Hostinger changes, write-scope activation, or automatic PR closure. It also does not grant runtime authority to any shadow/default-off component.

## Sources

1. [Repository main](https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/tree/main)
2. [PR #6950](https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/pull/6950)
3. [PR #6886](https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/pull/6886)
4. [PR #3260](https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/pull/3260)
5. [PR #2950](https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/pull/2950)
