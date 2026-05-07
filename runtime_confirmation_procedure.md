# Runtime Confirmation Procedure
**Authority document — run after every deployment before marking it complete**

This procedure produces a repeatable, evidence-backed runtime confirmation. File-level CI passing does not constitute deployment confirmation. Runtime confirmation is a separate, required step.

---

## Prerequisites

- Deployed runtime is reachable at a known `BASE_URL`
- `BACKEND_API_KEY` is available (if the deployment requires auth)
- You are on or have access to the commit that was deployed (`git rev-parse HEAD`)

---

## Step 1 — Record deployment context

Before running any checks, record:

```
Deployed commit:   <output of: git rev-parse HEAD>
Deployed at:       <ISO timestamp>
Deployed by:       <your name / operator>
Environment:       <staging | production | other>
Runtime URL:       <BASE_URL>
```

---

## Step 2 — Run the automated verification script

```bash
RUNTIME_BASE_URL=https://your-deployment.example.com \
BACKEND_API_KEY=your-api-key \
node http-generic-api/verify-runtime.mjs
```

This script checks governed behaviors:
1. `GET /health` — runtime is up, returns `ok: true`
2. Authentication — authorized requests accepted, unauthorized blocked (if applicable)
3. Dry-run site migration — `POST /site-migrations` with `apply: false` does not crash
4. Local dispatch — `POST /http-execute` with `github_git_blob_chunk_read` does not throw `ReferenceError`
5. Async job queue — `POST /jobs` enqueues and `GET /jobs/:id` returns a known status
6. Governance Validation Engine — `POST /governance/validate-execution` returns expected validation status
7. Local Connector Governance — `GET /local-connector/install/status` returns install state for mohammedlap
8. Dispatch routing — `GET /dispatch/routes` returns active task_routes with `directly_dispatched` flags
9. Dispatch intent — `POST /dispatch` with `intent_key=local.health.check` returns `ok` or expected error shape (not 500)

**Passing output ends with:**
```
RUNTIME VERIFICATION PASS ✓
Deployment claims are supported by live runtime evidence.
```

**Failing output ends with:**
```
RUNTIME VERIFICATION FAILED — N check(s) indicate drift or outage
```

---

## Step 3 — Run via GitHub Actions (optional but recommended for production)

Trigger the `Verify Runtime` workflow manually:

1. Go to **Actions** → **Verify Runtime** → **Run workflow**
2. Set `runtime_base_url` to the deployment URL
3. Set `environment_label` to `staging` or `production`
4. Click **Run workflow**

The workflow records the commit SHA, runtime URL, and verification result in the Actions log — this is your permanent evidence record.

---

## Step 4 — Confirm registry alignment (manual)

In the MySQL database (via direct query or API endpoint), verify:
- [ ] `Site Runtime Inventory Registry` is readable and has expected columns
- [ ] `Execution Log Unified` received at least one writeback row since deployment
- [ ] No policy rows contain unsupported custom literals that would bypass normalization

For activation confirmation, do not stop at `/health`, `/status`, release readiness, tenant listing, or count routes. Those checks prove diagnostics only. Activation confirmation requires Drive validation, Sheets `getSheetValues` row readback for `Activation Bootstrap Config!A2:J2` using `path_params.spreadsheetId=<activation_bootstrap_spreadsheet_id>` (use this exact literal string, the backend auto-resolves it), and GitHub validation using bootstrap/registry-resolved keys.

---

## Step 5 — Record final parity result

Complete the deployment version stamp:

```
Deployed commit:   <git rev-parse HEAD>
Deployed at:       <ISO timestamp>
Deployed by:       <operator>
Layer 1 (CI):      PASS  — syntax + 168 tests + 104 architecture checks
Layer 2 (registry): PASS / FAIL / SKIP — <notes>
Layer 3 (runtime):  PASS / FAIL — verify-runtime.mjs result
Layer 4 (live):     PASS / FAIL / SKIP — <notes>
```

A deployment is **complete** only when Layers 1 and 3 both pass.

---

## Drift resolution

If `verify-runtime.mjs` fails, classify the failure using the drift table in [`deployment_parity_checklist.md`](deployment_parity_checklist.md) and resolve before proceeding.

| Failure pattern | First resolution step |
|---|---|
| `GET /health` 0 / unreachable | Check process is running and port is open |
| `GET /health` 500 | Check startup logs for module load errors |
| Health/status pass but Drive or Sheets bootstrap was skipped | Treat activation as degraded; run the provider bootstrap chain |
| Dry-run 500 with ReferenceError | Revert to last passing commit, check extracted module imports |
| Dispatch returns unexpected shape | Check `dispatchEndpointKeyExecution` wiring in `jobRunner.js` |
| Job status not a known value | Check `normalizeJobStatus` in `jobUtils.js` |
| Registry sheet missing columns | Align sheet structure with `siteInventoryRegistry.js` column constants |

---

## Current runtime notes

The runtime now exposes additional operational truth that should be considered during confirmation:

- `GET /health` may return `status: "degraded"` while still returning `ok: true`
- health responses now expose `dependencies.redis`, `dependencies.queue`, and `dependencies.worker.enabled`
- async submission endpoints (`POST /jobs`, `POST /site-migrate`) now return a truthful `503` when the queue backend cannot accept work
- instances may run in API-only mode with `QUEUE_WORKER_ENABLED=FALSE`

Interpretation guidance:

- `ok: true` plus `status: "degraded"` means the HTTP runtime is up, but at least one dependency is not in the expected state
- `dependencies.worker.enabled: false` is valid when the instance is intentionally deployed as API-only
- a `503` from async submission endpoints is a queue/dependency failure signal, not a request-schema failure

---

## Automated CI vs manual confirmation

| Check | Automated in CI | Requires live runtime |
|---|---|---|
| Module syntax | ✅ | ❌ |
| Unit + integration tests (150+) | ✅ | ❌ |
| Architecture export floor | ✅ | ❌ |
| Inline redefinition drift | ✅ | ❌ |
| server.js size guard | ✅ | ❌ |
| Health endpoint | ❌ | ✅ |
| Dry-run migration | ❌ | ✅ |
| Dispatch ReferenceError check | ❌ | ✅ |
| Job queue round-trip | ❌ | ✅ |
| `GET /dispatch/routes` returns active routes | ❌ | ✅ |
| `POST /dispatch` intent resolution (local.health.check) | ❌ | ✅ |
| Local connector install/status check | ❌ | ✅ |
| Registry sheet writeback | ❌ | ✅ (manual) |

---
**Documentation Integrity:** This confirmation procedure must remain aligned with the [Canonical Sources](canonicals/) and the [Agent Knowledge Guide](AI_Agent_Knowledge_Guide.md). Any structural changes must be propagated across all three layers as defined in the [README Documentation Architecture](README.md#documentation-integrity-architecture).
