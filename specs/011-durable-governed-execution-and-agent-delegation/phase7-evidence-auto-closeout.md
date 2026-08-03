# Phase 7 — Evidence Auto-Closeout

## Purpose

Phase 7 converts authoritative implementation evidence into a bounded, reviewable closeout pull request. It composes existing structured diagnosis, repository patch, GitHub endpoint dispatch, mutation approval, audit, and readback authorities.

It does not create a second evidence database, a second repository writer, or an unreviewed GitHub transport.

## Authority chain

```text
authoritative readers
→ evidence packet and fingerprint
→ semantic change generator
→ structured pre-commit validator
→ repo_patch_batch_apply
→ exact branch-head readback
→ github_rest_endpoint_dispatch
→ github_create_pull_request
→ github_get_pull_request
→ governed managed-delivery lifecycle
```

All repository and GitHub writes remain subject to existing capability, mutation approval, audit, idempotency, and same-cycle readback controls.

## T220 — Authoritative evidence collector

`collectAuthoritativeEvidence()` invokes one reviewed reader for each required source family.

Supported families:

- pull request;
- workflow run;
- workflow artifact;
- main readback;
- migration ledger;
- Production parity;
- post-merge audit.

Every observation is bound to:

- evidence id;
- closeout subject;
- source family;
- authoritative source reference;
- immutable SHA-256 digest;
- observed timestamp;
- passing or verified status;
- no-secret boundary.

The collector rejects missing or duplicate families, ambiguous cardinality, stale observations, subject mismatch, non-authoritative references, failed evidence, mutable evidence, and secret-like fields or values.

## T221 — Governed document schemas

Phase 7 defines schemas for:

- authoritative evidence packet;
- semantic closeout change set.

The change set covers exactly these document classes:

- `manifest.json`;
- `completion.json`;
- requirements or release checklist Markdown;
- `tasks.md`;
- delivery-state JSON.

Each generated change includes the expected Git blob SHA, before/after content SHA-256, bounded after-content, semantic operations, evidence ids, parse state, completion-contract state, and no-secret flag.

## T222 — Semantic closeout generation

JSON documents use explicit JSON Pointer set operations.

Markdown tasks and checklist items use unique exact semantic anchors. A checkbox is changed only when its anchor resolves exactly once and the requested closure cites evidence ids in the validated packet.

The generator refuses arbitrary path traversal, duplicated document classes, invalid JSON, missing evidence references, empty or oversized change sets, and terminal completion claims that lack:

- every task completed;
- migration-ledger evidence;
- Production parity evidence;
- post-merge audit evidence.

The system therefore preserves `in_progress` whenever known work or operational evidence remains open.

## T223 — Pre-commit and CI validation

`validateCloseoutChangeSet()` validates:

- canonical version and evidence fingerprint;
- at most five governed files;
- exact expected Git blob SHAs;
- before/after SHA-256 contracts;
- recomputed after-content digest;
- semantic operation coverage;
- bounded content;
- JSON parseability;
- completion contract validity;
- structured diagnosis coverage;
- no-secret boundary.

`.github/workflows/spec-011-evidence-auto-closeout.yml` runs syntax, lifecycle, schema, unknown-outcome, and no-bypass tests and uploads bounded certification evidence even on failure.

## T224 — Governed closeout PR creation

`createGovernedCloseoutPullRequest()` requires typed confirmation:

```text
CREATE_GOVERNED_CLOSEOUT_PR
```

After validation it:

1. previews the change through `repo.change.preview` and `pr_delivery`;
2. applies all generated files atomically through `repo_patch_batch_apply`;
3. requires exact branch-head and changed-path readback;
4. opens the PR through `github_rest_endpoint_dispatch` and the registered `github_create_pull_request` endpoint;
5. reads the PR through the registered `github_get_pull_request` endpoint;
6. verifies PR number, open state, head branch, head SHA, and base branch.

If patch or PR creation returns an unknown outcome, the system performs readback. It never repeats the mutation automatically. Zero matching PRs remain `reconciliation_required`; multiple matches are blocked as ambiguous.

## Safety boundaries

- No force push.
- No protected-branch direct write.
- No raw HTTP method, URL, or authorization header from the caller.
- No closure from failed, stale, mutable, or unrelated evidence.
- No task or checklist update without evidence ids.
- No terminal completion while tasks or required operational evidence remain open.
- No real repository write or PR creation in the certification workflow.
- No Production database mutation, migration authorization, provider write, deployment, runtime authority activation, or secret exposure.
