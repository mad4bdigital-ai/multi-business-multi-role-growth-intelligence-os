# Hostinger Node.js Auto Deploy

## Authoritative deployment branch policy

The machine-readable authority is `http-generic-api/config/deployment-branch-policy.json`.

| Hostname | Role | Source branch | Deployment path |
|---|---|---|---|
| `auth.mad4b.com` | Production control plane | `Production` | Hostinger Auto Deploy |
| `dev.mad4b.com` | Planned local staging runtime | `main` | Local device; not Hostinger Auto Deploy |
| `connector.mad4b.com` | Admin-only break-glass local connector | Managed local Windows service | Cloudflare Tunnel; not Hostinger |

A push or merge to `main` must not deploy production directly. `main` is the source-of-change branch and the source for the planned local staging runtime. Production changes reach Hostinger only after a governed pull request promotes an exact validated `main` snapshot into protected `Production`.

## Production release flow

```text
feature branch
  -> pull request to main
  -> exact-head CI and review
  -> merge to main
  -> governed promotion candidate
  -> pull request from candidate to Production
  -> exact candidate CI and typed approval
  -> merge to Production
  -> Hostinger Auto Deploy
  -> /health + /version + /deployment-info exact-SHA readback
```

The merge into `Production` is the deployment trigger. A merge into `main` creates a production-promotion backlog only.

Do not push directly or force-push to `Production`. Do not treat branch ancestry, a successful GitHub merge, Hostinger build acceptance, or filesystem checkout alone as proof that production is live.

## Repository runtime contract

Hostinger uses the repository root.

```json
{
  "scripts": {
    "start": "node server.js",
    "postinstall": "cd http-generic-api && npm ci --omit=dev"
  }
}
```

Required runtime:

```text
Node.js 22
App root: repository root
Start command: npm start
```

The root `server.js` wrapper enters `http-generic-api` and starts the ESM runtime. Startup failures must preserve the full stack trace.

## Hostinger hPanel production setup

Configure only the production Node.js app through this Hostinger flow.

1. Open the `auth.mad4b.com` Node.js app in hPanel.
2. Connect repository `mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os`.
3. Select branch `Production`.
4. Use the repository root as the app root.
5. Use `npm start` as the start command.
6. Enable Auto Deploy on pushes to `Production`.
7. Keep secrets and runtime environment variables in hPanel only.
8. Set explicit deployment provenance:

```text
DEPLOYMENT_BRANCH=Production
```

Hostinger may use a detached checkout. Git `HEAD`, hostname inference, or branch ancestry is not authoritative deployment evidence. `/version` and `/deployment-info` must report an explicit manifest branch of `Production` and the exact deployed commit SHA.

## Planned staging environment

`dev.mad4b.com` is reserved for a future staging runtime built on the local device.

Its source branch is `main`, but it must not be connected to Hostinger Auto Deploy. When implemented, the local staging runtime must expose bounded deployment evidence and remain isolated from production traffic and production mutations.

Expected future provenance:

```text
hostname: dev.mad4b.com
source branch: main
runtime location: local device
deployment mode: local staging runtime
Hostinger Auto Deploy: disabled
```

Until that local runtime exists and passes its own governance/readback checks, `dev.mad4b.com` must be treated as planned or unavailable, not as production fallback.

## Production verification

After every Hostinger Auto Deploy triggered by `Production`, verify in the same operational cycle:

```text
https://auth.mad4b.com/health
https://auth.mad4b.com/version
https://auth.mad4b.com/deployment-info
https://auth.mad4b.com/connector-agent/version
```

Required evidence:

- GitHub protected `Production` SHA after merge;
- Hostinger build created after that merge;
- deployment manifest branch equals `Production`;
- deployed commit equals the exact protected `Production` SHA;
- `/health` is healthy;
- `/version` reports the same commit;
- `/deployment-info` does not rely on hostname fallback;
- connector-agent distribution is present when connector code changed.

If the build succeeds but the running process reports an older SHA, classify the release as runtime reload lag. Use hPanel restart/redeploy and repeat readback. Do not mark production current from build status alone.

## Production promotion automation

Use the source-pinned flow documented in `docs/production-promotion-candidate-automation.md`.

The candidate must preserve:

- exact `main` source SHA;
- exact current `Production` SHA;
- tree equality with the approved `main` snapshot;
- fast-forward-safe candidate updates;
- exact candidate CI;
- explicit merge approval for the same candidate SHA.

The promotion workflow prepares and validates candidates. It does not merge `Production` and does not deploy Hostinger.

## Runtime synchronization and recovery

Use `http-generic-api/docs/hostinger-runtime-sync-runbook.md` when:

- `main` contains approved changes not yet promoted;
- `Production` is behind the intended `main` snapshot;
- Hostinger has not built the latest `Production` merge;
- runtime readback does not match protected `Production`;
- the process loaded stale code after file synchronization.

Normal recovery order:

1. establish the exact expected `Production` SHA;
2. confirm all exact-head CI and approval evidence;
3. let Hostinger Auto Deploy run from `Production`;
4. use hPanel restart/redeploy only when runtime reload lags;
5. repeat `/health`, `/version`, and `/deployment-info` readback.

Any governed SSH executor is break-glass only. It must remain target-bound, exact-SHA-bound, approval-bound, time-limited, and followed by runtime parity readback. It is not the normal deployment path.

## Connector boundary

`connector.mad4b.com` is not a Hostinger Node.js app. It must continue to route through Cloudflare Tunnel to the active Windows `local-connector/server.mjs` service.

Do not deploy `http-generic-api/server.js` to `connector.mad4b.com`. Its health response must identify the local connector service and Windows platform. This separate path is required for recovery when Hostinger or `auth.mad4b.com` is unavailable.

## Database and migration separation

Repository merge, `Production` promotion, Hostinger deployment, process restart, and SQL migration are separate states.

A deployment never authorizes SQL apply. Every migration still requires:

- exact checksum and statement count;
- governed authorization;
- dry-run/preflight;
- typed confirmation where required;
- apply ledger entry;
- same-cycle schema and runtime readback.

## Security boundaries

- Never commit `.env`, API keys, private keys, Hostinger credentials, Cloudflare tokens, or provider secrets.
- Keep production secrets in hPanel environment variables.
- Do not store deployment secrets in GitHub Actions when Hostinger Auto Deploy is sufficient.
- Do not use manual ZIP upload except for an explicitly approved emergency rollback.
- Do not interpret an accepted deployment request as completed without readback.
- Record only bounded, non-secret deployment evidence.

## Rollback

Use Hostinger hPanel deployment history to return to a previously verified `Production` release. After rollback, verify `/health`, `/version`, and `/deployment-info` against the selected rollback SHA.

Rollback does not rewrite `main` or `Production` automatically. Any permanent repository correction requires a normal reviewed change and a new governed promotion.
