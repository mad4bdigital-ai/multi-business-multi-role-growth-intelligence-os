# Requirements Checklist

## Problem and scope

- [x] The problem is clearly stated: config can exist while runtime/tunnel/host reachability is unknown or failing.
- [x] Tenant auth-host and admin break-glass channels are separated.
- [x] Format, Windows reinstall, device replacement, and multiple-device scenarios are covered.
- [x] Non-goals exclude runtime mutation in the specification PR.

## Functional coverage

- [x] Canonical device identity is required.
- [x] Device aliases are display/search metadata, not authority.
- [x] Route registration is separate from config presence.
- [x] Heartbeat and probe evidence are separate health sources.
- [x] Recovery preview is separated from installer generation.
- [x] Fresh authorization is required for privileged installer generation.
- [x] Same-cycle readback is required before recovered status.
- [x] Break-glass is admin-only.

## API coverage

- [x] Device listing contract exists.
- [x] Reachability readback contract exists.
- [x] Recovery plan preview contract exists.
- [x] Recovery action contract exists.
- [x] Heartbeat ingest contract exists.
- [x] Admin probe contract exists.
- [ ] Contract examples must be validated in implementation PR.
- [ ] OpenAPI generation/sync must be updated in implementation PR.

## Data coverage

- [x] Canonical device table proposed.
- [x] Device alias table proposed.
- [x] Route registry table proposed.
- [x] Heartbeat evidence table proposed.
- [x] Probe evidence table proposed.
- [x] Recovery plan table proposed.
- [x] Route lifecycle profile extensions proposed.
- [ ] Physical migration SQL must be written and reviewed.
- [ ] Migration readback must confirm tables, indexes, and constraints.

## Operational coverage

- [x] Runbook for both paths returning 502 exists.
- [x] Runbook for format/reinstall exists.
- [x] Runbook for multiple devices exists.
- [x] Alert types are listed.
- [x] SLO/freshness assumptions are stated.
- [ ] Production alert wiring must be implemented later.
- [ ] Canary readback must be captured before closeout.

## Parallel execution coverage

- [x] Implementation lanes are separated.
- [x] Parallel execution matrix is documented.
- [x] Stop conditions are documented.
- [x] Feature flags are listed.
- [ ] Owners for each lane must be assigned before implementation.
- [ ] Integration milestones across lanes must be scheduled.
