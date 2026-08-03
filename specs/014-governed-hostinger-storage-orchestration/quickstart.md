# Quickstart

This quickstart is for repository development and synthetic fixtures only. It does not authorize or perform live Hostinger cleanup.

## Prerequisites

- Node.js 22.
- Bash with GNU `find`, `stat`, `realpath`, `sha256sum`, and `base64`.
- Repository checkout on the feature branch.
- No production credentials are required.

## Validate current contracts

```bash
node -e "JSON.parse(require('node:fs').readFileSync('http-generic-api/config/hostinger-storage-cleanup-policy.json','utf8'))"
node -e "JSON.parse(require('node:fs').readFileSync('http-generic-api/config/hostinger-storage-orchestration-policy.json','utf8'))"
node -e "JSON.parse(require('node:fs').readFileSync('specs/014-governed-hostinger-storage-orchestration/manifest.json','utf8'))"
node -e "JSON.parse(require('node:fs').readFileSync('specs/014-governed-hostinger-storage-orchestration/work-map-integration.json','utf8'))"
```

## Run safe regression tests

```bash
bash -n http-generic-api/scripts/hostinger-storage-cleanup.sh
node http-generic-api/scripts/test-hostinger-storage-cleanup-script.mjs
node http-generic-api/test-hostinger-storage-orchestration-policy.mjs
node http-generic-api/scripts/spec-kit-work-map-governance-gate.mjs --ci --changed
```

## Read-only local fixture scan

Create a disposable directory:

```bash
FIXTURE="$(mktemp -d)"
mkdir -p "$FIXTURE/.npm/_cacache" "$FIXTURE/.npm/_logs" "$FIXTURE/logs" "$FIXTURE/public_html"
printf 'old cache\n' > "$FIXTURE/.npm/_cacache/old-cache"
printf 'active app\n' > "$FIXTURE/public_html/server.js"
touch -d '20 days ago' "$FIXTURE/.npm/_cacache/old-cache"
```

Run scan:

```bash
HOME="$FIXTURE" \
  bash http-generic-api/scripts/hostinger-storage-cleanup.sh \
  scan --root "$FIXTURE"
```

Expected properties:

- JSON output with `action=scan`;
- byte and inode inventory;
- no deletion;
- no state directory created;
- `secrets_included=false`.

## Create and inspect a synthetic plan

```bash
PLAN_JSON="$({
  HOME="$FIXTURE" bash http-generic-api/scripts/hostinger-storage-cleanup.sh \
    plan --root "$FIXTURE"
})"
printf '%s\n' "$PLAN_JSON"
```

Extract `plan_id` with an available JSON tool, then:

```bash
HOME="$FIXTURE" bash http-generic-api/scripts/hostinger-storage-cleanup.sh \
  inspect --root "$FIXTURE" --plan-id '<PLAN_ID>'
```

The plan must not include `public_html` and must not delete anything.

## Synthetic apply

Use only the fixture and copy the exact `plan_hash` and `confirmation` returned by the plan:

```bash
HOME="$FIXTURE" bash http-generic-api/scripts/hostinger-storage-cleanup.sh \
  apply \
  --root "$FIXTURE" \
  --plan-id '<PLAN_ID>' \
  --expected-plan-hash '<PLAN_HASH>' \
  --confirm '<EXACT_CONFIRMATION>'
```

Verify:

- eligible old cache/log candidates are removed;
- `public_html/server.js` remains;
- changed/replaced candidates are skipped;
- a second apply is rejected.

Remove the disposable fixture after inspection:

```bash
rm -rf -- "$FIXTURE"
```

The `rm -rf` command above is for the locally created `mktemp` fixture only and is not part of the production cleanup tool.

## Authority policy examples

Run the policy regression:

```bash
node http-generic-api/test-hostinger-storage-orchestration-policy.mjs
```

It covers:

- Admin and Tenant context separation;
- Tenant Operator vs Workspace Owner;
- platform/tenant/shared targets;
- Admin delegation/support boundary;
- shared impact approvals;
- reserve incident requirement;
- revision/plan binding;
- unknown-outcome state transitions.

## Work Map validation

```bash
node http-generic-api/scripts/spec-kit-work-map-governance-gate.mjs --ci --changed
```

When `main` changes Work Maps or schema classification, regenerate/review `work-map-integration.json` before continuing implementation.

## Live Hostinger prohibition

Do not copy or execute the apply command on Hostinger until all of the following exist and are certified:

- live Context Kernel and authority wiring;
- durable plans/approvals/leases/runs;
- pinned SSH host key;
- fixed worker adapter;
- hPanel quota evidence;
- actual target/deployment layout certification;
- synthetic apply and unknown-outcome drills;
- explicit phase rollout approval.

The only permitted first live operation is an explicitly authorized read-only `scan` through the future certified adapter.
