# Hostinger Runtime Sync Guard

## Branch authority

The machine-readable authority is `http-generic-api/config/deployment-branch-policy.json`.

`Production` is the only Hostinger Auto Deploy source for `auth.mad4b.com`.

`main` is the source-of-change branch and the source for the planned local staging runtime. It does not deploy production directly.

## Mandatory `main` to `Production` synchronization

Every approved movement of `main` creates a production-promotion backlog until the intended snapshot is represented by a validated candidate and merged into protected `Production`.

Required sequence:

1. Read the exact source SHA from `main`.
2. Read the exact current protected `Production` SHA.
3. Build or refresh a governed candidate whose tree equals the approved `main` snapshot and whose ancestry preserves the current `Production` head.
4. Run exact candidate CI and require successful Syntax Check, Unit & Integration Tests, Architecture Drift Detection, Execution Resolver Gate, and relevant generated-contract checks.
5. Obtain review and typed approval for the exact candidate SHA.
6. Merge the candidate to `Production` without force push.
7. Confirm the new protected `Production` SHA.
8. Hostinger must build the exact resulting `Production` SHA through Auto Deploy.
9. Verify `/health`, `/version`, and `/deployment-info` against that same SHA.

A successful merge to `main` is not a production deployment. A successful merge to `Production` is only the deployment trigger; it is not runtime proof.

## Trigger conditions

Use this runbook when any of the following is true:

- `main` contains approved changes not yet promoted to `Production`;
- a Production candidate is stale against either protected branch;
- Hostinger has not created a build after the latest `Production` merge;
- the Hostinger build completed but runtime readback reports an older commit;
- the Hostinger filesystem contains the expected files but the process still serves older code;
- production route or contract behavior differs from the exact protected `Production` tree;
- a database repair succeeded but the loaded runtime remains stale.

## Required preflight

Before production promotion:

1. Confirm exact-head CI for the intended `main` snapshot.
2. Confirm generated artifacts are current.
3. Confirm the current `Production` head has not moved since candidate construction.
4. Confirm candidate tree equality with the approved `main` snapshot.
5. Confirm candidate ancestry preserves the current `Production` head.
6. Confirm no unresolved review threads or required-check failures.
7. Confirm deployment and migration scopes remain separate.

Before declaring production live:

1. Read protected `Production` again.
2. Confirm Hostinger built after the merge timestamp.
3. Confirm deployment manifest branch equals `Production`.
4. Confirm deployment manifest commit equals protected `Production`.
5. Confirm `/health` is healthy.
6. Confirm `/version` reports the same commit.
7. Confirm `/deployment-info` uses explicit branch and commit evidence.
8. Run targeted route or connector-agent readback when the release changes those surfaces.

## Normal Auto Deploy path

The normal production path is:

```text
merge to Production
  -> Hostinger detects Production push
  -> Hostinger installs dependencies
  -> npm start
  -> root server.js starts http-generic-api
  -> deployment manifest records Production + exact commit
  -> runtime parity readback
```

Do not configure the production Hostinger app to follow `main`.

Do not configure `dev.mad4b.com` as another Hostinger production app. Its planned staging runtime is local and uses `main` as its source branch.

## Runtime reload lag

A Hostinger build may update files before the live Node.js process reloads.

Classify this as runtime reload lag when:

- filesystem or build evidence matches the expected protected `Production` SHA; and
- `/health`, `/version`, or route behavior still reflects an older release.

Recovery order:

1. use hPanel restart or settings-and-redeploy;
2. repeat `/health` and `/version` readback;
3. confirm exact commit parity;
4. use a governed break-glass executor only when normal Hostinger controls cannot recover the process and explicit authority exists.

An accepted restart or deployment request is not completion. Require readback.

## Break-glass executor boundary

Any Hostinger SSH deploy executor is temporary recovery infrastructure only.

It must require:

- a registered production target;
- exact expected protected `Production` SHA;
- target-specific resource authority;
- dry-run readiness;
- a fresh capability envelope;
- typed approval;
- bounded commands and output;
- no force push or arbitrary shell;
- `/health` and `/version` readback;
- expiry or explicit disablement after recovery.

The break-glass path must not become the default deployment mechanism and must not bypass Hostinger Auto Deploy branch authority.

## Staging boundary

`dev.mad4b.com` is planned as a local-device staging runtime sourced from `main`.

Until implemented, classify it as planned or unavailable. Do not use it as a production traffic fallback and do not infer staging validation from GitHub CI alone.

When implemented, it must expose bounded evidence for:

- hostname;
- source branch `main`;
- exact commit;
- local runtime identity;
- health status;
- deployment timestamp;
- no-secret validation state.

## Connector boundary

`connector.mad4b.com` remains a Cloudflare Tunnel to the Windows local connector. It is not synchronized through Hostinger and must remain available as a separate recovery surface.

Do not deploy the production Node.js application to the connector hostname.

## Evidence to record

Record bounded, non-secret evidence for:

- source `main` SHA;
- previous and resulting protected `Production` SHAs;
- candidate SHA and tree equality;
- exact-head CI results;
- review and approval identity/reference;
- Hostinger build identifier and timestamps;
- deployment manifest branch and commit;
- `/health`, `/version`, and `/deployment-info` results;
- process restart/redeploy action when required;
- targeted runtime symbol or route readback;
- remaining migration or provider certification gaps.

Never record raw credentials, authorization headers, private keys, provider tokens, database passwords, or unbounded runtime output.

## Deployment and database separation

Repository promotion, Hostinger deployment, runtime reload, migration application, and provider certification are separate states.

Do not mark a SQL or dispatcher rollout complete from branch or runtime parity alone. Migrations require checksum-bound authorization, preflight, apply, ledger evidence, and same-cycle schema/runtime readback.

A database repair that clears a query error before process reload must be recorded separately from runtime deployment status.

## Prohibited shortcuts

- Do not connect the production Hostinger app to `main`.
- Do not push or force-push directly to protected `Production`.
- Do not claim deployment from GitHub merge status alone.
- Do not claim runtime parity from Hostinger build acceptance alone.
- Do not replace exact-SHA readback with hostname fallback.
- Do not use arbitrary SSH or unregistered shell commands.
- Do not treat `dev.mad4b.com` as a production fallback.
- Do not apply SQL as part of repository or Hostinger deployment without separate governed authorization.

## Completion classification

Use these states:

- `production_sync_required`: intended `main` snapshot is not represented in protected `Production`;
- `production_candidate_validation_required`: candidate exists but exact CI/approval is incomplete;
- `hostinger_build_pending`: `Production` moved but no fresh Hostinger build is confirmed;
- `runtime_reload_pending`: build/files are current but the process is stale;
- `runtime_parity_incomplete`: required readback is absent or mismatched;
- `production_current`: protected `Production`, Hostinger manifest, and live runtime all match the exact same SHA.

Only `production_current` closes the runtime synchronization path.
