# VPS host hygiene: inventory-first, never unattended deletion

This package introduces a **report-only maintenance mechanism** for shared VPS hosts. It is intentionally NOT self-deploying. It does not require credentials or connect to remote systems. GitHub CI validates the policy; the server timer is separately opt-in after owner approval.

## Existing host findings (2026-10-29, read-only)

- /tmp contains ~31 GiB; numerous temporary repository checkouts and Git worktrees with **uncommitted changes**, linked worktrees, or unresolved review evidence. Their modification times and size alone do not prove safe deletion.
- 50 running Docker containers, none unhealthy. Never use docker volume prune, docker system prune, Docker container prune, or global temp deletion.
- Docker image prune cron currently: \`docker image prune -af --filter "until=24h"\` daily. This can discard local rollback images that are no longer attached to containers. A separate weekly \`docker builder prune -f\` is also installed. Review the cron ownership and Coolify cleanup settings before altering either.
- Coolify has its own daily cleanup configuration (threshold 80%, force enabled, unused-volume deletion disabled). The Linux host also has systemd-tmpfiles, logrotate and APT maintenance. Avoid duplicate cleaners.
- Root disk ~79% full; RAM ~17 GiB available; swap 4/4 GiB occupied but memory PSI and sampled swap I/O low. Swap fullness alone must not trigger \`swapoff\` or process termination.

## GitHub as source of truth — removable local checkout policy

User decision (2026-10-29): **a Git checkout on this VPS does not need to be retained when its full recoverable state is already published to GitHub**. This is a recoverability condition, not permission to delete all directories whose `origin` contains `github.com`.

Before removing a local checkout, verify the exact local HEAD **and every local branch tip** are ancestors of a current published GitHub branch (using current remote evidence, not stale `origin/*` refs). Check `git status --porcelain --untracked-files=all` plus ignored files. Ordinary generated Python `__pycache__/*.pyc` may be discarded when corresponding source is published; other untracked, ignored, modified, staged or unpushed files are not recoverable by default. Refuse on linked Git worktrees, subprocesses holding CWD/file descriptors, nested mounts, non-GitHub remotes, deleted branches without a confirmed reachable ancestor, or unresolved private-repository verification.

**Never equate "GitHub repository exists" with "the entire local checkout has a copy."** Verification failure => keep and report. For now the unattended timer remains **report-only**. An eventual controlled reclaimer must operate only on explicit, verified candidates with per-action evidence and a reversible GitHub source receipt.

### Executed one-time cleanup (documented evidence)

Two standalone temporary Git clones, `/tmp/mad4b-pr507-final` and `/tmp/mad4b-runner-current-check`, were proven redundant against live `mad4bdigital-ai/WordPress` `master` using GitHub compare evidence covering local HEAD and branch tips. Their only untracked files were reproducible `.pyc`, no linked worktrees or active process handles existed. Both were removed after revalidation, reclaiming **1,197,330,432 bytes**; Docker remained at 50 running containers with no unhealthy containers. No Git checkout with unpushed source code or unique artifacts was removed.

## Branch lifecycle: GitHub first, verify, then cleanup

Approved source-retention policy: Work in focused feature/fix/ops branches, test the code, review the staged diff for credentials and private data, commit only reviewed source, publish to GitHub, verify the exact remote commit SHA, then remove truly redundant temporary checkouts. Committing source does not upload untracked files, ignored data, database dumps, build evidence or files not included in the commit. Preserve those separately until classified.

| Stage | Gate | Effect |
| --- | --- | --- |
| Build / review | Unit tests + source review, no credentials in commits | Short-lived local branch |
| Publish | Explicit --reviewed and a clean checkout | Non-force push to unique archive/<ticket>-<UTC> branch |
| Verify | Live ls-remote returns exact local HEAD SHA | Private receipt outside checkout (mode 0600) |
| Cleanup | Explicit cleanup --apply, fresh SHA check and matching receipt | Only one named standalone temporary checkout removed |
| Retain | Preserve archive branch until reachable from retained main/release | GitHub remains the recovery authority |

The opt-in helper is ops/vps-maintenance/branch_lifecycle.py. It never stages or commits files, modifies history, force pushes, resets branches, deletes GitHub refs, or cleans other directories. Remote targets must be in the mad4bdigital-ai GitHub scope. For now the daily timer and inventory remain report-only.

Operator example after separately installing the reviewed exact Git commit to /opt/host-hygiene/ and reviewing the branch:

    sudo install -d -m 0700 /var/lib/host-hygiene/receipts

    # Inspect a temporary source checkout (no changes)
    sudo python3 /opt/host-hygiene/branch_lifecycle.py verify \
      --checkout /tmp/mad4b-task-123 --branch archive/task-123-20261029

    # Review code, secrets, private data and Git status; commit approved changes first.
    # Publish a NEW archive ref without force, recheck SHA and write a private receipt:
    sudo python3 /opt/host-hygiene/branch_lifecycle.py publish \
      --checkout /tmp/mad4b-task-123 --branch archive/task-123-20261029 \
      --receipt /var/lib/host-hygiene/receipts/task-123.json --reviewed

    # Read-only cleanup preflight: still no removal
    sudo python3 /opt/host-hygiene/branch_lifecycle.py cleanup \
      --checkout /tmp/mad4b-task-123 --branch archive/task-123-20261029 \
      --receipt /var/lib/host-hygiene/receipts/task-123.json

    # Separate, explicit manual deletion if every check passes:
    sudo python3 /opt/host-hygiene/branch_lifecycle.py cleanup \
      --checkout /tmp/mad4b-task-123 --branch archive/task-123-20261029 \
      --receipt /var/lib/host-hygiene/receipts/task-123.json --apply

The script refuses altered/untracked/ignored files, multiple local branch tips, linked worktrees, unknown remotes, Git submodules/LFS requiring separate proof, mounted paths, live process handles, mismatched SHA or receipt, and attempted deletion outside a one-level temporary checkout. If GitHub refuses a push due to access policy, cleanup is blocked. Never bypass branch protection to purge local storage.

This helper is NOT installed or called on VPS by the PR and is NOT wired to any automatic timer. Production worktrees are never subject to this cleanup path; it is an explicitly approved manual maintenance workflow.

## Contract

The reporter inventories configurable top-level temporary roots, ages, file sizes, and whether an entry appears to be a Git checkout. It skips protected system paths, symlinks and files on other filesystems. It always sets \`eligible_for_automatic_deletion=false\`. It does **not** open file contents, remove data, edit permissions, stop containers, clear memory, or invoke Docker pruning. It writes only one mode-0600 JSON report into its own state directory.

The default policy scans /tmp and /var/tmp after 3 days and reports at most 70 large candidates. Reports are strictly local because path names may contain private identifiers.

\`git_checkout_preserve_for_review\` entries must undergo human/source-control review; even a clean local status is not deletion authorization. Before any future optional cleanup implementation, require remote Git reachability, clean working tree, no linked worktrees, no active file descriptor/CWD, rollback retention windows, and an owner-approved explicit allowlist. Refuse auto-cleanup of Docker volumes, database directories, production logs, backups, release artifacts, mount points, or unknown paths.

## Host activation (NOT executed by this PR)

After approving a separately reviewed, exact Git SHA and verifying backup/access:

1. Install \`guardian.py\` as root-owned mode 0644 under \`/opt/host-hygiene/\`; \`policy.json\` to \`/etc/host-hygiene/\` mode 0644. No remote-file fetch at runtime.
2. Install reviewed \`host-hygiene.service\` and \`host-hygiene.timer\` under \`/etc/systemd/system/\`.
3. Run \`python3 -m unittest discover -s ops/vps-maintenance/tests -v\`, then run the report **without** \`--output\` once and inspect candidate classification.
4. Only after approval, \`systemctl daemon-reload && systemctl enable --now host-hygiene.timer\`; timer never deletes, and its journal is bounded by existing journald rotation.
5. Review \`/var/lib/host-hygiene/report.json\` daily or feed only aggregate metrics (never filenames) into an authenticated MAD4B Control Plane workflow.
6. Rollback is disabling the dedicated timer and removing its dedicated files. It must not alter Coolify, DNS, Docker, backups, or any other service.

## Alerts and response

- Disk warning at 80%; identify largest **verified** abandoned artifacts. Do not delete evidence/recovery sources.
- Swap >90%: assess PSI and swap-in/out trend before changes; avoid \`swapoff -a\`.
- Forced Docker pruning of unused images older than 24h: request review of existing cron and Coolify image-retention policy. Protect rollback images via a coordinated change; do not silently rewrite administrator cron.
- If disk space becomes critical, escalate for a confirmed source-specific cleanup, never global unbounded pruning.

See \`host-hygiene.service\` for sandbox and resource caps; systemd timer starts only when independently enabled by the owner. No production mutation occurs on opening/merging this PR.
