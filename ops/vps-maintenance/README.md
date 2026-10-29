# VPS host hygiene: inventory-first, never unattended deletion

This package introduces a **report-only maintenance mechanism** for shared VPS hosts. It is intentionally NOT self-deploying. It does not require credentials or connect to remote systems. GitHub CI validates the policy; the server timer is separately opt-in after owner approval.

## Existing host findings (2026-10-29, read-only)

- /tmp contains ~31 GiB; numerous temporary repository checkouts and Git worktrees with **uncommitted changes**, linked worktrees, or unresolved review evidence. Their modification times and size alone do not prove safe deletion.
- 50 running Docker containers, none unhealthy. Never use docker volume prune, docker system prune, Docker container prune, or global temp deletion.
- Docker image prune cron currently: \`docker image prune -af --filter "until=24h"\` daily. This can discard local rollback images that are no longer attached to containers. A separate weekly \`docker builder prune -f\` is also installed. Review the cron ownership and Coolify cleanup settings before altering either.
- Coolify has its own daily cleanup configuration (threshold 80%, force enabled, unused-volume deletion disabled). The Linux host also has systemd-tmpfiles, logrotate and APT maintenance. Avoid duplicate cleaners.
- Root disk ~79% full; RAM ~17 GiB available; swap 4/4 GiB occupied but memory PSI and sampled swap I/O low. Swap fullness alone must not trigger \`swapoff\` or process termination.

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
